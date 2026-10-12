# QA ve teslim durumu — 2026-10-10

**Sonuç: Tamamlanmış, çalıştırılarak kabul edilmiş MVP teslimi değildir.** Kaynak kodu ve çekirdek doğrulaması mevcut; çalışma ortamı npm/medya ağ bağlantılarını engellediği için SDK bağımlılıkları, yerel server, gerçek endpointler ve Stremio oynatımı doğrulanamadı.

## Çalıştırılan kontroller

| Kontrol | Gerçek sonuç |
| --- | --- |
| Node / npm | Node v24.19.0, npm 11.17.0 |
| npm install | **FAIL**: registry bağlantısı `EACCES`. Tekrar deneme de aynı kısıta takıldı. |
| Offline kurulum | Gerçek npm tarball önbelleğinden TypeScript, Vitest, ESLint, Zod, Undici, ipaddr.js ve bağımlılıkları kuruldu. SDK/Express/Pino/dotenv/Prettier mevcut değildi. |
| npm run test:core | **PASS**: 5 dosya, 93 test; son çalıştırma yaklaşık 1,45 s. |
| npm test | **FAIL**: 93 test geçti; `addon.test.ts` SDK paketi eksik olduğundan toplanamadı. 6 SDK/admin testi henüz çalıştırılmadı. |
| npm run test:integration | **FAIL**: 2 gerçek entegrasyon testi. Blender HTTPS bağlantısı `connect EACCES 8.47.69.0:443`; diğer testte SDK paketi eksik. Mock veya skip ile geçilmiş gösterilmedi. |
| npm run typecheck:core | **PASS**: ID, eşleştirme, kalite, cache, timeout, güvenli HTTP/URL ve video doğrulama modülleri; matching/http testleri. Sunucu/provider/metadata katmanının tamamını kapsamıyor. |
| npm run typecheck | **FAIL**: eksik SDK/Express/Pino/dotenv ve bunlardan kaynaklanan tip çıkarım hataları. Tam kurulumdan sonra yeniden çalıştırılmalı. |
| npm run lint | **PASS**: src, tests, scripts. |
| node --check admin/app.js | **PASS**: JavaScript syntax kontrolü; görsel veya canlı UI kontrolü değildir. |
| npm run format:check | **FAIL**: Prettier indirilemedi. Kaynaklar TypeScript printer ile düzenlendi; Prettier uygunluğu iddia edilmiyor. |
| npm run build | **FAIL**: eksik paket/tipler. `noEmitOnError` açık; önceki başarısız denemenin kısmi JS çıktıları kaldırıldı. |
| npm run dev | **FAIL**: Express eksik (`ERR_MODULE_NOT_FOUND`). Sunucu çalışır durumda bırakılmadı. |
| Manifest / movie / series HTTP | **Doğrulanmadı**: SDK bağımlılığı/server başlangıcı engelli. Test kodları hazır. |
| Stremio GUI oynatımı | **Doğrulanmadı**. MP4 imza/ulaşılabilirlik testi bile ağ kısıtına takıldı; GUI oynatımı için ayrıca görüntü/ses kontrolü gerekir. |

Kurulum URL'si tasarım gereği `http://127.0.0.1:7000/manifest.json`; şu anda çalışan bir sunucu adresi olarak sunulmuyor.

## Test kapsamı

- 25 parsing/matching testi: movie/episode IDs, specials, malformed IDs, Türkçe/Unicode, exact ID, localized/original/alternative title, yıl çelişkisi, fuzzy benzerlik, belirsizlik ve bölüm doğruluğu.
- 29 güvenlik testi: input/env, localhost, özel IP aralıkları, metadata/link-local, IPv4 numeric ve mapped IPv6, host/port/credentials, mixed DNS, expiry ve iptal.
- 25 stream/cache testi: provider hata/timeout izolasyonu, dedup, yanlış film, seri arama, dil/kalite sırası, TTL/eviction/caller mutation, cache hit/single-flight, MIME, HEAD fallback, expiry, şifresiz HLS ve şifreli/private-reference HLS reddi, VTT doğrulama.
- 8 provider/metadata/health testi: izin alanları, JSON katalog/resolve, yanlış katalog, reserve IDs, demo scope, health izolasyonu/cache ve metadata cache.
- 6 HTTP transport testi: DNS pinning, redirect izin kontrolü, her hop DNS, private DNS before socket, bounded response ve Range'i yok sayan sunucuya karşı byte sınırı.
- 6 SDK/admin testi hazır ama çalışmadı: manifest, stream fields/handler, empty streams, SDK HTTP movie/series/CORS, Host/Origin/CSRF kontrolleri.
- 2 canlı medya testi hazır ve gerçekten denendi; ağ/paket engeli nedeniyle başarısız.

