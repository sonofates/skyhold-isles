# Tutulma Gökleri · i40–i42 teslimi

Gölge Korusu zaferi artık Yıldız Düşüğü’nü açıyor. Üç yeni Master adasının her birinde 15 dalga, 17 inşa alanı ve ayrı bir uçuş rotası var. Örtü Büyücüsü (`veilcaster`) ilk kez i40’ın açılışında iki büyücü ve sekiz piyadeyle geliyor. Kartta yalnız büyücü **Yeni** etiketi alıyor. Büyücü ve Alacakaranlık Tazısı i41 ve i42’de de görülüyor. Kampanyada önsöz dahil 43 oynanabilir ada var. Bölüm finali i45.

| Ada | Yol ve arazi | Savunmada öne çıkan yer |
| --- | --- | --- |
| i40 · Yıldız Düşüğü | Güneybatıdaki maden ağzından gelen tek yol, göktaşının altında iki sert dönüş yaparak kuzeydoğudaki kaleye çıkar. Sıkışmış külün içinde ince yıldız madeni parçaları parlar. Elek ve cevher arabası dönüşleri işaretler. | İki dönüşü birden gören kuleler, menzili daraltan büyücülere karşı birbirini destekler. |
| i41 · Güneş Saati Harabesi | Doğudaki iki saat kapısı, kırık kadranın kuzeyinden ve güneyinden dolaşıp batı revakında birleşir. Pirinç milin gölgesi güney yolunun çatlak döşeme taşlarını keser. Kırık sekstant ve ölçü çubukları avludadır. | Batıdaki birleşim kısa. Kollar ayrıyken özellikle zırhlı birlikleri yıpratmak gerekir. |
| i42 · Zincir Burcu | Batı ve doğu kapılarından gelen birlikler çapa avlusunda karşılaşır, ardından aynı yokuştan kuzeydoğu kalesine çıkar. Perçinli demir plakalar, bakır pası ve parlak aşınma izleriyle okunur. Kuzey surunda çapa tamburu, avluda ırgat ve perçin sepeti vardır. | Ortak yokuş ağır birlikler için iyi bir atış hattı sunar. 7. ve 9. dalgaların hava birimleri avludaki dönüşü atlar. |

## Dalga dengesi

Tablo, Bran ile eşyasız Normal ilk zaferi ölçer. Kahraman deneyimi ve atölye yıldızları önceki adalardan gelir. i39 karşılaştırma için 4/22 can bırakıyor.

| Ada | Kalan can | Can götüren dalgalar ve kayıpları |
| --- | ---: | --- |
| i40 | 3/22 | 8. dalgada 6, 9. dalgada 4, 12. dalgada 3, 15. dalgada 6 |
| i41 | 2/22 | 4. dalgada 1, 8. dalgada 9, 12. dalgada 4, 15. dalgada 6 |
| i42 | 1/22 | 7. dalgada 4, 8. dalgada 4, 9. dalgada 3, 12. dalgada 6, 15. dalgada 4 |

Yedi kuleli zayıf savunma sırasıyla 12., 8. ve 11. dalgada yenildi. Normal ilk zafer koşularında büyücüler 31, 30 ve 24 kez örtü kullandı. Beş kahraman da üç adayı bitirdi. Düşman canı −%3, −%1,5, +%1,5 ve +%3 değiştirildiğinde Bran her adayı kazandı.

`scripts/balanceSim.ts` üç adanın can kaybı aralıklarını, `scripts/difficultySim.ts` ise i39’dan i42’ye ilk zaferde kalan canın her adımda azalmasını denetliyor. Ön ayar sırasında iki kısa simülasyon çakıştı ve ilki durduruldu. Teslim simülasyonları sırayla çalıştırıldı.

## Görseller ve yeniden üretim

Üç özgün boyalı arazi, üç kapı/dekor atlası, üç yol malzemesi ve altı hikâye resmi ImageGen ile üretildi. Göktaşında köz ve sıcak hava, saat fenerinde ışık böcekleri, burcun su verme teknesinde buhar hareket ediyor. Hareket maskeleri inşa alanlarını, kapıları ve yolları koruyor. Ada adları, alt başlıkları, 45 dalga başlığı ve altı hikâye sahnesi Türkçe ve İngilizce. [Sanat yönergeleri](../design/art-2d/chapter5/islands.md) · [Görsel kaynak kiti](../design/art-2d/v2/biomes/eclipse/)

