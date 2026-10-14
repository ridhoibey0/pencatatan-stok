import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { requireRole } from "@/lib/auth";
import { query, execute } from "@/lib/db";
import { importTikTokFile, cariBatchDenganHash } from "@/lib/order-sync";
import { angka, tanggalJam } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage, Tabs } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import { TABS } from "@/lib/nav";
import UnmappedForm from "./UnmappedForm";

export const metadata = { title: "Import Penjualan — Nerva" };
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

async function prosesUpload(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin", "warehouse");

  const file = formData.get("file") as File | null;
  const salesChannelId = Number(formData.get("sales_channel_id"));
  const paksa = String(formData.get("paksa") ?? "") === "1";

  if (!file || file.size === 0) redirect("/import?error=Pilih+file+dulu");
  if (file.size > MAX_BYTES) redirect("/import?error=File+lebih+dari+10+MB");
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    redirect("/import?error=File+harus+berekstensi+.xlsx");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (!paksa) {
    const hash = createHash("sha256").update(buffer).digest("hex");
    const sudah = await cariBatchDenganHash(hash, salesChannelId);
    if (sudah) {
      redirect(
        `/import?dupe=${sudah.id}&nama=${encodeURIComponent(sudah.file_name)}&waktu=${encodeURIComponent(sudah.created_at)}`,
      );
    }
  }

  let hasil;
  try {
    hasil = await importTikTokFile({
      buffer,
      fileName: file.name,
      salesChannelId,
      userId: user.id,
    });
  } catch (e) {
    const err = e as { message?: string; digest?: string };
    if (err.digest?.startsWith("NEXT_REDIRECT")) throw e;
    redirect(`/import?error=${encodeURIComponent(err.message ?? "File gagal dibaca")}`);
  }

  if (hasil.rejected) {
    // Simpan daftar SKU belum terpetakan supaya bisa ditampilkan form pemetaannya.
    const payload = Buffer.from(
      JSON.stringify({
        message: hasil.message,
        unmapped: hasil.unmapped,
        problems: hasil.problems.slice(0, 50),
        channel: salesChannelId,
      }),
    ).toString("base64url");
    redirect(`/import?tolak=${payload}`);
  }

  revalidatePath("/stok");
  revalidatePath("/pesanan");
  revalidatePath("/import");
  redirect(`/import?ok=${encodeURIComponent(hasil.message)}`);
}

async function simpanPemetaan(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");

  const salesChannelId = Number(formData.get("sales_channel_id"));
  const skuIds = formData.getAll("channel_sku_id").map(String);
  const variantIds = formData.getAll("variant_id").map((v) => Number(v));
  const sellerSkus = formData.getAll("seller_sku").map(String);
  const variations = formData.getAll("variation").map(String);

  let n = 0;
  for (let i = 0; i < skuIds.length; i++) {
    const variantId = variantIds[i];
    if (!Number.isInteger(variantId) || variantId <= 0) continue;
    await execute(
      `INSERT INTO channel_sku_mappings
         (sales_channel_id, product_variant_id, channel_sku_id,
          channel_seller_sku, channel_variation)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE product_variant_id = VALUES(product_variant_id)`,
      [salesChannelId, variantId, skuIds[i], sellerSkus[i] || null, variations[i] || null],
    );
    n++;
  }

  revalidatePath("/import");
  revalidatePath("/mapping");
  redirect(
    `/import?ok=${encodeURIComponent(`${n} SKU dipetakan. Upload ulang file yang tadi untuk melanjutkan import.`)}`,
  );
}

