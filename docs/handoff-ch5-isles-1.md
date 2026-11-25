# Tutulma Gökleri · i37–i39 teslimi

Kırağı Kalesi’ni kazanan oyuncu bölüm tamamlama kartından Tutulma Gökleri’ne geçer. Bölümün dokuz yuvası i37–i45 için ayrıldı. İlk üç ada sırayla açılıyor. i39 zaferi bölümü tamamlamıyor. Bölüm finali i45. Kampanyada önsöz dahil 40 oynanabilir ada var.

| Ada | Yol, imza yapı ve savunma |
| --- | --- |
| i37 · Alacakaranlık İskelesi | Kopuk zincirli yük vincinin önündeki yol doğu kapısından batıya uzanıyor. Rıhtımın altından dönüp ortadaki kaleye giriyor. İç kıvrımı gören kuleler aynı akını iki kez karşılayabiliyor. |
| i38 · Kırık Adacıklar | Tek kara yolu üç kayayı birbirine bağlıyor. Ortadaki kayada yol kuzeye çıkıp güneye dönüyor. İki ayrı ahşap asma köprü, askı makarasının iki yanındaki yarıkları geçiyor. |
| i39 · Gölge Korusu | Kara yapraklı ağacın altındaki koruya batı ve doğu kök mahzenlerinden giriliyor. İki kol güneydeki mantar yataklarının üstünde birleşiyor. |

Her adada 17 inşa alanı, ayrı bir uçuş rotası ve Master sınıfında 14 dalga var. Ada adları, alt başlıklar, 42 dalga adı ve altı resimli hikâye sahnesi Türkçe ve İngilizce. Yeni dalgalar ilk dört bölümün düşmanlarını kullanıyor. i38’in ikinci dalgasında ilk köprüyü geçen, beşer üyeli iki koşucu sürüsü var. Kaynakta işaretli bu iki grup sonraki fazda `duskhound` tanıtımına ayrıldı.

## Denge

Eşyasız, önceki adalardan kazanılan kahraman deneyimi ve atölye yıldızlarıyla Normal ilk zaferde Kırağı Kalesi 2/22 can bırakıyor. Yeni adalardaki dağılım aşağıda. Dalga numaraları birden başlıyor.

| Ada | Kalan can | Can götüren dalgalar | Yedi kuleli savunma |
| --- | ---: | --- | --- |
| i37 | 7/22 | 12. dalgada 6, 14. dalgada 9 | 14. dalgada yenildi |
| i38 | 6/22 | 12. dalgada 6, 14. dalgada 10 | 14. dalgada yenildi |
| i39 | 4/22 | 4. dalgada 1, 7. dalgada 2, 8. dalgada 1, 12. dalgada 6, 14. dalgada 8 | 8. dalgada yenildi |

i37’nin dönüş yolunda kızakçılar ve golemler, i38’in köprülerinde iki ağır birlik son savunmayı zorluyor. i39’da iki girişten gelen destekçiler ve kırağı lekeleri baskıyı daha erken başlatıyor. Kırağı böceği içeren dalgalarda kulelerin ateş süresinin %12,7’si yavaşlamayla kaybedildi.

Normal sağlamlık koşularında beş kahraman da üç adayı bitirdi. i39’da düşman canı %3 artırıldığında aynı otomatik savunma 15 canla kazandı. Kulelerin ateşleme ve satın alma sırası değişebildiği için ilerideki dalga ayarında küçük can değişiklikleriyle eğri yeniden ölçülmeli.

## Resimler ve üretim

Yerleşik ImageGen ile üç boyalı zemin, üç kapı ve dekor atlası, üç yol dokusu, üç harita madalyonu ve altı hikâye paneli üretildi. İskelede kargo fenerleri, kırık kayalarda ölçüm fenerleri, koruda bal rengi mantarlar yolu aydınlatıyor. İskele altında ve yarıklarda sis, korunun üst kenarında yapraklar hareket ediyor. Hareket maskeleri yolları, köprüleri, kale ve kapı ağızlarını ve inşa alanlarını koruyor. [Görsel istemleri](../design/art-2d/chapter5/islands.md) · [Kaynak kiti](../design/art-2d/v2/biomes/eclipse/)

Oyun içi teslim 12 harita dokusu (1×, 1,5×, 2× ve 3×), iki ölçekte 14 kapı ve kale ön katmanı, dokuz arayüz resmi ve üç kayıpsız maskeden oluşuyor. Yalnızca bu üç adanın harita ve maskelerini yeniden üretmek için depo kökünden çalıştırılır.

```sh
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-compose/rebake_all.py i37,i38,i39 --jobs 1
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-life/gen_eclipse_masks.py i37 i38 i39
```

## Ortak dosyalar

Ada sırasını `chapters.ts`, oyun verisini `CHAPTER5_ISLANDS` belirliyor. Yayımlanan son kimlik `playableThrough: 'i39'`. Başarım kodu sayıyı zaten yayımlanan kimliklerden alıyor. Masaüstü kataloğunda 40 ada yazıyor. Kayıt testleri, önceki sürümde i36’da kalmış oyuncuyla i36’yı kazanmış oyuncunun farklı ilerleme noktalarını doğruluyor.

Ortak görsel manifestine yeni haritalar, kapı katmanları ve arayüz resimleri eklendi. Ortak harita tarifi, TR/EN sözlükleri ve hikâye tablosuna bu üç adanın girdileri işlendi. Denge, zorluk, dalga raporu, kayıt turu ve bölüm ekranı QA aracı yayımlanan adaları kapsıyor. Önceki adaların denge eşikleri korundu.

## Doğrulama

Node 22.23.4 ile TypeScript ve lint geçti. Tam Vitest turunda tek işçi kullanıldı. 147 dosyada 1.997 test geçti. İki dosya ve toplam 15 test atlandı. Kapı ve kale katmanları iki ölçekte çözüldü. Her katmanın alfa kanalı ve resim boyutu, yerleşimdeki dikdörtgeniyle doğrulandı.

| Komut | Sonuç |
| --- | --- |
| `npm run sim:balance` | 56 seviyelik denge turu geçti. |
| `npm run sim:items -- --workers=2` | Yedi kontrol geçti. Normal zorlukta eşya kemeriyle 40 adanın tamamı kazanıldı. |
| `npm run sim:difficulty` | 12 kontrol geçti. Kampanya zaferleri Kolay’da 40/40, Normal’de 40/40, Zor’da 16/40. |
| `npm run build` | Üretim derlemesi geçti. Yeni 38 WebP dosyası ve görsel manifesti, kaynak ve dağıtım dizinlerinde bayt bayt eşleşti. Vite, paket boyutu ve iki dinamik içe aktarma için uyarı verdi. |

## Telefon kadrajı ve açık görsel kontrol

`qa/plotCoverCheck.mjs --layout-only` dört ekran boyutunda, boş ve dolu kemerle 24 düzeni ölçtü. Üç CSS pikseli ek payla 51 kule yerinin tamamı açıkta. Telefon kamera denetimi 844×390 ve 932×430 boyutlarında kapılar, kale, yollar ve inşa alanları için 12/12 temiz kadraj verdi. Üç adanın da 932×430 inşa halkası 44,04 CSS pikseli.

Canlı DOM ölçümü ve savaş ekranı görüntüleri Chromium erişimi olan ortam için açık. Ayrı ayrı çalıştırılan iki komut yalnızca bu teslimi açar.

```sh
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --ids=i37,i38,i39
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --new-islands --ids=i37,i38,i39 --shots=docs/ch5-isles-1-shots
```

Taban `af731ac5`. Değişiklikler çalışma ağacında.
