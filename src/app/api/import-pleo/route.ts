export const maxDuration = 300; // 5 minutes

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function extractReceiptItems(
  fileBuffer: ArrayBuffer,
  mediaType: "application/pdf" | "image/jpeg" | "image/png"
): Promise<unknown[] | null> {
  try {
    const base64 = Buffer.from(fileBuffer).toString("base64");

    const contentBlock =
      mediaType === "application/pdf"
        ? {
            type: "document" as const,
            source: { type: "base64" as const, media_type: mediaType, data: base64 },
          }
        : {
            type: "image" as const,
            source: { type: "base64" as const, media_type: mediaType, data: base64 },
          };

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            contentBlock,
            {
              type: "text",
              text: `Extract product lines from this receipt as a JSON array.
Each item must have: product_name, quantity, unit_price, total.

IMPORTANT for unit_price: always return the price per individual sellable unit (excl. VAT).
If a product is sold as a case/box/pack, divide the case price by units per case.
Example: "Coca-Cola 33cl x24, 1 case, 103.98" → unit_price: 4.33 (103.98/24), quantity: 24
Example: "Sandwich 175g, 24 pcs, 20.00 each" → unit_price: 20.00, quantity: 24

Return ONLY a valid JSON array, no explanation. If no product lines, return: []`,
            },
          ],
        },
      ],
    });

    let text = message.content[0].type === "text" ? message.content[0].text : "[]";
    // Fjern markdown code blocks hvis Claude tilføjer dem
    // Strip markdown code blocks if Claude wraps the response
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

function getMediaType(filename: string): "application/pdf" | "image/jpeg" | "image/png" | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  return null;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();

  // Afgør om det er en ZIP-fil eller direkte XLSX
  const isZip = file.name.endsWith(".zip");

  let xlsxBuffer: ArrayBuffer | null = null;
  const receiptFiles: Map<string, { buffer: ArrayBuffer; mediaType: "application/pdf" | "image/jpeg" | "image/png" }> = new Map();

  if (isZip) {
    const zip = await JSZip.loadAsync(buffer);

    // Find XLSX and receipt files in ZIP
    for (const [path, zipFile] of Object.entries(zip.files)) {
      if (zipFile.dir) continue;
      const filename = path.split("/").pop() ?? "";

      if (filename.endsWith(".xlsx") && !filename.startsWith("~")) {
        xlsxBuffer = await zipFile.async("arraybuffer");
      } else {
        const mediaType = getMediaType(filename);
        if (mediaType) {
          // Use filename without extension as receipt ID (e.g. "2600026" from "2600026.pdf")
          const receiptId = filename.replace(/[a-z]?\.(pdf|jpg|jpeg|png)$/i, "");
          const fileBuffer = await zipFile.async("arraybuffer");
          // Keep first file per receipt ID (page a)
          if (!receiptFiles.has(receiptId)) {
            receiptFiles.set(receiptId, { buffer: fileBuffer, mediaType });
          }
        }
      }
    }

    if (!xlsxBuffer) {
      return NextResponse.json({ error: "No XLSX file found in ZIP" }, { status: 400 });
    }
  } else {
    xlsxBuffer = buffer;
  }

  // Parse XLSX
  const workbook = XLSX.read(xlsxBuffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
  }) as unknown[][];

  const headers = raw[0] as string[];
  const dataRows = raw.slice(1);

  function col(row: unknown[], name: string): unknown {
    const idx = headers.findIndex((h) => h === name);
    return idx >= 0 ? row[idx] : null;
  }

  const rows = dataRows
    .filter((row) => row.some((cell) => cell !== null))
    .map((row) => {
      const rawAmount = parseFloat(String(col(row, "Amount") ?? "0"));
      const rawNet = parseFloat(String(col(row, "Net Amount") ?? "0"));
      const rawTax = parseFloat(String(col(row, "Tax Amount") ?? "0"));
      const date = col(row, "Date");
      const receiptId = col(row, "Receipt") != null ? String(col(row, "Receipt")) : null;

      return {
        expense_id: col(row, "Expense ID") as string ?? null,
        receipt_id: receiptId,
        date: date instanceof Date ? date.toISOString() : String(date),
        merchant: (col(row, "Text") as string) ?? (col(row, "Source description") as string) ?? null,
        amount: Math.abs(isNaN(rawAmount) ? 0 : rawAmount),
        net_amount: Math.abs(isNaN(rawNet) ? 0 : rawNet),
        tax_amount: Math.abs(isNaN(rawTax) ? 0 : rawTax),
        currency: (col(row, "Currency") as string) ?? "DKK",
        category: col(row, "Category") != null ? String(col(row, "Category")) : null,
        owner: col(row, "Owner") as string ?? null,
        receipt_url: col(row, "Receipt urls") as string ?? null,
      };
    })
    .filter((r) => r.amount > 0);

  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid rows found" }, { status: 400 });
  }

  // Upsert expenses — update receipt_id even if expense already exists
  const { error } = await supabaseAdmin
    .from("expenses")
    .upsert(rows, { onConflict: "expense_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Analyze receipts from ZIP
  let receiptsProcessed = 0;

  if (receiptFiles.size > 0) {
    console.log(`Analyzing ${receiptFiles.size} receipts...`);

    for (const row of rows) {
      if (!row.expense_id || !row.receipt_id) continue;

      const receipt = receiptFiles.get(row.receipt_id);
      if (!receipt) {
        console.log(`No receipt found for receipt_id: ${row.receipt_id}`);
        continue;
      }

      console.log(`Processing receipt ${row.receipt_id} (${receipt.mediaType})`);
      const items = await extractReceiptItems(receipt.buffer, receipt.mediaType);
      console.log(`  → ${items?.length ?? 0} product lines found`);

      if (items !== null) {
        await supabaseAdmin
          .from("expenses")
          .update({ receipt_items: items })
          .eq("expense_id", row.expense_id);
        if (items.length > 0) receiptsProcessed++;
      }
    }
  }

  return NextResponse.json({
    imported: rows.length,
    receipts_processed: receiptsProcessed,
    receipts_found: receiptFiles.size,
  });
}