Oyun paketine 12 harita dokusu (1×, 1,5×, 2× ve 3×), iki ölçekte 16 kapı ve kale ön katmanı, üç ada madalyonu, altı hikâye resmi ve üç hareket maskesi eklendi. Bu 40 WebP toplam 11.021.382 bayt. Tarifler depodaki kaynaklardan şu iki komutla yeniden üretilir.

```sh
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-compose/rebake_all.py i40,i41,i42 --jobs 1
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-life/gen_eclipse_masks.py i40 i41 i42
```

## Kampanya ve kayıtlar

`CHAPTER5_ISLANDS` üç ada tanımını alıyor. Kampanyanın sırasını belirleyen `chapters.ts` içinde yayımlanan son ada `playableThrough: 'i42'`. Eski kayıtta i39 kazanılmışsa i40 açılıyor. Yalnızca i39’a ulaşılmışsa oyuncu oradan devam ediyor. i42 zaferi bölüm tamamlama kartını açmıyor.

Paylaşılan dosyalara bu adaların harita tarifleri, hareket maskesi bölgeleri, görsel manifest girdileri, TR/EN metinleri ve hikâye kayıtları eklendi. Masaüstü başarım açıklaması ve kayıt QA aracı 43 adayı kapsıyor. Testler kayıt geçişini, dalga kartını, uçuş girişlerini, iki kollu haritalarda her iki kapının kullanımını, görselleri ve telefon yerleşimini kapsıyor.

## Doğrulama

Node 22.23.4 kullanıldı. Kapı ve kale ön katmanlarının boyutları yerleşim dikdörtgenleriyle, saydamlıkları da dosyaların alfa kanalıyla doğrulandı.

| Komut | Sonuç |
| --- | --- |
| `npx tsc --noEmit` ve `npm run lint` | İkisi de geçti. |
| `npx vitest run --maxWorkers=1` | 148 dosyada 2.059 test geçti. İki dosya ve toplam 15 test atlandı. |
| `npm run sim:balance` | 59 seviyenin tamamında ana ve zayıf savunma hedefleri karşılandı. |
| `npm run sim:items -- --workers=2` | Yedi kontrol geçti. Normal zorlukta iki kampanya profili de eşya kemeriyle 43/43 zafer aldı. |
| `npm run sim:difficulty` | 12 kontrol geçti. Kampanya zaferleri Kolay’da 43/43, Normal’de 43/43 ve Zor’da 17/43. |
| `npm run build` | Üretim derlemesi geçti. Yeni 40 WebP ve manifest dağıtım dizininde kaynakla bayt bayt eşleşti. Vite paket boyutu ve iki dinamik içe aktarma için uyarı verdi. |

## Telefon kadrajı

Dört çözünürlükte (2000×991, 1440×900, 844×390 ve 932×430) boş ve üç eşyalı kemerle 24 yerleşim ölçüldü. HUD çevresine eklenen 3 CSS pikseli payla 51 inşa alanının tamamı açık kaldı. İki telefon boyutundaki 12 kamera kontrolünde yollar, girişler, kaleler ve inşa alanları HUD’dan uzak kaldı. İnşa halkalarının çapı 932×430’da 44,04, 844×390’da 39,91 CSS pikseli. Kadraj görseli oyun haritaları ve inşa alanları kullanılarak dolu kemerin kamera ayarıyla çevrimdışı hazırlandı. [Üç telefon kadrajı](ch5-isles-2-shots/phone-layout.jpg)

```sh
node qa/plotCoverCheck.mjs --ids=i40,i41,i42 --layout-only
```

## Açık kontroller

Sandbox Chromium’u engelliyor. Canlı DOM örtüşme ölçümü ve savaş sırasında telefon görüntüleri Chromium erişimi olan bir ortamda şu komutlarla, sırayla alınabilir.

```sh
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --ids=i40,i41,i42
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --new-islands --ids=i40,i41,i42 --shots=docs/ch5-isles-2-shots
```

Taban `art-2d` üzerindeki `a4c2c8a8`. Değişiklikler çalışma ağacında. Bu tabanda i38’in ikinci dalgasındaki iki sürü hâlâ koşucu. Paralel dalga işi tazı tanıtımını birleştirdiğinde önceki adalardan taşınan deneyim ve yıldızlarla ilk zafer eğrisi tekrar ölçülmeli.
