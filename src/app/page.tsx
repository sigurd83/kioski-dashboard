"use client";

import { useState, useEffect, useCallback } from "react";

type Tab = "dashboard" | "products" | "import";

interface Summary {
  total_revenue: number;
  total_expenses: number;
  gross_margin: number;
  margin_pct: number;
}

interface MerchantStat {
  merchant: string;
  amount: number;
}

interface DashboardData {
  summary: Summary;
  merchants: MerchantStat[];
}

interface ProductStat {
  product_name: string;
  quantity: number;
  revenue: number;
  avg_sale_price: number;
  avg_purchase_price: number | null;
  margin_kr: number | null;
  margin_pct: number | null;
  gross_margin_kr: number | null;
}

function fmt(n: number, decimals = 0) {
  return new Intl.NumberFormat("da-DK", {
    style: "currency",
    currency: "DKK",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(n);
}

function getDefaultPeriod() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().substring(0, 10);
  return { from, to };
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [period, setPeriod] = useState(getDefaultPeriod);
  const [data, setData] = useState<DashboardData | null>(null);
  const [products, setProducts] = useState<ProductStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [matchingStatus, setMatchingStatus] = useState<string | null>(null);

  const [sandstarStatus, setSandstarStatus] = useState<string | null>(null);
  const [pleoStatus, setPleoStatus] = useState<string | null>(null);
  const [invoiceStatus, setInvoiceStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof ProductStat>("gross_margin_kr");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from: period.from, to: period.to + "T23:59:59" });
    const res = await fetch(`/api/dashboard?${params}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [period]);

  const fetchProducts = useCallback(async () => {
    setProductLoading(true);
    const params = new URLSearchParams({ from: period.from, to: period.to + "T23:59:59" });
    const res = await fetch(`/api/product-stats?${params}`);
    if (res.ok) {
      const json = await res.json();
      setProducts(json.products ?? []);
    }
    setProductLoading(false);
  }, [period]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);
  useEffect(() => { if (tab === "products") fetchProducts(); }, [tab, fetchProducts]);

  async function runMatching() {
    setMatchingStatus("Matching purchase items with products...");
    const res = await fetch("/api/match-products", { method: "POST" });
    const json = await res.json();
    if (res.ok) {
      setMatchingStatus(`✓ ${json.new_mappings} new matches found`);
      fetchProducts();
    } else {
      setMatchingStatus(`Error: ${json.error}`);
    }
  }

  async function handleUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    endpoint: string,
    setStatus: (s: string) => void,
    loadingMsg: string
  ) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";

    let totalImported = 0;
    let totalReceipts = 0;
    const errors: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatus(`${loadingMsg} (${i + 1}/${files.length}: ${file.name})`);
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(endpoint, { method: "POST", body: formData });
      const json = await res.json();
      if (res.ok) {
        totalImported += json.imported ?? json.processed ?? 0;
        totalReceipts += json.receipts_processed ?? 0;
      } else {
        errors.push(`${file.name}: ${json.error}`);
      }
    }

    if (errors.length > 0) {
      setStatus(`Error in ${errors.length} file(s): ${errors.join(", ")}`);
    } else {
      const msg = endpoint === "/api/import-pleo"
        ? `✓ ${totalImported} expenses imported, ${totalReceipts} receipts analyzed`
        : endpoint === "/api/upload-invoice"
        ? `✓ ${totalImported} invoices analyzed`
        : `✓ ${totalImported} rows imported`;
      setStatus(msg);
    }
    fetchDashboard();
  }

  const months = [
    { label: "Jan", from: "2026-01-01", to: "2026-01-31" },
    { label: "Feb", from: "2026-02-01", to: "2026-02-28" },
    { label: "Mar", from: "2026-03-01", to: "2026-03-31" },
    { label: "Apr", from: "2026-04-01", to: "2026-04-30" },
    { label: "May", from: "2026-05-01", to: "2026-05-31" },
    { label: "Jun", from: "2026-06-01", to: "2026-06-30" },
    { label: "Jul", from: "2026-07-01", to: "2026-07-31" },
    { label: "Aug", from: "2026-08-01", to: "2026-08-31" },
    { label: "Sep", from: "2026-09-01", to: "2026-09-30" },
    { label: "Oct", from: "2026-10-01", to: "2026-10-31" },
    { label: "Nov", from: "2026-11-01", to: "2026-11-30" },
    { label: "Dec", from: "2026-12-01", to: "2026-12-31" },
    { label: "Q1", from: "2026-01-01", to: "2026-03-31" },
    { label: "Q2", from: "2026-04-01", to: "2026-06-30" },
    { label: "Q3", from: "2026-07-01", to: "2026-09-30" },
    { label: "Q4", from: "2026-10-01", to: "2026-12-31" },
    { label: "2026", from: "2026-01-01", to: "2026-12-31" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Kioski Dashboard</h1>
        <nav className="flex gap-1">
          {([
            ["dashboard", "Overview"],
            ["products", "Products"],
            ["import", "Import data"],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="px-8 py-6 max-w-7xl mx-auto">

        {/* Period filter — shown on overview and products */}
        {tab !== "import" && (
          <div className="flex flex-wrap gap-2 mb-6">
            {months.map((m) => (
              <button key={m.label}
                onClick={() => setPeriod({ from: m.from, to: m.to })}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${period.from === m.from && period.to === m.to ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"}`}>
                {m.label}
              </button>
            ))}
            <div className="flex gap-2 items-center">
              <input type="date" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
                className="px-2 py-1.5 rounded-lg text-sm border border-gray-200 bg-white" />
              <span className="text-gray-400 text-sm">→</span>
              <input type="date" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
                className="px-2 py-1.5 rounded-lg text-sm border border-gray-200 bg-white" />
            </div>
          </div>
        )}

        {/* OVERVIEW */}
        {tab === "dashboard" && (
          <div className="space-y-6">
            {loading && <p className="text-sm text-gray-500">Loading data...</p>}
            {data && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard label="Revenue" value={fmt(data.summary.total_revenue)} color="blue" />
                  <StatCard label="Expenses" value={fmt(data.summary.total_expenses)} color="red" />
                  <StatCard label="Gross margin" value={fmt(data.summary.gross_margin)} color={data.summary.gross_margin >= 0 ? "green" : "red"} />
                  <StatCard label="Margin %" value={`${data.summary.margin_pct.toFixed(1)}%`} color={data.summary.margin_pct >= 0 ? "green" : "red"} />
                </div>
                <div className="bg-white rounded-xl shadow p-6">
                  <h2 className="text-base font-semibold text-gray-900 mb-4">Expenses by supplier</h2>
                  {data.merchants.length === 0 ? (
                    <p className="text-sm text-gray-400">No expense data yet</p>
                  ) : (
                    <div className="space-y-2">
                      {data.merchants.map((m) => (
                        <div key={m.merchant} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 truncate max-w-[400px]">{m.merchant}</span>
                          <span className="font-medium text-gray-900 w-24 text-right">{fmt(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* PRODUCTS */}
        {tab === "products" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <input
                  type="text"
                  placeholder="Search products..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-2 rounded-lg text-sm border border-gray-200 bg-white w-64 focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
                <p className="text-sm text-gray-500">
                  {products.filter(p => p.product_name.toLowerCase().includes(search.toLowerCase())).length} products
                </p>
              </div>
              <div className="flex items-center gap-3">
                {matchingStatus && <p className="text-sm text-gray-600">{matchingStatus}</p>}
                <button onClick={runMatching}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors">
                  Match purchase prices
                </button>
              </div>
            </div>

            {productLoading && <p className="text-sm text-gray-500">Loading products...</p>}

            {!productLoading && products.length > 0 && (() => {
              const filtered = products.filter(p =>
                p.product_name.toLowerCase().includes(search.toLowerCase())
              );
              const sorted = [...filtered].sort((a, b) => {
                const av = a[sortKey] ?? (sortDir === "asc" ? Infinity : -Infinity);
                const bv = b[sortKey] ?? (sortDir === "asc" ? Infinity : -Infinity);
                if (typeof av === "string" && typeof bv === "string")
                  return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
                return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
              });

              function SortTh({ label, col, align = "right" }: { label: string; col: keyof ProductStat; align?: string }) {
                const active = sortKey === col;
                return (
                  <th
                    className={`px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900 text-${align}`}
                    onClick={() => { if (active) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(col); setSortDir("desc"); } }}
                  >
                    {label} {active ? (sortDir === "asc" ? "↑" : "↓") : <span className="text-gray-300">↕</span>}
                  </th>
                );
              }

              return (
                <div className="bg-white rounded-xl shadow overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <SortTh label="Product" col="product_name" align="left" />
                        <SortTh label="Units sold" col="quantity" />
                        <SortTh label="Avg. sale price" col="avg_sale_price" />
                        <SortTh label="Avg. purchase price" col="avg_purchase_price" />
                        <SortTh label="Margin DKK" col="margin_kr" />
                        <SortTh label="Margin %" col="margin_pct" />
                        <SortTh label="Gross margin DKK" col="gross_margin_kr" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sorted.map((p) => (
                        <tr key={p.product_name} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-900 max-w-[250px] truncate">{p.product_name}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{p.quantity.toLocaleString("da-DK")}</td>
                          <td className="px-4 py-3 text-right text-gray-900">{fmt(p.avg_sale_price, 2)}</td>
                          <td className="px-4 py-3 text-right text-gray-900">
                            {p.avg_purchase_price !== null ? fmt(p.avg_purchase_price, 2) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            {p.margin_kr !== null
                              ? <span className={p.margin_kr >= 0 ? "text-green-600" : "text-red-600"}>{fmt(p.margin_kr, 2)}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            {p.margin_pct !== null
                              ? <span className={p.margin_pct >= 0 ? "text-green-600" : "text-red-600"}>{p.margin_pct.toFixed(1)}%</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            {p.gross_margin_kr !== null
                              ? <span className={p.gross_margin_kr >= 0 ? "text-green-600" : "text-red-600"}>{fmt(p.gross_margin_kr, 0)}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {/* IMPORT */}
        {tab === "import" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <UploadCard title="Sandstar OPS" description="XLSX export from Sandstar. Sales transactions per product and machine." accept=".xlsx" color="blue" status={sandstarStatus}
              onChange={(e) => handleUpload(e, "/api/import-sandstar", setSandstarStatus, "Importing sales data...")} />
            <UploadCard title="Pleo expenses" description="Upload the full Pleo export ZIP (incl. receipts folder), or just the XLSX." accept=".xlsx,.zip" color="purple" status={pleoStatus}
              onChange={(e) => handleUpload(e, "/api/import-pleo", setPleoStatus, "Importing expenses and analyzing receipts...")} />
            <UploadCard title="Invoices" description="Upload a single PDF or a ZIP with the month's invoices. AI extracts product lines automatically." accept=".pdf,.zip" color="green" status={invoiceStatus}
              onChange={(e) => handleUpload(e, "/api/upload-invoice", setInvoiceStatus, "Analyzing invoices...")} />
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = { blue: "text-blue-600", red: "text-red-600", green: "text-green-600" };
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colors[color] ?? "text-gray-900"}`}>{value}</p>
    </div>
  );
}

function UploadCard({ title, description, accept, color, status, onChange }: {
  title: string; description: string; accept: string; color: "blue" | "purple" | "green";
  status: string | null; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const styles = { blue: "file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100", purple: "file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100", green: "file:bg-green-50 file:text-green-700 hover:file:bg-green-100" };
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-gray-500 text-sm mb-4">{description}</p>
      <input type="file" accept={accept} multiple onChange={onChange}
        className={`block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium ${styles[color]}`} />
      {status && <p className={`mt-3 text-sm ${status.startsWith("Error") ? "text-red-600" : "text-gray-700"}`}>{status}</p>}
    </div>
  );
}
