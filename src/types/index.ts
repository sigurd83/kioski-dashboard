export interface SalesRow {
  id?: string;
  date: string;
  product: string;
  quantity: number;
  unit_price: number;
  total: number;
  source: string; // e.g. "sandstar_ops"
  imported_at?: string;
}

export interface Invoice {
  id?: string;
  filename: string;
  supplier?: string;
  invoice_date?: string;
  due_date?: string;
  amount?: number;
  vat?: number;
  total_amount?: number;
  raw_text?: string;
  uploaded_at?: string;
}
