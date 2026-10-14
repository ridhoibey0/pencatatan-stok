"use client";

import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";

interface Order {
  id: number;
  reference_no: string;
  manufacturer_name: string;
  ordered_date: string;
  status: string;
}

interface Item {
  production_order_id: number;
  variant_id: number;
  sku: string;
  product_name: string;
  size: string | null;
  color: string | null;
  quantity_ordered: number;
  quantity_produced: number;
}

export default function ReceiptForm({
  action,
  orders,
  items,
  today,
}: {
  action: (formData: FormData) => void;
  orders: Order[];
  items: Item[];
  today: string;
}) {
  const [orderId, setOrderId] = useState<number>(orders[0]?.id ?? 0);
  const baris = items.filter((i) => i.production_order_id === orderId);

  return (
    <form action={action}>
      <div className="card" style={{ padding: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="production_order_id">
              Order produksi
            </label>
            <select
              id="production_order_id"
              name="production_order_id"
              className="select"
              value={orderId}
              onChange={(e) => setOrderId(Number(e.target.value))}
            >
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.reference_no} — {o.manufacturer_name}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="invoice_number">
              No. nota konveksi
            </label>
            <input
              id="invoice_number"
              name="invoice_number"
              className="input mono"
              maxLength={40}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="received_date">
              Tanggal terima
            </label>
            <input
              id="received_date"
              name="received_date"
              type="date"
              className="input"
              defaultValue={today}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="notes">
              Catatan
            </label>
            <input id="notes" name="notes" className="input" maxLength={255} />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          {baris.length === 0 ? (
            <div className="muted" style={{ padding: "16px 0", fontSize: 14 }}>
              Order ini belum punya rincian varian.
            </div>
          ) : (
            <div className="scroll-x">
              <table className="data">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Varian</th>
                    <th className="num">Dipesan</th>
                    <th className="num">Sudah jadi</th>
                    <th className="num" style={{ width: 120 }}>
                      Diterima
                    </th>
                    <th className="num" style={{ width: 110 }}>
                      Reject
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {baris.map((r) => {
                    const sisa = Number(r.quantity_ordered) - Number(r.quantity_produced);
                    return (
                      <tr key={r.variant_id}>
                        <td className="mono" style={{ fontSize: 13 }}>
                          {r.sku}
                          <input type="hidden" name="variant_id" value={r.variant_id} />
                        </td>
                        <td>
                          <div style={{ fontSize: 13.5 }}>{r.product_name}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {[r.color, r.size].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        <td className="num">{r.quantity_ordered}</td>
                        <td className="num muted">{r.quantity_produced}</td>
                        <td className="num">
                          <input
                            name="quantity"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={9999}
                            defaultValue={0}
                            className="input num"
                            style={{ width: 100, fontWeight: 600 }}
                            placeholder={sisa > 0 ? String(sisa) : "0"}
                          />
                        </td>
                        <td className="num">
                          <input
                            name="quantity_rejected"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            defaultValue={0}
                            className="input num"
                            style={{ width: 90 }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
          <SubmitButton
            className="btn btn-primary btn-lg"
            pendingLabel="Mencatat…"
            disabled={baris.length === 0}
          >
            Simpan Penerimaan
          </SubmitButton>
          <span className="muted" style={{ fontSize: 13 }}>
            Baris dengan jumlah 0 dilewati.
          </span>
        </div>
      </div>
    </form>
  );
}