interface Tolak {
  message: string;
  unmapped: { skuId: string; sellerSku: string; variation: string; productName: string }[];
  problems: { excelRow: number; orderId: string; reason: string }[];
  channel: number;
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    tolak?: string;
    dupe?: string;
    nama?: string;
    waktu?: string;
  }>;
}) {
  await requireRole("owner", "admin", "warehouse");
  const sp = await searchParams;

  let tolak: Tolak | null = null;
  if (sp.tolak) {
    try {
      tolak = JSON.parse(Buffer.from(sp.tolak, "base64url").toString("utf8"));
    } catch {
      tolak = null;
    }
  }

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

  const batches = await query<{
    id: number;
    file_name: string;
    row_count: number;
    created_count: number;
    updated_count: number;
    skipped_count: number;
    status: string;
    created_at: string;
    channel_name: string;
    user_name: string | null;
  }>(
    `SELECT ib.id, ib.file_name, ib.row_count, ib.created_count, ib.updated_count,
            ib.skipped_count, ib.status, ib.created_at,
            sc.name AS channel_name, u.name AS user_name
       FROM import_batches ib
       JOIN sales_channels sc ON sc.id = ib.sales_channel_id
       LEFT JOIN users u ON u.id = ib.imported_by
      ORDER BY ib.id DESC LIMIT 15`,
  );

  return (
    <>
      <PageHeader
        title="Import Penjualan"
        description="Upload file “Semua pesanan” dari TikTok Shop. Stok keluar dihitung otomatis dari pesanan yang sudah dikirim atau selesai."
      />

      <Tabs items={TABS.pesanan} active="/import" />

      <FlashMessage ok={sp.ok} error={sp.error} />

      {sp.dupe && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          <strong>File ini sudah pernah diimpor</strong> sebagai batch #{sp.dupe} (
          {sp.nama}) pada {tanggalJam(sp.waktu)}. Mengimpor ulang tidak akan
          mengurangi stok dua kali, tapi biasanya memang tidak perlu. Centang
          “paksa proses ulang” di bawah kalau memang disengaja.
        </div>
      )}

      {tolak && (
        <div style={{ marginBottom: 18 }}>
          <div className="alert alert-bad" style={{ marginBottom: 12 }}>
            <strong>File ditolak — tidak ada data yang disimpan.</strong>
            <div style={{ marginTop: 4 }}>{tolak.message}</div>
          </div>

          {tolak.problems.length > 0 && (
            <Card style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Baris bermasalah</h3>
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Baris Excel</th>
                      <th>Order ID</th>
                      <th>Masalah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tolak.problems.map((p, i) => (
                      <tr key={i}>
                        <td className="num">{p.excelRow}</td>
                        <td className="mono" style={{ fontSize: 13 }}>
                          {p.orderId}
                        </td>
                        <td>{p.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {tolak.unmapped.length > 0 && (
            <UnmappedForm
              action={simpanPemetaan}
              salesChannelId={tolak.channel}
              unmapped={tolak.unmapped}
              variants={variants}
            />
          )}
        </div>
      )}

      <Card style={{ marginBottom: 20 }}>
        <form action={prosesUpload}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="sales_channel_id">
                Channel
              </label>
              <select
                id="sales_channel_id"
                name="sales_channel_id"
                className="select"
                defaultValue={channels.find((c) => c.name.includes("TikTok"))?.id}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="file">
                File export (.xlsx)
              </label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".xlsx"
                required
                className="input"
                style={{ paddingTop: 7 }}
              />
            </div>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "14px 0",
              fontSize: 13.5,
            }}
          >
            <input type="checkbox" name="paksa" value="1" />
            Paksa proses ulang walau filenya sudah pernah diimpor
          </label>

          <SubmitButton pendingLabel="Memproses file…">Upload &amp; Proses</SubmitButton>
        </form>

        <div
          className="muted"
          style={{ fontSize: 13, marginTop: 14, lineHeight: 1.6, borderTop: "1px solid var(--border)", paddingTop: 12 }}
        >
          <strong>Yang dilakukan sistem:</strong> pesanan berstatus Dikirim atau
          Selesai mengurangi stok sekali saja. Pesanan Dibatalkan yang belum pernah
          dikirim tidak menyentuh stok — barangnya memang tidak pernah keluar gudang.
          Pesanan yang sudah terkirim lalu dibatalkan akan mengembalikan stok.
        </div>
      </Card>

      <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Riwayat import</h2>
      <Card padded={false}>
        {batches.length === 0 ? (
          <Empty>Belum pernah ada import.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>File</th>
                  <th>Channel</th>
                  <th className="num">Baris</th>
                  <th className="num">Baru</th>
                  <th className="num">Diperbarui</th>
                  <th className="num">Dilewati</th>
                  <th>Waktu</th>
                  <th>Oleh</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.id}</td>
                    <td style={{ maxWidth: 260, fontSize: 13 }}>{b.file_name}</td>
                    <td className="muted">{b.channel_name}</td>
                    <td className="num">{angka(b.row_count)}</td>
                    <td className="num" style={{ color: "var(--ok)", fontWeight: 600 }}>
                      {angka(b.created_count)}
                    </td>
                    <td className="num">{angka(b.updated_count)}</td>
                    <td className="num muted">{angka(b.skipped_count)}</td>
                    <td className="muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                      {tanggalJam(b.created_at)}
                    </td>
                    <td className="muted">{b.user_name ?? "—"}</td>
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
