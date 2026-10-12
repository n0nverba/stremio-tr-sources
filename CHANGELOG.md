# Sürüm notları

## 1.0.0 — 2026-10-10 — doğrulaması tamamlanmamış yerel MVP

- Stream-only Stremio SDK uygulaması, IMDb/bölüm ayrıştırması ve Türkçe fuzzy matching.
- Yetkili sağlayıcı arayüzü, JSON katalog adaptörü ve açık lisanslı Blender demo tanımı.
- Provider timeout/izolasyonu, stream/metadata/search/health cache'leri ve benchmark.
- SSRF kontrollü HTTP, DNS sabitleme, medya/VTT/SRT doğrulaması ve basit şifresiz HLS varyantları.
- Yerel yönetim paneli, kalıcı tercihler, CSRF/Origin/Host kontrolleri.
- Araştırılan dört kaynak için gerekçeli `unsupported` raporu.

Bu sürüm yayınlanmadı. SDK/Express/Pino/dotenv kurulumunun ağ kısıtı nedeniyle tamamlanamaması, tam build ve endpoint doğrulamasını engelledi. Çekirdek test sonuçları ve canlı entegrasyon hataları [QA raporunda](reports/QA.md). Stremio'da oynatım doğrulanana kadar tamamlanmış release kabul edilmemelidir.
