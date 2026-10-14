"use client";

import { useMemo, useState } from "react";

export interface PickerVariant {
  id: number;
  sku: string;
  product_name: string;
  size: string | null;
  color: string | null;
  stock_on_hand: number;
}

/**
 * Pencarian SKU yang bisa diketik. Dipakai di layar gudang, jadi targetnya
 * pilih SKU dalam hitungan detik tanpa menggulir daftar panjang.
 */
export default function VariantPicker({
  variants,
  name = "variant_id",
  label = "SKU",
  autoFocus = true,
  onPick,
  emitHiddenInput = true,
}: {
  variants: PickerVariant[];
  name?: string;
  label?: string;
  autoFocus?: boolean;
  /** Dipanggil saat varian dipilih/dilepas. Dipakai form multi-baris. */
  onPick?: (v: PickerVariant | null) => void;
  /** Matikan kalau induknya sendiri yang menulis input tersembunyi. */
  emitHiddenInput?: boolean;
}) {
  const [q, setQ] = useState("");
  const [picked, setPickedState] = useState<PickerVariant | null>(null);

  function setPicked(v: PickerVariant | null) {
    setPickedState(v);
    onPick?.(v);
  }

  const hasil = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return variants
      .filter((v) =>
        `${v.sku} ${v.product_name} ${v.color ?? ""} ${v.size ?? ""}`
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 8);
  }, [q, variants]);

  if (picked) {
    return (
      <div className="field">
        {label ? <label className="label">{label}</label> : null}
        {emitHiddenInput ? (
          <input type="hidden" name={name} value={picked.id} />
        ) : null}
        <div
          className="card"
          style={{
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{picked.product_name}</div>
            <div className="muted mono" style={{ fontSize: 12.5 }}>
              {picked.sku}
              {[picked.color, picked.size].filter(Boolean).length
                ? ` · ${[picked.color, picked.size].filter(Boolean).join(" ")}`
                : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted" style={{ fontSize: 11 }}>
              stok
            </div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 17,
                color: picked.stock_on_hand <= 0 ? "var(--bad)" : undefined,
              }}
            >
              {picked.stock_on_hand}
            </div>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPicked(null);
              setQ("");
            }}
            style={{ minHeight: 34, padding: "4px 10px", fontSize: 13 }}
          >
            Ganti
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      {label ? (
        <label className="label" htmlFor={`${name}-search`}>
          {label}
        </label>
      ) : null}
      <input
        id={`${name}-search`}
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ketik kode SKU, nama produk, atau warna…"
        autoComplete="off"
        autoFocus={autoFocus}
        style={{ minHeight: 46 }}
      />
      {q.trim() && (
        <div
          className="card"
          style={{ marginTop: 6, maxHeight: 290, overflowY: "auto", padding: 4 }}
        >
          {hasil.length === 0 ? (
            <div className="muted" style={{ padding: 12, fontSize: 13.5 }}>
              Tidak ada SKU yang cocok.
            </div>
          ) : (
            hasil.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setPicked(v)}
                style={{
                  display: "flex",
                  width: "100%",
                  gap: 10,
                  alignItems: "center",
                  padding: "9px 10px",
                  background: "transparent",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                  color: "inherit",
                  font: "inherit",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{v.product_name}</div>
                  <div className="muted mono" style={{ fontSize: 12 }}>
                    {v.sku}
                    {[v.color, v.size].filter(Boolean).length
                      ? ` · ${[v.color, v.size].filter(Boolean).join(" ")}`
                      : ""}
                  </div>
                </div>
                <span
                  className={
                    v.stock_on_hand <= 0 ? "pill pill-bad" : "pill pill-muted"
                  }
                >
                  {v.stock_on_hand}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
