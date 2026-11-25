# Tutulma Gökleri · i37–i39 görsel rötuşu

Taban `art-2d` / `a4c2c8a8`. Üç adanın da oynanış yerleşimi tabanla bayt düzeyinde aynı. Yeni resimler yerleşik ImageGen ile üretildi ve mevcut `tools/map-compose` hattından geçirildi. [Görsel istemleri](../design/art-2d/chapter5/islands.md)

## Görsel karşılaştırma

i17’de açık toprağın kenarı çime karışıyor. i31’de köprü tahtaları sıkışmış toprağa bağlanıyor. i32’de taş çatlakları, i34 ve i36’da örgü derzleri yolu kısa bir kesitte bile tarif ediyor. Eski i37–i39’da telefon boyutuna inince yolun içindeki malzeme kayboluyor, yalnızca sarı, somon ve turuncu şeritler kalıyordu.

| Ada | Önce | Sonra |
| --- | --- | --- |
| [i37 · Alacakaranlık İskelesi](../public/art2d/map-i37-layered@1x.webp) | Düz mor avlu, sarı yol ve üst kenarda kadrajdan kesilen vinç. | Solda yırtık yelkenli bir gök kayığı, üstte mor göğe karşı kopmuş zinciri okunan vinç, sağda ikinci kayık ve sandık yığını var. Islak tahta ve mor taş döşemede fener yansımaları görülüyor. Yolun çakılı enine tahtaları, taş sıraları ve yer yer aydınlanan kenarları dönüşleri izliyor. |
| [i38 · Kırık Adacıklar](../public/art2d/map-i38-layered@1x.webp) | İki köprüye somon renkli tekdüze bir yol bağlanıyordu. | Çentikli mor arduvazların derzleri, açık aşınma yüzleri ve yer yer ışık sızan çatlakları var. Kayaların düz alanlarında kuvars döküntüsü ve liken görünüyor. Giriş ağzını açık söveler, iki fener ve bakır lento içindeki mavi kristal belirginleştiriyor. |
| [i39 · Gölge Korusu](../public/art2d/map-i39-layered@1x.webp) | İki koldan gelen turuncu yol ve karanlıkta kaybolan mahzen girişleri. | Sıkışmış toprağı yosun çevreliyor. Birkaç iri kök virajları takip ediyor. Mavi-yeşil mantar kümeleri iki kolu ve birleşme noktasını, bal rengi küme kaleye yaklaşımı aydınlatıyor. Açıklıkta yaprak, kök ve çürümüş kütük var. İki mahzenin de girişini açık renk kök kemeri ve iri raf mantarları çerçeveliyor. |

844 × 390’a küçültülmüş resimde yolun iç kısmıyla aynı noktaların çıplak zeminini karşılaştırdım. Kapıları, kaleyi ve köprüleri örneklem dışında tuttum. 0–255 gri ölçekte ortanca yol / zemin değeri i37’de **113 / 74**, i38’de **117 / 78**, i39’da **91 / 53**. Ayrıca üç resmin üstüne yerleşimdeki 17’şer inşa halkasını çizip dekor açıklıklarını inceledim.

## Önce / sonra dosya listesi

Aşağıdaki `i{37,38,39}` gösterimi üç kimliğin her birini kapsar. Kaynak kitin kökü `design/art-2d/v2/biomes/eclipse/`.

