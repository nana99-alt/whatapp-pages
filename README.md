# WhatApp Public Web / PWA

WhatApp adalah prototipe aplikasi chat web/PWA berbahasa Indonesia. Situs publik: <https://nana99-alt.github.io/whatapp-pages/>. Push ke branch `main` akan memperbarui GitHub Pages.

## Akun dan ID kontak

Setelah seseorang mendaftar memakai email, mengonfirmasi email (jika verifikasi Supabase diwajibkan), lalu masuk, aplikasi membuat profil dan memberikan **ID WhatApp acak** dalam format `WA-1234-5678`. ID disimpan pada `public.profiles.virtual_number`, yang harus tetap memiliki constraint `UNIQUE`; database menjadi pemeriksa akhir bila dua pendaftaran kebetulan menghasilkan ID yang sama. Setiap akun mempertahankan ID yang sama saat masuk kembali. Pengguna lain yang masuk dapat mengetik ID itu melalui tombol `+` untuk membuka obrolan.

ID tersebut adalah **alamat kontak internal aplikasi**, bukan nomor seluler/SIM, bukan nomor PSTN, tidak bisa menerima SMS/OTP telepon, dan tidak otomatis bisa dipanggil melalui jaringan telepon. Chat antar akun memerlukan koneksi Supabase dan kebijakan tabel yang benar. Panggilan audio/video belum tersedia sampai WebRTC, signaling, dan TURN disiapkan.

## Menjalankan mode demo

Pilih **Lihat demo** pada layar masuk. Pesan demo yang dikirim disimpan di penyimpanan browser pada perangkat itu saja; pesan tersebut tidak dikirim ke pengguna lain atau Supabase. Lampiran juga memerlukan akun dan bucket storage yang dikonfigurasi.

## Integrasi Supabase

`config.js` memuat Supabase URL dan publishable/anon key yang aman untuk dipakai di browser. Jangan pernah menaruh `service_role` key di sana. Tabel yang dipakai aplikasi adalah:

- `profiles`: `id` UUID yang merujuk ke `auth.users`, `display_name`, `avatar_url`, dan `virtual_number` unik.
- `messages`: `sender_id`, `receiver_id`, `body`, metadata lampiran, waktu kirim, dan status baca.

Aktifkan RLS dengan kebijakan yang membatasi perubahan profil ke pemilik akun dan membaca/mengirim pesan hanya bagi peserta percakapan. Untuk attachment, buat bucket `chat-media` dan atur kebijakannya sebelum mengaktifkan upload. Tambahkan domain publik ke daftar URL redirect Supabase Auth bila konfirmasi email dipakai.

Buka melalui HTTPS lalu pilih **Pasang** atau **Add to Home screen** untuk memasang PWA.
