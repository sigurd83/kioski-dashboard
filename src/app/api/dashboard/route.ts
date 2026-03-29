import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? "2026-01-01";
  const to = searchParams.get("to") ?? new Date().toISOString();

  const [summaryRes, merchantsRes] = await Promise.all([
    supabaseAdmin.rpc("get_period_summary", { p_from: from, p_to: to }),
    supabaseAdmin.rpc("get_period_merchants", { p_from: from, p_to: to }),
  ]);

  if (summaryRes.error) {
    return NextResponse.json({ error: summaryRes.error.message }, { status: 500 });
  }

  const summary = summaryRes.data?.[0] ?? { total_revenue: 0, total_expenses: 0 };
  const totalRevenue = Number(summary.total_revenue);
  const totalExpenses = Number(summary.total_expenses);
  const grossMargin = totalRevenue - totalExpenses;

  const merchants = (merchantsRes.data ?? []).map((m: { merchant: string; total: number }) => ({
    merchant: m.merchant ?? "Unknown",
    amount: Number(m.total),
  }));

  return NextResponse.json({
    summary: {
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      gross_margin: grossMargin,
      margin_pct: totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : 0,
    },
    merchants,
  });
}
