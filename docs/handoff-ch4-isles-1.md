# Kırağı Takımadası · i28–i30 teslimi

Üç ada i24 zaferinden sonra sırayla açılır. Bu teslim kampanyayı önsöz dahil 31 oynanabilir adaya çıkarır. Bölümün dokuz yuvası ayrıldı. Bölüm tamamlama kartının koşulu i36 zaferidir.

| Ada | Oyun alanı | İnşa alanı | Normal ilk zaferde kalan can |
| --- | --- | ---: | ---: |
| i24 · Lastlight Head | Önceki bölümün finali, denge referansı | — | 12/22 |
| i28 · Kırağı Limanı | Buza oturmuş gemi, iki buz mağarası ve rıhtımdaki keskin dönüş | 18 | 13/22 |
| i29 · Ocak Dumanı Köyü | Çift bacalı tütsü kulübesi, iki kayıkhaneden beslenen göl yolu | 17 | 11/22 |
| i30 · Akçam Sırtı | Ahşap kızak rampası, iki kereste kapısı ve sırttan inen çift kızak izi | 17 | 9/22 |

Üçü de Master sınıfında, ikişer kara girişi ve ayrı uçuş rotası olan 13 dalgalı adalar. Normal sonuçlar, önceki adalarda kazanılan deneyim ve yıldızlarla Bran’ın eşya kullanmadan yaptığı ilk seferden gelir. Üçü de iki yıldız verir. i29’un ikinci dalgasında doğu kayıkhanesi için `rimebeetle` ekleme noktası işaretli. Bu sürüm ilk üç bölümün düşmanlarını kullanır.

## Görseller ve üretim

Yerleşik görsel üreticiyle üç zemin, üç dekor ve kapı atlası, üç yol dokusu, altı hikâye paneli ve üç dünya haritası madalyonu üretildi. Zeminler ve kesilmiş dekorlar Frostveil kitinde. Haritalardaki ana yapı, kar yığınları, düşük güneş gölgeleri ve koyu su kenarları boyalı zeminin parçaları. Son haritalar i17 ve yenilenmiş i25–i27 ile telefon ölçeğinde karşılaştırıldı. [Görsel istemleri](../design/art-2d/chapter4/islands.md) · [Frostveil kaynak kiti](../design/art-2d/v2/biomes/frostveil/)

Her haritanın 1×, 1,5×, 2× ve 3× sürümü, her iki giriş ve kale için iki çözünürlükte ön katmanı var. Kar savruntusu ve buz parıltısı altı kayıpsız maskeyle sınırlandırıldı. Duman liman mangalından, köyün iki bacasından ve sırt sobasından çıkar. TR ve EN metinleri ada adlarını, alt başlıkları, 39 dalga adını, bölüm kartını ve altı hikâye panelini kapsar.

Haritaları ve maskeleri yeniden üretmek için depo kökünde çalıştırılır.

```sh
OPENBLAS_NUM_THREADS=1 python3 -B tools/map-compose/rebake_all.py i28,i29,i30 --jobs 1
/usr/bin/python3 -B tools/map-life/gen_frostveil_masks.py
```

## Ortak dosyalardaki değişiklikler

Bölüm sırası ve oynanabilir yuva sayısı, başarım kataloğu, kayıt geçişi, simülasyon grupları ve ada listesi testleri kimlikleri izler. Eski i24 kaydının i28’i açması ve i30 zaferinin bölümü tamamlamaması doğrulanır. Tüm adalarda üç yıldız başarımı kayıtlı 2D ada kimliklerini kullanır. Sonraki partide bölümün son yayımlanan ada kimliği (`playableThrough`) ve masaüstü kataloğunun açıklaması güncellenmeli. Testler yayımlanan yuvaların gerçek oyun kayıtlarıyla birebir eşleştiğini denetler.

Yatay telefonlarda HUD’un dış sıradaki inşa alanlarını kapatması nedeniyle yerleşim tipine, yükleyiciye ve telefon kamerasına isteğe bağlı `phoneFrame` eklendi. Yalnız bu üç harita başlangıç kadrajı tanımlar. i29’un inşa alanları ve ona bağlı kule planları bu kadraja göre düzenlendi. [Telefon kamerası](../src/render2d/phoneCamera.ts) · [Yerleşim yükleyicisi](../src/data/levels2d/loader.ts)

## Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| `npx tsc --noEmit`, `npm run lint` | Geçti. |
| `npx vitest run --maxWorkers=2` | 1.888 test geçti, 15 test atlandı. Kayıt taşıma ve kampanya boyunca kaydetme/yükleme kontrolleri dahil. |
| `npm run build` | Geçti. Vite, 500 kB üzerindeki paketler için boyut uyarısı verdi. |
| `npm run sim:balance` | 47 seviyede tüm eşikler geçti. Üç yeni adada on kuleli plan kazandı, yedi kuleli plan eşyasız kaybetti. Normal sağlamlık denetiminde Sela dahil her kahraman üç adayı da bitirdi. |
| `npm run sim:items -- --workers=2` | 31 adada tüm eşya ve ekonomi eşikleri geçti. Zayıf savunma Normal’de kemersiz 5, kemerle 9 ada kazandı. Üç yeni adada da kemer kaybı zafere çevirdi. |
| `npm run sim:difficulty` | Tüm eşikler geçti. Kolay ve Normal kampanya 31/31, Zor 15/31. Yeni üç adanın Normal eğrisi ayrıca kimlikle doğrulandı. |
| Görsel dosyalar | 45 WebP dosyası çözüldü. Her adada dört harita boyutu, altı kapı ön katmanı, üç arayüz görseli ve iki maske doğrulandı. |

Doğrulamalar Node 22 ile çalıştırıldı. Bu çalışma kopyasında eksik olan, kilit dosyasına uygun Rolldown Linux bağlayıcısı aynı sürümü kullanan yerel kurulumdan node_modules içine alındı.

## Açık kalan görsel kontrol

Geometri denetimi 2000×991, 1440×900, 844×390 ve 932×430 ekranlarda, boş ve dolu eşya kemerleriyle üç adanın 52 inşa alanını kontrol etti. Üç CSS pikseli ek payla 24 birleşimin tamamında örtüşme sayısı sıfır. 932×430 çözünürlükte dokunulabilir halka çapları sırasıyla 48,7, 45,5 ve 45,5 CSS pikseli. Canlı DOM ölçümü ve savaş ekranı görüntüleri açık. Chromium bu ortamda başlangıçta `shutdown: Operation not permitted` hatasıyla kapandı. Tarayıcı işlemi sonlandı.

```sh
node qa/plotCoverCheck.mjs --ids=i28,i29,i30 --layout-only
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --ids=i28,i29,i30
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --new-islands --ids=i28,i29,i30 --shots=docs/ch4-isles-1-shots
```

Son komut yalnızca bu üç ada için 1280×800 ve 932×430 savaş görüntüleri alır. i31–i36 ve yeni düşmanların dalgalara yerleştirilmesi sonraki partilere aittir. Değişiklikler `355d289b` tabanlı çalışma ağacındadır.
