/**
 * Uji penyetujuan stok opname memakai kode aplikasi yang sebenarnya.
 *
 * Ditulis setelah menemukan bug: count_date dikembalikan driver sebagai objek
 * Date, lalu String(date).slice(0, 10) menghasilkan "Wed Oct 14" sehingga
 * MySQL menolaknya (ER_TRUNCATED_WRONG_VALUE) dan penyetujuan selalu gagal.
 *
 *   npm run test:opname
 */
import { pool, query, queryOne, execute, withTransaction } from "../lib/db";
import { recordMovement } from "../lib/stock";
import { approveStockCount } from "../lib/stock-count";

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

const TANGGAL = "2026-03-09"; // sengaja bukan hari ini, untuk menguji round-trip

async function main() {
  const kategori = await queryOne<{ id: number }>(
    `SELECT id FROM categories ORDER BY id LIMIT 1`,
  );
  const user = await queryOne<{ id: number }>(`SELECT id FROM users ORDER BY id LIMIT 1`);
  if (!kategori || !user) throw new Error("Jalankan npm run seed dulu");

  const kode = `ZZOP${Date.now().toString().slice(-6)}`;
  const { insertId: productId } = await execute(
    `INSERT INTO products (category_id, code, name, base_price) VALUES (?, ?, ?, 0)`,
    [kategori.id, kode, "Produk Uji Opname"],
  );
  const { insertId: variantId } = await execute(
    `INSERT INTO product_variants (product_id, sku, size, color, reorder_point)
     VALUES (?, ?, 'M', 'Hitam', 2)`,
    [productId, `${kode}-HITAM-M`],
  );

  await withTransaction((tx) =>
    recordMovement(tx, {
      variantId,
      quantity: 20,
      type: "in",
      referenceType: "goods_receipt",
      notes: "saldo awal uji",
    }),
  );

  const stok = async () =>
    Number(
      (
        await queryOne<{ stock_on_hand: number }>(
          `SELECT stock_on_hand FROM product_variants WHERE id = ?`,
          [variantId],
        )
      )?.stock_on_hand ?? NaN,
    );

  console.log(`\n1. Sesi opname tanggal ${TANGGAL}, sistem 20 vs fisik 17`);
  const nomor = `SO-UJI-${Date.now().toString().slice(-7)}`;
  const { insertId: sessionId } = await execute(
    `INSERT INTO stock_counts (reference_no, count_type, count_date, status, created_by)
     VALUES (?, 'product', ?, 'draft', ?)`,
    [nomor, TANGGAL, user.id],
  );
  await execute(
    `INSERT INTO stock_count_items
       (stock_count_id, product_variant_id, system_quantity, counted_quantity, notes)
     VALUES (?, ?, ?, ?, 'hilang 3 pcs saat uji')`,
    [sessionId, variantId, 20, 17],
  );

  const selisih = await queryOne<{ variance: string }>(
    `SELECT variance FROM stock_count_items WHERE stock_count_id = ?`,
    [sessionId],
  );
  cek("selisih dihitung database (-3)", Number(selisih?.variance) === -3, selisih?.variance);

  console.log("\n2. Menyetujui sesi");
  const hasil = await approveStockCount(sessionId, user.id);
  cek("tidak melempar error", true);
  cek("1 SKU disesuaikan", hasil.skuDisesuaikan === 1, String(hasil.skuDisesuaikan));
  cek("3 unit disesuaikan", hasil.unitDisesuaikan === 3, String(hasil.unitDisesuaikan));
  cek("stok jadi 17", (await stok()) === 17, `dapat ${await stok()}`);

  const mutasi = await queryOne<{
    movement_type: string;
    quantity: number;
    balance_after: number;
    movement_date: Date | string;
    notes: string | null;
  }>(
    `SELECT movement_type, quantity, balance_after, movement_date, notes
       FROM stock_movements
      WHERE reference_type = 'stock_count' AND reference_id = ?`,
    [sessionId],
  );
  cek("mutasi penyesuaian tercatat", !!mutasi);
  cek("jenis mutasi count_adjustment", mutasi?.movement_type === "count_adjustment");
  cek("jumlah -3", Number(mutasi?.quantity) === -3, String(mutasi?.quantity));
  cek("saldo sesudah 17", Number(mutasi?.balance_after) === 17, String(mutasi?.balance_after));

  // Inti bug yang diperbaiki: tanggal sesi harus sampai utuh ke mutasi.
  const tglMutasi =
    mutasi?.movement_date instanceof Date
      ? `${mutasi.movement_date.getFullYear()}-${String(mutasi.movement_date.getMonth() + 1).padStart(2, "0")}-${String(mutasi.movement_date.getDate()).padStart(2, "0")}`
      : String(mutasi?.movement_date ?? "").slice(0, 10);
  cek(`tanggal mutasi ikut tanggal opname (${TANGGAL})`, tglMutasi === TANGGAL, tglMutasi);
  cek("alasan selisih ikut tersimpan", mutasi?.notes === "hilang 3 pcs saat uji", mutasi?.notes ?? "");

  const sesi = await queryOne<{ status: string; approved_by: number | null }>(
    `SELECT status, approved_by FROM stock_counts WHERE id = ?`,
    [sessionId],
  );
  cek("sesi berstatus approved", sesi?.status === "approved", sesi?.status);
  cek("pencatat persetujuan tersimpan", Number(sesi?.approved_by) === user.id);

  console.log("\n3. Menyetujui ulang tidak mengubah stok");
  const ulang = await approveStockCount(sessionId, user.id);
  cek("ditandai sudah pernah disetujui", ulang.sudahPernah === true);
  cek("stok tetap 17", (await stok()) === 17, `dapat ${await stok()}`);
  const jumlahMutasi = await query(
    `SELECT id FROM stock_movements WHERE reference_type='stock_count' AND reference_id = ?`,
    [sessionId],
  );
  cek("tidak ada mutasi ganda", jumlahMutasi.length === 1, `dapat ${jumlahMutasi.length}`);

  console.log("\n4. Sesi tanpa selisih");
  const nomor2 = `SO-UJI2-${Date.now().toString().slice(-7)}`;
  const { insertId: sesi2 } = await execute(
    `INSERT INTO stock_counts (reference_no, count_type, count_date, status, created_by)
     VALUES (?, 'product', CURDATE(), 'draft', ?)`,
    [nomor2, user.id],
  );
  await execute(
    `INSERT INTO stock_count_items
       (stock_count_id, product_variant_id, system_quantity, counted_quantity)
     VALUES (?, ?, 17, 17)`,
    [sesi2, variantId],
  );
  const hasil2 = await approveStockCount(sesi2, user.id);
  cek("tidak ada SKU disesuaikan", hasil2.skuDisesuaikan === 0);
  cek("stok tidak berubah", (await stok()) === 17, `dapat ${await stok()}`);

  console.log("\n5. Cache stok sama dengan ledger");
  const beda = await query(
    `SELECT * FROM v_stock_balance_check WHERE product_variant_id = ?`,
    [variantId],
  );
  cek("tidak ada selisih cache vs ledger", beda.length === 0, JSON.stringify(beda));

  console.log("\nMembersihkan data uji…");
  await execute(`DELETE FROM stock_count_items WHERE stock_count_id IN (?, ?)`, [
    sessionId,
    sesi2,
  ]);
  await execute(`DELETE FROM stock_counts WHERE id IN (?, ?)`, [sessionId, sesi2]);
  await execute(`DELETE FROM stock_alerts WHERE product_variant_id = ?`, [variantId]);
  await execute(`DELETE FROM stock_movements WHERE product_variant_id = ?`, [variantId]);
  await execute(`DELETE FROM product_variants WHERE id = ?`, [variantId]);
  await execute(`DELETE FROM products WHERE id = ?`, [productId]);

  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  await pool.end();
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nERROR:", e);
  await pool.end();
  process.exit(1);
});
