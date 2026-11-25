# Bölüm 4 düşman çizimleri

Başlangıç revizyonu `355d289b`. Kırağı Böceği, Kalkanlı Kızakçı ve Buzul Muhafızı, yerleşik ImageGen ile ayrı birer 6 × 5 atlas olarak çizildi. Her düşmanın iki yaratık kataloğu portresi ve beş animasyon şeridi hazır. Üretime giren 36 yeni dosya toplam 1,31 MiB.

## Oyun ölçeğinde inceleme

Ön yürüyüşün ilk karesinde, standart akıncı 48 piksel boydayken böcek 48, kızakçı 49, Buzul Muhafızı 106 piksel. Boss’un görünen boyu, aynı kamerada standart akıncının 2,20 katı. Bu oranı manifestteki `height` değeri sağlıyor.

- [Kare dökümü](../design/art-2d/chapter4/motion-review.png) paketlenmiş 90 kareyi, zemin çizgilerini ve 48 piksellik akıncıyı gösterir.
- [Hareketli inceleme](../design/art-2d/chapter4/motion-review.gif) beş hareketi yan yana, altı pozu eşzamanlı oynatır. Saldırı sütununun altındaki sarı nokta temas karesini işaretler. GIF inceleme için kare başına 130 ms kullanır. Oyun verisinde yürüyüş ve saldırı 12 fps, ölüm 10 fps.
- Böceğin hücumu ve devrilmesi ikinci üretimden seçildi. Kafa vuruşunda en öndeki kıskaç dördüncü karede uzanır. Altı saldırı karesi arasında alt silüetin konumu bir kaynak piksel değişir.
- Kızakçının kalkanı önden, kürk pelerini ve kızak kuyruğu arkadan okunur. Kalkan vuruşunda kalkan kızak burnunun önüne çıkar, ölümde sürücü kızağın üzerine yığılır.
- Muhafızın ikinci üretiminde yan yürüyüşteki ayaklar ayrıştı. İki yumruk üçüncü karede yükselir ve dördüncü karede yere değer. Ölümün son karesinde sönmüş fener, mavi buz bloklarının dibinde kalır.

## Dosyalar

Aşağıdaki yollarda `<id>` üç değerden birini alır: `rimebeetle`, `sledguard`, `glacier_warden`. Beş klibin adı `walk-down`, `walk-up`, `walk-side`, `attack` ve `death`.

| Yol | İçerik |
| --- | --- |
| `design/art-2d/chapter4/<id>.webp` | Tekrar paketlenebilir, alfa kanallı üç kaynak atlas |
| [motion.md](../design/art-2d/chapter4/motion.md) | EN/TR adları, üç üretim istemi, iki düzeltme istemi ve paketleme komutu |
| `design/art-2d/chapter4/motion-review.png`, `motion-review.gif` | Oyun ölçeğindeki inceleme görselleri |
| `public/art2d/enemy-<id>.webp`, `enemy-<id>-back.webp` | Altı ön ve arka portre |
| `public/art2d/anim/<id>-<klip>.webp`, `<id>-<klip>.json` | 15 animasyon şeridi ve 15 kare tanımı |
| [manifest.json](../public/art2d/manifest.json) | Üç `enemies` kaydı ve aynı kimlikleri bağlayan üç `enemyMap` girdisi |
| [chapterTwoActivation.test.ts](../tests/sim/chapterTwoActivation.test.ts) | Görsel listesinin dışındaki tek değişiklik. Ölüm şeritlerinin tam listesini denetleyen mevcut test, yeni atlaslarla birlikte yedi kimlik bekliyor. |
| `docs/handoff-ch4-art.md` | Devir belgesi |

## Doğrulama

- Oyunun `parseManifest`, `resolveEnemyType` ve `parseSheetJson` işlevleri üç kimliği kendi portre ve şeritlerine çözdü. 15 şeridin her birinde altı ayrı 240 × 184 kare var. Tümünde ayak bağlantı noktası (120, 176). Üç saldırının temas indeksi 3.
- 90 karenin alfa silüetleri hücre sınırlarının içinde. Her şeridin altı silüeti birbirinden farklı. Kaynakları mevcut `tools/sprites/chapter_enemies.py` ile boş bir klasöre yeniden paketledim. Üretimdeki 36 dosyanın tümü bayt düzeyinde eşleşti. Paketleyicinin iki mevcut testi de geçti.
- Node 22.23.4 ile `npx tsc --noEmit` ve `npm run lint` geçti.
- `npx vitest run` iki eşzamanlı işçiyle tamamlandı. 145 dosyada 1.867 test geçti, 15 test atlandı.
- Simülasyonlar sırayla çalıştı. `npm run sim:balance` 44 seviyede geçti. `npm run sim:items -- --workers=2` yedi denetimden, `npm run sim:difficulty` dokuz denetimden geçti.
- `npm run build` geçti. Derleme çıktısındaki manifest ve 36 görsel dosyası kaynaklarıyla bayt düzeyinde eşleşti. Vite, JavaScript parça boyutu ve iki dinamik içe aktarım uyarısı verdi.

Bu çalışma dizininin bağımlılık kurulumunda `@rolldown/binding-linux-x64-gnu` eksikti. Vitest ve Vite için kilit dosyasındaki 1.2.19 sürümü, yerel Skyhold kurulumundan geçici bir `NODE_PATH` ile yüklendi.

## Entegrasyon

Oyun içi karşılaşma kontrolü, A görevinin düşman kayıtları ve dalgalarıyla birleşmeye bağlı. Görsellerin manifest kimlikleri bu kayıtlarla doğrudan eşleşir. Bu teslimdeki görsel inceleme paketlenmiş dosyalar üzerinden yapıldı. Sandbox kısıtı nedeniyle Chromium çalıştırılmadı.
