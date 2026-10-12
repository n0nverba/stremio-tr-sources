# Dört site için Stremio köprüsü — mevcut durum

Hedef: Stremio'nun seçili film/bölüm kimliğini kaynakta doğru içerikle eşleştirip oynatılabilir medya URL'si döndürmek. Mevcut sonuç: bu dört site için çalışan oynatım adaptörü yoktur.

10 Ekim 2026 son araştırma aracı denemesi:

| Kontrol | Sonuç |
| --- | --- |
| https://www.dizibox.live/ | Araştırma aracında HTTP 403 |
| https://dizi76.life/ | Araştırma aracında HTTP 403 |
| https://www.hdfilmcehennemi.nl/terms-use/ | Araştırma aracında HTTP 403 |
| https://dizipal1588.com/kullanim-kosullari | Araştırma aracında cache miss; izin belgesi okunamadı |

Bunlar kullanıcının normal tarayıcısında sitelerin erişilemez olduğunu kanıtlamaz. Önceki normal Windows kontrolünde Dizibox/DiziLife bölüm sayfaları okunmuş ve iframe'ler bulunmuştur. Son kaydedilmiş HTML/audit raporlarında doğrudan MP4/HLS URL'si doğrulanmamıştır. Scriptlerin veya iframe sorgu parametrelerinin varlığı DRM ya da koruma kanıtı değildir.

Stremio SDK handler, IMDb/season/episode ayrıştırma, paralel sağlayıcı araması, eşleştirme, medya doğrulama ve cache mevcut. Yetkili JSON arama API'leri için istek üzerine adaptör mevcut, fakat hiçbir hayalî site API adresiyle yapılandırılmamıştır. Genel adaptörün testlerinin geçmesi bu dört sitenin entegrasyonunun çalıştığı anlamına gelmez.

Tamamlama için gerekenler: erişilebilir ve doğrulanmış içerik arama yöntemi; doğru bölüm/film çözümlemesi; üçüncü taraf oynatıma izin verilmiş doğrudan medya bağlantısı veya belgelenmiş API; gerçek SDK stream ve Stremio görüntü/ses kontrolü. İlk kullanıcı talebindeki izin/erişim kontrolü kısıtları korunur. Çerez/oturum aktarma, Cloudflare/CAPTCHA aşma ve korumalı token çıkarma uygulanmaz.

Başarılı mevcut test paketi: 116 test, TypeScript, lint, format, build ve derlenmiş sunucu HTTP smoke kontrolleri. Bu dört kaynak için canlı oynatım doğrulaması: yok.
