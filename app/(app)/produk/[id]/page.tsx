import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { query, queryOne, execute } from "@/lib/db";
import { angka, rupiah } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage, StockPill } from "@/components/ui";
import Modal, { ModalActions } from "@/components/Modal";
import SubmitButton from "@/components/SubmitButton";
import Icon from "@/components/Icon";

export const dynamic = "force-dynamic";

interface Product {
  id: number;
  code: string;
  name: string;
  base_price: string;
  category_id: number;
  category_name: string;
  is_active: number;
}

interface Variant {
  id: number;
  sku: string;
  size: string | null;
  color: string | null;
  barcode: string | null;
  price: string | null;
  stock_on_hand: number;
  reorder_point: number;
  is_active: number;
  movement_count: number;
}

function isRedirect(e: unknown) {
  return (e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT");
}

/** SKU internal dibentuk dari kode produk + varian, karena "Seller SKU" dari
 *  marketplace hanya setingkat produk dan tidak membedakan ukuran/warna. */
function buatSku(code: string, color: string | null, size: string | null) {
  const suffix = [color, size]
    .filter(Boolean)
    .join("-")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
  return suffix ? `${code}-${suffix}` : code;
}

async function tambahVarian(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");

  const productId = Number(formData.get("product_id"));
  const size = String(formData.get("size") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  const reorderPoint = Number(formData.get("reorder_point") ?? 0);
  const priceRaw = String(formData.get("price") ?? "").trim();
  const price = priceRaw ? Number(priceRaw) : null;
  const barcode = String(formData.get("barcode") ?? "").trim() || null;

  const product = await queryOne<{ code: string }>(
    `SELECT code FROM products WHERE id = ?`,
    [productId],
  );
  if (!product) redirect("/produk?error=Produk+tidak+ditemukan");

  const sku = buatSku(product.code, color, size);

  try {
    await execute(
      `INSERT INTO product_variants
         (product_id, sku, size, color, barcode, price, reorder_point)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productId, sku, size, color, barcode, price, reorderPoint],
    );
    revalidatePath(`/produk/${productId}`);
    redirect(`/produk/${productId}?ok=Varian+${encodeURIComponent(sku)}+ditambahkan`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      redirect(
        `/produk/${productId}?error=Varian+dengan+ukuran+dan+warna+itu+sudah+ada+(${encodeURIComponent(sku)})`,
      );
    }
    throw e;
  }
}

async function ubahVarian(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");

  const productId = Number(formData.get("product_id"));
  const variantId = Number(formData.get("variant_id"));
  const size = String(formData.get("size") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  const reorderPoint = Math.max(0, Number(formData.get("reorder_point") ?? 0));
  const priceRaw = String(formData.get("price") ?? "").trim();
  const price = priceRaw ? Number(priceRaw) : null;
  const barcode = String(formData.get("barcode") ?? "").trim() || null;
  const isActive = formData.get("is_active") ? 1 : 0;
  const skuBaru = String(formData.get("sku") ?? "").trim().toUpperCase();

  if (!skuBaru) redirect(`/produk/${productId}?error=SKU+tidak+boleh+kosong`);

  try {
    await execute(
      `UPDATE product_variants
          SET sku = ?, size = ?, color = ?, barcode = ?, price = ?,
              reorder_point = ?, is_active = ?
        WHERE id = ?`,
      [skuBaru, size, color, barcode, price, reorderPoint, isActive, variantId],
    );
    revalidatePath(`/produk/${productId}`);
    redirect(`/produk/${productId}?ok=Varian+diperbarui`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      redirect(`/produk/${productId}?error=SKU+atau+kombinasi+ukuran+dan+warna+itu+sudah+dipakai`);
    }
    throw e;
  }
}

async function hapusVarian(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");
  const productId = Number(formData.get("product_id"));
  const variantId = Number(formData.get("variant_id"));

  const pakai = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_movements WHERE product_variant_id = ?`,
    [variantId],
  );

  // Varian yang pernah bermutasi tidak dihapus -- kartu stoknya harus tetap terbaca.
  if (Number(pakai?.n ?? 0) > 0) {
    await execute(
      `UPDATE product_variants SET is_active = 0, deleted_at = NOW() WHERE id = ?`,
      [variantId],
    );
    revalidatePath(`/produk/${productId}`);
    redirect(
      `/produk/${productId}?ok=Varian+punya+riwayat+stok,+jadi+diarsipkan+(bukan+dihapus)+agar+kartu+stoknya+tetap+utuh`,
    );
  }

  await execute(`DELETE FROM product_variants WHERE id = ?`, [variantId]);
  revalidatePath(`/produk/${productId}`);
  redirect(`/produk/${productId}?ok=Varian+dihapus`);
}

function FormVarian({
  productId,
  varian,
}: {
  productId: number;
  varian?: Variant;
}) {
  const k = varian?.id ?? "new";
  return (
    <>
      <input type="hidden" name="product_id" value={productId} />
      {varian && <input type="hidden" name="variant_id" value={varian.id} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label className="label" htmlFor={`color-${k}`}>
            Warna
          </label>
          <input
            id={`color-${k}`}
            name="color"
            className="input"
            placeholder="Hitam"
            defaultValue={varian?.color ?? ""}
            maxLength={30}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`size-${k}`}>
            Ukuran
          </label>
          <input
            id={`size-${k}`}
            name="size"
            className="input"
            placeholder="M"
            defaultValue={varian?.size ?? ""}
            maxLength={10}
          />
        </div>
      </div>

      {varian && (
        <div className="field">
          <label className="label" htmlFor={`sku-${k}`}>
            SKU
          </label>
          <input
            id={`sku-${k}`}
            name="sku"
            className="input mono"
            defaultValue={varian.sku}
            required
            maxLength={40}
          />
          <div className="hint">
            Dipakai di seluruh kartu stok dan laporan. Ubah hanya kalau memang perlu.
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label className="label" htmlFor={`rp-${k}`}>
            Batas minimum
          </label>
          <input
            id={`rp-${k}`}
            name="reorder_point"
            type="number"
            min={0}
            defaultValue={varian?.reorder_point ?? 3}
            className="input"
          />
          <div className="hint">Peringatan muncul saat stok menyentuh angka ini.</div>
        </div>
        <div className="field">
          <label className="label" htmlFor={`price-${k}`}>
            Harga khusus
          </label>
          <input
            id={`price-${k}`}
            name="price"
            type="number"
            min={0}
            step={1000}
            className="input"
            defaultValue={varian?.price ? Number(varian.price) : ""}
            placeholder="ikut harga produk"
          />
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor={`bc-${k}`}>
          Barcode
        </label>
        <input
          id={`bc-${k}`}
          name="barcode"
          className="input mono"
          defaultValue={varian?.barcode ?? ""}
          maxLength={40}
        />
      </div>

      {varian && (
        <label className="check">
          <input type="checkbox" name="is_active" defaultChecked={!!varian.is_active} />
          Varian aktif
        </label>
      )}
    </>
  );
}

export default async function DetailProdukPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole("owner", "admin");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const productId = Number(id);
  if (!Number.isInteger(productId)) notFound();

  const product = await queryOne<Product>(
    `SELECT p.id, p.code, p.name, p.base_price, p.category_id, p.is_active,
            c.name AS category_name
       FROM products p
       JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?`,
    [productId],
  );
  if (!product) notFound();

  const variants = await query<Variant>(
    `SELECT pv.id, pv.sku, pv.size, pv.color, pv.barcode, pv.price,
            pv.stock_on_hand, pv.reorder_point, pv.is_active,
            (SELECT COUNT(*) FROM stock_movements sm
              WHERE sm.product_variant_id = pv.id) AS movement_count
       FROM product_variants pv
      WHERE pv.product_id = ? AND pv.deleted_at IS NULL
      ORDER BY pv.color, FIELD(pv.size, 'XS','S','M','L','XL','XXL','XXXL'), pv.size`,
    [productId],
  );

  const totalStok = variants.reduce((s, v) => s + Number(v.stock_on_hand), 0);

  return (
    <>
      <PageHeader
        title={product.name}
        description={`${product.code} · ${product.category_name} · harga acuan ${rupiah(product.base_price)}${
          product.is_active ? "" : " · NONAKTIF"
        }`}
        back={{ href: "/produk", label: "Semua produk" }}
        action={
          <Modal
            title="Tambah Varian"
            description="Satu varian = satu SKU. Kode SKU dibuat otomatis dari kode produk, warna, dan ukuran."
            defaultOpen={!!error}
            trigger={
              <button className="btn btn-primary">
                <Icon name="plus" size={18} />
                Tambah Varian
              </button>
            }
          >
            <form action={tambahVarian}>
              <FormVarian productId={productId} />
              <ModalActions>
                <SubmitButton pendingLabel="Menyimpan…">Tambah Varian</SubmitButton>
              </ModalActions>
            </form>
          </Modal>
        }
      />

      <FlashMessage ok={ok} error={error} />

      <Card padded={false}>
        {variants.length === 0 ? (
          <Empty icon="tag" title="Produk ini belum punya varian">
            Tanpa varian, stoknya tidak bisa dicatat. Tambahkan minimal satu — kalau
            produknya memang tidak punya ukuran atau warna, kosongkan saja kedua
            isian itu.
          </Empty>
        ) : (
          <>
            <div
              className="row"
              style={{
                padding: "11px 16px",
                borderBottom: "1px solid var(--border)",
                fontSize: 13.5,
                background: "var(--surface-2)",
              }}
            >
              <span className="muted">{variants.length} varian</span>
              <span className="muted">·</span>
              <span>
                total stok <strong>{angka(totalStok)}</strong> pcs
              </span>
            </div>
            <div className="scroll-x">
              <table className="data stack">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Varian</th>
                    <th className="num">Stok</th>
                    <th>Status</th>
                    <th className="num">Batas min.</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.id} style={{ opacity: v.is_active ? 1 : 0.55 }}>
                      <td className="cell-main" data-label="">
                        <Link href={`/stok/${v.id}`}>
                          <div className="mono" style={{ fontWeight: 600, fontSize: 13.5 }}>
                            {v.sku}
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {Number(v.movement_count)} mutasi tercatat
                            {v.is_active ? "" : " · nonaktif"}
                          </div>
                        </Link>
                      </td>
                      <td data-label="Varian">
                        {[v.color, v.size].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td data-label="Stok" className="num" style={{ fontWeight: 700 }}>
                        {angka(v.stock_on_hand)}
                      </td>
                      <td data-label="Status">
                        <StockPill
                          stock={Number(v.stock_on_hand)}
                          reorderPoint={Number(v.reorder_point)}
                        />
                      </td>
                      <td data-label="Batas min." className="num muted">
                        {angka(v.reorder_point)}
                      </td>
                      <td data-label="" className="num">
                        <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                          <Link href={`/stok/${v.id}`} className="btn btn-sm">
                            Riwayat
                          </Link>

                          <Modal
                            title="Edit Varian"
                            description={v.sku}
                            trigger={<button className="btn btn-sm">Edit</button>}
                          >
                            <form action={ubahVarian}>
                              <FormVarian productId={productId} varian={v} />
                              <ModalActions>
                                <SubmitButton pendingLabel="Menyimpan…">
                                  Simpan Perubahan
                                </SubmitButton>
                              </ModalActions>
                            </form>
                          </Modal>

                          <Modal
                            title="Hapus varian ini?"
                            description={v.sku}
                            width={400}
                            trigger={
                              <button className="btn btn-sm btn-danger">Hapus</button>
                            }
                          >
                            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                              {Number(v.movement_count) > 0 ? (
                                <>
                                  Varian ini punya{" "}
                                  <strong>{Number(v.movement_count)} mutasi</strong>{" "}
                                  tercatat, jadi akan <strong>diarsipkan</strong>, bukan
                                  dihapus. Kartu stoknya tetap bisa dibaca dan laporan
                                  lama tidak berubah.
                                </>
                              ) : (
                                <>
                                  Varian ini belum pernah dipakai, jadi akan dihapus
                                  permanen.
                                </>
                              )}
                            </p>
                            <form action={hapusVarian}>
                              <input type="hidden" name="product_id" value={productId} />
                              <input type="hidden" name="variant_id" value={v.id} />
                              <ModalActions>
                                <SubmitButton
                                  className="btn btn-danger"
                                  pendingLabel="Memproses…"
                                >
                                  Ya, lanjutkan
                                </SubmitButton>
                              </ModalActions>
                            </form>
                          </Modal>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
