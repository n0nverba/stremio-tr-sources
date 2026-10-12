# Dizibox içerik entegrasyonu

Hedef: yalnızca örnek bir film değil, sitedeki tüm ilgili içeriklerin IMDb ve bölüm kimlikleriyle eşleştirilmesi. Tam kapsama henüz ulaşılmadı.

## İstek üzerine scraper

`src/scrapers/dizibox.ts` gerçek bir HTTP sayfa okuyucusu ve keşif modülüdür. Kayıtlı envanterde başlığı eşleştirir; yalnızca seçilen içerik sayfasını ve gerekiyorsa tam sezon/bölüm sayfasını okur. Ana sayfa veya tüm site her stream isteğinde taranmaz. IMDb kimliği, içerik başlığı ve bölüm bağlantısı doğrulanamıyorsa keşif durur. Envanterde olmayan içeriklerin bulunması henüz desteklenmez; envanterin tamlığı da doğrulanmamıştır.

Çalıştırma: `npm run dizibox:discover -- series tt0903747:1:2`. Çıktı: `reports/dizibox-discovery.json`. Film için `movie tt...` kullanılır. Uzak metadata yalnızca bu keşif komutunda açıktır; mevcut uygulama ayarları değiştirilmez.

Keşif sonucu `playbackStatus: unverified` taşır. Bulunan medya referansları oynatım URL'si olarak SDK'ya verilmez; iframe'ler takip edilmez, scriptler çalıştırılmaz ve cookie/token çıkarılmaz. Bu modül henüz aktif Stremio stream sağlayıcısı değildir.

Beş yeni test doğru bölüm seçimi/cache, yanlış IMDb, challenge, belirsiz başlık, eksik metadata, SSRF host ve eksik bölüm davranışlarını sınar. Toplam 121 otomatik test, build ve derlenmiş sunucu kontrolleri geçti. Gerçek Breaking Bad 1x2 isteği bu geliştirme ortamında başarısız oldu; canlı site çözümlemesi veya oynatım doğrulandığı iddia edilmez.

`npm run dizibox:index` son kaynak kontrolünde kaydedilmiş, kamuya açık ana sayfa HTML'sinden benzersiz içerik adları ve sayfa adreslerini çıkarır. Yeni ağ isteği yapmaz. Çıktı `reports/dizibox-catalog.json` dosyasıdır. İlk çalıştırmada 4.811 bağlantı bulundu; önceki tanılama aracının 150 kayıt sınırı bu envantere uygulanmaz. Film/dizi türü URL yoluna göre ön sınıflandırmadır; ayrıntı metadata'sıyla doğrulanmalıdır.

Çıktı bilinçli olarak `complete: false` ve `playbackStatus: unverified` taşır. Bir ana sayfanın binlerce bağlantı içermesi bütün sitenin kapsandığını kanıtlamaz. Aynı dizinin farklı adresleri bulunabilir; URL benzersizliği IMDb benzersizliği değildir.

Kalan adımlar:

1. Erişilebilir, kullanım koşullarıyla uyumlu katalog/sitemap/pagination yöntemini belirlemek; eksik sayfaları düşük istek hızı ve kaldığı yerden devam eden taramayla tamamlamak.
2. İçerik ayrıntılarından doğrulanmış IMDb kimliği, başlık ve yılı almak; aynı içeriğe ait adresleri birleştirmek.
3. Her dizi için doğru sezon/bölüm listesini çıkarmak; gezinme menüsündeki başka dizileri karıştırmamak.
4. Üçüncü taraf oynatımına izin verilmiş doğrudan medya entegrasyonunu doğrulamak ve ancak bundan sonra stream adaptörünü etkinleştirmek.
5. Gerçek film/bölüm için SDK endpointini ve Stremio görüntü/ses oynatımını doğrulamak.

Cloudflare/CAPTCHA aşma, kullanıcı oturumu kopyalama veya korumalı oynatma tokenlarını çıkarma uygulanmaz. Bu envanter bir Stremio stream sağlayıcısı olarak kaydedilmez; mevcut manifest stream-only kalır.
