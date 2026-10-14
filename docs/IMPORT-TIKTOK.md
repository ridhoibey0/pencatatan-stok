# Spesifikasi Import Laporan Penjualan TikTok Shop

Disusun dari pembacaan file contoh export TikTok Shop
(48 baris data, 43 pesanan, periode 27–30 Agustus 2026).

> Nomor pesanan, SKU ID, dan nama akun pada contoh di bawah sudah disamarkan.
> Polanya tetap sama persis dengan file aslinya, jadi tetap bisa dipakai acuan.

---

## 1. Bentuk File

| | |
|---|---|
| Nama sheet | `OrderSKUList` (satu sheet saja) |
| Jumlah kolom | 65 |
| Baris 1 | Judul kolom |
| **Baris 2** | **Teks penjelasan, bukan data — WAJIB dilewati** |
| Baris 3 dst | Data |
| Granularitas | **Satu baris = satu SKU dalam satu pesanan** (bukan satu pesanan) |

Satu pesanan bisa memakan beberapa baris. Di file contoh ada 4 pesanan seperti itu,
yang terbanyak 3 baris. Jadi importer harus mengelompokkan dulu per `Order ID`,
baru membuat satu baris `orders` + beberapa `order_items`.

**Semua sel bertipe teks**, termasuk angka dan tanggal.

---

## 2. Temuan Penting (yang mengubah rancangan)

### 2.1 `Seller SKU` itu kode PRODUK, bukan kode varian

Ini temuan paling berpengaruh. Isi kolom `Seller SKU` berulang untuk ukuran berbeda:

| Seller SKU | Variation yang muncul |
|---|---|
| `T014` | S, M, L, XL |
| `T005` | S, M, L, XL |
| `T017` | Hitam S, Hitam M, Putih L |
| `P006` | Kancing, S |
| `PB001` | Default |

Jadi `Seller SKU` memetakan ke `products.code`, bukan ke `product_variants.sku`.

### 2.2 Kolom `SKU ID` adalah kunci varian yang benar

Kolom `SKU ID` (angka 19 digit milik TikTok) terbukti **1:1 dengan kombinasi
Seller SKU + Variation** — 23 `SKU ID` unik untuk 23 kombinasi, tanpa satu pun
yang bercabang. Contoh:

```
1700000000000000001  ->  T014 / S
1700000000000000002  ->  T014 / M
1700000000000000003  ->  T014 / L
1700000000000000004  ->  T014 / XL
```

Inilah yang dipakai sebagai kunci pencocokan, lewat tabel `channel_sku_mappings`.

**Jangan mencocokkan dengan mengurai teks `Variation`.** Formatnya tidak konsisten:
`"M"` (ukuran saja), `"Hitam, M"` (warna + ukuran), `"Kancing, S"` (atribut lain +
ukuran), `"Default"` (tanpa varian). Aturan parsing apa pun akan patah begitu ada
produk dengan pola baru.

### 2.3 Kode SKU di master data perlu dibersihkan dulu

Dua nilai bermasalah ditemukan di file contoh:

| Nilai | Masalah |
|---|---|
| `THE FLORENCE` | Nama produk dipakai sebagai kode, bukan kode |
| `TO18` | Hampir pasti salah ketik `T018` — huruf O, bukan angka nol |

Kalau tidak dibereskan sebelum import, `TO18` dan `T018` akan jadi dua produk
berbeda yang stoknya terpisah, dan selamanya tidak akan cocok.

### 2.4 Data pembeli disamarkan

`Buyer Username` = `b***di09`, `Phone #` = `(+62)8xx******xx`, alamat tertutup
bintang. Nilai tersamar **tidak bisa dipakai mengidentifikasi orang** — dua pembeli
berbeda bisa menghasilkan topeng yang sama.

Karena itu tabel `customers` dihapus, dan `buyer_username`, `recipient_name`,
`phone` disimpan langsung di `orders` sebagai catatan apa adanya. Kalau suatu saat
ada sumber data yang tidak tersamar, tabel pelanggan bisa dibuat lagi tanpa
mengubah yang lain.

### 2.5 Kolom `Order Channel` memisahkan penjualan live

| Nilai | Jumlah di file contoh |
|---|---|
| `Product cards` | 21 |
| `LIVE` | 16 |
| `Videos` | 11 |

Ditambah `Creator Handle` (mis. `hostutama`, `hosttamu1`, …) yang menunjukkan
host-nya. Artinya laporan "live tanggal sekian laku apa saja, dibawakan siapa"
bisa dibuat **tanpa perlu input manual apa pun** — cukup dari file ini. Disimpan di
`orders.order_source` dan `orders.creator_handle`.

### 2.6 Pembatalan tinggi, dan dua jenisnya berbeda total

14 dari 48 baris (29%) berstatus `Dibatalkan`, dan ternyata terbagi dua:

