import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { query, execute } from "@/lib/db";
import { PageHeader, Card, Empty, FlashMessage, Tabs } from "@/components/ui";
import Modal, { ModalActions } from "@/components/Modal";
import SubmitButton from "@/components/SubmitButton";
import Icon from "@/components/Icon";
import { TABS } from "@/lib/nav";

export const metadata = { title: "Pemetaan SKU — Nerva" };
export const dynamic = "force-dynamic";

async function hapusPemetaan(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");
  const id = Number(formData.get("id"));
  await execute(`DELETE FROM channel_sku_mappings WHERE id = ?`, [id]);
  revalidatePath("/mapping");
  redirect("/mapping?ok=Pemetaan+dihapus");
}

async function tambahPemetaan(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");
  const salesChannelId = Number(formData.get("sales_channel_id"));
  const variantId = Number(formData.get("variant_id"));
  const channelSkuId = String(formData.get("channel_sku_id") ?? "").trim();
  const sellerSku = String(formData.get("channel_seller_sku") ?? "").trim() || null;
  const variation = String(formData.get("channel_variation") ?? "").trim() || null;

  if (!channelSkuId || !variantId) {
    redirect("/mapping?error=SKU+ID+dan+varian+wajib+diisi");
  }

  await execute(
    `INSERT INTO channel_sku_mappings
       (sales_channel_id, product_variant_id, channel_sku_id,
        channel_seller_sku, channel_variation)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE product_variant_id = VALUES(product_variant_id),
                             channel_seller_sku = VALUES(channel_seller_sku),
                             channel_variation = VALUES(channel_variation)`,
    [salesChannelId, variantId, channelSkuId, sellerSku, variation],
  );
  revalidatePath("/mapping");
  redirect("/mapping?ok=Pemetaan+disimpan");
}

export default async function MappingPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole("owner", "admin");
  const { ok, error } = await searchParams;

  const rows = await query<{
    id: number;
    channel_sku_id: string;
    channel_seller_sku: string | null;
    channel_variation: string | null;
    channel_name: string;
    variant_id: number;
    sku: string;
    product_name: string;
    size: string | null;
    color: string | null;
  }>(
    `SELECT csm.id, csm.channel_sku_id, csm.channel_seller_sku, csm.channel_variation,
            sc.name AS channel_name, pv.id AS variant_id, pv.sku,
            p.name AS product_name, pv.size, pv.color
       FROM channel_sku_mappings csm
       JOIN sales_channels sc   ON sc.id = csm.sales_channel_id
       JOIN product_variants pv ON pv.id = csm.product_variant_id
       JOIN products p          ON p.id = pv.product_id
      ORDER BY sc.name, csm.channel_seller_sku, csm.channel_variation`,
  );

  const channels = await query<{ id: number; name: string }>(
    `SELECT id, name FROM sales_channels WHERE is_active = 1 ORDER BY name`,
  );
  const variants = await query<{
    id: number;
    sku: string;
    product_name: string;
    size: string | null;
    color: string | null;
  }>(
    `SELECT pv.id, pv.sku, p.name AS product_name, pv.size, pv.color
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
      WHERE pv.is_active = 1 AND pv.deleted_at IS NULL
      ORDER BY p.name, pv.color, pv.size`,
  );

  return (
    <>
      <PageHeader
        title="Pemetaan SKU Marketplace"
        description="Menghubungkan SKU ID dari marketplace ke varian internal. Biasanya terisi sendiri lewat halaman Import."
        action={
          <Modal
            title="Tambah Pemetaan"
            description="Dipakai kalau ada SKU yang perlu dipetakan manual tanpa menunggu file import."
            defaultOpen={!!error}
            trigger={
              <button className="btn btn-primary">
                <Icon name="plus" size={18} />
                Tambah Pemetaan
              </button>
            }
          >
            <form action={tambahPemetaan}>
              <div className="field">
                <label className="label" htmlFor="sales_channel_id">
                  Channel
                </label>
                <select id="sales_channel_id" name="sales_channel_id" className="select">
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="channel_sku_id">
                  SKU ID marketplace
                </label>
                <input
                  id="channel_sku_id"
                  name="channel_sku_id"
                  className="input mono"
                  required
                  maxLength={50}
                />
                <div className="hint">
                  Angka panjang milik marketplace, bukan kode produk Anda.
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label className="label" htmlFor="channel_seller_sku">
                    Seller SKU
                  </label>
                  <input
                    id="channel_seller_sku"
                    name="channel_seller_sku"
                    className="input mono"
                    maxLength={50}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="channel_variation">
                    Variation
                  </label>
                  <input
                    id="channel_variation"
                    name="channel_variation"
                    className="input"
                    maxLength={100}
                  />
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="variant_id">
                  Varian internal
                </label>
                <select id="variant_id" name="variant_id" className="select" required>
                  <option value="">— pilih —</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.sku} · {v.product_name}
                    </option>
                  ))}
                </select>
              </div>
              <ModalActions>
                <SubmitButton pendingLabel="Menyimpan…">Simpan Pemetaan</SubmitButton>
              </ModalActions>
            </form>
          </Modal>
        }
      />

      <Tabs items={TABS.pesanan} active="/mapping" />

      <FlashMessage ok={ok} error={error} />


      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty>
            Belum ada pemetaan. Upload file export di halaman Import — SKU yang
            belum dikenal akan ditawarkan untuk dipetakan di sana.
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="data stack">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>SKU ID</th>
                  <th>Seller SKU</th>
                  <th>Variation</th>
                  <th>Varian internal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Channel" className="muted">{r.channel_name}</td>
                    <td data-label="SKU ID" className="mono" style={{ fontSize: 12 }}>
                      {r.channel_sku_id}
                    </td>
                    <td data-label="Seller SKU" className="mono">{r.channel_seller_sku ?? "—"}</td>
                    <td data-label="Variation">{r.channel_variation ?? "—"}</td>
                    <td className="cell-main" data-label="">
                      <Link href={`/stok/${r.variant_id}`}>
                        <span className="mono" style={{ color: "var(--brand)" }}>
                          {r.sku}
                        </span>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {r.product_name}
                        </div>
                      </Link>
                    </td>
                    <td data-label="" className="num">
                      <Modal
                        title="Hapus pemetaan ini?"
                        description={r.channel_sku_id}
                        width={380}
                        trigger={<button className="btn btn-sm btn-danger">Hapus</button>}
                      >
                        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                          Import berikutnya akan menganggap SKU ini belum dikenal dan
                          meminta dipetakan ulang. Stok yang sudah tercatat tidak berubah.
                        </p>
                        <form action={hapusPemetaan}>
                          <input type="hidden" name="id" value={r.id} />
                          <ModalActions>
                            <SubmitButton className="btn btn-danger" pendingLabel="Menghapus…">
                              Ya, hapus
                            </SubmitButton>
                          </ModalActions>
                        </form>
                      </Modal>
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
