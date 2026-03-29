import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // Sandstar has 2 metadata rows before the actual header (row 3 = header)
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: 1,
    defval: null,
  }) as unknown[][];

  // Find the header row (the one containing "Product name")
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    const row = raw[i] as string[];
    if (row.some((cell) => typeof cell === "string" && cell.includes("Product name"))) {
      headerRowIndex = i;
      break;
    }
  }

  const headers = raw[headerRowIndex] as string[];
  const dataRows = raw.slice(headerRowIndex + 1).filter((row) =>
    row.some((cell) => cell !== null)
  );

  function col(row: unknown[], name: string): unknown {
    const idx = headers.findIndex((h) => h === name);
    return idx >= 0 ? row[idx] : null;
  }

  const rows = dataRows.map((row) => {
    const orderTime = col(row, "Order time");
    const unitPrice = parseFloat(String(col(row, "Unit price") ?? "0"));
    const salesVolume = parseFloat(String(col(row, "Sales volume") ?? "0"));
    const quantity = parseInt(String(col(row, "Quantity") ?? "1"), 10);

    return {
      order_number: col(row, "Order number") as string ?? null,
      order_time: orderTime instanceof Date ? orderTime.toISOString() : String(orderTime),
      route: col(row, "Route") as string ?? null,
      machine: col(row, "Machine") as string ?? null,
      custom_machine_number: col(row, "Custom machine number") != null
        ? String(col(row, "Custom machine number"))
        : null,
      product_name: col(row, "Product name") as string ?? "Unknown",
      product_barcode: col(row, "Product barcode") != null
        ? String(col(row, "Product barcode"))
        : null,
      quantity: isNaN(quantity) ? 1 : quantity,
      unit_price: isNaN(unitPrice) ? 0 : unitPrice,
      sales_volume: isNaN(salesVolume) ? 0 : salesVolume,
    };
  }).filter((r) => r.sales_volume > 0);

  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid rows found in file" }, { status: 400 });
  }

  // Find the date range from the data
  const dates = rows.map((r) => r.order_time).sort();
  const periodFrom = dates[0].substring(0, 10);
  const periodTo = dates[dates.length - 1].substring(0, 10);

  // Delete existing data for the same period before import
  await supabaseAdmin
    .from("sales")
    .delete()
    .gte("order_time", periodFrom)
    .lte("order_time", periodTo + "T23:59:59");

  // Insert in batches of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin.from("sales").insert(batch);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    imported: rows.length,
    period: `${periodFrom} → ${periodTo}`,
  });
}