| Jenis | Jumlah | Ciri | Barang keluar gudang? |
|---|---|---|---|
| Batal oleh pembeli, sebelum dikirim | 5 | `Cancel By = User`, `Shipped Time` kosong | **Tidak** |
| Gagal kirim, dibatalkan sistem | 9 | `Cancel By = System`, alasan "Pengiriman paket gagal", **punya `Shipped Time`** | **Ya** |

Yang kedua ini penting: paketnya sudah berangkat (28–31 Agustus) lalu dibatalkan
1–2 minggu kemudian (3–17 September) karena tidak sampai ke pembeli. Barangnya
keluar gudang dan sedang dalam perjalanan pulang.

Keliru memperlakukan keduanya sama akan membuat stok salah di salah satu arah —
entah 9 pcs tidak pernah dikurangi padahal sudah keluar, atau 9 pcs dianggap
sudah kembali padahal masih di jalan.

---

## 3. Pemetaan Kolom

### 3.1 Ke tabel `orders` (ambil dari baris pertama tiap `Order ID`)

| Kolom Excel | Kolom database | Catatan |
|---|---|---|
| `Order ID` | `order_number` | **Simpan sebagai teks.** 18 digit, melebihi presisi angka |
| — | `sales_channel_id` | Diisi dari pilihan channel saat upload |
| `Order Status` | `status` + `platform_status` | Lihat 3.3 |
| `Order Channel` | `order_source` | `LIVE`→`live`, `Videos`→`video`, `Product cards`→`product_card`, kosong→`other` |
| `Creator Handle` | `creator_handle` | |
| `Created Time` | `ordered_at` | Format `dd/MM/yyyy HH:mm:ss` |
| `Paid Time` | `paid_at` | |
| `Shipped Time` | `shipped_at` | |
| `Delivered Time` | `completed_at` | |
| `Cancelled Time` | `cancelled_at` | |
| `Shipping Provider Name` | `courier` | |
| `Tracking ID` | `tracking_number` | |
| `Province` | `province` | |
| `Regency and City` | `city` | |
| `Buyer Username` | `buyer_username` | tersamar |
| `Recipient` | `recipient_name` | tersamar |
| `Phone #` | `phone` | tersamar |
| `Shipping Fee After Discount` | `shipping_cost` | |
| `Order Amount` | `grand_total` | **Nilainya diulang di tiap baris pesanan yang sama — ambil sekali, jangan dijumlahkan** |

### 3.2 Ke tabel `order_items` (satu baris Excel = satu baris tabel)

| Kolom Excel | Kolom database | Catatan |
|---|---|---|
| `SKU ID` | `channel_sku_id` | juga dipakai mencari `product_variant_id` lewat `channel_sku_mappings` |
| `Quantity` | `quantity` | |
| `Sku Quantity of return` | `returned_quantity` | |
| `SKU Unit Original Price` | `unit_price` | |
| `SKU Platform Discount` + `SKU Seller Discount` | `discount` | dijumlahkan |

Kolom lain (`Buyer Service Fee`, `Handling Fee`, `Shipping Insurance`, `Weight`,
`Zipcode`, `Districts`, `Villages`, `Detail Address`, dll.) tidak diimpor. Semuanya
urusan keuangan atau pengiriman, bukan pencatatan stok.

### 3.3 Pemetaan status

| `Order Status` | `orders.status` | Efek ke stok |
|---|---|---|
| `Selesai` | `completed` | keluar |
| `Dikirim` | `shipped` | keluar |
| `Dibatalkan` | `cancelled` | lihat 4.3 |

Nilai lain yang belum pernah muncul (`Belum dibayar`, `Perlu dikirim`, dsb.)
**jangan ditebak** — hentikan baris itu, catat di `import_batches.error_log`,
dan minta operator memutuskan. Lebih baik satu baris gagal daripada stok salah.

---

## 4. Alur Importer

### 4.1 Langkah

```
1. Hitung sha256 file. Sudah pernah diimpor -> tanya operator mau lanjut atau tidak.
2. Buat import_batches (status 'pending').
3. Baca sheet OrderSKUList, lewati baris 1-2.
4. Validasi dulu SELURUH file sebelum menulis apa pun:
     - setiap SKU ID punya pasangan di channel_sku_mappings
     - setiap Order Status dikenali
     - setiap tanggal bisa diurai
   Ada yang gagal -> batalkan seluruh import, tampilkan daftar barisnya.
5. Kelompokkan baris per Order ID.
6. Untuk tiap pesanan, jalankan satu transaksi (lihat 4.2).
7. Tutup import_batches: jumlah dibuat / diperbarui / dilewati.
```

Langkah 4 penting: file yang separuh masuk jauh lebih sulit dibereskan daripada
file yang ditolak utuh. Khususnya SKU ID yang belum dipetakan — itu kejadian
normal setiap ada produk baru, dan operator harus memetakannya dulu.

### 4.2 Pesanan baru