| Dosya veya dosya ailesi | Önce | Sonra |
| --- | --- | --- |
| Kaynak kitte `terrain-i{37,38,39}.webp` | İlk zemin resimleri | Baştan boyanan iskele ve iç alanlarına yerel boya uygulanan iki ada |
| Kaynak kitte `tex-i{37,38,39}.webp` | Üç küçük kare doku | i37’de tahta ve taş şeridi, i38’de arduvaz şeridi, i39’da iki kolu ve ortak çıkışı içeren kayıtlı yol resmi |
| Kaynak kitte `finish-i38-e.webp`, `finish-i39-e.webp`, `finish-i39-w.webp` | Yok | Mevcut kapı silüetine ve açıklığına oturtulan üç renk katmanı |
| `tools/map-compose/campaign.json` | Üç adada da kare doku döşemesi | Yalnız bu üç kimliğin görsel tarifi. İlk iki yol eğri boyunca seriliyor, koru resmi onaylı yol maskesiyle kesiliyor. |
| `public/art2d/map-i{37,38,39}-layered{,@1x,@1.5x,@3x}.webp` | 12 eski harita | Aynı adlarla 12 yeni harita. Eksiz dosya 2× ana görsel. |
| `public/art2d/map-i{37,38,39}-layered-gate-{A,goal}{,@3x}.webp` ve `map-i39-layered-gate-B{,@3x}.webp` | 14 eski ön katman | Yeni kompozitten kesilen 14 ön katman. Alfa kanalları tabanla piksel piksel aynı. |
| `tools/map-life/gen_eclipse_masks.py`, `public/art2d/life/i{37,38,39}-sway.webp` | i37’de yalnız iskele altındaki eski bulut aralıkları hareketliydi. | i37’de sol kayığın arkası, vincin açıklığı ve iskele altındaki yeni bulut aralıkları maskelendi. i38 yarıklarının ve i39 ağaç tepelerinin maskeleri aynı bölgelerde, güncel zeminlerden yeniden örneklendi. |
| `tests/fixtures/i{37,38,39}-sway-mask.{json,gray.gz}` | Önceki maskelerin özetleri ve gri piksel verisi | Üç yayımlanan maskeden çözülen güncel veriler |
| `design/art-2d/chapter5/islands.md`, `docs/handoff-ch5-art-polish.md` | İlk üretim istemleri | Güncel istemler ve bu teslim |

Manifestteki 12 harita ve 14 ön katman anahtarı aynı dosya adlarına çözülüyor. Üç hareket maskesiyle birlikte 29 WebP’nin ve manifestin dağıtım kopyaları kaynaklarla bayt düzeyinde eşleşti. Toplam 29 görsel 6,00 MiB’den 6,49 MiB’ye çıktı.

## Yeniden üretim ve doğrulama

```sh
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-compose/rebake_all.py i37,i38,i39 --jobs 1
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-life/gen_eclipse_masks.py i37 i38 i39
node qa/plotCoverCheck.mjs --layout-only --ids=i37,i38,i39
```

Yerleşim kontrolü 2000 × 991, 1440 × 900, 844 × 390 ve 932 × 430 boyutlarında, boş ve üç eşyalı kemerle **24/24** geçti. Örtülen inşa alanı sayısı sıfır. Her harita varyantının çözülen boyutunu, kapı önlerinin dikdörtgen ve alfalarını ve üç yerleşim JSON’unu denetledim.

| Kontrol | Sonuç |
| --- | --- |
| `npx tsc --noEmit` ve `npm run lint` | Geçti. |
| `npx vitest run --maxWorkers=1` | 148 dosyada 2.033 test geçti. İki dosya ve 15 test atlandı. |
| `npm run sim:balance` | 56 seviyede geçti. |
| `npm run sim:items -- --workers=2` | Yedi denetim geçti. |
| `npm run sim:difficulty` | 12 denetim geçti. Normal ilk zaferde i37, i38 ve i39 sırasıyla 7, 6 ve 4 can bıraktı. |
| `npm run build` | Üretim derlemesi geçti. Vite parça boyutu ve iki dinamik içe aktarım uyarısı verdi. |

Kontroller Node 22.23.4 ile çalıştı. Vitest ve Vite için bu çalışma dizininde eksik olan Rolldown Linux bağlayıcısının kilit dosyasındaki 1.2.19 sürümü, yerel kurulumdan `NODE_PATH` ile sağlandı.

## Açık kontrol

Sandbox Chromium’u engellediği için canlı savaşta HUD ve yürüyen düşmanların kapıdan geçişi için ekran görüntüsü alınamadı. Telefon incelemesi paketlenmiş görseller ve oyunun yerleşim hesabı üzerinden yapıldı.
