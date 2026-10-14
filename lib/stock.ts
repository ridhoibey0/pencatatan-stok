import { Tx } from "./db";

export type MovementType =
  | "in"
  | "out"
  | "return"
  | "damage"
  | "count_adjustment"
  | "correction";

export type ReferenceType = "goods_receipt" | "order" | "stock_count" | "manual";

export interface MovementInput {
  variantId: number;
  /** Bertanda: positif menambah, negatif mengurangi. */
  quantity: number;
  type: MovementType;
  referenceType: ReferenceType;
  referenceId?: number | null;
  notes?: string | null;
  /** YYYY-MM-DD. Default hari ini. */
  date?: string;
  userId?: number | null;
  reversesId?: number | null;
}

export interface MovementResult {
  movementId: number;
  balanceBefore: number;
  balanceAfter: number;
  wentNegative: boolean;
  hitReorderPoint: boolean;
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * SATU-SATUNYA tempat stok barang jadi boleh berubah.
 *
 * Menulis baris stock_movements dan memperbarui cache product_variants.stock_on_hand
 * dalam satu langkah, jadi keduanya tidak mungkin berbeda. Memanggil UPDATE ke
 * stock_on_hand dari tempat lain akan merusak jaminan itu -- jangan.
 *
 * Harus dipanggil di dalam withTransaction().
 */
export async function recordMovement(
  tx: Tx,
  input: MovementInput,
): Promise<MovementResult> {
  if (!Number.isInteger(input.quantity) || input.quantity === 0) {
    throw new Error("Jumlah mutasi harus bilangan bulat dan tidak boleh nol");
  }

  // Kunci barisnya dulu. Tanpa FOR UPDATE, dua proses bisa membaca saldo yang
  // sama lalu saling menimpa, dan satu mutasi hilang tanpa jejak.
  const variant = await tx.queryOne<{
    id: number;
    stock_on_hand: number;
    reorder_point: number;
  }>(
    `SELECT id, stock_on_hand, reorder_point
       FROM product_variants
      WHERE id = ?
      FOR UPDATE`,
    [input.variantId],
  );
  if (!variant) throw new Error(`Varian id ${input.variantId} tidak ditemukan`);

  const before = Number(variant.stock_on_hand);
  const after = before + input.quantity;

  const ins = await tx.execute(
    `INSERT INTO stock_movements
       (product_variant_id, movement_type, quantity, balance_after,
        reference_type, reference_id, notes, movement_date, recorded_by, reverses_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.variantId,
      input.type,
      input.quantity,
      after,
      input.referenceType,
      input.referenceId ?? null,
      input.notes ?? null,
      input.date ?? today(),
      input.userId ?? null,
      input.reversesId ?? null,
    ],
  );

  await tx.execute(
    `UPDATE product_variants SET stock_on_hand = ? WHERE id = ?`,
    [after, input.variantId],
  );

  const reorderPoint = Number(variant.reorder_point);
  const wentNegative = after < 0;
  const hitReorderPoint = after >= 0 && after <= reorderPoint;

  // Stok minus bukan ditolak, tapi ditandai. Penjualan dicatat sebagai rekap
  // setelah kejadian -- kalau tidak cukup, yang salah catatannya, bukan penjualannya.
  if (wentNegative) {
    await raiseAlert(tx, {
      variantId: input.variantId,
      type: "variance",
      message: `Stok minus (${after}) setelah mutasi ${input.type}. Perlu stok opname.`,
      level: after,
    });
  } else if (hitReorderPoint && input.quantity < 0) {
    await raiseAlert(tx, {
      variantId: input.variantId,
      type: after === 0 ? "out_of_stock" : "low_stock",
      message:
        after === 0
          ? "Stok habis."
          : `Stok tinggal ${after}, di bawah atau sama dengan batas minimum ${reorderPoint}.`,
      level: after,
    });
  }

  return {
    movementId: ins.insertId,
    balanceBefore: before,
    balanceAfter: after,
    wentNegative,
    hitReorderPoint,
  };
}

/** Membatalkan sebuah mutasi dengan mutasi lawan. Tidak pernah DELETE. */
export async function reverseMovement(
  tx: Tx,
  movementId: number,
  userId: number | null,
  reason: string,
): Promise<MovementResult> {
  const original = await tx.queryOne<{
    id: number;
    product_variant_id: number;
    quantity: number;
  }>(
    `SELECT id, product_variant_id, quantity FROM stock_movements WHERE id = ?`,
    [movementId],
  );
  if (!original) throw new Error("Mutasi tidak ditemukan");

  const already = await tx.queryOne<{ id: number }>(
    `SELECT id FROM stock_movements WHERE reverses_id = ? LIMIT 1`,
    [movementId],
  );
  if (already) throw new Error("Mutasi ini sudah pernah dikoreksi");

  return recordMovement(tx, {
    variantId: Number(original.product_variant_id),
    quantity: -Number(original.quantity),
    type: "correction",
    referenceType: "manual",
    referenceId: null,
    notes: reason,
    userId,
    reversesId: movementId,
  });
}

interface AlertInput {
  variantId?: number | null;
  materialId?: number | null;
  type: "low_stock" | "out_of_stock" | "variance";
  message: string;
  level: number;
}

/** Tidak membuat peringatan baru kalau yang lama untuk item & jenis yang sama masih terbuka. */
export async function raiseAlert(tx: Tx, a: AlertInput): Promise<void> {
  const open = await tx.queryOne<{ id: number }>(
    `SELECT id FROM stock_alerts
      WHERE alert_type = ?
        AND status <> 'resolved'
        AND ${a.variantId ? "product_variant_id = ?" : "material_id = ?"}
      LIMIT 1`,
    [a.type, a.variantId ?? a.materialId],
  );
  if (open) return;

  await tx.execute(
    `INSERT INTO stock_alerts
       (product_variant_id, material_id, alert_type, message, stock_level)
     VALUES (?, ?, ?, ?, ?)`,
    [a.variantId ?? null, a.materialId ?? null, a.type, a.message, a.level],
  );
}

/** Versi bahan baku dari recordMovement. */
export async function recordMaterialMovement(
  tx: Tx,
  input: {
    materialId: number;
    quantity: number;
    type: "in" | "usage" | "damage" | "count_adjustment" | "correction";
    referenceType: "material_purchase" | "production" | "stock_count" | "manual";
    referenceId?: number | null;
    notes?: string | null;
    date?: string;
    userId?: number | null;
  },
): Promise<{ movementId: number; balanceAfter: number }> {
  if (input.quantity === 0) throw new Error("Jumlah mutasi bahan tidak boleh nol");

  const material = await tx.queryOne<{
    id: number;
    stock_on_hand: string;
    reorder_point: string;
    name: string;
    unit: string;
  }>(
    `SELECT id, stock_on_hand, reorder_point, name, unit
       FROM materials WHERE id = ? FOR UPDATE`,
    [input.materialId],
  );
  if (!material) throw new Error(`Bahan id ${input.materialId} tidak ditemukan`);

  const before = Number(material.stock_on_hand);
  const after = Number((before + input.quantity).toFixed(2));

  const ins = await tx.execute(
    `INSERT INTO material_movements
       (material_id, movement_type, quantity, balance_after,
        reference_type, reference_id, notes, movement_date, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.materialId,
      input.type,
      input.quantity,
      after,
      input.referenceType,
      input.referenceId ?? null,
      input.notes ?? null,
      input.date ?? today(),
      input.userId ?? null,
    ],
  );

  await tx.execute(`UPDATE materials SET stock_on_hand = ? WHERE id = ?`, [
    after,
    input.materialId,
  ]);

  if (after <= Number(material.reorder_point) && input.quantity < 0) {
    await raiseAlert(tx, {
      materialId: input.materialId,
      type: after <= 0 ? "out_of_stock" : "low_stock",
      message: `${material.name} tersisa ${after} ${material.unit}.`,
      level: after,
    });
  }

  return { movementId: ins.insertId, balanceAfter: after };
}
