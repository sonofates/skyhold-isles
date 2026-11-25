# Kırağı Takımadası · i34–i36 teslimi

i33’ü kazanan oyuncuya Buhar Pınarları açılır. Kırağı Kalesi’ndeki ilk zafer 4. Bölüm’ü tamamlar ve bölüm kartını bir kez gösterir. Kartta “5. Bölüm yakında geliyor” mesajı görünür. Tutulma Gökleri haritada kapalı kalır. Önsöz dahil 37 ada oynanabilir.

| Ada | Yol ve savunma | Kule yeri | Dalga | Normal ilk zafer |
| --- | --- | ---: | ---: | ---: |
| i34 · Buhar Pınarları | Tek girişten inen yol üç kaplıca sekisini birbirine bağlar. Komşu sekilere bakan kuleler aynı birliği iki kez karşılayabilir. | 18 | 14 | 5/22 can |
| i35 · Soğuk Demirhane | Batıdaki iki maden galerisi cevher makasında birleşir. Ortak yol demirhanenin yanından doğudaki kaleye tırmanır. | 17 | 15 | 4/22 can |
| i36 · Kırağı Kalesi | Muhafız’ın büyük buz kapısı batı avlusuna açılır. İki küçük hücum kapısı farklı kavşaklardan ona katılır. Güney suru boyunca son bir savunma hattı vardır. | 17 | 15 | 2/22 can |

Üç ada Master sınıfında. Can sayıları, önceki ada zaferlerinden kazanılan Bran deneyimi ve atölye yıldızlarıyla, eşya kullanmadan ölçüldü. Aynı koşullarda i33 bitişi 8/22. On kuleli savunma üç adayı da geçti. Yedi kuleli plan üçünde de son dalgada yenildi. Böcek çıkan dalgalarda kırağı lekelerinin kulelere kaybettirdiği ateş süresi sırayla %5,2, %6,2 ve %5,7 oldu. Üç haritada da ayrı uçuş rotası var.

## Final savaşı

Kırağı böcekleri ve kalkanlı kızakçılar üç adada da eski bölümlerin düşmanlarıyla savaşır. Buzul Muhafızı ilk kez i36’nın 15. dalgasında görünür. Yan kapılardaki öncü birliğin ardından 24. saniyede ana kapıdan çıkar. Ana yol yaklaşık 1.776 harita pikseli, yan yollar 1.245 ve 1.040 pikseldir.

Eşyasız Normal koşuda Muhafız iki ayrı savunma noktasına ulaştı. Dalganın 47,3. saniyesinde topu, 54,0. saniyesinde Tesla kulesini dondurdu. Her evrede üç böcek çağırdı ve 62,8. saniyede kaleye ulaşmadan öldü. Öncüdeki on kızakçı kaleye toplam 20 can kaybettirdi. Denge kontrolü artık iki farklı kuleyi, altı çağrıyı ve Muhafız’ın kaleye sızmamasını ölçüyor.

## Görseller ve kayıtlar

Kaplıcalarda karlı kıyının karşısına sıcak mineral taşı, turkuaz havuzlar, ahşap hamamlar ve asılı havlular yerleştirildi. Madende mavi kristaller ve cevher vagonları, karanlığın içindeki turuncu ocağı çevreliyor. Finalde kızıl sancaklar, tören avlusu, surlar ve iki yan kapıdan belirgin biçimde büyük bir buz kapısı var. Üç adanın ortam efektleri buharı, ocak ışığını, kar savruntusunu ve buz parıltısını ilgili yüzeylere bağlıyor. [Görsel üretim istemleri](../design/art-2d/chapter4/islands.md) · [Kaynak resimler](../design/art-2d/v2/biomes/frostveil/)

45 oyun içi WebP çözüldü. Bunlar dört ölçekte 12 harita, iki ölçekte 18 kapı ve kale ön katmanı, altı ortam maskesi, üç ada madalyonu ve altı hikâye panelidir. Yol ve kule yerleri hareketli maskelerden çıkarıldı. Ada adları, alt başlıklar, 44 dalga adı, altı sahne ve bölüm tanıtımı Türkçe ve İngilizce.

