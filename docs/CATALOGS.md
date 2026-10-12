# Film ve dizi katalogları

Eklenti v1.1.0, Stremio catalog, meta ve stream kaynaklarını sunar. Keşfet ekranında **TR · Tüm Filmler**, **TR · Tüm Diziler** ve her kayıtlı sağlayıcının film/dizi listeleri bulunur. Bir sağlayıcıda ilgili tür yoksa liste boş döner.

- DiziBOX: mevcut yerel indeksin tüm kayıtları, başlık araması ve skip sayfalaması. İndeks şu anda 4.811 kayıt içerir; kaynak dosyanın complete alanı false olduğundan tüm sitenin eksiksiz kopyası olduğu iddia edilmez. İndeksi yenilemek için mevcut dizibox:index komutunu kullanın. Yerel indeks yoksa public listelemeye başvurulur.
- HDFilmCehennemi ve DiziLife: public film/dizi sayfaları, kaynak araması, HTML'deki sonraki sayfa bağlantılarını izleyen listeleme. Bir istek en fazla 50 kart döndürür; bu toplam katalog sınırı değildir. Yalnızca HTML'de yayınlanan kayıt ve sayfalama bağlantıları keşfedilebilir; JavaScript ile yüklenen gizli katalog API'leri varsayılmaz.
- Dizipal: public başlık kataloğu. Oynatma adaptörü bulunmadığından stream sonucu boştur.
- Blender demo: Big Buck Bunny film kartı.
- JSON sağlayıcıları: tanımlı kataloğun bütün kayıtları. Aynı dizinin bölümleri tek kart altında gruplanır.
- search-api sağlayıcıları: listeleme için isteğe bağlı catalogUrl ekleyin. Yalnızca içerik araması sunan bir API'den bütün katalog türetilemez. Mevcut stream araması çalışmaya devam eder.

Birleşik katalog sağlayıcıları sırayla iç içe listeler. Aynı başlık farklı kaynaklarda ayrı kart olarak bulunabilir. Devre dışı bırakılan sağlayıcılar liste, meta ve stream sonuçlarına dahil edilmez. Kaynak hataları diğer sağlayıcıları durdurmaz; yönetim panelinde CATALOG_FAILED olarak kaydedilir.

İçerik kimlikleri tr:provider:base64url(pageUrl) biçimindedir ve sunucu yeniden başlatıldığında da çalışır. Ayrıntı isteğinde sağlayıcı alan adı ve içerik yolu kontrol edilir. Dizi bölüm kartları yalnızca kaynakta bulunan gerçek sezon/bölüm bağlantılarından üretilir. Film ve bölüm oynatma sonuçları mevcut medya doğrulama ve dil/kalite tercihlerinden geçer.

## Güncellemeyi kullanma

Sunucuyu yeniden başlatın. Stremio'daki eski eklentiyi kaldırın ve http://127.0.0.1:7000/manifest.json adresinden yeniden ekleyin; Stremio kurulu eklentinin manifest kataloğunu önbellekte tutabilir.

## Doğrulama sınırları

Arama, sayfalama, provider izolasyonu, kaynak kimlikleri, bölüm seçimi ve SDK endpointleri yerel fixture testleriyle doğrulanır. Bu ortamın dış ağ erişimi engellendiğinden bütün sağlayıcıların canlı katalog kapsamı ve Stremio GUI görünümü doğrulanamaz. Bir başlığın katalogda görünmesi oynatma bağlantısının çalıştığını garanti etmez.
