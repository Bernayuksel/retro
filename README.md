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

## GitHub Project sprint seçimi

`server/.env.example` dosyasını yerelde `server/.env.local` adıyla kopyalayıp
değerleri doldurun veya sunucunun ortam değişkenleri olarak ayarlayın:
`GITHUB_TOKEN` (Project için salt okuma erişimi), `GITHUB_ORG`,
`GITHUB_PROJECT_NUMBER`, `GITHUB_PROJECT_ACCESS_KEY` (GitHub token'ından
ayrı, rastgele üretilmiş en az 24 karakterlik erişim anahtarı). Gerekirse
`GITHUB_BOARD_FIELD`, `GITHUB_SPRINT_FIELD`, `GITHUB_STATUS_FIELD`,
`GITHUB_ESTIMATE_FIELD` ve `GITHUB_DONE_STATUSES` değerlerini Project alanlarıyla
eşleştirin. Gerçek değerleri Git'e veya tarayıcı koduna koymayın.

PowerShell örneği (dosya Git tarafından yok sayılır):

```powershell
Copy-Item server/.env.example server/.env.local
# server/.env.local dosyasını VS Code ile açıp değerleri doldurun.
cd server
npm start
```

Board kuran kişi erişim anahtarını arayüzde bir kez girer; sunucu sekiz saatlik
HTTP-only oturum çerezi üretir. GitHub bağlantısı etkinse board başlığı alanı
Project board ve mevcut sprint dropdown'una dönüşür. Seçilen sprintin özeti
board ve rapora kaydedilir. GitHub'a erişilemiyorsa board oluşturulmaz ve
örnek istatistikler gösterilmez. Bağlantı yapılandırılmamışsa önceki manuel
board oluşturma akışı çalışır. Şirket verisi içeren board bağlantılarını yalnızca
yetkili katılımcılarla paylaşın; uygulamayı üretimde HTTPS ile çalıştırın.

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

Board oluştururken bir veya birden fazla board kutucuğunu işaretleyip ortak sprinti seçin.
Seçilen boardların o sprintteki işleri tek özet olarak hesaplanır. Efor kaynağı
varsayılan olarak `Original Estimate` alanıdır; sayısal değerler saat kabul edilir.
Metin alanlarında `2.5`, `2,5`, `2h` ve `2 saat` desteklenir. Farklı alan adı varsa
`GITHUB_ESTIMATE_FIELD` ile ayarlayın. Eski SP özetleri kendi birimiyle gösterilmeye devam eder.

Sprint seçildiğinde veriler önceden yüklenir; eşzamanlı sorgular aynı isteği paylaşır.
Board oluşturma sırasında düğme bekleme durumuna geçer ve tekrar tıklamayı engeller.
Eski SP özeti olan GitHub bağlantılı board, Project erişim çereziyle açıldığında
gerçek saat tahminleriyle bir kez yenilenir. Önceden oluşturulmuş raporlar geçmiş
çıktıları korur; eski SP değeri saat olarak yeniden etiketlenmez.

Saat tahminleri hem Project alanlarından hem issue üzerindeki organizasyon alanlarından
okunur. Issue üzerindeki değer aynı isimli Project değerinden önceliklidir.
Eksik tahminler gerçek sıfırdan ayrılır ve tahmin kapsama sayısı ekranda belirtilir.
Önceki okuma sürümüyle kaydedilmiş saat özetleri de yetkili açılışta yenilenir.
