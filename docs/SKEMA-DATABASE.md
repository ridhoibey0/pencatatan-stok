# Evaluasi & Pengembangan Skema Database

Dokumen pendamping [`database/schema.sql`](../database/schema.sql). Isinya: konvensi penamaan, apa yang sudah benar dari rancangan awal, apa yang kurang, dan alur transaksi yang harus diikuti saat coding.

---

## 1. Konvensi Penamaan

Mengikuti konvensi yang umum dipakai di Laravel, Rails, dan mayoritas tim backend:

| Aturan | Benar | Hindari |
|---|---|---|
| Nama tabel: bahasa Inggris, snake_case, **jamak** | `products`, `order_items` | `produk`, `Product`, `tbl_produk` |
| Primary key selalu bernama **`id`** | `products.id` | `id_produk`, `product_id` di tabelnya sendiri |
| Foreign key: `<tabel_tunggal>_id` | `product_id`, `user_id` | `id_produk`, `fk_produk` |
| Tabel detail: `<induk_tunggal>_items` | `order_items`, `goods_receipt_items` | `detail_pesanan` |
| Boolean: awalan `is_` | `is_active` | `aktif`, `status_aktif` |
| Waktu: akhiran `_at` (datetime) / `_date` (date) | `created_at`, `ordered_at`, `due_date` | `tanggal`, `waktu_buat` |
| Pivot many-to-many: dua nama tunggal urut abjad | `product_tag` | `tag_produk` |
| Uang: `DECIMAL`, **jangan** `FLOAT` | `DECIMAL(12,2)` | `FLOAT`, `DOUBLE` |
| Nilai ENUM: lowercase snake_case | `'in_progress'` | `'Diproses'`, `'IN PROGRESS'` |
| Nama index/constraint: `<tabel>_<kolom>_<jenis>` | `orders_status_index` | `idx1`, `fk_1` |

Dua hal yang paling sering salah dan sudah diperbaiki di skema ini:

- **`id_produk` sebagai PK.** Prefix `id_` membuat nama kolom jadi berbeda antara tabel asal dan tabel yang mereferensi, sehingga ORM tidak bisa menebak relasi otomatis dan harus dikonfigurasi manual satu per satu. Dengan `products.id` + `order_items.product_id`, relasi terdeteksi sendiri.
- **Campur bahasa** (`nama_produk`, `jumlah`, `stok` bercampur `status`, `platform`). Pilih satu bahasa dan konsisten. Standar industri memakai Inggris karena seluruh framework, library, dan dokumentasi memakai Inggris — penamaan Indonesia membuat kode jadi `$pesanan->customer_id` yang canggung.

### Peta nama lama → baru

| Rancangan awal | Sekarang |
|---|---|
| `pembeli` | `customers` |
| `pesanan` | `orders` |
| `detail_pesanan` | `order_items` |
| `produk` | `products` |
| `varian` | `product_variants` |
| `kategori` | `categories` |
| `pembatalan` | `order_cancellations` |
| `produksi` | `production_orders` + `production_order_items` |
| `supplier` | `suppliers` |
| `bahan_baku` | `materials` |
| `pembelian_bahan` | `material_purchases` + `material_purchase_items` |
| `pemakaian_bahan` | `material_usages` |
| (konveksi, dulu kolom teks) | `manufacturers` |
| (platform, dulu ENUM) | `sales_channels` |
| **(tidak ada)** | `users`, `stock_movements`, `material_movements`, `goods_receipts`, `stock_counts`, `sales_returns`, `stock_alerts`, `activity_logs` |

Istilah yang dipakai juga mengikuti istilah baku inventory, supaya mudah dicari referensinya:
`stock_on_hand` (stok fisik), `reorder_point` (stok minimum), `goods_receipt` (penerimaan barang), `stock_count` (opname), `variance` (selisih).

---

## 2. Penilaian Rancangan Awal

**Yang sudah tepat dan dipertahankan:**

- Pemisahan produk → varian. Ini keputusan paling benar di rancangan awal: stok melekat pada SKU (ukuran + warna), bukan nama produk.
- Pola header–detail pada pesanan.
- Menyimpan harga dan diskon di baris detail. Ini snapshot harga saat transaksi, sehingga laporan lama tidak ikut berubah ketika harga produk diubah.
- `bahan_baku` sudah punya stok minimum — konsep ambang batas sudah terpikirkan.
- Pembatalan dipisah jadi tabel sendiri, bukan sekadar kolom status.

Kerangkanya sudah betul. Masalahnya ada pada satu hal yang justru jadi inti sistem ini.

---

## 3. Masalah Utama: Tidak Ada Jejak Perubahan Stok

Di rancangan awal, stok hanya satu kolom yang di-UPDATE setiap ada transaksi. Konsekuensinya:

