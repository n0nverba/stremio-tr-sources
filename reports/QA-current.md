# Güncel doğrulama — 10 Ekim 2026

Bu rapor, QA.md içindeki ilk geliştirme denemelerine ait eksik bağımlılık durumunu günceller. Eski rapor geçmiş kayıt olarak korunmuştur.

- `npm run check`: başarılı. TypeScript, ESLint, 8 dosyada 109 test, production build ve gerçek derlenmiş Node sunucusunda manifest/movie/series/admin HTTP kontrolleri geçti.
- Bağımlılıklar ve package-lock.json mevcut.
- Kullanıcının paylaştığı son normal Windows oturumu çıktısında gerçek demo entegrasyonu 2/2 geçti. Bu oturumdaki kontrol, o canlı ağ ölçümünün yeni bir tekrarı değildir.
- Bu oturumda canlı entegrasyon tekrar denendi: 2 test başarısız. Medya bağlantısı `connect EACCES 8.47.69.5:443` ile engellendi; SDK bu durumda boş stream döndürdü. Bu sonuç başarı veya skip olarak gösterilmedi.
- Kullanıcının canlı benchmark'ı: 10 soğuk istek ortalama 191,25 ms, p95 209,69 ms; 10 cache hit ortalama 0,059 ms. Stremio görüntü/ses oynatımı ölçülmedi.

Çalışan medya adaptörü Big Buck Bunny demosudur (`tt1254207`). Film/dizi protokol endpointlerinin çalışması, tüm film ve dizilerin mevcut olduğu anlamına gelmez. Canlı dizi sağlayıcısı yoktur.

Dizibox ve DiziLife için son source-probe.json raporunda katalog ve örnek bölüm HTML sayfaları okunmuştur. Oynatıcı iframe'lerinin bulunması bir MP4/HLS bağlantısının veya üçüncü taraf oynatma izninin doğrulandığı anlamına gelmez. Bu kaynakların stream adaptörleri henüz yoktur. HDFilmCehennemi ve Dizipal de aktif stream sağlayıcısı değildir.

Yönetim panelinde bu dört kaynağın durumu ilk yüklemede gösterilir; Dizibox/DiziLife için eski 403 açıklaması kaldırılmıştır. Çalışan sunucunun yeni kodu kullanması için yeniden başlatılması gerekir.

Başlatma: `npm run dev`. Production: `npm run build`, ardından `npm start`.

Yerel panel: http://127.0.0.1:7000/admin/

Stremio kurulum adresi: http://127.0.0.1:7000/manifest.json
