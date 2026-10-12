# 🤝 Stremio TR Sources Katkı Rehberi (Contributing Guide)

Öncelikle projeye katkı sunmak istediğiniz için teşekkür ederiz! Stremio TR Sources, topluluğun desteği ve yeni sağlayıcıların eklenmesiyle büyüyen açık kaynaklı bir projedir.

---

## 🛠️ Geliştirme Ortamı Kurulumu

Projeyi yerelinizde çalıştırmak için:

1. **Depoyu çatallayın (Fork) ve klonlayın:**
   ```bash
   git clone https://github.com/n0nverba/stremio-tr-sources.git
   cd stremio-tr-sources
   ```

2. **Bağımlılıkları yükleyin:**
   ```bash
   npm install
   ```

3. **Geliştirici modunu başlatın:**
   ```bash
   npm run dev
   ```

4. **Testleri çalıştırın:**
   ```bash
   npm test
   npm run typecheck
   ```

---

## 🚀 5 Adımda Yeni Bir Kaynak (Provider) Ekleme

Proje, yeni kaynak eklemeyi olabildiğince kolaylaştıran modüler bir arayüze sahiptir.

### 1. Dosya Oluşturun
`src/providers/` dizininde yeni bir dosya açın (örn: `src/providers/ornek-provider.ts`).

### 2. `MediaProvider` Arayüzünü Uygulayın
```typescript
import type { MediaProvider } from './base.js';
import type {
  MovieQuery,
  EpisodeQuery,
  MediaResult,
  ResolvedStream,
  ProviderPolicy,
  ProviderContext,
} from '../types/index.js';
import { safeHttp, type HttpTransport } from '../utils/safe-http.js';

export class OrnekProvider implements MediaProvider {
  readonly id = 'ornek';
  readonly name = 'Örnek Film & Dizi';
  enabled = true;

  readonly policy: ProviderPolicy = {
    allowedHosts: ['ornekfilm.com', '*.ornekfilm.com', 'cdn.ornek.com'],
    authorization: {
      kind: 'explicit-permission',
      evidenceUrl: 'https://ornekfilm.com',
      attribution: 'Örnek Film · Türkçe Dublaj & Altyazı',
    },
    timeoutMs: 10000,
  };

  constructor(private readonly http: HttpTransport = safeHttp) {}

  async searchMovie(query: MovieQuery, context?: ProviderContext): Promise<MediaResult[]> {
    // Sitede film ara ve MediaResult[] döndür
    return [];
  }

  async searchEpisode(query: EpisodeQuery, context?: ProviderContext): Promise<MediaResult[]> {
    // Sitede dizi bölümü ara ve MediaResult[] döndür
    return [];
  }

  async resolveStreams(media: MediaResult, context?: ProviderContext): Promise<ResolvedStream[]> {
    // Sayfadaki video oynatıcısını/HLS linkini çöz ve ResolvedStream[] döndür
    return [];
  }
}
```

### 3. Registry'ye Kaydedin
`src/providers/registry.ts` dosyasını açıp yeni sağlayıcınızı `createRegistry` fonksiyonunda kaydedin:
```typescript
import { OrnekProvider } from './ornek-provider.js';

// ...
registry.register(new OrnekProvider());
```

### 4. Test Edin
Yeni sağlayıcınız için testler ekleyin veya `npm test` ile mevcut testlerin bozulmadığından emin olun.

### 5. Pull Request Açın!
Değişikliklerinizi commit edip GitHub üzerinden `main` dalına Pull Request gönderin. CI robotumuz testlerinizi otomatik olarak doğrulayacaktır.

---

## 💡 Kod Standartları

* **TypeScript Strict Mode:** Tüm kodlar katı tiplerle yazılmalıdır (`any` kullanımından kaçının).
* **Güvenli Ağ Erişimi:** Harici sitelere istek atarken doğrudan `fetch` yerine daima projenin sağladığı `safeHttp` transportunu kullanın (SSRF ve DNS rebinding koruması için).
* **Temiz Loglama:** Kullanıcı token'larını veya hassas verileri asla konsola yazdırmayın.

Katkılarınız için şimdiden çok teşekkürler! ⭐