| Pertanyaan | Bisa dijawab? |
|---|---|
| Kenapa stok SKU-001 tinggal 3? | **Tidak** |
| Siapa yang terakhir mengubahnya? | **Tidak** |
| Berapa stok tanggal 1 Oktober lalu? | **Tidak** |
| Masuk berapa dan keluar berapa bulan ini? | **Tidak** |
| Kalau angkanya salah, salah di langkah mana? | **Tidak** |

Nilai lama tertimpa dan hilang. Secara perilaku ini **persis papan tulis** — hanya pindah ke layar. Padahal alasan mengganti papan tulis justru karena riwayatnya hilang.

**Solusi: tabel `stock_movements` (ledger).** Yang dicatat bukan angka stok, tapi kejadiannya:

```
id | variant | type | quantity | balance_after | reference        | date       | by
 1 | SKU-001 | in   |     +20  |      20       | goods_receipt #3 | 2026-10-01 | warehouse
 2 | SKU-001 | out  |      -2  |      18       | order #112       | 2026-10-02 | warehouse
 3 | SKU-001 | out  |      -1  |      17       | order #118       | 2026-10-02 | warehouse
 4 | SKU-001 | count_adjustment | -1 | 16       | stock_count #1   | 2026-10-05 | warehouse
```

Kelima pertanyaan di atas jadi terjawab, dan `product_variants.stock_on_hand` cukup jadi **cache** supaya halaman stok cepat dibuka.

Aturannya: **tidak ada kode yang boleh meng-UPDATE `stock_on_hand` tanpa menulis baris `stock_movements` di transaksi yang sama.** Kalau aturan ini dilanggar sekali saja, data tidak bisa dipercaya lagi. View `v_stock_balance_check` dipakai untuk mendeteksinya — idealnya selalu mengembalikan 0 baris.

---

## 4. Kekurangan Lain & Perbaikannya

| # | Masalah di rancangan awal | Perbaikan |
|---|---|---|
| 1 | **Tidak ada tabel pengguna sama sekali** — tidak ada login, tidak ada jejak siapa mencatat apa | `users` + kolom `recorded_by`/`created_by` di semua tabel transaksi + `activity_logs` |
| 2 | Produksi hanya bisa untuk **satu varian** (`id_varian` di header) | `production_orders` (header) + `production_order_items` (banyak varian) |
| 3 | Produksi punya `id_varian` **dan** `id_detail` sekaligus — dua tingkat tercampur di satu tabel | `order_item_id` dipindah ke baris detail, tetap nullable untuk make-to-order |
| 4 | **Barang jadi masuk gudang lewat mana?** Tidak ada tabelnya — hanya tersirat dari status produksi | `goods_receipts` + `goods_receipt_items`. Konveksi sering kirim bertahap, jadi satu production order bisa punya beberapa penerimaan |
| 5 | Tidak memisahkan **jumlah dipesan vs jadi vs reject** | `quantity_ordered`, `quantity_produced`, `quantity_rejected` |
| 6 | Pembelian bahan = 1 baris per bahan, padahal **satu nota berisi banyak bahan** | `material_purchases` + `material_purchase_items` |
| 7 | Konveksi hanya kolom teks `varchar(100)` — rawan salah ketik, tidak bisa direkap | Tabel `manufacturers` |
| 8 | Platform sebagai ENUM — nambah marketplace harus `ALTER TABLE` | Tabel `sales_channels` |
| 9 | **Tidak ada stok opname** padahal ini kebutuhan nyata | `stock_counts` + `stock_count_items`, mendukung produk maupun bahan |
| 10 | **Tidak ada retur** — barang balik tapi stok tidak pernah bertambah | `sales_returns` + `sales_return_items` dengan `item_condition` |
| 11 | Varian **tidak punya stok minimum** (padahal bahan baku punya) — peringatan stok menipis mustahil dibuat | `reorder_point` + tabel `stock_alerts` |
| 12 | `id_pesanan varchar(25)` sebagai PK **tanpa jaminan unik antar platform** — nomor Shopee & TikTok bisa bentrok | PK surrogate `BIGINT` + `UNIQUE (sales_channel_id, order_number)`. Juga lebih hemat: FK tidak lagi menyalin string 25 karakter ke tabel detail |
| 13 | — | *(Kolom `stock_reserved` sempat ditambahkan lalu dihapus. Lihat bagian 8: pencatatan di sini berbasis rekap, bukan real-time, jadi kondisi "sudah dipesan tapi belum dikirim" tidak pernah ada di dalam sistem.)* |
| 14 | Mayoritas tabel **tanpa `created_at`/`updated_at`** | Ditambahkan di semua tabel |
| 15 | Tidak ada UNIQUE pada SKU, kode produk, kombinasi produk+ukuran+warna | Ditambahkan, supaya SKU ganda tidak bisa masuk |
| 16 | Tidak ada index selain PK — pencarian & laporan akan lambat | Index pada kolom filter: status, tanggal, barcode, reference |
| 17 | Tidak ada soft delete — produk lama tak bisa disembunyikan tanpa merusak riwayat | `deleted_at` + `is_active`, FK pakai `ON DELETE RESTRICT` |
| 18 | Harga hanya di level produk, padahal **harga sering beda per ukuran** | `product_variants.price` nullable sebagai penimpa; NULL = ikut `base_price` |

