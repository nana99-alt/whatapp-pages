# Panggilan latar Web Push — implementasi WhatApp

## Referensi resmi
- Supabase pg_net async HTTP, fungsi `net.http_post`, dan pemanggilan dari trigger: https://supabase.com/docs/guides/database/extensions/pg_net
- Supabase Database Webhooks, event tabel, dan pola memanggil Edge Function: https://supabase.com/docs/guides/database/webhooks

## Desain implementasi
Offer baru pada `public.call_signals` memicu `net.http_post` ke Edge Function `send-call-push`. Fungsi memeriksa bahwa ID adalah offer baru, menandainya idempotent pada `call_push_deliveries`, mencari subscription milik penerima, lalu mengirim Web Push menggunakan pasangan VAPID privat/public. Private key hanya disimpan di Edge Function Secrets Supabase. Endpoint Push dan kunci browser disimpan per user dalam `call_push_subscriptions` dengan RLS hanya ke pemilik. Service worker menerima push, menampilkan notifikasi Android, dan membuka panggilan dengan ID sinyal saat notifikasi diketuk.

## Batas platform
Web Push dapat menampilkan notifikasi dan memakai bunyi/getar notifikasi Android saat tab/PWA ditutup, jika izin notifikasi aktif dan sistem tidak membatasi Chrome. Ini bukan panggilan telepon seluler/PSTN, dan browser tidak dapat menjamin ringtone berulang seperti aplikasi native saat proses browser dihentikan paksa, mode Jangan Ganggu aktif, atau penghemat baterai menahan push. Pengguna perlu mengaktifkan izin pada setiap perangkat penerima.

## Validasi yang sudah dilakukan
- Trigger offer dan tabel subscriptions dibuat pada Supabase.
- Edge Function `send-call-push` aktif.
- Validasi sintaks JavaScript/service worker dijalankan.
- Uji end-to-end tetap membutuhkan setidaknya satu perangkat nyata yang mengaktifkan push dan menerima panggilan uji.
