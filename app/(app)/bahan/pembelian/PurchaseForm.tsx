"use client";

import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";

interface Material {
  id: number;
  code: string;
  name: string;
  unit: string;
  stock_on_hand: string;
}

interface Baris {
  key: number;
  materialId: number;
  quantity: number;
  unitPrice: number;
}

export default function PurchaseForm({
  action,
  materials,
  suppliers,
  today,
}: {
  action: (formData: FormData) => void;
  materials: Material[];
  suppliers: string[];
  today: string;
}) {
  const [baris, setBaris] = useState<Baris[]>([
    { key: 1, materialId: 0, quantity: 0, unitPrice: 0 },
  ]);

  function ubah(key: number, patch: Partial<Baris>) {
    setBaris((b) => b.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const total = baris.reduce(
    (s, r) => s + (r.materialId ? r.quantity * r.unitPrice : 0),
    0,
  );

  return (
    <form action={action}>
      <div className="card" style={{ padding: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 12,
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="supplier_name">
              Supplier
            </label>
            <input
              id="supplier_name"
              name="supplier_name"
              className="input"
              list="daftar-supplier"
              required
              maxLength={100}
            />
            <datalist id="daftar-supplier">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="invoice_number">
              No. nota
            </label>
            <input
              id="invoice_number"
              name="invoice_number"
              className="input mono"
              maxLength={40}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="purchase_date">
              Tanggal
            </label>
            <input
              id="purchase_date"
              name="purchase_date"
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

        <div style={{ marginTop: 16 }}>
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Bahan</th>
                  <th className="num" style={{ width: 120 }}>
                    Jumlah
                  </th>
                  <th className="num" style={{ width: 140 }}>
                    Harga satuan
                  </th>
                  <th className="num" style={{ width: 130 }}>
                    Subtotal
                  </th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {baris.map((r) => {
                  const m = materials.find((x) => x.id === r.materialId);
                  return (
                    <tr key={r.key}>
                      <td>
                        <select
                          className="select"
                          value={r.materialId}
                          onChange={(e) => ubah(r.key, { materialId: Number(e.target.value) })}
                        >
                          <option value={0}>— pilih bahan —</option>
                          {materials.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.code} · {x.name} ({x.unit})
                            </option>
                          ))}
                        </select>
                        {r.materialId > 0 && (
                          <input type="hidden" name="material_id" value={r.materialId} />
                        )}
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={r.quantity || ""}
                          onChange={(e) => ubah(r.key, { quantity: Number(e.target.value) })}
                          className="input num"
                          style={{ width: 100 }}
                        />
                        {r.materialId > 0 && (
                          <input type="hidden" name="quantity" value={r.quantity} />
                        )}
                        {m && (
                          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                            {m.unit}
                          </div>
                        )}
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          step={100}
                          min={0}
                          value={r.unitPrice || ""}
                          onChange={(e) => ubah(r.key, { unitPrice: Number(e.target.value) })}
                          className="input num"
                          style={{ width: 120 }}
                        />
                        {r.materialId > 0 && (
                          <input type="hidden" name="unit_price" value={r.unitPrice} />
                        )}
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {(r.quantity * r.unitPrice).toLocaleString("id-ID")}
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setBaris((b) =>
                              b.length === 1 ? b : b.filter((x) => x.key !== r.key),
                            )
                          }
                          style={{ padding: "4px 10px", minHeight: 32 }}
                          aria-label="Hapus baris"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="btn"
            onClick={() =>
              setBaris((b) => [
                ...b,
                { key: Date.now(), materialId: 0, quantity: 0, unitPrice: 0 },
              ])
            }
            style={{ marginTop: 10 }}
          >
            + Tambah baris
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <SubmitButton
            className="btn btn-primary btn-lg"
            pendingLabel="Menyimpan…"
            disabled={total === 0 && !baris.some((r) => r.materialId && r.quantity > 0)}
          >
            Simpan Pembelian
          </SubmitButton>
          <span style={{ fontSize: 14 }}>
            Total: <strong>Rp {total.toLocaleString("id-ID")}</strong>
          </span>
        </div>
      </div>
    </form>
  );
}
