import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? "2026-01-01";
  const to = searchParams.get("to") ?? new Date().toISOString();

  // Fetch sales per product via SQL function
  const { data: salesData, error } = await supabaseAdmin.rpc("get_period_sales", {
    p_from: from,
    p_to: to,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch all purchase items with mapping (all time — purchase price does not change per period)
  const [purchaseRes, mappingRes] = await Promise.all([
    supabaseAdmin.from("purchase_items").select("product_name, unit_price, source"),
    supabaseAdmin.from("product_mappings").select("purchase_name, sandstar_name, deposit_kr"),
  ]);

  const mappingMap: Record<string, string> = {};
  const depositMap: Record<string, number> = {};
  for (const m of mappingRes.data ?? []) {
    mappingMap[m.purchase_name] = m.sandstar_name;
    depositMap[m.sandstar_name] = Number(m.deposit_kr ?? 0);
  }

  const VAT = 1.25; // Purchase prices are excl. VAT, sales prices are incl. VAT

  // Build separate maps for invoice and pleo sources
  const invoiceMap: Record<string, number[]> = {};
  const pleoMap: Record<string, number[]> = {};

  for (const item of purchaseRes.data ?? []) {
    const sandstarName = mappingMap[item.product_name];
    if (!sandstarName || !item.unit_price) continue;
    const deposit = depositMap[sandstarName] ?? 0;
    const price = Number(item.unit_price) * VAT + deposit;
    if (item.source === "invoice") {
      if (!invoiceMap[sandstarName]) invoiceMap[sandstarName] = [];
      invoiceMap[sandstarName].push(price);
    } else {
      if (!pleoMap[sandstarName]) pleoMap[sandstarName] = [];
      pleoMap[sandstarName].push(price);
    }
  }

  // Prefer invoice prices — only use Pleo prices when no invoice data exists
  const purchaseMap: Record<string, number[]> = { ...pleoMap };
  for (const [name, prices] of Object.entries(invoiceMap)) {
    purchaseMap[name] = prices;
  }

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const products = (salesData ?? []).map((s: {
    product_name: string;
    quantity: number;
    revenue: number;
    avg_price: number;
  }) => {
    const avgSalePrice = Number(s.avg_price);
    const avgPurchasePrice = avg(purchaseMap[s.product_name] ?? []);
    const marginKr = avgPurchasePrice !== null ? avgSalePrice - avgPurchasePrice : null;
    const marginPct = marginKr !== null && avgSalePrice > 0
      ? (marginKr / avgSalePrice) * 100
      : null;

    const qty = Number(s.quantity);
    const grossMarginKr = marginKr !== null ? marginKr * qty : null;

    return {
      product_name: s.product_name,
      quantity: qty,
      revenue: Number(s.revenue),
      avg_sale_price: Math.round(avgSalePrice * 100) / 100,
      avg_purchase_price: avgPurchasePrice !== null ? Math.round(avgPurchasePrice * 100) / 100 : null,
      margin_kr: marginKr !== null ? Math.round(marginKr * 100) / 100 : null,
      margin_pct: marginPct !== null ? Math.round(marginPct * 10) / 10 : null,
      gross_margin_kr: grossMarginKr !== null ? Math.round(grossMarginKr * 100) / 100 : null,
    };
  });

  return NextResponse.json({ products });
}