Mock sağlayıcılar yalnızca test fixture'larıdır; kullanıcıya sunulan canlı provider gibi kaydedilmezler. Sentetik benchmark da ayrı etiketlidir.

## Performans ölçümü

Ham sonuç: [benchmark-synthetic.json](benchmark-synthetic.json).

Ortam: Windows 11 `10.0.26200`, Node v24.19.0, AMD Ryzen 5 5600 (6 core). Ölçüm `NODE_ENV=test` ile mevcut offline bağımlılıklar kullanılarak `node scripts/run-ts.mjs scripts/benchmark.ts` üzerinden alındı. 100 soğuk çekirdek + 100 cache hit örneği; gerçek dış ağ veya Stremio istemcisi kullanılmadı.

| Ölçüm | Ortalama | p50 | p95 | Maksimum |
| --- | ---: | ---: | ---: | ---: |
| Sentetik soğuk çekirdek | 0,218 ms | 0,163 ms | 0,361 ms | 2,811 ms |
| Cache hit | 0,024 ms | 0,020 ms | 0,043 ms | 0,101 ms |

Ölçüm sonunda RSS yaklaşık 71,4 MiB, heap used 16,5 MiB. Bu tek süreç anlık bellek ölçümüdür; yük altında uzun süreli bellek sınırı veya internet üzerinden <3 s gecikme garantisi değildir. Canlı benchmark tamamlanmadı. Cache hit hedefi bu sentetik örneklemde karşılandı.

## Sağlayıcı durumu ve bilinen sınırlar

Canlı çalıştığı doğrulanmış sağlayıcı **yok**. Blender demo adaptörü uygulandı ve lisans birincil kaynakla araştırıldı; ağdaki mevcut video ulaşılabilirliği ve Stremio oynatımı gözlenmedi. HDFilmCehennemi, Dizibox, Dizipal, Dizilife `unsupported`; [araştırma gerekçeleri](../docs/SOURCE_RESEARCH.md).

Basit, şifresiz HLS desteklenir; dış audio/subtitle rendition ve derin master zincirleri reddedilir. Segmentlerin tümü ayrı ayrı probe edilmez. Dil/kalite yalnızca sağlayıcı metadata'sı veya playlist'ten gelir; demo `Unknown` kalite ve bilinmeyen dil etiketiyle tanımlıdır. Üç örnek IMDb künyesi dışında metadata için opsiyonel Cinemeta gerekir veya exact provider IMDb eşleşmesi kullanılır. Canlı bir dizi provider'ı ekli değildir. Redis ve uzak yönetim yoktur.

SSRF/DNS/timeout/redirect/response-limit çekirdek kontrolleri test edildi. Yönetim CSRF/Origin/Host kodu yazıldı; canlı HTTP testleri henüz çalışmadı. Yeni provider konfigürasyonundaki izin kanıtı insan tarafından doğrulanmalıdır; yazılım bir lisans URL'sinin gerçek yetki verdiğini otomatik kanıtlamaz.

## Aşamaların durumu

1. Foundation: kod/manifest/SDK router hazır; kurulum ve localhost başlangıcı engelli.
2. Metadata Engine: uygulanmış çekirdek parsing/matching testleri geçti; opsiyonel uzak metadata canlı doğrulanmadı.
3. Provider Architecture: registry/JSON/demo adaptörleri, timeout ve health testleri geçti; canlı provider kontrolü engelli.
4. Stream Processing: HTTP/medya/HLS/subtitle ve sıralama birim testleri geçti; gerçek video testi engelli.
5. Optimization: cache, single-flight, logger tanımı ve sentetik benchmark hazır; Pino kurulumu/canlı ağ ölçümü engelli.
6. Admin: yerel panel/kalıcılık/güvenlik kodu hazır; canlı UI/HTTP doğrulaması engelli.
7. QA & Release: çekirdek test/typecheck ve lint geçti; tam install/test/build/format/oynatım kabulü tamamlanmadı. Yayınlama yapılmadı.

## Tamamlamak için gerekli koşul

npm/ağ erişimi olan oturumda `npm install`, `npm run format`, `npm run check`, `npm run test:integration`, `npm run dev` çalıştırılmalı. Ardından manifest/movie/series endpointleri, panel ve Stremio masaüstünde Big Buck Bunny'nin tam oynatımı doğrulanmalı; canlı benchmark ölçülmeli. Bu kontroller geçmeden release tamamlandı kabul edilmemeli.

