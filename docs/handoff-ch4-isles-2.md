# Kırağı Takımadası · i31–i33 teslimi

i30 zaferi Yarık Köprüsü’nü açar. Üç yeni ada Master sınıfında ve her biri 14 dalga. Kampanyada önsözle birlikte 34 oynanabilir ada var. Bölümün tamamlanma koşulu i36 zaferi.

| Ada | Kara yolu ve savunma | Kule yeri | Normal ilk zafer |
| --- | --- | ---: | ---: |
| i30 · Akçam Sırtı | Önceki partinin son adası | 17 | 9/22 can |
| i31 · Yarık Köprüsü | Doğu yakasındaki iki halat evi ayrı köprülere açılır. Birlikler buzul yarığını geçtikten sonra batıdaki kaleye giden yolda birleşir. | 17 | 8/22 can |
| i32 · Kutup Işığı Rasathanesi | Tek girişten çıkan yol gözlem avlusunu dolanır, gök küresinin yanından geçerek içteki kaleye varır. | 17 | 7/22 can |
| i33 · Donmuş Çağlayan | Kuzeydeki iki mağaranın ağızları zıt yönlere bakar. Kollar ayrı buz sekilerini izler ve güneydoğudaki kaleden önce son terasta birleşir. | 16 | 6/22 can |

Normal sonuçlar Bran’ın önceki zaferlerden kazandığı deneyim ve atölye yıldızlarıyla, eşya kullanmadan ölçüldü. Her adanın ayrı uçuş rotası var. i31’in ilk dalgası iki `sledguard` ve diğer köprüde altı koşucuyla açılır. Önceki adaları geçmiş bir kayıtta dalga kartı `sledguard` için “Yeni” işaretini gösterir. `rimebeetle` ikinci dalgada gelir. Her iki düşman i32 ve i33’te önceki bölümlerin düşmanlarıyla birlikte kullanılır. `glacier_warden` i36’ya ayrıldı.

## Görseller

Yarık Köprüsü’nde iki ahşap tabliye, vinç, halat tamburu ve işaret flamaları var. Rasathanede kuzey kenarındaki büyük mercek, avludaki gök küresi ve taşınabilir teleskop birbirinden ayrılıyor. Son zemin resminde mercek telefon düğmelerinden uzak, kuzey kenarının ortasında. Donmuş Çağlayan’da alt kenardaki buz sütunları, düşey su sisi, ölçüm düzeneği ve bent çarkı mağara yollarına eşlik ediyor. i17 ve i28–i30’un son haritalarıyla telefon ölçeğinde yan yana karşılaştırıldı. [Görsel istemleri](../design/art-2d/chapter4/islands.md) · [Kaynak sanat](../design/art-2d/v2/biomes/frostveil/)

Her adada dört harita çözünürlüğü, tüm kapı ve kalelerde iki çözünürlükte ön katman, bir dünya haritası madalyonu, iki hikâye paneli ve iki kayıpsız ortam maskesi var. Toplam 43 oyun içi WebP çözüldü. Yollar ve kule yerleri kar ve buz maskelerinden çıkarıldı. Bölüm kartı, ada alt başlıkları, 42 dalga adı ve altı hikâye sahnesi İngilizce ve Türkçe.

Haritaları ve maskeleri yalnız bu üç ada için yeniden üretmek için depo kökünde çalıştırılır.

```sh
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-compose/rebake_all.py i31,i32,i33 --jobs 1
OPENBLAS_NUM_THREADS=1 /usr/bin/python3 -B tools/map-life/gen_frostveil_masks.py i31 i32 i33
```

## Ortak dosyalar

Ortak görsel manifestine ve harita üretim tariflerine üç adanın kaynakları kaydedildi. Kırağı maske üreticisi ada kimliği alarak tek partiyle sınırlandırılabiliyor. Üç ada `CHAPTER4_ISLANDS` listesine eklendi. `playableThrough` i33’e, masaüstü üç yıldız başarımının açıklaması 34 adaya güncellendi. Kayıt geçişi, kaydetme/yükleme turu, harita varlıkları, ilk ve son dalga canları, düşman tanıtımı ve bölüm sırası testleri yeni kimlikleri kapsıyor. Denge simülasyonuna i32 ve i33 için can kaybı aralıkları, zorluk simülasyonuna i30’dan sonraki düşüşü doğrulayan kontrol eklendi. Sonraki parti kendi adalarını kaydederken `playableThrough` ve başarım açıklamasını birlikte güncellemeli.

## Doğrulama

Simülasyonlar Node 22 ile sırayla çalıştırıldı.

| Kontrol | Sonuç |
| --- | --- |
| `npx tsc --noEmit`, `npm run lint` | Geçti. |
| `npx vitest run --maxWorkers=1` | 1.941 test geçti, 15 test atlandı. Kayıt taşıma, dalga önizlemesi, uçuş yolları ve telefon kadrajı dahil. |
| `npm run sim:balance` | 50 seviyede tüm eşikler geçti. Yeni üç adada on kuleli plan kazandı, yedi kuleli plan 14. dalgada kaybetti. Her kahramanla ve düşman canındaki ±%3 değişimlerle Normal zafer doğrulandı. |
| `npm run sim:items -- --workers=2` | Tüm eşya ve ekonomi eşikleri geçti. Seçili kemerle Normal kampanya 34/34 tamamlandı. Zayıf savunma kemersiz 5, kemerle 11 adada kazandı. |
| `npm run sim:difficulty` | Tüm eşikler geçti. Kampanya Kolay ve Normal’de 34/34, Zor’da 16/34 tamamlandı. Yeni üç adada Kolay ilk zafer 27/27 canla geldi. |
| `npm run build` | Üretim derlemesi geçti. Vite, büyük paketler ve aynı modülün hem statik hem dinamik içe aktarılması için uyarı verdi. |

## Telefon denetimi

`node qa/plotCoverCheck.mjs --ids=i31,i32,i33 --layout-only` dört ekran boyutunda (2000×991, 1440×900, 844×390 ve 932×430), boş ve dolu kemerle çalıştırıldı. Üç CSS pikseli ek payla 24 birleşimde 50 kule yerinin hiçbirinde HUD örtüşmesi bulunmadı. 932×430 kadrajında dokunma halkalarının çapları sırayla 48,3, 45,5 ve 44,1 CSS pikseli.

Ayrıca iki telefon boyutunda her iki kemerle yollar, kapılar, kale ve kule yerleri birlikte denetlendi. On iki durumda da oyun kamerası tam görünürlük bildirdi. Bu denetim yeni haritaların Vitest dosyasında çalışır.

Canlı Chromium DOM ölçümü ve savaş görüntüleri, kullanıcının tarayıcı çalıştırabildiği ortamda yapılacak. Aşağıdaki komutlar yalnızca yeni adaları açar. İkinci komut ada başına bir masaüstü ve bir telefon görüntüsü alır.

```sh
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --ids=i31,i32,i33
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --new-islands --ids=i31,i32,i33 --shots=docs/ch4-isles-2-shots
```

Değişiklikler `art-2d` tabanı `7f76665c` üzerindeki çalışma ağacında.
