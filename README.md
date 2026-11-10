# WhatApp Public Web / PWA

WhatApp adalah aplikasi chat web/PWA berbahasa Indonesia yang memakai akun Supabase nyata; tidak ada mode demo. Situs publik: <https://nana99-alt.github.io/whatapp-pages/>. Push ke branch `main` akan memperbarui GitHub Pages.

## Akun dan ID kontak

Pengguna baru pilih **Buat akun baru**, daftarkan email dan kata sandi minimal 6 karakter, lalu buka tautan verifikasi di email sebelum masuk. Setelah masuk, aplikasi membuat profil dan memberikan **ID WhatApp acak** dalam format `WA-1234-5678`. Buka tombol avatar di kanan atas untuk melihat email, ID kontak, atau mengubah nama tampilan. ID disimpan pada `public.profiles.virtual_number`, yang harus tetap memiliki constraint `UNIQUE`; database menjadi pemeriksa akhir bila dua pendaftaran kebetulan menghasilkan ID yang sama. Setiap akun mempertahankan ID yang sama saat masuk kembali. Pengguna lain yang masuk dapat mengetik ID itu melalui tombol `+` untuk membuka obrolan.

ID tersebut adalah **alamat kontak internal aplikasi**, bukan nomor seluler/SIM, bukan nomor PSTN, tidak bisa menerima SMS/OTP telepon, dan tidak otomatis bisa dipanggil melalui jaringan telepon. Chat antar akun memerlukan koneksi Supabase dan kebijakan tabel yang benar. Panggilan audio/video belum tersedia sampai WebRTC, signaling, dan TURN disiapkan.

## Integrasi Supabase

`config.js` memuat Supabase URL dan publishable/anon key yang aman untuk dipakai di browser. Jangan pernah menaruh `service_role` key di sana. Tabel yang dipakai aplikasi adalah:

- `profiles`: `id` UUID yang merujuk ke `auth.users`, `display_name`, `avatar_url`, dan `virtual_number` unik.
- `messages`: `sender_id`, `receiver_id`, `body`, metadata lampiran, waktu kirim, dan status baca.

Aktifkan RLS dengan kebijakan yang membatasi perubahan profil ke pemilik akun dan membaca/mengirim pesan hanya bagi peserta percakapan. Untuk attachment, buat bucket `chat-media` dan atur kebijakannya sebelum mengaktifkan upload. Tambahkan `https://nana99-alt.github.io/whatapp-pages/` ke daftar URL redirect Supabase Auth (redirect email aplikasi kini kembali ke subfolder tersebut). Email perlu diverifikasi sebelum pengguna dapat masuk dan memperoleh ID.

Buka melalui HTTPS lalu pilih **Pasang** atau **Add to Home screen** untuk memasang PWA.