Normal npm isteği `EACCES` ile engellendi. Yükseltilmiş çalıştırma isteği otomatik onay politikası tarafından reddedildi: `sandbox_approval=false`. Ağ kısıtı sahte SDK, mock canlı provider veya başka erişim yolu ile aşılmadı. Güvenli, bağımsız geliştirme ve offline testler tamamlandı.

## Takip çalışması — 10 Ekim 2026

En güncel sonuç: kullanıcı oturumunda W3C canlı entegrasyonu **2/2 geçti** (MP4 imzası/validator ve gerçek SDK stream). Canlı benchmark Windows 11 / Node 24.19 / Ryzen 5 5600, 10 soğuk + 10 cache örneği: ortalama 191,59 ms / 0,059 ms, p95 212,61 ms / 0,121 ms, RSS 74,0 MiB. Stremio GUI oynatımı henüz gözlenmedi. Ardından production başlangıcında SDK CommonJS/ESM named import hatası görüldü ve default SDK importuyla düzeltildi. `test:built` gerçek `node dist/index.js` sürecini açarak manifest, film/dizi boş yanıt ve admin HTTP endpointlerini doğruladı. Bu kontrol artık `npm run check` içinde build sonrasında zorunlu. 99 birim/HTTP test ve typecheck/build/lint geçti. Aşağıdaki sonuçlar önceki denemelerin tarihçesidir.

Google örneği kullanıcı oturumunda 403 döndü. Kimlik doğrulama, proxy veya başlık taklidi uygulanmadı. Kaynak bağımsız W3C Bunny movie test kopyasına değiştirildi (`media.w3.org`); lisans Blender CC BY 3.0 olarak korundu. Canlı test HTTP durumunu, host ve content-type bilgisini açıkça raporluyor. 99 test/typecheck/lint/build yeniden geçti; yeni W3C adresinin canlı erişimi henüz doğrulanmadı.

Kullanıcı ortamında canlı video isteği ağ engeli olmadan 404 döndü: önceki Blender demo MP4 yolu geçersizdi. Demo URL, Google Cast resmî dokümantasyonunda `video/mp4` oynatma örneği olan Big Buck Bunny kopyasına değiştirildi; host allowlist ve canlı testin beklediği URL güncellendi. 99 test/typecheck/lint/build tekrar geçti. Bu araç ortamında yeni adrese canlı bağlantı da `EACCES` ile engellendi; kullanıcı oturumunda tekrar doğrulama ve Stremio oynatımı gerekiyor.

Son doğrulama: kullanıcı normal Windows oturumunda bağımlılıkları kurdu ve lockfile oluştu. SDK 1.6.10 declaration dosyası içermediğinden, kullanılan stream-only API için kurulu SDK kaynak koduyla uyumlu strict tip sözleşmesi eklendi. Node Fetch'in Host başlığını değiştirmesi nedeniyle DNS rebinding testi doğrudan `node:http` ile gerçek Host başlığını gönderiyor. `npm run check` tamamen geçti: typecheck, lint, **99/99 test**, production build. `npm run format:check` geçti. Gerçek SDK manifest/movie/series HTTP ve admin Host/Origin/CSRF kontrolleri artık test edildi. Canlı entegrasyon yeniden denendi: dış HTTPS bağlantısı bu araç ortamında `EACCES` ile engellendi ve iki test başarısız oldu; medya erişimi ve Stremio oynatımı henüz doğrulanmadı. Aşağıdaki önceki aşama durumları bu güncellemeden önceki sonuçları anlatır.

Normal Windows oturumundaki ilk başlatma `debug@2.6.9` için `ETARGET` ile durdu. Neden, araç kurulumu için hazırlanmış kısmi çevrimdışı npm metadata önbelleğinin başlatıcıda da kullanılmasıydı. Başlatıcı `.cache/npm-online` ve `--prefer-online` kullanacak şekilde düzeltildi; mevcut önbellek ve kullanıcı dosyaları silinmedi. Düzeltme sonrası tam kurulum henüz doğrulanmadı.

Kullanıcının tüm işlemleri otomatik yapma isteği üzerine npm kurulumu tekrar denendi; aynı `EACCES` ağ engeli sürdü. `.env` dosyası hazırlandı. `Stremio-TR-Baslat.cmd` ve `scripts/setup-local.mjs`, normal Windows oturumunda bağımlılık kurulumunu, format/check/build, canlı entegrasyon/benchmark, yerel arka plan server, film/dizi endpoint kontrolü ve panel/Stremio açmayı tek başlatmada otomatikleştirir. Başlatıcı syntax/help kontrolünden geçti; tam kurulum bu ortamda yine doğrulanamadı. 93 çekirdek test, çekirdek typecheck ve lint tekrar geçti.