---

## 5. Daftar Tabel (28)

| Kelompok | Tabel |
|---|---|
| Users & master | `users`, `categories`, `products`, `product_variants`, `sales_channels`, `channel_sku_mappings`, `import_batches`, `manufacturers`, `suppliers`, `materials` |
| Sales | `orders`, `order_items`, `order_cancellations`, `sales_returns`, `sales_return_items` |
| *(dihapus)* | ~~`customers`~~ — data pembeli di export tersamar, disimpan langsung di `orders`. Lihat [IMPORT-TIKTOK.md](IMPORT-TIKTOK.md#24-data-pembeli-disamarkan) |
| Production | `production_orders`, `production_order_items`, `goods_receipts`, `goods_receipt_items` |
| Materials | `material_purchases`, `material_purchase_items`, `material_usages` |
| **Ledger (inti)** | **`stock_movements`**, **`material_movements`** |
| Stock count | `stock_counts`, `stock_count_items` |
| Alerts & audit | `stock_alerts`, `activity_logs` |

---

## 6. Alur Transaksi (wajib diikuti saat coding)

Semua langkah di bawah dijalankan **dalam satu transaksi database**. Kalau satu gagal, semuanya dibatalkan.

### 6.1 Barang jadi datang dari konveksi

```
BEGIN;
  INSERT goods_receipts, goods_receipt_items
  untuk tiap baris:
    SELECT stock_on_hand FROM product_variants WHERE id = ? FOR UPDATE;
    INSERT stock_movements (movement_type='in', quantity=+n,
                            reference_type='goods_receipt', reference_id=?)
    UPDATE product_variants SET stock_on_hand = stock_on_hand + n;
    UPDATE production_order_items SET quantity_produced = quantity_produced + n;
COMMIT;
```

### 6.2 Rekap penjualan setelah live

Pencatatan penjualan dilakukan **setelah sesi live selesai**, sekaligus untuk semua
pesanan yang masuk. Di sinilah stok berkurang — tidak ada tahap reservasi.

```
BEGIN;
  INSERT orders, order_items
  untuk tiap baris:
    SELECT stock_on_hand FROM product_variants WHERE id = ? FOR UPDATE;
    INSERT stock_movements (movement_type='out', quantity=-n,
                            reference_type='order', reference_id=order_id)
    UPDATE product_variants SET stock_on_hand = stock_on_hand - n;
    bila stock_on_hand baru <= reorder_point -> INSERT stock_alerts
COMMIT;
```

**Bila stok tidak cukup, jangan tolak input.** Berbeda dengan sistem real-time,
di sini barangnya sudah benar-benar terjual — penjualannya fakta, yang salah
justru catatan stoknya. Tetap simpan, lalu terbitkan
`stock_alerts (alert_type='variance')` supaya selisihnya diinvestigasi.
Kalau input ditolak, petugas akan mengarang angka agar bisa lanjut, dan itu
merusak data lebih parah daripada selisih yang tercatat jujur.

### 6.3 Pesanan dikirim

```
BEGIN;
  UPDATE orders SET status='shipped', tracking_number=?, shipped_at=NOW();
COMMIT;
```

Tidak ada perubahan stok di sini — stok sudah dikurangi saat rekap (6.2).

### 6.4 Pesanan dibatalkan

Karena stok sudah dikurangi saat rekap, pembatalan harus **mengembalikan** stok:

```
BEGIN;
  UPDATE orders SET status='cancelled';
  INSERT order_cancellations (...);
  untuk tiap baris:
    SELECT ... FOR UPDATE;
    INSERT stock_movements (movement_type='return', quantity=+n,
                            reference_type='order_cancellation', reference_id=?)
    UPDATE product_variants SET stock_on_hand = stock_on_hand + n;
COMMIT;
```

Ini perbedaan penting dari rancangan dengan reservasi: di sana pembatalan cuma
melepas angka pesanan, di sini pembatalan benar-benar menambah stok kembali.
Kalau langkah ini terlewat, stok sistem akan terus lebih kecil dari fisik.

### 6.5 Stok opname

```
BEGIN;
  UPDATE stock_counts SET status='approved', approved_by=?, approved_at=NOW();
  untuk tiap item yang variance <> 0:
    INSERT stock_movements (movement_type='count_adjustment', quantity=variance,
                            reference_type='stock_count', reference_id=?)
    UPDATE product_variants SET stock_on_hand = counted_quantity;
COMMIT;
```

### 6.6 Koreksi salah input

Jangan DELETE. Buat movement lawan:

```
INSERT stock_movements (movement_type='correction',
                        quantity = -quantity_asal,
                        reverses_id = id_movement_yang_salah,
                        notes = 'Koreksi salah input');
UPDATE product_variants SET stock_on_hand = stock_on_hand - quantity_asal;
```

Riwayat tetap utuh dan terlihat bahwa pernah ada koreksi.

---

## 7. Catatan Teknis

- **`FOR UPDATE` tetap dipakai**, walau risikonya kecil pada pola rekap. Kalau dua orang memproses rekap atau opname untuk SKU yang sama secara bersamaan, tanpa penguncian baris keduanya bisa membaca saldo yang sama lalu saling menimpa — satu pengurangan hilang tanpa jejak. Biayanya nyaris nol, jadi tidak ada alasan melewatkannya.
- **Jangan pakai TRIGGER** untuk mengubah stok. Trigger membuat perubahan jadi tak terlihat saat membaca kode, susah di-debug, dan tidak bisa mengisi `recorded_by` karena database tidak tahu siapa user yang login. Letakkan di satu service layer aplikasi.
- **CHECK constraint** berjalan di MySQL 8.0.16+ dan MariaDB 10.2+. Di versi lebih lama constraint diabaikan diam-diam, jadi validasi harus tetap ada di aplikasi.
- **`balance_after`** sengaja disimpan meski bisa dihitung. Tujuannya agar kartu stok bisa ditampilkan tanpa running total, dan agar kerusakan data lebih mudah dilacak.
- **Tidak ada kolom stok "siap jual" terpisah.** `stock_on_hand` adalah satu-satunya angka stok barang jadi. Lihat bagian 8 untuk konsekuensinya.
- **`activity_logs` memakai pola polymorphic** (`auditable_type` + `auditable_id`), sama seperti paket audit log di Laravel, sehingga satu tabel bisa mencatat perubahan tabel mana pun.
- **Backup harian wajib.** Dengan model ledger, data bisa direkonstruksi — tapi hanya kalau filenya masih ada.

---

## 8. Konsekuensi Pola Rekap (bukan real-time)

Penjualan dicatat **setelah sesi live selesai**, bukan saat pesanan masuk. Ini keputusan
sadar yang menyesuaikan cara kerja yang sudah berjalan, dan punya konsekuensi yang
perlu diketahui sejak awal — bukan bug, tapi batas kemampuan sistem.

**Yang bisa dilakukan sistem:**

- Angka stok akurat **sebelum live dimulai** — host tahu persis apa yang layak dipromosikan
- Riwayat lengkap: kapan masuk, kapan keluar, siapa yang mencatat
- Peringatan stok menipis setelah tiap rekap
- Opname yang bermakna, karena stok sistem = stok fisik

**Yang tidak bisa:**

- **Mencegah oversell saat live sedang berlangsung.** Kalau stok 10 dan dalam satu sesi
  laku 14, sistem baru tahu saat rekap dimasukkan. Mencegah ini butuh pencatatan real-time
  per pesanan, yang berarti mengubah cara kerja tim, bukan sekadar menambah fitur.
- Menampilkan sisa stok akurat **di tengah** sesi live.

**Mitigasi tanpa mengubah cara kerja:**

1. Tampilkan **tanggal & jam rekap terakhir** di halaman stok, supaya host sadar angkanya
   per kapan. Angka tanpa keterangan waktu lebih berbahaya daripada angka yang jelas-jelas
   bertanda "data per tadi pagi".
2. Sediakan tombol rekap cepat per SKU, supaya kalau ada yang sempat, stok bisa
   diperbarui di sela-sela live tanpa harus menunggu selesai.
3. Pakai `reorder_point` yang agak longgar untuk SKU yang sering diborong saat live,
   supaya peringatan muncul sebelum benar-benar mepet.

Kalau suatu saat tim siap mencatat per pesanan secara real-time, kolom `stock_reserved`
tinggal ditambahkan kembali — struktur ledger-nya tidak perlu diubah sama sekali.

---

## 9. Yang Sengaja Belum Dimasukkan

Semuanya bisa ditambah nanti tanpa membongkar struktur:

- **Multi gudang/lokasi** — butuh tabel `warehouses` + `warehouse_id` di ledger dan saldo per lokasi
- **HPP & nilai persediaan** (FIFO/average) — butuh kolom harga pokok di tiap movement masuk
- **Sinkronisasi otomatis ke marketplace** — butuh tabel pemetaan SKU per channel
- **Bill of material** — pemakaian bahan sekarang masih diinput manual, belum dihitung dari resep
- **Utang supplier & konveksi** — ranah keuangan, bukan pencatatan stok
