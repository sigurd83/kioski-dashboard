export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function sendMessage(chatId: number, text: string) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function fetchKioskiContext(question: string) {
  const looksLikePeriod = (q: string) => /jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec|q1|q2|q3|q4|2026/i.test(q);

  // Determine period from question — default to current month
  let from = "2026-01-01";
  let to = "2026-03-31";

  if (/januar|jan/i.test(question)) { from = "2026-01-01"; to = "2026-01-31"; }
  else if (/februar|feb/i.test(question)) { from = "2026-02-01"; to = "2026-02-28"; }
  else if (/marts|mar/i.test(question)) { from = "2026-03-01"; to = "2026-03-31"; }
  else if (/april|apr/i.test(question)) { from = "2026-04-01"; to = "2026-04-30"; }
  else if (/q1/i.test(question)) { from = "2026-01-01"; to = "2026-03-31"; }
  else if (/q2/i.test(question)) { from = "2026-04-01"; to = "2026-06-30"; }
  else if (!looksLikePeriod(question)) { from = "2026-01-01"; to = "2026-03-31"; }

  const [summaryRes, productsRes] = await Promise.all([
    supabaseAdmin.rpc("get_period_summary", { p_from: from, p_to: to + "T23:59:59" }),
    supabaseAdmin.rpc("get_period_sales", { p_from: from, p_to: to + "T23:59:59" }),
  ]);

  const summary = summaryRes.data?.[0];
  const sales = (productsRes.data ?? []) as Array<{
    product_name: string;
    quantity: number;
    revenue: number;
    avg_price: number;
  }>;

  // Get purchase prices
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

  const VAT = 1.25;
  const invoiceMap: Record<string, number[]> = {};
  const pleoMap: Record<string, number[]> = {};
  for (const item of purchaseRes.data ?? []) {
    const sandstarName = mappingMap[item.product_name];
    if (!sandstarName || !item.unit_price) continue;
    const price = Number(item.unit_price) * VAT + (depositMap[sandstarName] ?? 0);
    if (item.source === "invoice") {
      if (!invoiceMap[sandstarName]) invoiceMap[sandstarName] = [];
      invoiceMap[sandstarName].push(price);
    } else {
      if (!pleoMap[sandstarName]) pleoMap[sandstarName] = [];
      pleoMap[sandstarName].push(price);
    }
  }
  const purchaseMap: Record<string, number[]> = { ...pleoMap };
  for (const [name, prices] of Object.entries(invoiceMap)) purchaseMap[name] = prices;
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const products = sales.map((s) => {
    const avgPurchase = avg(purchaseMap[s.product_name] ?? []);
    const marginKr = avgPurchase !== null ? Number(s.avg_price) - avgPurchase : null;
    return {
      name: s.product_name,
      qty: Number(s.quantity),
      revenue: Number(s.revenue),
      avg_sale: Number(s.avg_price),
      avg_purchase: avgPurchase,
      margin_kr: marginKr,
      margin_pct: marginKr !== null ? (marginKr / Number(s.avg_price)) * 100 : null,
      gross_margin: marginKr !== null ? marginKr * Number(s.quantity) : null,
    };
  }).sort((a, b) => (b.gross_margin ?? 0) - (a.gross_margin ?? 0));

  return { summary, products, period: `${from} → ${to}` };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = body.message;
  if (!message?.text || !message?.chat?.id) return NextResponse.json({ ok: true });

  const chatId: number = message.chat.id;
  const text: string = message.text;
  const userName: string = message.from?.first_name ?? "Partner";

  // Ignore bot commands except /start
  if (text.startsWith("/start")) {
    await sendMessage(chatId, `Hej ${userName}! 👋 Jeg er Kioski's data-assistent. Spørg mig om salg, marginer, produkter eller hvad I tjener. Eks: _"Hvad tjente vi mest på i Q1?"_ eller _"Hvad er margin på Monster?"_`);
    return NextResponse.json({ ok: true });
  }

  // Fetch data context
  const { summary, products, period } = await fetchKioskiContext(text);

  const topProducts = products.slice(0, 20).map(p =>
    `${p.name}: ${p.qty} solgt, salg ${p.avg_sale?.toFixed(2)} kr, køb ${p.avg_purchase?.toFixed(2) ?? "?"} kr, margin ${p.margin_pct?.toFixed(1) ?? "?"}%, gross margin ${p.gross_margin?.toFixed(0) ?? "?"} kr`
  ).join("\n");

  const context = `
Kioski er et dansk vending machine firma med automater på bl.a. Fujifilm Hillerød, Bispebjerg og Myhotel.

PERIODE: ${period}
OMSÆTNING: ${summary?.total_revenue?.toFixed(0) ?? "?"} DKK
UDGIFTER: ${summary?.total_expenses?.toFixed(0) ?? "?"} DKK
BRUTTOMARGIN: ${summary?.gross_margin?.toFixed(0) ?? "?"} DKK (${summary?.margin_pct?.toFixed(1) ?? "?"}%)

TOP PRODUKTER (sorteret efter gross margin):
${topProducts}

Bemærk: indkøbspriser er inkl. moms og deposit. Overview-marginen er cash flow, ikke COGS.
`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `Du er en hjælpsom forretningsassistent for Kioski. Du svarer kortfattet og præcist på dansk baseret på de data du får. Brug tal fra konteksten. Hvis du ikke ved noget, sig det ærligt. Svar i max 3-4 sætninger medmindre der specifikt bedes om en liste.`,
    messages: [
      { role: "user", content: `${context}\n\nSpørgsmål fra ${userName}: ${text}` }
    ],
  });

  const reply = response.content[0].type === "text" ? response.content[0].text : "Beklager, kunne ikke generere svar.";
  await sendMessage(chatId, reply);

  return NextResponse.json({ ok: true });
}