```
BEGIN;
  INSERT orders (...);
  untuk tiap baris:
    INSERT order_items (...);
    bila status 'completed' atau 'shipped':
      SELECT stock_on_hand FROM product_variants WHERE id = ? FOR UPDATE;
      INSERT stock_movements (movement_type='out', quantity=-n,
                              reference_type='order', reference_id=order_id,
                              movement_date = tanggal Created Time);
      UPDATE product_variants SET stock_on_hand = stock_on_hand - n;
      bila hasilnya <= reorder_point -> INSERT stock_alerts
      bila hasilnya < 0              -> INSERT stock_alerts (alert_type='variance')
COMMIT;
```

### 4.3 Pembatalan — perhatikan bedanya

Yang menentukan bukan status akhirnya, tapi **ada tidaknya `Shipped Time`**:

| Keadaan | Barang keluar gudang? | Tindakan |
|---|---|---|
| Dibatalkan, `Shipped Time` kosong | Tidak | Catat pesanan sebagai `cancelled`, **jangan sentuh stok sama sekali** |
| Dibatalkan, **punya `Shipped Time`** | Ya | Stok tetap **dikurangi** (barang memang keluar), lalu pesanan masuk daftar tunggu retur |

Aturannya: stok berkurang kalau pesanan **pernah dikirim**, apa pun status akhirnya.

**Pembatalan tidak otomatis mengembalikan stok.** Paket retur butuh berhari-hari
sampai kembali — di file contoh jedanya 3 sampai 17 hari — dan kadang tidak
kembali utuh. Menambahkannya saat pembatalan muncul akan membuat host
mempromosikan barang yang belum ada di rak, yaitu persis masalah yang mau
diselesaikan sistem ini.

Pengembalian stok dicatat lewat halaman **Konfirmasi Retur** saat paketnya
benar-benar diterima gudang, dengan pilihan kondisi layak jual atau rusak.

### 4.4 Pesanan yang sudah pernah diimpor

Satu pesanan akan muncul lagi di export berikutnya dengan status yang berubah
(`Dikirim` → `Selesai`, atau → `Dibatalkan`). Cocokkan lewat
`UNIQUE (sales_channel_id, order_number)`, lalu:

| Perubahan status | Tindakan stok |
|---|---|
| `shipped` → `completed` | tidak ada — stok sudah dikurangi saat pertama diimpor |
| `completed`/`shipped` → `cancelled` | stok **masuk kembali** (barang batal di tengah jalan atau diretur) |
| status sama | lewati, hitung sebagai `skipped` |

**Aturan mutlak: satu pesanan hanya boleh mengurangi stok satu kali.** Sebelum
menulis mutasi keluar, periksa dulu apakah sudah ada baris `stock_movements`
dengan `reference_type='order'` dan `reference_id` yang sama. Tanpa ini, satu
kali salah upload akan menghapus stok dua kali lipat tanpa jejak yang jelas.

---

## 5. Jebakan Teknis

| Hal | Risiko | Penanganan |
|---|---|---|
| `Order ID` 18 digit | Dibaca sebagai angka pecahan → `5.85808E+17`, dua pesanan berbeda jadi sama | Baca dan simpan sebagai **string**. Jangan buka-lalu-simpan filenya di Excel sebelum diimpor |
| Tanggal `30/08/2026 22:35:01` | Terbaca sebagai bulan 30 (gagal) atau tertukar hari/bulan | Urai dengan format eksplisit `dd/MM/yyyy HH:mm:ss` |
| Baris 2 berisi penjelasan | Masuk sebagai pesanan palsu | Lewati indeks baris ke-2 |
| `Order Amount` diulang per baris | Omzet terhitung berlipat | Ambil dari baris pertama tiap `Order ID` |
| Nama produk mengandung `�` | Karakter rusak sejak dari export TikTok | Baca sebagai UTF-8; nama produk hanya rujukan, nama resmi tetap dari master data |
| Angka berupa teks (`'299000'`) | Penjumlahan jadi penggabungan teks | Konversi eksplisit ke angka |
| `SKU ID` belum dipetakan | Stok salah SKU | Tolak seluruh file, tampilkan daftar yang perlu dipetakan |

---

## 6. Yang Perlu Dikonfirmasi

1. **Apakah export ini selalu berisi semua pesanan**, atau hanya rentang tanggal yang dipilih? Berpengaruh ke cara mendeteksi pesanan yang hilang.
2. **Status apa saja yang mungkin muncul?** Di file contoh baru ada tiga. Kalau ada daftar lengkapnya dari TikTok Seller Center, pemetaan status bisa dibuat utuh sekarang.
3. **Apakah ada export dari marketplace lain** (Shopee/Tokopedia)? Formatnya berbeda dan butuh parser sendiri — tapi tabel `channel_sku_mappings` sudah menyiapkan tempatnya.
4. **Barang keluar selain penjualan** (endorse, giveaway, dipakai sendiri) dicatat dari mana? Tidak ada di export, jadi perlu form manual.
