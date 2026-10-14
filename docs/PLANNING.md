# Rencana Pembangunan Web Pencatatan Stok

Ruang lingkup: **mengganti pencatatan stok di buku/papan tulis menjadi pencatatan digital.**
Alur pesanan tetap berjalan di marketplace seperti sekarang — sistem ini tidak mengurus pesanan, pembayaran, atau pengiriman. Sistem hanya mencatat **barang masuk, barang keluar, dan stok akhir**, lalu menampilkannya ke semua orang secara real-time.

---

## 1. Masalah yang Diselesaikan

Kondisi sekarang: stok ditulis di buku atau papan tulis.

| Masalah | Akibat |
|---|---|
| Papan tulis hanya bisa dilihat di tempat | Host live & owner tidak tahu stok saat butuh |
| Angka ditimpa/dihapus saat berubah | Riwayat hilang, selisih tidak bisa ditelusuri |
| Stok akhir dihitung manual di kepala | Salah hitung, angka beda antar orang |
| Tidak ada tanda stok menipis | Baru sadar saat barang habis |
| Tidak tahu siapa yang mengubah angka | Kalau ada selisih, tidak bisa ditelusuri |

**Tujuan:** satu angka stok yang sama untuk semua orang, berubah otomatis setiap ada pencatatan, dan tiap perubahan ada jejaknya.

---

## 2. Prinsip Dasar: Buku Besar, Bukan Papan Tulis

Ini keputusan desain paling penting, dan ini bedanya dengan papan tulis:

**Angka stok tidak pernah diketik ulang.** Yang diketik user adalah **kejadian** — "masuk 20 pcs", "keluar 3 pcs". Stok akhir dihitung sistem.

```
Stok akhir = stok awal + semua barang masuk − semua barang keluar ± penyesuaian opname
```

Setiap kejadian tersimpan sebagai satu baris: tanggal, SKU, jumlah, jenis, keterangan, dan **siapa yang mencatat**. Jadi kalau besok angkanya terasa aneh, bisa dibuka riwayatnya baris per baris — sesuatu yang tidak mungkin dilakukan papan tulis.

Kalau desainnya dibalik (user mengetik langsung stok akhir seperti di papan tulis), semua keunggulan di atas hilang dan sistemnya cuma jadi papan tulis versi layar.

---

## 3. Peran Pengguna

| Peran | Hak akses |
|---|---|
| Owner / Admin | Semua: master produk, catat, koreksi, opname, laporan, kelola user |
| Gudang / Produksi | Catat barang masuk & keluar, ikut opname, lihat stok |
| Host Live | **Hanya lihat** halaman stok (read-only) |

Cukup 3 peran. Jangan dibuat lebih rumit dari ini di awal.

---

## 4. Jenis Pencatatan

| Jenis | Kapan dipakai | Efek |
|---|---|---|
| **MASUK** | Barang datang dari konveksi | stok **+** |
| **KELUAR** | Barang dikirim ke pembeli / dibawa keluar | stok **−** |
| **RETUR** | Barang kembali dari pembeli | stok **+** |
| **RUSAK** | Barang cacat/hilang, tidak bisa dijual | stok **−** |
| **OPNAME** | Hasil hitung fisik berkala | penyesuaian **±**, wajib isi alasan |

Lima jenis ini sudah mencakup semua yang biasanya ditulis di papan tulis. Setiap pencatatan boleh diberi keterangan bebas (misal nomor nota konveksi atau nomor pesanan) tanpa sistem harus mengurus pesanannya.

---

## 5. Aturan Penting

1. **Pencatatan tidak bisa dihapus**, hanya bisa dibatalkan dengan catatan koreksi (mutasi lawan). Alasannya: kalau bisa dihapus, jejak audit hilang dan masalah papan tulis kembali lagi.
2. **Stok boleh minus, dan itu disengaja.** Penjualan dicatat sebagai rekap setelah live, jadi kalau jumlah keluar melebihi stok tercatat, yang salah adalah catatannya — barangnya memang sudah laku. Input tetap diterima, stok jadi minus, dan sistem menerbitkan peringatan selisih yang harus diselesaikan lewat opname. Kalau input ditolak, petugas akan mengarang angka supaya bisa lanjut, dan itu merusak data jauh lebih parah daripada angka minus yang jujur.
3. **Satuan stok adalah SKU (varian)**, bukan nama produk. Untuk konveksi, "Kemeja A" tanpa ukuran & warna tidak ada artinya.
4. **Stok awal diisi lewat opname pertama**, bukan diketik sembarangan — supaya angka pembuka pun punya jejak.

---

## 6. Model Data

Skema lengkap ada di [`database/schema.sql`](../database/schema.sql), penjelasan dan konvensi penamaannya di [`docs/SKEMA-DATABASE.md`](SKEMA-DATABASE.md).

Ringkasnya, 28 tabel dalam 7 kelompok:

| Kelompok | Tabel |
|---|---|
| Users & master | `users`, `categories`, `products`, `product_variants`, `sales_channels`, `channel_sku_mappings`, `import_batches`, `manufacturers`, `suppliers`, `materials` |
| Sales | `orders`, `order_items`, `order_cancellations`, `sales_returns`, `sales_return_items` |
| Production | `production_orders`, `production_order_items`, `goods_receipts`, `goods_receipt_items` |
| Materials | `material_purchases`, `material_purchase_items`, `material_usages` |
| **Ledger (inti)** | **`stock_movements`**, **`material_movements`** |
| Stock count | `stock_counts`, `stock_count_items` |
| Alerts & audit | `stock_alerts`, `activity_logs` |

Inti sistemnya ada di `stock_movements`. Kolom `product_variants.stock_on_hand` hanya cache — kebenarannya ada di ledger.

