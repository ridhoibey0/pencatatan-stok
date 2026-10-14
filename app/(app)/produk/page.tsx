import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { query, execute, type Param } from "@/lib/db";
import { angka, rupiah } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage } from "@/components/ui";
import Modal, { ModalActions } from "@/components/Modal";
import SubmitButton from "@/components/SubmitButton";
import Icon from "@/components/Icon";

export const metadata = { title: "Produk & Varian — Nerva" };
export const dynamic = "force-dynamic";

interface ProductRow {
  id: number;
  code: string;
  name: string;
  base_price: string;
  category_id: number;
  category_name: string;
  is_active: number;
  variant_count: number;
  total_stock: number;
}

function isRedirect(e: unknown) {
  return (e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT");
}

async function tambahProduk(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const categoryId = Number(formData.get("category_id"));
  const basePrice = Number(formData.get("base_price") ?? 0);

  if (!code || !name || !categoryId) {
    redirect("/produk?error=Kode,+nama,+dan+kategori+wajib+diisi");
  }

  try {
    const { insertId } = await execute(
      `INSERT INTO products (category_id, code, name, base_price) VALUES (?, ?, ?, ?)`,
      [categoryId, code, name, basePrice],
    );
    revalidatePath("/produk");
    redirect(`/produk/${insertId}?ok=Produk+dibuat.+Tambahkan+variannya+sekarang.`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      redirect(`/produk?error=Kode+produk+${encodeURIComponent(code)}+sudah+dipakai`);
    }
    throw e;
  }
}

async function ubahProduk(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");

  const id = Number(formData.get("id"));
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const categoryId = Number(formData.get("category_id"));
  const basePrice = Number(formData.get("base_price") ?? 0);
  const isActive = formData.get("is_active") ? 1 : 0;

  if (!code || !name || !categoryId) {
    redirect("/produk?error=Kode,+nama,+dan+kategori+wajib+diisi");
  }

  try {
    await execute(
      `UPDATE products SET code = ?, name = ?, category_id = ?, base_price = ?, is_active = ?
        WHERE id = ?`,
      [code, name, categoryId, basePrice, isActive, id],
    );
    revalidatePath("/produk");
    redirect("/produk?ok=Produk+diperbarui");
  } catch (e) {
    if (isRedirect(e)) throw e;
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      redirect(`/produk?error=Kode+produk+${encodeURIComponent(code)}+sudah+dipakai`);
    }
    throw e;
  }
}

