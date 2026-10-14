import ExcelJS from "exceljs";

/**
 * Pembaca file "Semua pesanan-*.xlsx" dari TikTok Shop.
 * Bentuk filenya didokumentasikan di docs/IMPORT-TIKTOK.md.
 */

export const SHEET_NAME = "OrderSKUList";

/** Satu baris Excel = satu SKU dalam satu pesanan. */
export interface RawRow {
  excelRow: number;
  orderId: string;
  orderStatus: string;
  orderSubstatus: string;
  cancelReturnType: string;
  skuId: string;
  sellerSku: string;
  productName: string;
  variation: string;
  quantity: number;
  returnQuantity: number;
  unitPrice: number;
  platformDiscount: number;
  sellerDiscount: number;
  shippingFee: number;
  orderAmount: number;
  createdTime: Date | null;
  paidTime: Date | null;
  shippedTime: Date | null;
  deliveredTime: Date | null;
  cancelledTime: Date | null;
  cancelBy: string;
  cancelReason: string;
  trackingId: string;
  shippingProvider: string;
  province: string;
  city: string;
  buyerUsername: string;
  recipient: string;
  phone: string;
  orderChannel: string;
  creatorHandle: string;
}

export interface ParsedOrder {
  orderNumber: string;
  status: "pending" | "processing" | "shipped" | "completed" | "cancelled";
  platformStatus: string;
  orderSource: "live" | "video" | "product_card" | "other";
  creatorHandle: string | null;
  orderedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** true kalau barang tidak pernah keluar gudang (batal sebelum dikirim). */
  neverShipped: boolean;
  courier: string | null;
  trackingNumber: string | null;
  province: string | null;
  city: string | null;
  buyerUsername: string | null;
  recipientName: string | null;
  phone: string | null;
  shippingCost: number;
  discountTotal: number;
  grandTotal: number;
  cancelledBy: "customer" | "seller" | "system" | null;
  cancelReason: string | null;
  items: {
    skuId: string;
    sellerSku: string;
    variation: string;
    productName: string;
    quantity: number;
    returnedQuantity: number;
    unitPrice: number;
    discount: number;
  }[];
}

export interface ParseResult {
  orders: ParsedOrder[];
  rowCount: number;
  /** Baris yang tidak bisa diproses. File ditolak utuh kalau ini terisi. */
  problems: { excelRow: number; orderId: string; reason: string }[];
  /** SKU ID unik yang ditemukan di file, untuk dicek pemetaannya. */
  skuIds: { skuId: string; sellerSku: string; variation: string; productName: string }[];
}

const STATUS_MAP: Record<string, ParsedOrder["status"]> = {
  selesai: "completed",
  completed: "completed",
  dikirim: "shipped",
  shipped: "shipped",
  "sedang dikirim": "shipped",
  dibatalkan: "cancelled",
  cancelled: "cancelled",
  canceled: "cancelled",
  "perlu dikirim": "processing",
  "to ship": "processing",
  "belum dibayar": "pending",
  unpaid: "pending",
};

const SOURCE_MAP: Record<string, ParsedOrder["orderSource"]> = {
  live: "live",
  videos: "video",
  video: "video",
  "product cards": "product_card",
  "product card": "product_card",
};

const CANCEL_BY_MAP: Record<string, "customer" | "seller" | "system"> = {
  user: "customer",
  buyer: "customer",
  customer: "customer",
  seller: "seller",
  system: "system",
  platform: "system",
};

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (typeof o.text === "string") return o.text;
    if (o.result !== undefined) return String(o.result);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

