# Retro App

 self-hosted, gerçek zamanlı sprint retrospektif aracı.
Login gerektirmez, sonunda otomatik PDF + paylaşılabilir link raporu üretir.

## Özellikler
- Board oluşturma (özelleştirilebilir, max 5 kolon), her hafta sırayla gösterilen sorular
- Adminin başlatıp duraklatabildiği toplantı sayacı
- Kolonlar arasında kart sürükleme, aynı tarayıcıdan katılımcıyı yeniden açma ve birden fazla admin
- Login yok — sadece isimle katılım
- Gerçek zamanlı senkronizasyon (WebSocket)
- Anonim kart ekleme
- Reveal edilene kadar kartlar gizli (mask)
- Oylama
- Aksiyon maddeleri (sorumlu + tarih)
- Board kapatıldığında otomatik retro raporu: PDF + kalıcı paylaşılabilir link
- İsteğe bağlı, anonimleştirilmiş OpenAI özeti içeren ikinci PDF raporu
- Board'lar otomatik silinmez; kalıcılık için SQLite veri dizinini koruyun

## Yerel çalıştırma
```bash
cd server
npm install
npm start
```
Tarayıcıda `http://localhost:3000` adresini aç.

## AI özetli rapor

AI özetli PDF için OpenAI API anahtarını sunucuyu başlatmadan önce ortam değişkeni olarak tanımlayın.

PowerShell:

```powershell
$env:OPENAI_API_KEY="api-anahtariniz"
$env:OPENAI_MODEL="gpt-5.6-luna"
npm start
```

`OPENAI_MODEL` isteğe bağlıdır; varsayılan model `gpt-5.6-luna`dır. Kartlar, yorumlar,
oylar ve aksiyon içerikleri özette kullanılır. Katılımcı ve sorumlu isimleri OpenAI API'ye
gönderilmez. Üretilen AI özeti veritabanında saklanır; aynı rapor tekrar indirildiğinde yeni
bir API çağrısı yapılmaz.

## Docker ile çalıştırma
```bash
docker compose up --build
```

## Mimari
- **Backend:** Node.js + Express + `ws` (WebSocket) + SQLite (`node:sqlite`)
- **Frontend:** Vanilla JS, build adımı gerektirmez, `server/public` altından statik servis edilir
- **PDF:** `pdfkit`
- **Veri modeli:** `boards`, `participants`, `cards`, `votes`, `actions`, `reports`, `ai_reports`
  - `reports` tablosu board silinse bile bağımsız kalır (rapor snapshot'ı JSON olarak saklanır)

## Kurumsal revizyon noktaları (bir sonraki adım)
- SSO / kurumsal login zorunluluğu
- Board geçmişi / organizasyon bazlı arşiv
- Jira / Slack entegrasyonu
- Standart kolon şablonları
