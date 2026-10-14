/**
 * Uji import memakai file export TikTok yang asli.
 * Membuat produk/varian/pemetaan sementara, menjalankan import, memeriksa
 * hasilnya, lalu menghapus semua yang dibuatnya.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-import.ts "<file.xlsx>"
 */
import { readFileSync } from "node:fs";
import { pool, query, queryOne, execute } from "../lib/db";
import { parseTikTokExport } from "../lib/tiktok-import";
import { importTikTokFile } from "../lib/order-sync";

let lolos = 0;
let gagal = 0;
function cek(nama: string, syarat: boolean, detail?: string) {
  if (syarat) {
    lolos++;
    console.log(`  OK    ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${nama}${detail ? ` — ${detail}` : ""}`);
  }
}

const FILE = process.argv[2] ?? "Semua pesanan-2026-09-27-14_05.xlsx";

// Dicatat di level modul supaya pembersihan tetap bisa jalan walau uji
// berhenti di tengah karena gagal.
let ctxChannel = 0;
let ctxProduct = 0;
const ctxVariants: number[] = [];

async function main() {
  const buffer = readFileSync(FILE);

  console.log(`\n=== 1. Membaca file: ${FILE}`);
  const parsed = await parseTikTokExport(buffer);
  console.log(`  ${parsed.rowCount} baris, ${parsed.orders.length} pesanan, ${parsed.skuIds.length} SKU unik`);
  cek("tidak ada baris bermasalah", parsed.problems.length === 0,
      parsed.problems.map((p) => `baris ${p.excelRow}: ${p.reason}`).join("; "));
  cek("43 pesanan terbaca", parsed.orders.length === 43, `dapat ${parsed.orders.length}`);
  cek("23 SKU ID unik", parsed.skuIds.length === 23, `dapat ${parsed.skuIds.length}`);

  const perStatus = parsed.orders.reduce<Record<string, number>>((a, o) => {
    a[o.status] = (a[o.status] ?? 0) + 1;
    return a;
  }, {});
  console.log("  status:", perStatus);

  // Nomor pesanan tidak dipatok ke nilai tertentu supaya skrip ini tidak
  // menyimpan data asli: cukup pastikan 18 digitnya utuh dan tidak berubah
  // jadi notasi ilmiah seperti 5.85808E+17.
  const contoh = parsed.orders.find((o) => o.orderNumber.length >= 18);
  cek("Order ID 18 digit utuh (tidak jadi notasi ilmiah)",
      !!contoh && /^\d{18,}$/.test(contoh.orderNumber), contoh?.orderNumber);
  cek("tanggal dd/MM/yyyy terbaca benar (30 Agu 2026)",
      contoh?.orderedAt.getDate() === 30 && contoh?.orderedAt.getMonth() === 7,
      contoh?.orderedAt.toISOString());

  const batal = parsed.orders.filter((o) => o.status === "cancelled");
  const batalSebelumKirim = batal.filter((o) => o.neverShipped);
  const batalSetelahKirim = batal.filter((o) => !o.neverShipped);
  console.log(`  pembatalan: ${batalSebelumKirim.length} sebelum dikirim, ` +
              `${batalSetelahKirim.length} setelah dikirim (paket gagal kirim)`);
  cek("pembatalan sebelum vs sesudah kirim dibedakan",
      batalSebelumKirim.length === 5 && batalSetelahKirim.length === 9,
      `dapat ${batalSebelumKirim.length}/${batalSetelahKirim.length}`);

  const live = parsed.orders.filter((o) => o.orderSource === "live");
  cek("sumber pesanan LIVE terdeteksi", live.length > 0, `dapat ${live.length}`);

  const multi = parsed.orders.filter((o) => o.items.length > 1);
  cek("pesanan multi-SKU dikelompokkan", multi.length === 4, `dapat ${multi.length}`);
  const totalAmountGanda = multi[0] ? multi[0].grandTotal : 0;
  console.log(`  contoh pesanan multi-baris: ${multi[0]?.orderNumber} ` +
              `(${multi[0]?.items.length} SKU, total ${totalAmountGanda} -- diambil sekali, bukan dijumlah)`);

  // --- menyiapkan master data sementara
  console.log("\n=== 2. Menyiapkan produk, varian, dan pemetaan sementara");
  const kategori = await queryOne<{ id: number }>(`SELECT id FROM categories ORDER BY id LIMIT 1`);
  // Channel khusus uji, supaya pemetaan SKU dan pesanan milik pengguna
  // tidak pernah tersentuh oleh skrip ini.
  const namaChannel = `UJI-${Date.now().toString().slice(-7)}`;
  const { insertId: channelId } = await execute(
    `INSERT INTO sales_channels (name, is_active) VALUES (?, 0)`, [namaChannel]);
  const channel = { id: channelId };
  ctxChannel = channelId;
  const user = await queryOne<{ id: number }>(`SELECT id FROM users ORDER BY id LIMIT 1`);
  if (!kategori || !user) throw new Error("Jalankan npm run seed dulu");

  const tag = `ZT${Date.now().toString().slice(-6)}`;
  const { insertId: productId } = await execute(
    `INSERT INTO products (category_id, code, name, base_price) VALUES (?, ?, ?, 0)`,
    [kategori.id, tag, "Produk Uji Import"]);
  ctxProduct = productId;

  const variantIds: number[] = [];
  for (const s of parsed.skuIds) {
    const { insertId } = await execute(
      `INSERT INTO product_variants (product_id, sku, size, color, reorder_point)
       VALUES (?, ?, ?, ?, 0)`,
      [productId, `${tag}-${s.skuId.slice(-6)}`, s.variation.slice(0, 10) || null, null]);
    variantIds.push(insertId);
    ctxVariants.push(insertId);
    await execute(
      `INSERT INTO channel_sku_mappings
         (sales_channel_id, product_variant_id, channel_sku_id, channel_seller_sku, channel_variation)
       VALUES (?, ?, ?, ?, ?)`,
      [channel.id, insertId, s.skuId, s.sellerSku, s.variation]);
    // stok awal cukup besar supaya tidak minus
    await execute(`UPDATE product_variants SET stock_on_hand = 100 WHERE id = ?`, [insertId]);
    await execute(
      `INSERT INTO stock_movements
         (product_variant_id, movement_type, quantity, balance_after,
          reference_type, notes, movement_date)
       VALUES (?, 'in', 100, 100, 'manual', 'saldo awal uji', CURDATE())`,
      [insertId]);
  }
  console.log(`  ${variantIds.length} varian uji dibuat, masing-masing stok awal 100`);

  // --- import pertama
  console.log("\n=== 3. Import pertama");
  const r1 = await importTikTokFile({
    buffer, fileName: `UJI-${FILE}`, salesChannelId: channel.id, userId: user.id,
  });
  console.log("  " + r1.message);
  cek("file tidak ditolak", r1.rejected === false, r1.message);
  cek("43 pesanan dibuat", r1.created === 43, `dapat ${r1.created}`);

  // Barang dianggap keluar kalau pesanan PERNAH dikirim, termasuk yang
  // akhirnya dibatalkan karena pengiriman gagal.
  const diharapkanKeluar = parsed.orders
    .filter((o) => o.status === "shipped" || o.status === "completed" || o.shippedAt)
    .reduce((s, o) => s + o.items.reduce((t, i) => t + i.quantity, 0), 0);
  cek(`stok keluar sesuai pesanan yang pernah dikirim (${diharapkanKeluar} pcs)`,
      r1.stockOut === diharapkanKeluar, `dapat ${r1.stockOut}`);

  const totalStok1 = await queryOne<{ n: number }>(
    `SELECT COALESCE(SUM(stock_on_hand),0) AS n FROM product_variants WHERE product_id = ?`,
    [productId]);
  const harusnya = 100 * variantIds.length - diharapkanKeluar;
  cek(`total stok jadi ${harusnya}`, Number(totalStok1?.n) === harusnya, `dapat ${totalStok1?.n}`);

  const batalBelumKirim = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_movements sm
       JOIN orders o ON o.id = sm.reference_id AND sm.reference_type = 'order'
      WHERE o.status = 'cancelled' AND o.shipped_at IS NULL`);
  cek("batal sebelum dikirim tidak membuat mutasi stok",
      Number(batalBelumKirim?.n) === 0, `dapat ${batalBelumKirim?.n}`);

  const masukOtomatis = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_movements sm
       JOIN orders o ON o.id = sm.reference_id AND sm.reference_type = 'order'
      WHERE o.status = 'cancelled' AND sm.quantity > 0`);
  cek("retur TIDAK otomatis menambah stok (menunggu konfirmasi fisik)",
      Number(masukOtomatis?.n) === 0, `dapat ${masukOtomatis?.n}`);

  // Dibatasi ke channel uji -- tanpa ini hitungannya ikut menghitung pesanan
  // milik channel lain dan ujinya jadi bergantung pada isi database.
  const menunggu = await query(
    `SELECT o.id FROM orders o
      WHERE o.sales_channel_id = ?
        AND o.status = 'cancelled' AND o.shipped_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.reference_type='order'
                      AND sm.reference_id = o.id AND sm.quantity < 0)
        AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.reference_type='order'
                          AND sm.reference_id = o.id AND sm.quantity > 0)`,
    [channel.id]);
  cek("9 paket masuk daftar menunggu konfirmasi retur",
      menunggu.length === 9, `dapat ${menunggu.length}`);

  // --- import kedua: file yang sama persis
  console.log("\n=== 4. Import ulang file yang sama (uji idempotensi)");
  const r2 = await importTikTokFile({
    buffer, fileName: `UJI-ULANG-${FILE}`, salesChannelId: channel.id, userId: user.id,
  });
  console.log("  " + r2.message);
  cek("tidak ada pesanan baru", r2.created === 0, `dapat ${r2.created}`);
  cek("stok TIDAK dikurangi dua kali", r2.stockOut === 0, `dapat ${r2.stockOut}`);

  const totalStok2 = await queryOne<{ n: number }>(
    `SELECT COALESCE(SUM(stock_on_hand),0) AS n FROM product_variants WHERE product_id = ?`,
    [productId]);
  cek("total stok tidak berubah", Number(totalStok2?.n) === harusnya, `dapat ${totalStok2?.n}`);

  // --- konsistensi cache vs ledger
  console.log("\n=== 5. Konsistensi cache vs ledger");
  const beda = await query(
    `SELECT * FROM v_stock_balance_check WHERE product_variant_id IN (${variantIds.join(",")})`);
  cek("tidak ada selisih cache vs ledger", beda.length === 0, JSON.stringify(beda));

  console.log(`\n${lolos} lolos, ${gagal} gagal`);
}

