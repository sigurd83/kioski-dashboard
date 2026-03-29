export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import JSZip from "jszip";
import { supabaseAdmin } from "@/lib/supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function processInvoicePdf(
  pdfBuffer: ArrayBuffer,
  filename: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const base64 = Buffer.from(pdfBuffer).toString("base64");

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            {
              type: "text",
              text: `Extract the following fields from this invoice and return as JSON:
- supplier (string): supplier company name
- invoice_date (string): invoice date in YYYY-MM-DD format
- due_date (string): payment due date in YYYY-MM-DD format
- amount (number): subtotal excl. VAT
- vat (number): VAT amount
- total_amount (number): total incl. VAT
- items (array): product lines with fields product_name, quantity, unit_price, total

IMPORTANT for unit_price: always return the price per individual sellable unit.
If a product is sold as a case/box/pack, divide the case price by units per case.
Example: "Coca-Cola 33cl x24, 1 case, 103.98 DKK" → unit_price: 4.33 (103.98/24), quantity: 24
Example: "Sandwich egg & bacon 175g, 24 pcs, 20.00 DKK/pc" → unit_price: 20.00, quantity: 24

Return ONLY valid JSON without markdown.`,
            },
          ],
        },
      ],
    });

    let rawText = message.content[0].type === "text" ? message.content[0].text : "";
    rawText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    let extracted: Record<string, unknown> = {};
    try {
      extracted = JSON.parse(rawText);
    } catch {
      // Store raw text if parsing fails
    }

    const { error } = await supabaseAdmin.from("invoices").insert({
      filename,
      raw_text: rawText,
      supplier: extracted.supplier ?? null,
      invoice_date: extracted.invoice_date ?? null,
      due_date: extracted.due_date ?? null,
      amount: extracted.amount ?? null,
      vat: extracted.vat ?? null,
      total_amount: extracted.total_amount ?? null,
      items: extracted.items ?? null,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: extracted };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const isZip = file.name.endsWith(".zip");

  if (isZip) {
    // Process all PDFs in ZIP
    const zip = await JSZip.loadAsync(buffer);
    const pdfEntries = Object.entries(zip.files).filter(
      ([name, f]) => !f.dir && name.toLowerCase().endsWith(".pdf")
    );

    if (pdfEntries.length === 0) {
      return NextResponse.json({ error: "No PDF files found in ZIP" }, { status: 400 });
    }

    let processed = 0;
    let failed = 0;

    for (const [path, zipFile] of pdfEntries) {
      const filename = path.split("/").pop() ?? path;
      const pdfBuffer = await zipFile.async("arraybuffer");
      const result = await processInvoicePdf(pdfBuffer, filename);
      if (result.success) processed++;
      else failed++;
    }

    return NextResponse.json({
      success: true,
      processed,
      failed,
      total: pdfEntries.length,
    });
  }

  // Enkelt PDF
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF or ZIP files are supported" }, { status: 400 });
  }

  const result = await processInvoicePdf(buffer, file.name);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ success: true, processed: 1, data: result.data });
}
