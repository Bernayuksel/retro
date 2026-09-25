# Retro App

 self-hosted, gerçek zamanlı sprint retrospektif aracı.
Login gerektirmez, sonunda otomatik PDF + paylaşılabilir link raporu üretir.

## Özellikler
- Board oluşturma (özelleştirilebilir, max 5 kolon) ve her hafta sırayla gösterilen sorular
- Başlatılabilir, duraklatılabilir toplantı sayacı ve kolonlar arası kart taşıma
- Aynı tarayıcıdan güvenli oturum devamı ve birden fazla admin
- Login yok — sadece isimle katılım
- Gerçek zamanlı senkronizasyon (WebSocket)
- Anonim kart ekleme
- Reveal edilene kadar kartlar gizli (mask)
- Oylama
- Aksiyon maddeleri (sorumlu + tarih)
- Board kapatıldığında otomatik retro raporu: PDF + kalıcı paylaşılabilir link
- İsteğe bağlı, anonimleştirilmiş OpenAI özeti içeren ikinci PDF raporu
- Board yalnızca admin kapattığında kapanır; veriler otomatik silinmez

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

Üretim ortamında Turso zorunludur. Turso panelindeki veritabanı URL'sini ve oluşturduğunuz
veritabanı erişim token'ını Render servisinin **Environment** bölümünde sırasıyla
`TURSO_DATABASE_URL` ve `TURSO_AUTH_TOKEN` olarak tanımlayın. Token'ı GitHub'a eklemeyin.
`libsql://` (libSQL) ve `turso://` (Turso Database) URL'leri desteklenir.
Bu iki değer yoksa üretim sunucusu başlamaz; geçici diske sessizce yazılmaz.

Önceden Render'ın geçici diskindeki SQLite dosyasında kalmış veriler Turso'ya otomatik
taşınmaz. Mevcut retro oturumunuz varsa önce raporunu indirin; servisi yeniden başlatmak
geçici veriyi kaybettirebilir. Yerelde `npm start` SQLite dosyasıyla çalışmaya devam eder.

```bash
docker compose up --build
```

## Mimari
- **Backend:** Node.js + Express + `ws` (WebSocket) + Turso Cloud; yerelde SQLite
- **Frontend:** Vanilla JS, build adımı gerektirmez, `server/public` altından statik servis edilir
- **PDF:** `pdfkit`
- **Veri modeli:** `boards`, `participants`, `cards`, `votes`, `actions`, `reports`, `ai_reports`
  - `reports` tablosundaki snapshot ile geçici PDF dosyası yeniden oluşturulur

## Kurumsal revizyon noktaları (bir sonraki adım)
- SSO / kurumsal login zorunluluğu
- Board geçmişi / organizasyon bazlı arşiv
- Jira / Slack entegrasyonu
- Standart kolon şablonları
