"use client";

import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";
import VariantPicker, { type PickerVariant } from "@/components/VariantPicker";

interface Baris {
  key: number;
  variant: PickerVariant | null;
  quantity: number;
}

export default function ProductionForm({
  action,
  variants,
  manufacturers,
  today,
}: {
  action: (formData: FormData) => void;
  variants: PickerVariant[];
  manufacturers: string[];
  today: string;
}) {
  const [buka, setBuka] = useState(false);
  const [baris, setBaris] = useState<Baris[]>([{ key: 1, variant: null, quantity: 0 }]);

  function tambahBaris() {
    setBaris((b) => [...b, { key: Date.now(), variant: null, quantity: 0 }]);
  }
  function hapusBaris(key: number) {
    setBaris((b) => (b.length === 1 ? b : b.filter((r) => r.key !== key)));
  }
  function pilih(key: number, v: PickerVariant | null) {
    setBaris((b) => b.map((r) => (r.key === key ? { ...r, variant: v } : r)));
  }
  function ubahQty(key: number, q: number) {
    setBaris((b) => b.map((r) => (r.key === key ? { ...r, quantity: q } : r)));
  }

  const totalUnit = baris.reduce((s, r) => s + (r.variant ? r.quantity : 0), 0);

  if (!buka) {
    return (
      <button className="btn btn-primary" onClick={() => setBuka(true)}>
        + Buat Order Produksi
      </button>
    );
  }

  return (
    <form action={action}>
      <div className="card" style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <h2 style={{ fontSize: 15, margin: 0 }}>Order Produksi Baru</h2>
          <button type="button" className="btn" onClick={() => setBuka(false)}>
            Tutup
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 12,
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="manufacturer_name">
              Konveksi
            </label>
            <input
              id="manufacturer_name"
              name="manufacturer_name"
              className="input"
              list="daftar-konveksi"
              required
              maxLength={100}
              placeholder="Nama konveksi"
            />
            <datalist id="daftar-konveksi">
              {manufacturers.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="ordered_date">
              Tanggal order
            </label>
            <input
              id="ordered_date"
              name="ordered_date"
              type="date"
              className="input"
              defaultValue={today}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="due_date">
              Target selesai
            </label>
            <input id="due_date" name="due_date" type="date" className="input" />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="labor_cost">
              Biaya maklon
            </label>
            <input
              id="labor_cost"
              name="labor_cost"
              type="number"
              min={0}
              step={1000}
              className="input"
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
          <div className="label" style={{ marginBottom: 8 }}>
            Varian yang dipesan
          </div>

          {baris.map((r) => (
            <div
              key={r.key}
              className="card"
              style={{
                padding: 12,
                marginBottom: 10,
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 120px 44px",
                gap: 10,
                alignItems: "start",
              }}
            >
              <div>
                <VariantPicker
                  variants={variants}
                  name={`picker-${r.key}`}
                  label=""
                  autoFocus={false}
                  emitHiddenInput={false}
                  onPick={(v) => pilih(r.key, v)}
                />
                {r.variant && (
                  <input type="hidden" name="variant_id" value={r.variant.id} />
                )}
              </div>
              <div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={r.quantity || ""}
                  onChange={(e) => ubahQty(r.key, Number(e.target.value))}
                  className="input num"
                  placeholder="Jumlah"
                  style={{ fontWeight: 600 }}
                />
                {r.variant && <input type="hidden" name="quantity" value={r.quantity} />}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => hapusBaris(r.key)}
                aria-label="Hapus baris"
                style={{ padding: 0 }}
              >
                ×
              </button>
            </div>
          ))}

          <button type="button" className="btn" onClick={tambahBaris}>
            + Tambah varian
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <SubmitButton
            className="btn btn-primary btn-lg"
            pendingLabel="Menyimpan…"
            disabled={totalUnit === 0}
          >
            Simpan Order
          </SubmitButton>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Total {totalUnit} pcs
          </span>
        </div>
      </div>
    </form>
  );
}
