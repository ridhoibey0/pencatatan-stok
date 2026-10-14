import { withTransaction } from "./db";
import { recordMovement } from "./stock";
import { tanggalSQL } from "./format";

export interface ApproveResult {
  /** true kalau sesi memang sudah disetujui sebelumnya, jadi tidak diapa-apakan. */
  sudahPernah: boolean;
  skuDisesuaikan: number;
  unitDisesuaikan: number;
}

/**
 * Menyetujui sesi opname: setiap selisih diubah jadi mutasi penyesuaian,
 * lalu sesinya dikunci.
 *
 * Ditaruh di lib (bukan langsung di server action) supaya bisa diuji tanpa
 * menjalankan Next -- lihat scripts/test-opname.ts.
 */
export async function approveStockCount(
  stockCountId: number,
  userId: number | null,
): Promise<ApproveResult> {
  return withTransaction(async (tx) => {
    const sesi = await tx.queryOne<{
      id: number;
      status: string;
      count_date: Date | string;
    }>(`SELECT id, status, count_date FROM stock_counts WHERE id = ? FOR UPDATE`, [
      stockCountId,
    ]);
    if (!sesi) throw new Error("Sesi opname tidak ditemukan");
    if (sesi.status === "approved") {
      return { sudahPernah: true, skuDisesuaikan: 0, unitDisesuaikan: 0 };
    }

    // count_date datang sebagai objek Date dari driver; harus dinormalkan
    // sebelum dipakai lagi sebagai parameter kolom DATE.
    const tanggal = tanggalSQL(sesi.count_date);

    const items = await tx.query<{
      product_variant_id: number;
      counted_quantity: string;
      variance: string;
      notes: string | null;
    }>(
      `SELECT product_variant_id, counted_quantity, variance, notes
         FROM stock_count_items
        WHERE stock_count_id = ? AND product_variant_id IS NOT NULL AND variance <> 0`,
      [stockCountId],
    );

    const variantIds: number[] = [];
    let unit = 0;

    for (const it of items) {
      // Stok barang jadi selalu bilangan bulat; pembulatan menjaga agar
      // ketikan seperti "3,5" tidak menolak seluruh penyetujuan.
      const selisih = Math.round(Number(it.variance));
      if (selisih === 0) continue;

      const variantId = Number(it.product_variant_id);
      await recordMovement(tx, {
        variantId,
        quantity: selisih,
        type: "count_adjustment",
        referenceType: "stock_count",
        referenceId: stockCountId,
        notes: it.notes ?? "Penyesuaian hasil opname",
        date: tanggal,
        userId,
      });
      variantIds.push(variantId);
      unit += Math.abs(selisih);
    }

    await tx.execute(
      `UPDATE stock_counts
          SET status = 'approved', approved_by = ?, approved_at = NOW()
        WHERE id = ?`,
      [userId, stockCountId],
    );

    // Hanya peringatan selisih untuk varian yang baru saja dibereskan yang
    // ditutup -- bukan semua peringatan selisih di seluruh sistem.
    if (variantIds.length > 0) {
      await tx.execute(
        `UPDATE stock_alerts
            SET status = 'resolved', resolved_by = ?, resolved_at = NOW()
          WHERE alert_type = 'variance'
            AND status <> 'resolved'
            AND product_variant_id IN (${variantIds.map(() => "?").join(",")})`,
        [userId, ...variantIds],
      );
    }

    return {
      sudahPernah: false,
      skuDisesuaikan: variantIds.length,
      unitDisesuaikan: unit,
    };
  });
}
