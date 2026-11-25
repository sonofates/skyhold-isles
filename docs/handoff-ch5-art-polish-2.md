# Tutulma Gökleri · i40–i42 görsel rötuşu

Çalışma dalı `ch5-polish2`, teslim alınan revizyon `204de95e`. Bu revizyon `art-2d` üzerindeki `af731ac5` planını ve i40–i42’nin onaylı yerleşimlerini içeriyor. Üç yerleşim JSON’u kapı dikdörtgenleri dâhil başlangıç revizyonuyla bayt düzeyinde eşleşiyor.

| Ada | Görsel değişiklik |
| --- | --- |
| [i40 · Yıldız Düşüğü](../public/art2d/map-i40-layered@1x.webp) | Mavi göktaşı parçalarından turuncu damarlar krater tabanına uzanıyor. Ölçüm bayrakları, iki vagonlu kısa maden hattı ve doğudaki mangal kazı alanını tanımlıyor. Kül yolunda aşınma izleri dönüşleri izliyor, aralıklı cüruf ceplerinde köz parlıyor. Girişteki ahşap payandalar, fener ve kırık göktaşı yüzeyi eski eşiğe oturuyor. |
| [i41 · Güneş Saati Harabesi](../public/art2d/map-i41-layered@1x.webp) | Yolun sarısı, taş derzlerinin ve mil gölgesinin aydınlık değerleri korunarak yıpranmış kumtaşına çekildi. 1× kayıpsız kompozit karşılaştırmasında yol maskesi dışındaki 1.464.434 pikselin tamamı aynı. |
| [i42 · Zincir Burcu](../public/art2d/map-i42-layered@1x.webp) | İki giriş ve ortak yokuş aynı aşınmış demir levhalarla döşendi. Perçin çiftleri, kısa pas akıntıları ve fener yansımaları dönüşleri belirginleştiriyor. Batıda kopmuş çapa halkaları, doğuda ızgara, tamburun altında sürüklenme izleri, teknenin üzerinde su birikintileri ve yanık döküntü var. |

## Kaynaklar ve paket

Yerleşik ImageGen’in iki zemin boyaması, iki yol ve maden ağzı rötuşu Eclipse kaynak kitinde. i40’ın son kül resmi telefon boyutundaki ilk kompozitin üzerinden boyandı ve yol boyunca serilen tek şeride açıldı. i42’nin boyası iki kol ile birleşme noktasına hizalı bir plaka. [İstemler ve sanat kararları](../design/art-2d/chapter5/islands.md) · [Kaynak kit](../design/art-2d/v2/biomes/eclipse/)

Ortak birleştiricideki tek ek, yolun doygunluğunu maskelemeden hemen önce uygulayan isteğe bağlı `roadSaturation` ayarı. Yalnız i41 bu ayarı `0.46` ile kullanıyor. Böylece özgün döşeme resmi hem gölgeyi hem de kapı içine yansıyan ışık rengini sağlamaya devam ediyor. [Birleştirici](../tools/map-compose/compose.py) · [Üç adanın tarifleri](../tools/map-compose/campaign.json)

12 harita varyantı ve iki ölçekte 16 kapı/kale ön katmanı mevcut manifest anahtarlarından yükleniyor. Her dosyanın çözülen boyutu, her ön katmanın alfa kanalı ve yerleşimdeki dikdörtgeni denetlendi. 28 WebP’nin toplamı 8.706.214 bayttan 8.600.620 bayta indi. Dağıtım kopyaları ve manifest kaynaklarıyla bayt düzeyinde eşleşiyor. Üç hareket maskesini yeni kit ile yeniden ürettiğimde üçü de yayımlanan maskeyle piksel piksel eşleşti. [Manifest](../public/art2d/manifest.json)

## Doğrulama

```sh
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-compose/rebake_all.py i40,i41,i42 --jobs 1
node qa/plotCoverCheck.mjs --layout-only --ids=i40,i41,i42
```

Yerleşim kontrolü dört çözünürlükte boş ve üç eşyalı kemerle 24/24 geçti. Örtülen inşa alanı sıfır. 844 × 390 telefon kadrajında paketlenmiş haritalara oyunun 17’şer inşa halkasını yerleştirip dekor açıklıklarını inceledim. Kapılar ve kale yaklaşımı dışarıda bırakıldığında yol içi / altındaki çıplak zeminin ortanca gri değeri i40’ta 122 / 67, i41’de 180 / 76, i42’de 113 / 60. Aynı örneklemde i41 yolunun ortanca doygunluğu 255 üzerinden 107’den 53’e indi.

| Node 22.23.4 ile kontrol | Sonuç |
| --- | --- |
| `npx tsc --noEmit` ve `npm run lint` | Geçti. |
| `npx vitest run --maxWorkers=1` | 148 dosyada 2.059 test geçti. İki dosya ve 15 test atlandı. |
| `npm run sim:balance` | 59 seviye geçti. Normal ilk zaferde i40, i41 ve i42 sırasıyla 3, 2 ve 1 can bıraktı. İlk komut SIGTERM ile kesildi, baştan çalıştırılan tam koşu geçti. |
| `npm run sim:items -- --workers=2` | Yedi kontrol geçti. Normal zorlukta iki eşya kemeri profili de 43/43 zafer aldı. |
| `npm run sim:difficulty` | 12 kontrol geçti. Kampanya zaferleri Kolay’da 43/43, Normal’de 43/43, Zor’da 17/43. |
| `npm run build` | Üretim derlemesi geçti. Vite, parça boyutu ve iki dinamik içe aktarım için uyarı verdi. |

## Açık kontrol

Sandbox Chromium’u engelliyor. Canlı savaşta HUD, hareketli düşmanlar ve maden ağzından çıkış için cihaz üzerinde görsel kontrol açık.
