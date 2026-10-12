# İstek üzerine içerik arama

Stremio film/bölüm seçildiğinde SDK stream handler'ını çağırır. Akış: kimlik ayrıştırma → metadata → aktif sağlayıcılarda içerik arama → güvenli eşleştirme → medya doğrulama → Stremio stream JSON. Tüm siteyi indirmek bu akışın ön koşulu değildir.

Yeni `AuthorizedSearchProvider`, izinli bir JSON arama API'sine yalnızca seçilen içerik için GET isteği yapar. `data/providers.json` içinde `adapter: "search-api"` ve `searchUrl` kullanılır; `catalogUrl` kullanılmaz. Diğer id/name/enabled/policy alanları mevcut yetkili HTTP sağlayıcısıyla aynıdır. Arama adresi gerçek ve doğrulanmış olmalıdır; örnek veya tahmin edilmiş adres etkinleştirilmez.

İstek parametreleri:

| Alan            | Değer                                      |
| --------------- | ------------------------------------------ |
| type            | movie veya series                          |
| imdbId          | Stremio'dan gelen tt kimliği               |
| title           | Metadata varsa film/dizi başlığı           |
| year            | Metadata varsa yayın yılı                  |
| season, episode | Yalnızca dizilerde tam bölüm koordinatları |

Yanıt mevcut `catalogSchema` ile aynı `{ "items": [...] }` biçimini kullanır, fakat tüm katalog yerine arama sonuçlarını içerir. Her item title/mediaType/pageUrl, mümkünse externalId/year, dizide season/episode ve streams taşımalıdır. API yanıtı eşleşme motorundan ve medya URL doğrulamasından geçer; kaynak söyledi diye başka film/bölüm oynatılmaz.

Arama ve çözümleme aynı kısa süreli yanıtı kullanır. Medya yanıtı eskidiğinde yalnızca aynı içerik sorgusu yenilenir. Tekrarlanan SDK istekleri çekirdek stream cache ve single-flight mekanizmasından yararlanır. IMDb bilgisi olmayan başlık aramalarında metadata gerekir; `.env` içindeki `REMOTE_METADATA=true` opsiyonel Cinemeta çözümlemesini açar. Uzak metadata başarısız olursa yalnızca güvenilir exact IMDb eşleşmeleri çalışmaya devam eder.

Bu adaptör Dizibox API'si değildir. Dizibox'ın doğrulanmış arama/medya sözleşmesi ve üçüncü taraf oynatım izni henüz yoktur; registry'de unsupported kalır. `reports/dizibox-catalog.json` yalnızca araştırma envanteridir ve stream isteği sırasında okunmaz.

Doğrulama: test arama API'siyle SDK seçiminin tek hedefli istek oluşturması, cache hit, doğru bölüm parametreleri, medya yanıtı yenileme, hatalı host/izin ve yanlış bölüm reddi test edilir. Bu testler canlı Dizibox oynatımının kanıtı değildir.
