# Beşinci bölümün final adaları

İlk Ocak, Işık Arşivi ve Tutulma Tahtı oynanabilir. Üçü de Usta seviyesinde ve her adada 17 kule yeri var. Bu çalışma ağacında Tutulma Gökleri’nde yayımlanmış altı adanın sırası i37, i38, i39, i43, i44, i45. i40–i42 ayrı çalışma ağacında hazırlanıyor. Taban `art-2d` üzerindeki `0ac8b665`.

## Haritalar ve karşılaşmalar

| Ada | Dalga | Yol ve sahne | Normal zaferinde kalan can | Zayıf savunmanın yenildiği dalga |
| --- | ---: | --- | ---: | ---: |
| i43 · İlk Ocak | 15 | Tek fırın kapısından çıkan döküm hattı iki keskin dönüş yapıyor. Dev örs ve asılı çekiç, kurucu heykelleri ve kızgın yıldız metali kanalları ocağı çevreliyor. | 3/22 | 15 |
| i44 · Işık Arşivi | 16 | Karşılıklı kitap asansörlerinden çıkan iki koridor batıdaki kasaya gidiyor. Uzun üst koridor pirinç dizinin altından geçiyor. Alt koridorun savunma süresi daha kısa. Uçan düşmanlar doğu asansöründen ayrı bir yay çizerek yaklaşıyor. Okuma lambaları raflardan uçuşan sayfaları aydınlatıyor. | 2/22 | 16 |
| i45 · Tutulma Tahtı | 16 | Üç kapılı törende Hükümdar en uzun yolu izliyor. Alçak yan kapı kaleye yakın katılıyor. Tutulmuş güneş, tahtın dev altın kolları, kırık sütun halkası ve gölge kapısı kuzey terasını kaplıyor. | 1/22 | 14 |

Normal kampanya savunması i43’te 12, 14 ve 15. dalgalarda sırasıyla 9, 2 ve 8 can kaybetti. i44’te 9, 12, 14 ve 16. dalgalar sırasıyla 3, 3, 6 ve 8 can aldı. i45’te üçüncü kapının seçkin tazıları 11. dalgada kısa yaklaşımı deniyor. 12, 14 ve 16. dalgalarda 9, 6 ve 6 can kaybedildi. Üç harita da beş kahramanla ve düşman canının ±%1,5 ve ±%3 değiştiği koşuların tamamında kazanıldı. Kahraman ve büyü kullanılmadan, yalnız tam atölye yükseltmeleriyle yapılan ayrı koşuda sabit savunma üç adayı da kaybetti.

Son dalgada yan kapılardan Alacakaranlık Tazıları ve Örtü Büyücüleri geliyor. Hükümdar 20. saniyede büyük kemerden çıkıyor. Canı %66’ya düşünce tutulma başladı. %40’ta ikiye bölündüğünde ana güzergâhın %60,8’ini katetmişti. Dört tazı çağrıldı ve iki Gölge Yarısı da öldürüldü. i45 hikâye modunda Hükümdar’ın veya tek bir yarının kaleye ulaşması kalan canları tüketiyor. Testler, kalenin canı tamken de bu yenilginin gerçekleştiğini ve Sonsuz modda yarının olağan can bedelini aldığını doğruluyor.

Final zaferinden sonra mevcut bölüm kartı kampanyanın tamamlandığını gösteriyor ve haritaya dönüyor. Kapanış sahnesinin bağlantı noktası karttaki `TODO(campaignComplete)`. İlerleme testi bu kartın bir kez gösterildiğini doğruluyor. [Bölüm kartı](../src/render2d/ui/chapterCards.ts)

## Görseller ve telefon kadrajı

Üç özgün zemin, üç kapı ve dekor atlası, üç yol örneği, üç ada madalyonu ve altı hikâye resmi üretildi. Yollar ocakta közlü demir ızgara, arşivde ahşap ve açık taş parke, tahtta koyu kuşaklı gümüş mermer. Harita derleyicisi bu üç malzemeyi virajlarda yol doğrultusunda tekrarlıyor. Kavşakta ana yol yan kolu örtüyor. Ocak kenarında ısı dalgası, diğer iki adanın altında bulut hareketi var. [Üretim tarifleri](../design/art-2d/chapter5/islands.md) · [Kaynak görseller](../design/art-2d/v2/biomes/eclipse/)

