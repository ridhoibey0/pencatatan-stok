"use client";

interface Unmapped {
  skuId: string;
  sellerSku: string;
  variation: string;
  productName: string;
}

interface Variant {
  id: number;
  sku: string;
  product_name: string;
  size: string | null;
  color: string | null;
}

/**
 * Pencocokan SKU marketplace ke varian internal.
 *
 * Perlu dilakukan manual sekali per SKU karena "Seller SKU" di file export
 * hanya setingkat produk (T014 dipakai untuk S, M, L, XL sekaligus), sementara
 * teks "Variation" formatnya tidak konsisten sehingga tidak bisa diurai
 * dengan aturan yang bisa dipercaya.
 */
export default function UnmappedForm({
  action,
  salesChannelId,
  unmapped,
  variants,
}: {
  action: (formData: FormData) => void;
  salesChannelId: number;
  unmapped: Unmapped[];
  variants: Variant[];
}) {
  function tebakan(u: Unmapped): number | undefined {
    // Tebakan awal saja, tetap harus dikonfirmasi manusia.
    const bagian = u.variation
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const cocok = variants.filter((v) => {
      const kodeCocok = v.sku.toUpperCase().startsWith(u.sellerSku.toUpperCase());
      if (!kodeCocok || bagian.length === 0) return false;
      const atribut = [v.color, v.size]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      return bagian.every((b) => atribut.includes(b));
    });
    return cocok.length === 1 ? cocok[0].id : undefined;
  }

  return (
    <form action={action}>
      <div className="card" style={{ padding: 16 }}>
        <input type="hidden" name="sales_channel_id" value={salesChannelId} />
        <h3 style={{ fontSize: 15, margin: "0 0 6px" }}>
          Petakan {unmapped.length} SKU ini dulu
        </h3>
        <p className="muted" style={{ fontSize: 13.5, margin: "0 0 14px", maxWidth: "72ch" }}>
          Kode di kolom <strong>Seller SKU</strong> hanya menandai produk, bukan
          ukuran dan warnanya — satu kode dipakai untuk semua ukuran. Jadi tiap
          SKU ID dari marketplace perlu ditunjuk ke varian yang benar satu kali.
          Setelah ini, upload ulang file yang sama.
        </p>

        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>SKU ID</th>
                <th>Seller SKU</th>
                <th>Variation</th>
                <th>Nama di marketplace</th>
                <th style={{ minWidth: 260 }}>Varian internal</th>
              </tr>
            </thead>
            <tbody>
              {unmapped.map((u) => (
                <tr key={u.skuId}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {u.skuId}
                    <input type="hidden" name="channel_sku_id" value={u.skuId} />
                    <input type="hidden" name="seller_sku" value={u.sellerSku} />
                    <input type="hidden" name="variation" value={u.variation} />
                  </td>
                  <td className="mono">{u.sellerSku || "—"}</td>
                  <td>{u.variation || "—"}</td>
                  <td className="muted" style={{ fontSize: 13, maxWidth: 240 }}>
                    {u.productName}
                  </td>
                  <td>
                    <select
                      name="variant_id"
                      className="select"
                      defaultValue={tebakan(u) ?? 0}
                    >
                      <option value={0}>— lewati SKU ini —</option>
                      {variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.sku} · {v.product_name}
                          {[v.color, v.size].filter(Boolean).length
                            ? ` (${[v.color, v.size].filter(Boolean).join(" ")})`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <button type="submit" className="btn btn-primary" style={{ minHeight: 44 }}>
            Simpan Pemetaan
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Pilihan yang dilewati akan muncul lagi saat upload berikutnya.
          </span>
        </div>
      </div>
    </form>
  );
}