---

## 7. Halaman

| # | Halaman | Peran | Isi |
|---|---|---|---|
| 1 | Login | semua | — |
| 2 | **Stok Sekarang** (halaman utama) | semua | daftar SKU + jumlah, pencarian, filter kategori, warna status: hijau aman / kuning menipis / merah habis / abu-abu minus. **Wajib menampilkan waktu rekap terakhir**, supaya jelas angkanya per kapan |
| 3 | **Catat Barang Masuk** | Gudang, Owner | pilih SKU → jumlah → keterangan → simpan. Bisa beberapa SKU sekaligus (satu nota) |
| 4 | **Catat Barang Keluar / Rekap Live** | Gudang, Owner | sama. Input tetap diterima walau stok tidak cukup, lalu memunculkan peringatan selisih (lihat Aturan 2) |
| 5 | Riwayat / Kartu Stok | semua | riwayat per SKU: tanggal, jenis, jumlah, sisa, pencatat. Ini pengganti buku |
| 6 | Master Produk & Varian | Owner | CRUD produk + varian, atur stok minimum |
| 7 | Stok Opname | Gudang, Owner | buat sesi → input hitungan fisik → lihat selisih → simpan penyesuaian |
| 8 | Peringatan Stok Menipis | Owner, Gudang | daftar SKU di bawah minimum (muncul juga sebagai lonceng/badge) |
| 9 | Laporan | Owner | rekap stok akhir, mutasi per periode, barang paling bergerak, riwayat selisih; ekspor Excel/PDF |
| 10 | Pengguna & Log Aktivitas | Owner | kelola user, audit trail |

**Halaman 2, 3, 4 harus enak dipakai di HP** — pencatatan dilakukan sambil berdiri di gudang. Tombol besar, input angka pakai keypad, minim ketik.

Halaman 2 juga berfungsi sebagai "papan tulis digital": kalau ada TV/monitor di ruang live, halaman ini bisa ditampilkan permanen.

---

## 8. Teknologi

| Lapisan | Pilihan |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| Database | PostgreSQL (atau MySQL) |
| ORM | Prisma |
| UI | Tailwind + shadcn/ui |
| Auth | Auth.js (username + password) |
| Ekspor | SheetJS (xlsx) |
| Deploy | VPS / Vercel + Neon |

Skala kecil, jadi tidak perlu antrian, cache, atau microservice. Satu aplikasi Next.js + satu database sudah cukup.

**Alternatif:** Laravel 12 + Filament — dengan ruang lingkup sekecil ini, Filament bisa menghasilkan sebagian besar CRUD-nya otomatis dan jadi lebih cepat selesai. Model data di atas berlaku sama.

---

## 9. Tahapan Pengerjaan

| Fase | Isi | Hasil |
|---|---|---|
| 1 | Setup proyek, database, login, 3 peran | bisa login |
| 2 | Master produk & varian | data SKU siap |
| 3 | **Buku besar + catat masuk/keluar + halaman stok** | inti sistem jalan, papan tulis sudah bisa ditinggalkan |
| 4 | Riwayat / kartu stok per SKU | jejak perubahan bisa ditelusuri |
| 5 | Peringatan stok minimum | notifikasi otomatis |
| 6 | Stok opname + penyesuaian | stok sistem = stok fisik |
| 7 | Laporan + ekspor + log aktivitas | siap serah terima |

Setelah **Fase 3** sistem sudah bisa langsung dipakai menggantikan papan tulis. Fase 4–7 adalah penyempurnaan. Disarankan dipakai beneran mulai Fase 3 supaya masukannya cepat masuk.

---

## 10. Yang Sengaja Tidak Dibuat (untuk saat ini)

Supaya jelas batasnya:

- Manajemen pesanan, pembayaran, resi — tetap di marketplace
- Sinkronisasi stok otomatis ke marketplace — tetap manual seperti sekarang
- Harga, modal, laba, akuntansi
- Multi gudang / multi lokasi
- Barcode scanner (bisa ditambah nanti, kolom `barcode` sudah disiapkan)

Semua ini bisa ditambahkan belakangan tanpa membongkar struktur data, karena buku besar sudah jadi fondasinya.

---

## 11. Yang Perlu Diputuskan Sebelum Mulai

1. **Berapa banyak SKU?** (puluhan / ratusan / ribuan) — menentukan desain halaman stok & perlu tidaknya pencarian berat.
2. **Barang keluar dicatat satuan per pesanan, atau direkap sekali di akhir hari?** Ini menentukan bentuk form halaman 4.
3. **Varian pakai ukuran & warna?** Atau produk langsung jadi satuan stok?
4. **Berapa orang yang akan mencatat**, dan apakah lewat HP atau komputer gudang?
5. **Stok awal diambil dari mana** — hitung fisik sekali di awal (disarankan) atau salin dari papan tulis sekarang?

---

## 12. Risiko

| Risiko | Penanganan |
|---|---|
| Tim kembali ke papan tulis karena aplikasi lebih repot | Form catat harus < 10 detik: pilih SKU, isi angka, simpan. Ini syarat utama, bukan tambahan |
| Lupa mencatat barang keluar | Opname berkala sebagai jaring pengaman + halaman stok dipajang di monitor agar janggalnya cepat terlihat |
| Stok awal salah | Mulai dari opname fisik, bukan salin papan tulis |
| Salah input angka | Riwayat bisa dibatalkan dengan koreksi bercatatan, tidak dihapus diam-diam |
| Internet gudang mati | Halaman ringan + pesan error jelas; kalau sering mati, pertimbangkan pencatatan offline di fase lanjutan |
