# Bölüm 5 düşman çizimleri

`af731ac5` tabanında dört özgün düşman, yerleşik ImageGen ile boyandı. Her biri için saydam bir 6 × 5 kaynak atlas, iki yaratık kataloğu portresi ve beş hareket şeridi var. İstemler, düzeltme turları, EN/TR adları ve yeniden paketleme komutu birlikte kaydedildi. [Üretim istemleri](../design/art-2d/chapter5/motion.md)

## Oyun ölçeğinde inceleme

Boylar, akıncının ilk ön yürüyüş karesi 48 piksel görünecek şekilde, aynı kamerada ölçüldü. Ölçümde çizicinin kullandığı alfa eşiği (> 40) esas alındı. Altın çizgi ve GIF’teki nokta saldırının temas karesini gösterir. [120 karelik inceleme](../design/art-2d/chapter5/motion-review.png) · [Hareketli inceleme](../design/art-2d/chapter5/motion-review.gif)

| Kimlik | Ön yürüyüş boyu | Hareket ve silüet |
| --- | ---: | --- |
| `duskhound` | 47,5 px | Tazı yan yürüyüşte bacaklarını karnının altında toplar, ardından ileri uzatır. Köz rengi kuyruk ucu arka görünüşte de seçilir. Isırırken boynunu uzatır. |
| `veilcaster` | 50,6 px | İkinci çizimde tül asanın ucundaki merceğe bağlandı. Öndeki yüzde başlığın içi, arkada kumaş kıvrımları görünür. Asayı kaldırdığında dördüncü karede koyu halka belirir. |
| `eclipse_sovereign` | 114,4 px · 2,38× | Altın zırhlı yumruk öne çıkarken pelerin geride kalır. Yürüyüş yeniden çizildi. Ölümde kara güneş çatlar, iki parçası ayrılır ve zırh korlara çözülür. |
| `eclipse_shade` | 72,1 px · 1,50× | Hükümdar’ın modelinden çizildi. İnce omuz zırhı, yarım hale ve zeminin rengini geçiren mor pelerin iki biçimi ayırt eder. Son karede mor bir iz kalır. |

## Dosyalar ve entegrasyon

- `design/art-2d/chapter5/<id>.webp` dosyaları kayıpsız kaynak atlaslardır. Üretim paketinde sekiz portre, yirmi WebP şeridi ve yirmi JSON tanımı toplam 1,64 MiB yer tutar.
- Dört kimlik kendi ön ve arka portresine ve kendi beş şeridine bağlandı. Ön, arka ve yan yürüyüşler sağa bakar. Oyun sola dönüşleri aynalayarak çizer. [Manifest](../public/art2d/manifest.json)
- Görsel dosya listesinin dışındaki tek değişiklik, ölüm şeridi bulunan düşmanları birebir sayan mevcut testte dört kimliğin beklenen listeye eklenmesidir. [Liste testi](../tests/sim/chapterTwoActivation.test.ts)

## Doğrulama

- Oyunun `parseManifest`, `resolveEnemyType` ve `parseSheetJson` işlevleri dört kimliği ve yirmi klibi çözdü. Her klip altı ayrı 240 × 184 kare içerir. Ayak bağlantısı (120, 176), dört saldırının sıfır tabanlı temas indeksi 3. Şeritlerde yürüyüş ve saldırı 12 fps, ölüm 10 fps. Oyunda yürüyüş kat edilen mesafeyle ilerler. GIF inceleme için kare başına 130 ms kullanır.
- 120 karenin alfa sınırları hücrelerinin içinde kaldı. Her klipte altı ayrı silüet doğrulandı. Atlaslar `tools/sprites/chapter_enemies.py` ile yeniden paketlendi ve 48 dosya bayt düzeyinde eşleşti. Paketleyicinin iki testi geçti.
- Node 22.23.4 ile `npx tsc --noEmit`, `npm run lint` ve `npm run build` geçti. Derlemedeki manifest ve 48 dosya kaynaklarıyla eşleşti. Vite parça boyutu ve iki dinamik içe aktarım uyarısı verdi. Bu çalışma dizininde eksik olan Rolldown Linux bağlayıcısı için aynı 1.2.19 sürümünü içeren yerel Skyhold kurulumuna geçici `NODE_PATH` verildi.
- Simülasyonlar sırayla çalıştı. `npm run sim:balance` 53 seviyede, `npm run sim:items -- --workers=2` yedi denetimde, `npm run sim:difficulty` on bir denetimde geçti.
- `npx vitest run --maxWorkers=2` ile 147 dosyada 1.972 test geçti. İki dosya ve toplam 15 test atlandı.

## Açık kontrol

Sandbox Chromium’u engelliyor. İnceleme doğrudan paketlenmiş oyun dokuları ve manifest ölçekleriyle yapıldı. A görevinin düşman kayıtları birleştiğinde canlı Pixi sahnesinde dört düşmanın yürüyüşü, büyü halkası ve iki boss biçiminin göreli boyu kontrol edilebilir.