/** Dijalankan apa pun hasilnya, termasuk kalau uji gagal di tengah jalan. */
async function bersihkan(channelId: number, productId: number, variantIds: number[]) {
  console.log("\n=== Membersihkan data uji");
  const ids = await query<{ id: number }>(
    `SELECT id FROM orders WHERE sales_channel_id = ?`, [channelId]);
  const daftar = ids.map((o) => o.id);
  if (daftar.length) {
    const tanda = daftar.map(() => "?").join(",");
    await execute(
      `DELETE FROM stock_movements WHERE reference_type='order' AND reference_id IN (${tanda})`,
      daftar);
    await execute(`DELETE FROM order_items WHERE order_id IN (${tanda})`, daftar);
    await execute(`DELETE FROM orders WHERE id IN (${tanda})`, daftar);
  }
  if (variantIds.length) {
    const tanda = variantIds.map(() => "?").join(",");
    await execute(`DELETE FROM stock_movements WHERE product_variant_id IN (${tanda})`, variantIds);
    await execute(`DELETE FROM stock_alerts WHERE product_variant_id IN (${tanda})`, variantIds);
  }
  await execute(`DELETE FROM channel_sku_mappings WHERE sales_channel_id = ?`, [channelId]);
  await execute(`DELETE FROM import_batches WHERE sales_channel_id = ?`, [channelId]);
  if (productId) await execute(`DELETE FROM product_variants WHERE product_id = ?`, [productId]);
  if (productId) await execute(`DELETE FROM products WHERE id = ?`, [productId]);
  await execute(`DELETE FROM sales_channels WHERE id = ?`, [channelId]);
  console.log(`  channel uji, ${variantIds.length} varian, dan ${daftar.length} pesanan dihapus`);
}

async function jalankan() {
  try {
    await main();
  } catch (e) {
    gagal++;
    console.error("\nERROR:", e);
  } finally {
    // Pembersihan dijalankan apa pun hasilnya supaya kegagalan di tengah jalan
    // tidak meninggalkan produk, varian, atau channel uji di database.
    try {
      if (ctxChannel) await bersihkan(ctxChannel, ctxProduct, ctxVariants);
    } catch (e) {
      console.error("Pembersihan gagal:", e);
    }
    // Tanpa ini pool mysql2 menahan event loop dan prosesnya tidak pernah selesai.
    await pool.end();
  }

  console.log(gagal === 0 ? "\nSELESAI: semua lolos" : `\nSELESAI: ${gagal} gagal`);
  process.exit(gagal === 0 ? 0 : 1);
}

jalankan();
