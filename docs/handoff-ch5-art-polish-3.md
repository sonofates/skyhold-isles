# Tutulma Gökleri · i43–i45 görsel rötuşu

Çalışma ağacı `ch5-polish3` dalında, `4fdbb9ca` revizyonundan açıldı. Bu revizyon `af731ac5` planını, onaylı üç yerleşimi ve son denge ayarını içeriyor. Üç adanın yerleşim JSON’ları ve dalga dosyaları başlangıç revizyonuyla bayt düzeyinde eşleşiyor.

| Ada | Boyalı yol ve sahne |
| --- | --- |
| [i43 · İlk Ocak](../public/art2d/map-i43-layered@1x.webp) | Değişken büyüklükteki ocak taşlarının çatlaklarında köz parlıyor. Dev örsün altında maşalı bir su teknesi, alt dönüşte soğuyan külçeler var. Batı zemini fırın ışığını yansıtıyor, doğuda koyu tufal ve bakır döküntüsü birikiyor. |
| [i44 · Işık Arşivi](../public/art2d/map-i44-layered@1x.webp) | İnce altın kakma iki kolun mermer kenarını izliyor. Döşemede aşınmış mozaik ve birkaç yaprak görülüyor. Devrilmiş rafın kitapları erguvan renkli kilime saçılmış. Orta madalyonun öte yanında açık defterden sayfalar havalanıyor. |
| [i45 · Tutulma Tahtı](../public/art2d/map-i45-layered@1x.webp) | Üç girişten uzanan obsidyen döşeme, göğün morunu ve mangalların altın ışığını yansıtıyor. Kırık sütun ve düşmüş sancak iki ayrı açıklıkta duruyor. Işık huzmeleri avluyu kesiyor. Tahtın üstündeki kara güneşin çemberi iki telefon kadrajına da sığıyor. |

## Kaynak ve yeniden üretim

Yerleşik ImageGen, ada başına bir yol ve dekor boyaması ile bir çıplak zemin boyaması üretti. i45’in kuzey göğü telefon kadrajı için tekrar boyandı. Altı WebP kaynak plakası Eclipse kitinde. Üç yolun her biri 1846 × 852 yerleşim koordinatlarına hizalı tek resim. Güzergâh kolları ve kavşaklar bu resimde birleşiyor. Üç ada tarifinde `roadPlate` seçili. Altı yeni dekorun görünür silüetleri yerleştirilirken kule pedlerinin ve yolun çevresinde en az dört yerleşim pikseli pay bırakıldı. [İstemler ve sanat kararları](../design/art-2d/chapter5/islands.md) · [Kaynak kit](../design/art-2d/v2/biomes/eclipse/) · [Birleştirme tarifleri](../tools/map-compose/campaign.json)

```sh
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-compose/rebake_all.py i43,i44,i45 --jobs 1
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-life/gen_eclipse_masks.py i43 i44 i45
node qa/plotCoverCheck.mjs --layout-only --ids=i43,i44,i45
```

Mevcut manifest anahtarları dört ölçekte 12 haritayı ve iki ölçekte 18 kapı/kale ön katmanını çözüyor. Her WebP açılarak boyutları, ön katmanların alfa kanalları ve kayıtlı dikdörtgenleri denetlendi. i43 ısı maskesi yeni ocak boyasından üretildi ve iki test dosyası güncellendi. i44 ve i45’in bulut maskeleri yeniden üretimde mevcut dosyalarla eşleşti. Üç maske dâhil 33 WebP’nin toplamı 10.094.460 bayttan 8.694.578 bayta düştü. Dağıtım kopyaları ve manifest kaynaklarıyla bayt düzeyinde eşleşti. [Görsel manifesti](../public/art2d/manifest.json)

## Telefon kontrolü

Oyunun kamera hesabı ve gerçek kule pedi görseliyle üç paketlenmiş harita 844 × 390 kadrajında incelendi. Aynı kadrajın gri tonlu görüntüsünde yol ortası ile dönüşe dik yönde 42 yerleşim pikseli ötedeki açık zemin karşılaştırıldı. Tablo, 0–255 ölçeğindeki mutlak parlaklık farkını gösteriyor. Kapılar, pedler, yeni dekorlar ve bitişik yol kolları örneklem dışında tutuldu.

| Ada | Önceki ortanca fark | Yeni ortanca fark |
| --- | ---: | ---: |
| i43 | 28 | 80 |
| i44 | 34 | 115 |
| i45 | 48 | 61 |

i45’in koyu obsidyeni açık renkli terastan ayrılıyor. 844 × 390 ve 932 × 430 kadrajlarında güneşin üst çemberi ile ekran kenarı arasında yaklaşık dört CSS pikseli var. Yerleşim kontrolü 2000 × 991, 1440 × 900, 844 × 390 ve 932 × 430 boyutlarında boş ve üç eşyalı kemerle 24/24 geçti. 51 kule pedinde HUD örtüşmesi sıfır.

## Proje kontrolleri

Kontroller Node 22.23.4 ile çalıştı. Vitest ve Vite için kilit dosyasındaki Rolldown 1.2.19 Linux bağlayıcısı yerel kurulumdan `NODE_PATH` üzerinden yüklendi.

| Kontrol | Sonuç |
| --- | --- |
| `npx tsc --noEmit`, `npm run lint`, `git diff --check` | Geçti. |
| `npx vitest run --maxWorkers=1` | 152 dosyada 2.130 test geçti. İki dosya ve 19 test atlandı. |
| `npm run sim:balance` | 62 seviye geçti. Normal ilk zaferde i43, i44 ve i45 sırasıyla 4, 3 ve 2 can bıraktı. |
| `npm run sim:items -- --workers=2` | Yedi denetim geçti. Normal’de iki kemer profili de 46/46 zafer aldı. İlk çalıştırma SIGTERM ile kesildi, ayrı başlatılan tam koşu sıfır çıkış koduyla tamamlandı. |
| `npm run sim:difficulty` | 13 denetim geçti. Kampanya zaferleri Kolay’da 46/46, Normal’de 46/46 ve Zor’da 17/46. |
| `npm run build` | Üretim derlemesi geçti. Vite paket boyutu ve iki dinamik içe aktarım için uyarı verdi. |

## Açık kontrol

Sandbox Chromium’u engelliyor. Canlı savaşta hareketli düşmanların yol ve kapı katmanlarıyla birlikte görünümü cihaz üzerinde doğrulanmalı.