Dört çözünürlükte 12 harita, iki çözünürlükte 18 kapı ve kale ön katmanı, dokuz arayüz görseli ve üç hareket maskesi teslim edildi. 42 WebP çözüldü ve dağıtımdaki kopyalarıyla bayt bayt karşılaştırıldı. Kapı katmanlarının alfa kanalları ile boyutları, maskelerin piksel örnekleri ve manifest de doğrulandı.

```sh
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-compose/rebake_all.py i43,i44,i45 --jobs 1
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-life/gen_eclipse_masks.py i43 i44 i45
node qa/plotCoverCheck.mjs --layout-only --ids=i43,i44,i45
```

2000×991, 1440×900, 844×390 ve 932×430 boyutlarında boş ve üç eşyalı kemerle 24 yerleşimin hepsi geçti. 51 kule yerinin hiçbiri HUD altında kalmadı. İki telefon boyutunda yol, kapı, kale ve kule yerlerini birlikte denetleyen 12 kadraj da temiz. 932×430’da kule halkaları ada sırasıyla 44,73, 44,20 ve 44,20 CSS pikseli. Haritalar yarı boyuta indirildiğinde yol ortası ile altındaki boyalı zeminin mutlak parlaklık farkının medyanı 255 üzerinden 32, 41 ve 53. Küçük telefonun kamera izdüşümünde gerçek harita ve kule yeri görselleri kullanıldı. İnce çizgiler HUD sınırlarını gösteriyor. [Üç telefon kadrajı](ch5-isles-3-shots/phone-layout.webp)

Sandbox Chromium’u engelliyor. Canlı DOM örtüşmesi, dokunma ve savaş ekranı görüntüleri tarayıcılı ortamda açık. Aşağıdaki komutları sırayla çalıştırmak yalnızca bu üç adayı açar.

```sh
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --ids=i43,i44,i45
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --new-islands --ids=i43,i44,i45 --shots=docs/ch5-isles-3-shots
```

## Birleştirme ve doğrulama

i40–i42 teslimiyle `CHAPTER5_ISLANDS` dizisinde dokuz ada birlikte tutulmalı. `playableThrough` değeri `i45` olarak kalmalı. Bu dalda başarımların yalnız yayımlanan 43 adayı sayması için `chapters.ts` içinde üç ara kimliği dışarıda tutan `pendingEclipseIslands` var. Birleştirmede bu kümeyi ve onu kullanan filtreyi kaldırıp masaüstü başarım açıklamasındaki sayıyı 46’ya getirin. Kampanya sırası ve önceki kaydın açacağı ada kimlikten belirleniyor. Ortak denge, zorluk ve kayıt testlerini birleşik kadroyla yeniden çalıştırın.

Merkezi değişiklikler ada kaydı, TR/EN hikâye ve dalga metinleri, görsel manifesti, harita ve maske üretimi, kampanya kartı, i45’e özel sızıntı koşulu, denge simülasyonları ve kayıt regresyonlarıyla sınırlı. Değişiklikler çalışma ağacında.

| Kontrol | Sonuç |
| --- | --- |
| `npx tsc --noEmit`, `npm run lint`, `git diff --check` | Geçti. |
| `npx vitest run` | Tek işçiyle 148 dosyada 2.062 test geçti. İki dosya ve 15 test atlandı. |
| `npm run sim:balance` | 59 seviyede geçti. Finalin evre, konum, çağırma ve iki yarıyı öldürme denetimleri geçti. |
| `npm run sim:items -- --workers=2` | Yedi denetim geçti. Normal’de iki eşya kemeri profili de 43/43 ada kazandı. |
| `npm run sim:difficulty` | 13 denetim geçti. Kampanya zaferleri Kolay’da 43/43, Normal’de 43/43 ve Zor’da 16/43. |
| `npm run build` | Üretim derlemesi geçti. Vite büyük paket ve iki dinamik içe aktarma uyarısı verdi. |

Kontroller Node 22.23.4 ile çalıştı. Vitest ve Vite, kilit dosyasındaki Rolldown 1.2.19 Linux bağlayıcısını mevcut yerel kurulumdan `NODE_PATH` üzerinden yükledi.
