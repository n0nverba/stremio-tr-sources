<div align="center">

# 🍿 Stremio TR Sources

### Stremio için Türkçe Dublaj ve Türkçe Altyazılı En Kapsamlı Açık Kaynak Eklenti

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%20LTS-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Stremio](https://img.shields.io/badge/Stremio-Addon-6c5ce7?style=for-the-badge&logo=stremio&logoColor=white)](https://stremio.com/)
[![CI](https://img.shields.io/badge/CI-Passing-brightgreen.svg?style=for-the-badge&logo=githubactions&logoColor=white)](.github/workflows/ci.yml)

<p align="center">
  <b>Film Makinesi</b> • <b>DiziBOX</b> • <b>HDFilmCehennemi</b> • <b>DiziLife</b> • <b>Dizipal</b>
</p>

> 🌟 **Projeyi beğendiyseniz sağ üst köşeden bir yıldız (Star) vererek destek olmayı unutmayın!** Daha fazla Türkçe kaynağın eklenmesine ve projenin büyümesine yardımcı olur.

---

</div>

## 📌 İçindekiler
- [✨ Özellikler](#-özellikler)
- [🎬 Desteklenen Kaynaklar](#-desteklenen-kaynaklar)
- [📱 Stremio Akış Görünümü](#-stremio-akış-görünümü)
- [🚀 Hızlı Kurulum (Windows)](#-hızlı-kurulum-windows)
- [🐳 Docker Kurulumu (Linux / Mac / NAS)](#-docker-kurulumu-linux--mac--nas)
- [🎛️ Yönetim Paneli](#️-yönetim-paneli)
- [🤝 Katkıda Bulunma](#-katkıda-bulunma)
- [❓ Sıkça Sorulan Sorular (SSS)](#-sıkça-sorulan-sorular-sss)
- [🌐 English Summary](#-english-summary)

---

## ✨ Özellikler

* 🇹🇷 **Türkçe Dublaj & Altyazı Desteği:** Kaynaklardaki ses parçaları (Dual-Audio) ve VTT altyazılar otomatik tespit edilir; Stremio'da ayrı ayrı rozetlerle listelenir.
* 🚀 **"Kur ve Unut" Otomatik Başlatma:** Windows başlangıcına eklenir ve arka planda **tamamen sessiz ve penceresiz** çalışır. Bilgisayarınızı her açtığınızda hazırdır.
* 🧠 **Akıllı Çok Dilli Wikidata Eşleştirmesi:** Dünya sineması (Kore, Danimarka, Fransız, İspanyol vb.) yapımlarının Türkçe sitelerdeki orijinal/yerel adları Wikidata API üzerinden otomatik çözümlenir. Başlık uyuşmazlığı nedeniyle bulunamayan yapım kalmaz!
* 🛡️ **Yerleşik HLS Proxy:** Cloudflare korumalı, referer zorunlu ve AES-128 şifreli akışlar yerel proxy üzerinden Stremio oynatıcısına kayıpsız aktarılır.
* 📱 **Ev İçi Ağ (Wi-Fi / LAN) Desteği:** Aynı Wi-Fi'ye bağlı Android TV, telefon veya tabletlerinizden doğrudan izleyebilirsiniz.
* 🔄 **Otomatik Güncelleme Desteği:** Her başlangıçta GitHub'daki en son yenilikleri kontrol eder; `Guncelle.cmd` veya Yönetim Paneli üzerinden tek tıkla kendini günceller.
* 🎛️ **Modern Web Yönetim Paneli:** `http://127.0.0.1:7000/admin/` üzerinden kaynakları açıp kapatabilir, gecikme sürelerini izleyebilir ve önbelleği temizleyebilirsiniz.
* 🧪 **149+ Otomatik Test:** Sağlam, kurşun geçirmez ve her zaman test edilmiş mimari.

---

## 🎬 Desteklenen Kaynaklar

| Kaynak | Tür | Çözünürlük | Ses / Altyazı | Durum |
| :--- | :--- | :--- | :--- | :---: |
| **Film Makinesi** | Film & Mini Dizi | 1080p Full HD | 🇹🇷 Dublaj & 💬 Altyazı | 🟢 Aktif |
| **DiziBOX** | Dizi & Film | 1080p Full HD | 🇹🇷 Dublaj & 💬 Altyazı | 🟢 Aktif |
| **HDFilmCehennemi** | Film & Dizi | 1080p Full HD | 🇹🇷 Dublaj & 💬 Altyazı | 🟢 Aktif |
| **DiziLife** | Dizi | 1080p Full HD | 🇹🇷 Dublaj & 💬 Altyazı | 🟢 Aktif |
| **Dizipal** | Katalog & Arama | Meta / Arama | Keşif & Listeleme | 🟢 Aktif |

---

## 📱 Stremio Akış Görünümü

Stremio'da bir film veya dizi açtığınızda akışlar şu şekilde listelenir:

```text
┌─────────────────────────────────────────────────────────────────┐
│ 💬 TR Altyazı                                                   │
│ 1080p                                                           │
│ FILM MAKINESI • 1080p | Türkçe Altyazı (HLS)                     │
├─────────────────────────────────────────────────────────────────┤
│ 🇹🇷 TR Dublaj                                                    │
│ 1080p                                                           │
│ DIZIBOX • 1080p | Türkçe Dublaj (HLS)                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Hızlı Kurulum (Windows)

Hiçbir kodlama veya komut satırı bilgisine gerek yoktur!

### 1. Adım: İndirin
Projeyi [Releases](https://github.com/n0nverba/stremio-tr-sources/releases) sayfasından veya yeşil **Code -> Download ZIP** butonundan indirin ve klasöre çıkarın.

### 2. Adım: Kurun
Klasördeki **`Kurulum.cmd`** dosyasına çift tıklayın.
* Gerekli dosyaları derler.
* Windows Başlangıç klasörüne ekler.
* Eklentiyi arka planda sessizce başlatır.
* Stremio'yu açar.

### 3. Adım: Stremio'da Yükleyin
Stremio ekranında açılan **"Yükle" (Install)** butonuna tıklayın.

🎉 **Tebrikler!** Artık bilgisayarınızı her açtığınızda eklenti arka planda otomatik çalışır. Stremio hesabınız üzerinden aynı hesaba bağlı **telefon, tablet ve televizyonunuzda** da anında çalışır!

---

## 🛠️ Yardımcı Araçlar (Windows)

| Dosya | Görevi |
| :--- | :--- |
| **`Kurulum.cmd`** | Tek tıkla tam kurulum (başlangıç servisi ve Stremio kurulum ekranı açılışı). |
| **`Guncelle.cmd`** | GitHub'daki en son güncellemeleri ve yeni kaynakları tek tıkla indirip derler. |
| **`Durum-Kontrol.cmd`** | Eklenti çalışıyor mu kontrol eder ve yönetim panelini açar. |
| **`Durdur.cmd`** | Arka planda çalışan eklentiyi kapatır. |
| **`Kaldir-Otomatik-Baslat.cmd`** | Otomatik başlatmayı Windows'tan tamamen kaldırır. |
| **`Stremio-TR-Baslat.cmd`** | Konsol ekranında görünür şekilde tek seferlik başlatır. |

---

## 🐳 Docker Kurulumu (Linux / Mac / NAS)

Linux, macOS veya Synology/QNAP NAS kullanıcıları için Docker Compose desteği:

```bash
# 1. Depoyu indirin
git clone https://github.com/n0nverba/stremio-tr-sources.git
cd stremio-tr-sources

# 2. Arka planda başlatın
docker compose up -d
```

Ardından Stremio uygulamasında Eklentiler (Addons) arama çubuğuna şu adresi yapıştırın:
```text
http://127.0.0.1:7000/manifest.json
```

---

## 🎛️ Yönetim Paneli

Eklenti çalışırken tarayıcınızdan **`http://127.0.0.1:7000/admin/`** adresine giderek:
* İstemediğiniz sağlayıcıları tek tıkla kapatabilir,
* Dil tercihlerinizi (Yalnızca Dublaj / Yalnızca Altyazı / Tümü) ayarlayabilir,
* Önbelleği temizleyebilir ve sağlık durumlarını anlık izleyebilirsiniz.

---

## 🤝 Katkıda Bulunma

Bu proje topluluğun katkılarıyla büyümektedir!
* Yeni bir Türkçe dizi/film sitesi eklemek mi istiyorsunuz?
* Bir hata mı buldunuz?

Ayrıntılı rehber için lütfen **[CONTRIBUTING.md](CONTRIBUTING.md)** dosyasını inceleyin. Yeni bir sağlayıcı eklemek yalnızca birkaç düzine satır TypeScript kodundan ibarettir!

---

## ❓ Sıkça Sorulan Sorular (SSS)

<details>
<summary><b>Bilgisayarı her açtığımda tekrar başlatmam gerekir mi?</b></summary>
Hayır! <code>Kurulum.cmd</code> dosyasını bir kez çalıştırdıysanız, Windows her açıldığında eklenti arka planda sessizce kendi kendine başlar.
</details>

<details>
<summary><b>Neden bir bulut linki yerine kendi bilgisayarımda çalışıyor?</b></summary>
Türk film siteleri video trafiğini ve IP adreslerini sürekli kısıtlar. Eklenti kendi bilgisayarınızda çalıştığında doğrudan ev internetiniz üzerinden bağlandığı için IP engellerine takılmaz ve video trafiği sunucu kotası olmadan hızlıca akar.
</details>

<details>
<summary><b>Android TV veya Telefonda nasıl kullanabilirim?</b></summary>
Stremio'nun hesap senkronizasyonu sayesinde ekstra bir ayar yapmanıza gerek yoktur:
1. Bilgisayarınızda <code>Kurulum.cmd</code> dosyasını çalıştırıp Stremio'ya kurun.
2. Telefonunuzda veya Android TV'nizde aynı Stremio hesabıyla oturum açtığınızda eklenti otomatik olarak cihazlarınıza gelir.
3. Bilgisayarınız açık olduğu sürece tüm cihazlarınızdan kesintisiz izleyebilirsiniz!
</details>

---

## 🌐 English Summary

**Stremio TR Sources** is an open-source, self-hosted Stremio addon providing high quality Turkish Dubbed (`tr-dub`) and Turkish Subtitled (`tr-sub`) streams for movies and TV series.

* **Key Features:** Built-in HLS proxy with AES-128 support, Wikidata multi-language metadata resolution, dual-audio track detection, web admin dashboard, and 1-click Windows startup installer.
* **Quickstart:** Clone the repo, run `npm install && npm start`, and add `http://127.0.0.1:7000/manifest.json` to Stremio.

---

## 📜 Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında açık kaynak olarak yayınlanmıştır.
Bu yazılım herhangi bir video içeriğini barındırmaz veya depolamaz; yalnızca herkese açık web sitelerindeki medya indekslerini Stremio uyumlu JSON formatında sunar.
