export const maxDuration = 120;

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BATCH_SIZE = 30; // Match 30 purchase names per Claude call

async function matchBatch(
  purchaseNames: string[],
  sandstarNames: string[]
): Promise<{ purchase_name: string; sandstar_name: string | null }[]> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Match purchase item names to Sandstar sales product names.

SANDSTAR PRODUCTS (what we sell in the vending machines):
${sandstarNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

PURCHASE ITEMS (from invoices and receipts):
${purchaseNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Match each purchase item name to the best Sandstar product name.
Rules:
- Match on product type and size (e.g. "Coca-Cola 33cl" matches "Coca-Cola 33 cl dåse")
- Ignore minor spelling differences
- If no match is possible (e.g. shipping, fees, packaging, deposits), use JSON null
- Return ONLY a valid JSON array, no explanation, no markdown

Required format (use JSON null, not the string "null"):
[{"purchase_name": "Coca-Cola 33cl", "sandstar_name": "Coca-Cola 33 cl dåse"}, {"purchase_name": "Fragt", "sandstar_name": null}]`,
      },
    ],
  });

  let rawText = message.content[0].type === "text" ? message.content[0].text : "[]";
  rawText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const parsed = JSON.parse(rawText);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Parse error in batch:", e, rawText.substring(0, 200));
    return [];
  }
}

export async function POST() {
  // Fetch all unique purchase names that have not been matched yet
  const { data: purchaseItems } = await supabaseAdmin
    .from("purchase_items")
    .select("product_name")
    .not("product_name", "is", null);

  const { data: existingMappings } = await supabaseAdmin
    .from("product_mappings")
    .select("purchase_name");

  const alreadyMapped = new Set((existingMappings ?? []).map((m) => m.purchase_name));

  const uniquePurchaseNames = [
    ...new Set((purchaseItems ?? []).map((p) => p.product_name).filter(Boolean)),
  ].filter((name) => !alreadyMapped.has(name));

  if (uniquePurchaseNames.length === 0) {
    return NextResponse.json({ message: "All items are already matched", new_mappings: 0 });
  }

  // Fetch all Sandstar product names
  const { data: salesProducts } = await supabaseAdmin
    .from("sales_by_product")
    .select("product_name");

  const sandstarNames = (salesProducts ?? []).map((p) => p.product_name);

  console.log(`Matching ${uniquePurchaseNames.length} purchase names in batches of ${BATCH_SIZE}...`);

  // Process in batches
  const allMappings: { purchase_name: string; sandstar_name: string | null }[] = [];

  for (let i = 0; i < uniquePurchaseNames.length; i += BATCH_SIZE) {
    const batch = uniquePurchaseNames.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uniquePurchaseNames.length / BATCH_SIZE)}: ${batch.length} items`);
    const results = await matchBatch(batch, sandstarNames);
    allMappings.push(...results);
  }

  // Only save matches with a valid sandstar_name
  const validMappings = allMappings.filter((m) => m.sandstar_name !== null);

  if (validMappings.length > 0) {
    await supabaseAdmin
      .from("product_mappings")
      .upsert(validMappings, { onConflict: "purchase_name", ignoreDuplicates: true });
  }

  return NextResponse.json({
    new_mappings: validMappings.length,
    unmatched: allMappings.filter((m) => m.sandstar_name === null).map((m) => m.purchase_name),
  });
}
