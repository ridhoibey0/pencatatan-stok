import { createHash } from "node:crypto";
import { withTransaction, query, queryOne, type Tx } from "./db";
import { recordMovement } from "./stock";
import { parseTikTokExport, type ParsedOrder } from "./tiktok-import";

export interface ImportSummary {
  batchId: number | null;
  rowCount: number;
  orderCount: number;
  created: number;
  updated: number;
  skipped: number;
  stockOut: number;
  stockReturned: number;
  problems: { excelRow: number; orderId: string; reason: string }[];
  unmapped: { skuId: string; sellerSku: string; variation: string; productName: string }[];
  /** Kalau true, tidak ada apa pun yang ditulis ke database. */
  rejected: boolean;
  message: string;
}

function mysqlDateTime(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function mysqlDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Apakah barang pernah benar-benar keluar dari gudang.
 *
 * Bukan sekadar status akhir: di data nyata, 9 dari 14 pembatalan justru
 * sudah terlanjur dikirim lalu dibatalkan sistem karena "Pengiriman paket
 * gagal". Barangnya tetap keluar gudang dan sedang dalam perjalanan pulang,
 * jadi stok harus berkurang -- barang di jalan tidak bisa dijual.
 */
function pernahKeluarGudang(order: ParsedOrder): boolean {
  return (
    order.status === "shipped" ||
    order.status === "completed" ||
    order.shippedAt !== null
  );
}

export async function importTikTokFile(opts: {
  buffer: Buffer;
  fileName: string;
  salesChannelId: number;
  userId: number;
}): Promise<ImportSummary> {
  const parsed = await parseTikTokExport(opts.buffer);

  const kosong: ImportSummary = {
    batchId: null,
    rowCount: parsed.rowCount,
    orderCount: parsed.orders.length,
    created: 0,
    updated: 0,
    skipped: 0,
    stockOut: 0,
    stockReturned: 0,
    problems: parsed.problems,
    unmapped: [],
    rejected: true,
    message: "",
  };

  // Validasi SELURUH file dulu. File yang separuh masuk jauh lebih sulit
  // dibereskan daripada file yang ditolak utuh.
  if (parsed.problems.length > 0) {
    return {
      ...kosong,
      message: `${parsed.problems.length} baris bermasalah. Tidak ada data yang disimpan.`,
    };
  }

  const mappings = await query<{ channel_sku_id: string; product_variant_id: number }>(
    `SELECT channel_sku_id, product_variant_id
       FROM channel_sku_mappings WHERE sales_channel_id = ?`,
    [opts.salesChannelId],
  );
  const byChannelSku = new Map(
    mappings.map((m) => [m.channel_sku_id, Number(m.product_variant_id)]),
  );

  const unmapped = parsed.skuIds.filter((s) => !byChannelSku.has(s.skuId));
  if (unmapped.length > 0) {
    return {
      ...kosong,
      unmapped,
      message: `${unmapped.length} SKU belum dipetakan ke varian. Petakan dulu, lalu upload ulang.`,
    };
  }

  const hash = createHash("sha256").update(opts.buffer).digest("hex");

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let stockOut = 0;
  let stockReturned = 0;

  const batchId = await withTransaction(async (tx) => {
    const ins = await tx.execute(
      `INSERT INTO import_batches
         (sales_channel_id, file_name, file_hash, row_count, status, imported_by)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [opts.salesChannelId, opts.fileName, hash, parsed.rowCount, opts.userId],
    );
    return ins.insertId;
  });

  for (const order of parsed.orders) {
    const hasil = await withTransaction((tx) =>
      syncOneOrder(tx, order, {
        salesChannelId: opts.salesChannelId,
        userId: opts.userId,
        batchId,
        byChannelSku,
      }),
    );
    if (hasil.action === "created") created++;
    else if (hasil.action === "updated") updated++;
    else skipped++;
    stockOut += hasil.stockOut;
    stockReturned += hasil.stockReturned;
  }

  await withTransaction((tx) =>
    tx.execute(
      `UPDATE import_batches
          SET status = 'completed', created_count = ?, updated_count = ?, skipped_count = ?
        WHERE id = ?`,
      [created, updated, skipped, batchId],
    ),
  );

  return {
    batchId,
    rowCount: parsed.rowCount,
    orderCount: parsed.orders.length,
    created,
    updated,
    skipped,
    stockOut,
    stockReturned,
    problems: [],
    unmapped: [],
    rejected: false,
    message:
      `${parsed.orders.length} pesanan diproses: ${created} baru, ${updated} diperbarui, ` +
      `${skipped} tidak berubah. Stok keluar ${stockOut} pcs` +
      (stockReturned ? `, kembali ${stockReturned} pcs.` : "."),
  };
}

async function syncOneOrder(
  tx: Tx,
  order: ParsedOrder,
  ctx: {
    salesChannelId: number;
    userId: number;
    batchId: number;
    byChannelSku: Map<string, number>;
  },
): Promise<{ action: "created" | "updated" | "skipped"; stockOut: number; stockReturned: number }> {
  const existing = await tx.queryOne<{ id: number; status: string }>(
    `SELECT id, status FROM orders
      WHERE sales_channel_id = ? AND order_number = ? FOR UPDATE`,
    [ctx.salesChannelId, order.orderNumber],
  );

  const kolom = [
    order.status,
    order.platformStatus,
    order.orderSource,
    order.creatorHandle,
    mysqlDateTime(order.orderedAt),
    mysqlDateTime(order.paidAt),
    mysqlDateTime(order.shippedAt),
    mysqlDateTime(order.completedAt),
    mysqlDateTime(order.cancelledAt),
    order.courier,
    order.trackingNumber,
    order.province,
    order.city,
    order.buyerUsername,
    order.recipientName,
    order.phone,
    order.shippingCost,
    order.discountTotal,
    order.grandTotal,
    order.cancelledBy,
    order.cancelReason,
  ];

  if (!existing) {
    const ins = await tx.execute(
      `INSERT INTO orders
         (order_number, sales_channel_id, status, platform_status, order_source,
          creator_handle, ordered_at, paid_at, shipped_at, completed_at, cancelled_at,
          courier, tracking_number, province, city, buyer_username, recipient_name,
          phone, shipping_cost, discount_total, grand_total, cancelled_by,
          cancel_reason, import_batch_id, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.orderNumber,
        ctx.salesChannelId,
        ...kolom,
        ctx.batchId,
        ctx.userId,
      ],
    );
    const orderId = ins.insertId;

    for (const item of order.items) {
      const variantId = ctx.byChannelSku.get(item.skuId)!;
      await tx.execute(
        `INSERT INTO order_items
           (order_id, product_variant_id, channel_sku_id, quantity,
            returned_quantity, unit_price, discount)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
        [
          orderId,
          variantId,
          item.skuId,
          item.quantity,
          item.returnedQuantity,
          item.unitPrice,
          item.discount,
        ],
      );
    }

    let stockOut = 0;
    if (pernahKeluarGudang(order)) {
      stockOut = await kurangiStok(tx, orderId, order, ctx);
    }
    // Pesanan batal yang belum pernah dikirim: barang tidak pernah keluar gudang,
    // jadi stok tidak disentuh sama sekali.
    return { action: "created", stockOut, stockReturned: 0 };
  }

  const orderId = Number(existing.id);
  const statusLama = existing.status;

  await tx.execute(
    `UPDATE orders SET
       status = ?, platform_status = ?, order_source = ?, creator_handle = ?,
       ordered_at = ?, paid_at = ?, shipped_at = ?, completed_at = ?, cancelled_at = ?,
       courier = ?, tracking_number = ?, province = ?, city = ?, buyer_username = ?,
       recipient_name = ?, phone = ?, shipping_cost = ?, discount_total = ?,
       grand_total = ?, cancelled_by = ?, cancel_reason = ?
     WHERE id = ?`,
    [...kolom, orderId],
  );

  let stockOut = 0;

  if (pernahKeluarGudang(order)) {
    // Aman dipanggil berulang: kurangiStok memeriksa dulu apakah pesanan ini
    // sudah pernah mengurangi stok.
    stockOut = await kurangiStok(tx, orderId, order, ctx);
  }

  // Pembatalan TIDAK otomatis mengembalikan stok. Paket retur butuh waktu
  // berhari-hari untuk sampai, dan kadang tidak kembali utuh. Menambahkannya
  // sekarang membuat host mempromosikan barang yang belum ada di rak.
  // Pengembalian dicatat lewat halaman Konfirmasi Retur saat paketnya diterima.

  const berubah = statusLama !== order.status || stockOut > 0;
  return { action: berubah ? "updated" : "skipped", stockOut, stockReturned: 0 };
}

/**
 * Mengurangi stok untuk sebuah pesanan, hanya sekali seumur hidup pesanan itu.
 *
 * Ini pengaman terpenting di seluruh importer: tanpa pemeriksaan ini, satu file
 * yang ter-upload dua kali akan menghapus stok dua kali lipat.
 */
async function kurangiStok(
  tx: Tx,
  orderId: number,
  order: ParsedOrder,
  ctx: { userId: number; byChannelSku: Map<string, number> },
): Promise<number> {
  const sudah = await tx.queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_movements
      WHERE reference_type = 'order' AND reference_id = ? AND quantity < 0`,
    [orderId],
  );
  if (Number(sudah?.n ?? 0) > 0) return 0;

  let total = 0;
  for (const item of order.items) {
    const variantId = ctx.byChannelSku.get(item.skuId)!;
    await recordMovement(tx, {
      variantId,
      quantity: -item.quantity,
      type: "out",
      referenceType: "order",
      referenceId: orderId,
      notes: `Pesanan ${order.orderNumber}`,
      date: mysqlDate(order.shippedAt ?? order.orderedAt),
      userId: ctx.userId,
    });
    total += item.quantity;
  }
  return total;
}

/** Dipakai halaman import untuk memperingatkan file yang sama diupload lagi. */
export async function cariBatchDenganHash(hash: string, salesChannelId: number) {
  return queryOne<{ id: number; file_name: string; created_at: string }>(
    `SELECT id, file_name, created_at FROM import_batches
      WHERE file_hash = ? AND sales_channel_id = ? AND status = 'completed'
      ORDER BY id DESC LIMIT 1`,
    [hash, salesChannelId],
  );
}