Ortak dosyalarda bölüm kayıtları, başarım açıklaması, görsel manifesti, harita ve maske tarifleri, simülasyon ve kayıt testleri güncellendi. Harita üreticisine giriş başına isteğe bağlı yükseklik eklendi. i36 bunu yan kapıların siluetini küçültmek için kullanıyor. Eski kayıt için test, i33 kazanılmamışsa sıranın i33’te kaldığını, kazanılmışsa i34’ün açıldığını doğruluyor.

Haritaları ve maskeleri yalnız bu üç ada için üretmek için depo kökünde çalıştırılır.

```sh
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-compose/rebake_all.py i34,i35,i36 --jobs 1
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-life/gen_frostveil_masks.py i34 i35 i36
```

## Telefon kadrajı

`node qa/plotCoverCheck.mjs --ids=i34,i35,i36 --layout-only` dört ekran ölçüsünde, boş ve dolu eşya kemeriyle çalıştı. Üç CSS pikseli ek payla 24 düzenin hiçbirinde HUD, 52 kule yerinden birini örtmedi. 932×430 ekranda dokunma halkalarının çapı sırasıyla 44,4, 49,5 ve 45,0 CSS pikseli. Kamera testi 844×390 ve 932×430 ekranda iki kemer durumuyla yollar, kapılar, kale ve kule yerleri için 12/12 tam görünürlük bildirdi.

Canlı DOM ölçümü ve ekran görüntüleri tarayıcı erişimi olan ortamda alınacak. İlk komut yalnız yeni üç adada HUD denetimini, ikinci komut aynı adaların görüntülerini alır.

```sh
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --ids=i34,i35,i36
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --new-islands --ids=i34,i35,i36 --shots=docs/ch4-isles-3-shots
```

## Doğrulama ve açık konular

Kontroller Node 22 ile yürütüldü. Simülasyonlar sırayla çalıştı.

| Kontrol | Sonuç |
| --- | --- |
| `npx tsc --noEmit`, `npm run lint` | Geçti. |
| `npx vitest run --maxWorkers=1` | 1.971 test geçti, 15 atlandı. Tek hata, mevcut kampanya denge testinde i31 ve i33 ile ilgili dört beklenti. Yeni adalara ait beklentiler geçti. |
| `npm run sim:balance` | i34–i36 eşiklerinin tümü geçti. Beş kahraman ve dört düşman canı varyasyonunda üç ada da kazanıldı. Tam koşu i31 ve i33’te beş hata bildirdi. |
| `npm run sim:items -- --workers=2` | Yedi eşiğin tamamı geçti. Seçili kemerle Normal kampanya 37/37 tamamlandı. Zayıf planın Normal zaferleri kemerle 6’dan 11’e çıktı. |
| `npm run sim:difficulty` | Kolay ve Normal kampanya 37/37 tamamlandı. i33–i36 Normal zorluk eğrisi geçti. Tek kırmızı eşik önceki i28–i33 eğrisi. Kolay’da son üç ada 27, 27 ve 19 canla kazanıldı. Zor’da aynı on kuleli plan i34’te 12. dalgada, i35’te 8. dalgada yenildi ve i36’yı 4 canla geçti. |
| `npm run sim:balance -- --levels=i34,i35,i36` | Yalnız bu teslimin üç adasını kapsayan koşuda tüm eşikler geçti. |
| `npm run build` | Üretim derlemesi geçti. Vite büyük paketler ve iki modüldeki statik/dinamik içe aktarma çakışmaları için uyarı verdi. |

Entegrasyon tabanında i30, i31, i32 ve i33 için Normal bitiş canları sırasıyla 9, 18, 7 ve 8 idi. i31’deki 18 can hem Master aralığının üstüne çıkıyor hem de i30’dan sonraki artan güçlük beklentisini bozuyor. i33’te 8 can beklenen 5–7 aralığının üzerinde. Aynı adada zayıf plan kazanıyor, Sela ile Normal plan kaybediyor. Tam kampanya denge ve zorluk kontrollerini yeşile döndürmek önceki partinin ayarlarına bağlı.

Değişiklikler `92fcb3a9` tabanı üzerindeki çalışma ağacında.
