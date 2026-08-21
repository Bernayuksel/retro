# Retro App

QuickRetro benzeri, self-hosted, gerçek zamanlı sprint retrospektif aracı.
Login gerektirmez, sonunda otomatik PDF + paylaşılabilir link raporu üretir.

## Özellikler
- Board oluşturma (özelleştirilebilir, max 5 kolon)
- Login yok — sadece isimle katılım
- Gerçek zamanlı senkronizasyon (WebSocket)
- Anonim kart ekleme
- Reveal edilene kadar kartlar gizli (mask)
- Oylama
- Aksiyon maddeleri (sorumlu + tarih)
- Board kapatıldığında otomatik retro raporu: PDF + kalıcı paylaşılabilir link
- Board verisi TTL ile otomatik silinir (varsayılan 48 saat); rapor bundan bağımsız kalıcıdır

## Yerel çalıştırma
```bash
cd server
npm install
npm start
```
Tarayıcıda `http://localhost:3000` adresini aç.

## Docker ile çalıştırma
```bash
docker compose up --build
```

## Mimari
- **Backend:** Node.js + Express + `ws` (WebSocket) + SQLite (`better-sqlite3`)
- **Frontend:** Vanilla JS, build adımı gerektirmez, `server/public` altından statik servis edilir
- **PDF:** `pdfkit`
- **Veri modeli:** `boards`, `participants`, `cards`, `votes`, `actions`, `reports`
  - `reports` tablosu board silinse bile bağımsız kalır (rapor snapshot'ı JSON olarak saklanır)

## Kurumsal revizyon noktaları (bir sonraki adım)
- SSO / kurumsal login zorunluluğu
- Board geçmişi / organizasyon bazlı arşiv
- Jira / Slack entegrasyonu
- Standart kolon şablonları