function num(v: ExcelJS.CellValue): number {
  const s = text(v).replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tanggal di file ini berformat dd/MM/yyyy HH:mm:ss. Diurai manual karena
 * new Date("30/08/2026") tidak valid dan Date.parse akan menukar hari/bulan
 * pada tanggal yang ambigu seperti 05/09/2026.
 */
export function parseTikTokDate(raw: ExcelJS.CellValue): Date | null {
  if (raw instanceof Date) return raw;
  const s = text(raw);
  if (!s) return null;
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return null;
  const [, dd, MM, yyyy, hh = "0", mi = "0", ss = "0"] = m;
  const d = new Date(
    Number(yyyy),
    Number(MM) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function parseTikTokExport(buffer: Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const ws = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) throw new Error("File tidak punya sheet yang bisa dibaca");

  // Baris 1 = judul kolom, baris 2 = teks penjelasan (bukan data).
  const header = ws.getRow(1);
  const col: Record<string, number> = {};
  header.eachCell((cell, n) => {
    const key = text(cell.value).trim();
    if (key) col[key] = n;
  });

  const wajib = ["Order ID", "Order Status", "SKU ID", "Quantity", "Created Time"];
  const hilang = wajib.filter((k) => !col[k]);
  if (hilang.length) {
    throw new Error(
      `Kolom wajib tidak ditemukan: ${hilang.join(", ")}. ` +
        `Pastikan ini file "Semua pesanan" dari TikTok Shop, bukan laporan lain.`,
    );
  }

  const get = (row: ExcelJS.Row, key: string): ExcelJS.CellValue =>
    col[key] ? row.getCell(col[key]).value : null;

  const problems: ParseResult["problems"] = [];
  const raws: RawRow[] = [];

  for (let i = 3; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const orderId = text(get(row, "Order ID"));
    if (!orderId) continue; // baris kosong di akhir file

    const statusRaw = text(get(row, "Order Status"));
    const status = STATUS_MAP[statusRaw.toLowerCase()];
    if (!status) {
      // Status asing tidak ditebak -- lebih baik satu baris gagal daripada stok salah.
      problems.push({
        excelRow: i,
        orderId,
        reason: `Status "${statusRaw}" belum dikenal sistem`,
      });
      continue;
    }

    const createdTime = parseTikTokDate(get(row, "Created Time"));
    if (!createdTime) {
      problems.push({
        excelRow: i,
        orderId,
        reason: `Created Time "${text(get(row, "Created Time"))}" tidak bisa dibaca`,
      });
      continue;
    }

    const skuId = text(get(row, "SKU ID"));
    if (!skuId) {
      problems.push({ excelRow: i, orderId, reason: "SKU ID kosong" });
      continue;
    }

    raws.push({
      excelRow: i,
      orderId,
      orderStatus: statusRaw,
      orderSubstatus: text(get(row, "Order Substatus")),
      cancelReturnType: text(get(row, "Cancelation/Return Type")),
      skuId,
      sellerSku: text(get(row, "Seller SKU")),
      productName: text(get(row, "Product Name")),
      variation: text(get(row, "Variation")),
      quantity: num(get(row, "Quantity")),
      returnQuantity: num(get(row, "Sku Quantity of return")),
      unitPrice: num(get(row, "SKU Unit Original Price")),
      platformDiscount: num(get(row, "SKU Platform Discount")),
      sellerDiscount: num(get(row, "SKU Seller Discount")),
      shippingFee: num(get(row, "Shipping Fee After Discount")),
      orderAmount: num(get(row, "Order Amount")),
      createdTime,
      paidTime: parseTikTokDate(get(row, "Paid Time")),
      shippedTime: parseTikTokDate(get(row, "Shipped Time")),
      deliveredTime: parseTikTokDate(get(row, "Delivered Time")),
      cancelledTime: parseTikTokDate(get(row, "Cancelled Time")),
      cancelBy: text(get(row, "Cancel By")),
      cancelReason: text(get(row, "Cancel Reason")),
      trackingId: text(get(row, "Tracking ID")),
      shippingProvider: text(get(row, "Shipping Provider Name")),
      province: text(get(row, "Province")),
      city: text(get(row, "Regency and City")),
      buyerUsername: text(get(row, "Buyer Username")),
      recipient: text(get(row, "Recipient")),
      phone: text(get(row, "Phone #")),
      orderChannel: text(get(row, "Order Channel")),
      creatorHandle: text(get(row, "Creator Handle")),
    });
  }

  // Kelompokkan per Order ID. Nilai tingkat pesanan (Order Amount, ongkir)
  // diulang di tiap baris, jadi diambil sekali saja -- bukan dijumlahkan.
  const map = new Map<string, ParsedOrder>();
  for (const r of raws) {
    let o = map.get(r.orderId);
    if (!o) {
      const status = STATUS_MAP[r.orderStatus.toLowerCase()]!;
      o = {
        orderNumber: r.orderId,
        status,
        platformStatus: r.orderStatus,
        orderSource: SOURCE_MAP[r.orderChannel.toLowerCase()] ?? "other",
        creatorHandle: r.creatorHandle || null,
        orderedAt: r.createdTime!,
        paidAt: r.paidTime,
        shippedAt: r.shippedTime,
        completedAt: r.deliveredTime,
        cancelledAt: r.cancelledTime,
        neverShipped: status === "cancelled" && !r.shippedTime,
        courier: r.shippingProvider || null,
        trackingNumber: r.trackingId || null,
        province: r.province || null,
        city: r.city || null,
        buyerUsername: r.buyerUsername || null,
        recipientName: r.recipient || null,
        phone: r.phone || null,
        shippingCost: r.shippingFee,
        discountTotal: 0,
        grandTotal: r.orderAmount,
        cancelledBy: CANCEL_BY_MAP[r.cancelBy.toLowerCase()] ?? null,
        cancelReason: r.cancelReason || null,
        items: [],
      };
      map.set(r.orderId, o);
    }

    const diskon = r.platformDiscount + r.sellerDiscount;
    o.discountTotal += diskon;

    const sudahAda = o.items.find((it) => it.skuId === r.skuId);
    if (sudahAda) {
      // SKU yang sama muncul dua kali dalam satu pesanan: gabungkan.
      sudahAda.quantity += r.quantity;
      sudahAda.returnedQuantity += r.returnQuantity;
      sudahAda.discount += diskon;
    } else {
      o.items.push({
        skuId: r.skuId,
        sellerSku: r.sellerSku,
        variation: r.variation,
        productName: r.productName,
        quantity: r.quantity,
        returnedQuantity: r.returnQuantity,
        unitPrice: r.unitPrice,
        discount: diskon,
      });
    }
  }

  const skuMap = new Map<string, ParseResult["skuIds"][number]>();
  for (const r of raws) {
    if (!skuMap.has(r.skuId)) {
      skuMap.set(r.skuId, {
        skuId: r.skuId,
        sellerSku: r.sellerSku,
        variation: r.variation,
        productName: r.productName,
      });
    }
  }

  return {
    orders: [...map.values()],
    rowCount: raws.length + problems.length,
    problems,
    skuIds: [...skuMap.values()],
  };
}
