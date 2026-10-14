/**
 * Uji jalur tulis stok memakai kode aplikasi yang sebenarnya (lib/stock.ts),
 * bukan SQL tiruan. Dijalankan di database nyata lalu dibersihkan sendiri.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/smoke-test.ts
 */
import { pool, query, queryOne, execute, withTransaction } from "../lib/db";
import { recordMovement, reverseMovement } from "../lib/stock";

let lolos = 0;
let gagal = 0;

function cek(nama: string, syarat: boolean, detail?: string) {
  if (syarat) {
    lolos++;
    console.log(`  OK   ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${nama}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("Menyiapkan data uji…");

  const kategori = await queryOne<{ id: number }>(
    `SELECT id FROM categories ORDER BY id LIMIT 1`,
  );
  if (!kategori) throw new Error("Belum ada kategori. Jalankan scripts/seed.mjs dulu.");

  const kode = `ZZTEST${Date.now().toString().slice(-6)}`;
  const { insertId: productId } = await execute(
    `INSERT INTO products (category_id, code, name, base_price) VALUES (?, ?, ?, ?)`,
    [kategori.id, kode, "Produk Uji Otomatis", 100000],
  );
  const { insertId: variantId } = await execute(
    `INSERT INTO product_variants (product_id, sku, size, color, reorder_point)
     VALUES (?, ?, 'M', 'Hitam', 5)`,
    [productId, `${kode}-HITAM-M`],
  );
  console.log(`  varian uji id=${variantId} (${kode}-HITAM-M), batas minimum 5\n`);

  const stok = async () =>
    Number(
      (
        await queryOne<{ stock_on_hand: number }>(
          `SELECT stock_on_hand FROM product_variants WHERE id = ?`,
          [variantId],
        )
      )?.stock_on_hand ?? NaN,
    );

  // --- 1. barang masuk
  console.log("1. Barang masuk 20 pcs");
  const masuk = await withTransaction((tx) =>
    recordMovement(tx, {
      variantId,
      quantity: 20,
      type: "in",
      referenceType: "goods_receipt",
      notes: "uji masuk",
    }),
  );
  cek("saldo jadi 20", (await stok()) === 20, `dapat ${await stok()}`);
  cek("balance_after tercatat 20", masuk.balanceAfter === 20);

  // --- 2. barang keluar
  console.log("2. Barang keluar 3 pcs");
  await withTransaction((tx) =>
    recordMovement(tx, {
      variantId,
      quantity: -3,
      type: "out",
      referenceType: "order",
      notes: "uji keluar",
    }),
  );
  cek("saldo jadi 17", (await stok()) === 17, `dapat ${await stok()}`);

  // --- 3. cache vs ledger
  console.log("3. Cache stok sama dengan jumlah ledger");
  const beda = await query(
    `SELECT * FROM v_stock_balance_check WHERE product_variant_id = ?`,
    [variantId],
  );
  cek("tidak ada selisih cache vs ledger", beda.length === 0);

  // --- 4. peringatan batas minimum
  console.log("4. Keluar 13 lagi sehingga menyentuh batas minimum (5)");
  await withTransaction((tx) =>
    recordMovement(tx, {
      variantId,
      quantity: -13,
      type: "out",
      referenceType: "order",
    }),
  );
  cek("saldo jadi 4", (await stok()) === 4, `dapat ${await stok()}`);
  const alertMin = await query(
    `SELECT id FROM stock_alerts WHERE product_variant_id = ? AND alert_type = 'low_stock'`,
    [variantId],
  );
  cek("peringatan stok menipis terbit", alertMin.length === 1);

  // --- 5. stok minus diterima, bukan ditolak
  console.log("5. Keluar 10 padahal sisa 4 (rekap setelah live)");
  const minus = await withTransaction((tx) =>
    recordMovement(tx, {
      variantId,
      quantity: -10,
      type: "out",
      referenceType: "order",
      notes: "uji stok minus",
    }),
  );
  cek("input diterima, tidak dilempar error", minus.balanceAfter === -6);
  cek("saldo jadi -6", (await stok()) === -6, `dapat ${await stok()}`);
  cek("ditandai wentNegative", minus.wentNegative === true);
  const alertVar = await query(
    `SELECT id FROM stock_alerts WHERE product_variant_id = ? AND alert_type = 'variance'`,
    [variantId],
  );
  cek("peringatan selisih terbit", alertVar.length === 1);

  // --- 6. koreksi lewat mutasi lawan
  console.log("6. Koreksi mutasi minus tadi");
  await withTransaction((tx) => reverseMovement(tx, minus.movementId, null, "uji koreksi"));
  cek("saldo kembali jadi 4", (await stok()) === 4, `dapat ${await stok()}`);
  const asli = await query(
    `SELECT id FROM stock_movements WHERE id = ?`,
    [minus.movementId],
  );
  cek("mutasi asli tidak dihapus", asli.length === 1);
  const koreksi = await queryOne<{ id: number; reverses_id: number }>(
    `SELECT id, reverses_id FROM stock_movements WHERE reverses_id = ?`,
    [minus.movementId],
  );
  cek("mutasi koreksi menunjuk ke mutasi asli", Number(koreksi?.reverses_id) === minus.movementId);

  console.log("7. Koreksi kedua kali ditolak");
  let ditolak = false;
  try {
    await withTransaction((tx) => reverseMovement(tx, minus.movementId, null, "dobel"));
  } catch {
    ditolak = true;
  }
  cek("koreksi ganda ditolak", ditolak);

  // --- 8. rollback saat transaksi gagal
  console.log("8. Transaksi yang gagal di tengah tidak meninggalkan jejak");
  const sebelum = await stok();
  const jumlahMutasiSebelum = (
    await query(`SELECT id FROM stock_movements WHERE product_variant_id = ?`, [variantId])
  ).length;
  try {
    await withTransaction(async (tx) => {
      await recordMovement(tx, {
        variantId,
        quantity: -1,
        type: "out",
        referenceType: "manual",
      });
      throw new Error("sengaja gagal");
    });
  } catch {
    /* diharapkan */
  }
  cek("saldo tidak berubah", (await stok()) === sebelum, `dapat ${await stok()}`);
  const jumlahMutasiSesudah = (
    await query(`SELECT id FROM stock_movements WHERE product_variant_id = ?`, [variantId])
  ).length;
  cek("tidak ada mutasi tertinggal", jumlahMutasiSesudah === jumlahMutasiSebelum);

  // --- bersih-bersih
  console.log("\nMembersihkan data uji…");
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