async function hapusProduk(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");
  const id = Number(formData.get("id"));

  // Produk yang variannya sudah punya riwayat mutasi tidak boleh hilang --
  // menghapusnya akan memutus jejak stok. Dinonaktifkan saja.
  const pakai = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_movements sm
       JOIN product_variants pv ON pv.id = sm.product_variant_id
      WHERE pv.product_id = ?`,
    [id],
  );
  if (Number(pakai[0]?.n ?? 0) > 0) {
    await execute(`UPDATE products SET is_active = 0 WHERE id = ?`, [id]);
    revalidatePath("/produk");
    redirect(
      "/produk?ok=Produk+sudah+punya+riwayat+stok,+jadi+dinonaktifkan+(bukan+dihapus)+agar+jejaknya+utuh",
    );
  }

  await execute(`DELETE FROM product_variants WHERE product_id = ?`, [id]);
  await execute(`DELETE FROM products WHERE id = ?`, [id]);
  revalidatePath("/produk");
  redirect("/produk?ok=Produk+dihapus");
}

function FormProduk({
  produk,
  categories,
}: {
  produk?: ProductRow;
  categories: { id: number; name: string }[];
}) {
  return (
    <>
      {produk && <input type="hidden" name="id" value={produk.id} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label className="label" htmlFor={`code-${produk?.id ?? "new"}`}>
            Kode produk
          </label>
          <input
            id={`code-${produk?.id ?? "new"}`}
            name="code"
            className="input mono"
            placeholder="T014"
            defaultValue={produk?.code}
            required
            maxLength={30}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`price-${produk?.id ?? "new"}`}>
            Harga acuan
          </label>
          <input
            id={`price-${produk?.id ?? "new"}`}
            name="base_price"
            type="number"
            min={0}
            step={1000}
            defaultValue={produk ? Number(produk.base_price) : 0}
            className="input"
          />
        </div>
      </div>
      <div className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
        Pakai pola konsisten seperti T014. Hindari nama panjang sebagai kode.
      </div>

      <div className="field">
        <label className="label" htmlFor={`name-${produk?.id ?? "new"}`}>
          Nama produk
        </label>
        <input
          id={`name-${produk?.id ?? "new"}`}
          name="name"
          className="input"
          defaultValue={produk?.name}
          required
          maxLength={200}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={`cat-${produk?.id ?? "new"}`}>
          Kategori
        </label>
        <select
          id={`cat-${produk?.id ?? "new"}`}
          name="category_id"
          className="select"
          defaultValue={produk?.category_id}
          required
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {produk && (
        <label className="check">
          <input type="checkbox" name="is_active" defaultChecked={!!produk.is_active} />
          Produk aktif (tampil di daftar stok dan bisa dipilih saat mencatat)
        </label>
      )}
    </>
  );
}

export default async function ProdukPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ok?: string; error?: string }>;
}) {
  await requireRole("owner", "admin");
  const { q = "", ok, error } = await searchParams;

  const params: Param[] = [];
  let filter = "";
  if (q.trim()) {
    filter = "WHERE (p.code LIKE ? OR p.name LIKE ?)";
    params.push(`%${q.trim()}%`, `%${q.trim()}%`);
  }

  const products = await query<ProductRow>(
    `SELECT p.id, p.code, p.name, p.base_price, p.is_active, p.category_id,
            c.name AS category_name,
            COUNT(pv.id) AS variant_count,
            COALESCE(SUM(pv.stock_on_hand), 0) AS total_stock
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_variants pv
              ON pv.product_id = p.id AND pv.deleted_at IS NULL
      ${filter}
      GROUP BY p.id, p.code, p.name, p.base_price, p.is_active, p.category_id, c.name
      ORDER BY p.is_active DESC, p.code`,
    params,
  );

  const categories = await query<{ id: number; name: string }>(
    `SELECT id, name FROM categories WHERE is_active = 1 ORDER BY name`,
  );

  return (
    <>
      <PageHeader
        title="Produk & Varian"
        description="Produk adalah modelnya, varian adalah SKU per ukuran dan warna. Stok menempel pada varian, bukan produk."
        action={
          <Modal
            title="Tambah Produk"
            description="Setelah tersimpan, lanjutkan dengan menambahkan variannya."
            defaultOpen={!!error}
            trigger={
              <button className="btn btn-primary">
                <Icon name="plus" size={18} />
                Tambah Produk
              </button>
            }
          >
            <form action={tambahProduk}>
              <FormProduk categories={categories} />
              <ModalActions>
                <SubmitButton pendingLabel="Menyimpan…">Simpan Produk</SubmitButton>
              </ModalActions>
            </form>
          </Modal>
        }
      />

      <FlashMessage ok={ok} error={error} />

      <form style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 380 }}>
          <Icon
            name="search"
            size={17}
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
              pointerEvents: "none",
            }}
          />
          <input
            name="q"
            className="input"
            defaultValue={q}
            placeholder="Cari kode atau nama produk…"
            style={{ paddingLeft: 36 }}
          />
        </div>
        <button className="btn">Cari</button>
        {q && (
          <Link href="/produk" className="btn">
            Reset
          </Link>
        )}
      </form>

      <Card padded={false}>
        {products.length === 0 ? (
          q ? (
            <Empty icon="search" title="Tidak ada yang cocok">
              Coba kata kunci lain.
            </Empty>
          ) : (
            <Empty icon="tag" title="Belum ada produk">
              Mulai dengan menambahkan produk, lalu buat variannya per ukuran dan
              warna. Stok baru bisa dicatat setelah variannya ada.
            </Empty>
          )
        ) : (
          <div className="scroll-x">
            <table className="data stack">
              <thead>
                <tr>
                  <th>Produk</th>
                  <th>Kategori</th>
                  <th className="num">Varian</th>
                  <th className="num">Stok</th>
                  <th className="num">Harga</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
                    <td className="cell-main" data-label="">
                      <Link href={`/produk/${p.id}`}>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div className="muted mono" style={{ fontSize: 12.5 }}>
                          {p.code}
                          {!p.is_active && " · nonaktif"}
                        </div>
                      </Link>
                    </td>
                    <td data-label="Kategori" className="muted">
                      {p.category_name}
                    </td>
                    <td data-label="Varian" className="num">
                      {Number(p.variant_count) === 0 ? (
                        <Link href={`/produk/${p.id}`} className="pill pill-warn">
                          belum ada
                        </Link>
                      ) : (
                        angka(p.variant_count)
                      )}
                    </td>
                    <td data-label="Stok" className="num" style={{ fontWeight: 650 }}>
                      {angka(p.total_stock)}
                    </td>
                    <td data-label="Harga" className="num muted">
                      {rupiah(p.base_price)}
                    </td>
                    <td data-label="" className="num">
                      <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                        <Modal
                          title="Edit Produk"
                          trigger={
                            <button className="btn btn-sm">Edit</button>
                          }
                        >
                          <form action={ubahProduk}>
                            <FormProduk produk={p} categories={categories} />
                            <ModalActions>
                              <SubmitButton pendingLabel="Menyimpan…">
                                Simpan Perubahan
                              </SubmitButton>
                            </ModalActions>
                          </form>
                        </Modal>

                        <Modal
                          title="Hapus produk ini?"
                          description={`${p.code} — ${p.name}`}
                          width={400}
                          trigger={
                            <button className="btn btn-sm btn-danger">Hapus</button>
                          }
                        >
                          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                            Kalau produk ini sudah punya riwayat mutasi stok, sistem
                            akan <strong>menonaktifkannya</strong>, bukan menghapus —
                            supaya kartu stok lama tetap bisa dibaca. Produk yang
                            belum pernah dipakai akan dihapus permanen beserta
                            variannya.
                          </p>
                          <form action={hapusProduk}>
                            <input type="hidden" name="id" value={p.id} />
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
        )}
      </Card>
    </>
  );
}
