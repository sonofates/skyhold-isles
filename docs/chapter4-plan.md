# 4. Bölüm planı: Kırağı Takımadası / Frostveil Archipelago

Durum: 2026-11-25, sahibin "4'ten devam" kararıyla başladı.

Bağlam:
- Mobil sürüm tamamen bedava (`MOBILE_STORE_LIVE = false`, `src/platform/iap.ts`).
- PC (Steam) sürümü paralı olacak. 4. ve 5. bölümler oraya da girer.
- Kaynak: `docs/chapters-plan.md`, Faz C.

## Özet

- 9 yeni ada: `i28`–`i36`. Final adası `i36`.
- 3. Bölüm'ün finali `i24` kazanılınca açılır.
- Dalga sayısı 13–15 arasında, bölüm boyunca artar. Final 15 dalga olur.
- 2 yeni düşman ve 1 bölüm boss'u gelir. Boss'u olan ilk bölüm bu olur; diğer finallerde hâlâ ortak `boss` var.
- Görseller Codex'in görsel üreticisiyle yapılır. Map-life prosedürel olduğu için **Flow kredisi gerekmez**. Finallere video döngüsü istenirse ayrıca sorulur (yaklaşık 72 kredi).
- Ada id'leri ekleme sırasıyla verilir. Bölüm sırası `src/data/chapters.ts` dosyasından gelir. Kayıtlar id'ye göre tutulduğu için bozulmaz.

## Yeni düşmanlar

| id | EN / TR | Rol | Mekanik | Karşılığı |
|---|---|---|---|---|
| `rimebeetle` | Rime Beetle / Kırağı Böceği | yer, orta | Ölünce yerde 3 sn'lik bir kırağı lekesi bırakır. Lekenin yarıçapındaki kuleler o süre boyunca %30 daha yavaş ateş eder. Etki üst üste binmez. | Kuleleri dağıtmak, böceği kule kümesine varmadan öldürmek, uzun menzilli kuleler (ballista, havan). |
| `sledguard` | Sledge Warden / Kalkanlı Kızakçı | yer, tank | Kalkanı ayrı bir can havuzu (ana canın yaklaşık %40'ı). Önce kalkan erir. 4 sn hasar almazsa kalkan yeniden dolar. Tesla zinciri ve havan sıçraması kalkana 2 kat vurur. | Sürekli hasar ya da tesla ve havan. Tek atışlık okçu ile kalkan yenilenir. |
| `glacier_warden` | Glacier Warden / Buzul Muhafızı (boss, yalnız `i36`) | yer, boss | %66 ve %33 canda en yakın kuleyi 4 sn dondurur (kule ateş etmez) ve 3 `rimebeetle` çağırır. Yürürken arkasında kısa ömürlü buz izi bırakır (yalnız görsel). | Kuleleri yolun iki yanına yaymak, kahraman ve yetenekleri boss evresine saklamak. |

Kurallar:
- Sim, bugünkü boss evre ve çağırma sistemini (`src/sim/`) kullanır. Yeni sistem gerekiyorsa küçük tutulur ve test edilir.
- Kule yavaşlatma ve dondurma yalnızca ateş hızını etkiler. Satma, yükseltme ve menzil etkilenmez. UI'da kulenin üstünde buz ikonu görünür.
- Her düşmanın şunları olur: `ENEMY_DEFS`/`ENEMY_TYPES` kaydı, `ENEMY_MELEE`, HUD ikonu, bestiary metni (TR/EN), ölüm notu, ses tonu, 3D figür kaydı (3D derleme kırılmasın diye) ve dalga kartında "Yeni" etiketi. Örnek: `docs/handoff-opus-ch2.md`.
- Animasyon: 6×5 sprite atlası (aşağı, yukarı, yan, saldırı, ölüm), `tools/sprites/chapter_enemies.py`. Prompt kalıbı: `design/art-2d/chapter2/motion.md`.

## Adalar (çalışma adları)

| id | EN | TR | Tema / imza obje | Tanıtılan | Dalga |
|---|---|---|---|---|---|
| i28 | Rimeharbor | Kırağı Limanı | Donmuş liman, buza gömülü gemi | — (buzlu açılış) | 13 |
| i29 | Hearthsmoke Hamlet | Ocak Dumanı Köyü | Buz balıkçılığı köyü, tütsü kulübeleri | `rimebeetle` | 13 |
| i30 | Pinewhite Ridge | Akçam Sırtı | Karlı çam sırtı, kızak yolu | — | 13 |
| i31 | Crevasse Span | Yarık Köprüsü | Buzul yarığı üstünde halat köprüler | `sledguard` | 14 |
| i32 | Auroral Orrery | Kutup Işığı Rasathanesi | Aurora gözlemevi, dev mercek | — | 14 |
| i33 | Stillfall Cascade | Donmuş Çağlayan | Donmuş şelale, buz mağaraları | — | 14 |
| i34 | Steamvent Springs | Buhar Pınarları | Kaplıcalar, sıcak taş (renk zıtlığı) | — | 14 |
| i35 | Coldforge Delve | Soğuk Demirhane | Buz madeni, mavi kristal ocaklar | — | 15 |
| i36 | Frostveil Citadel | Kırağı Kalesi | Final: buz kalesi, boss sahnesi | `glacier_warden` | 15 |

Her ada için yapılacaklar:
- Katmanlı harita, kenar mimarisi, büyük bir imza obje ve biyoma özel düşman kapıları. i25–i27'deki "boş çayır" hatasını tekrarlama.
- Yol ve kule yerleri `json`'u, dalgalar, map-life (kar savruntusu, buz parıltısı, buhar).
- Giriş ve çıkış hikâye panelleri, TR/EN ad, alt başlık ve hikâye metni.
- Denge sim'leri. Bölüm 3 finalinden (i24) sonra i28 biraz yumuşar, i36'da tavan yapar.

## İş bölümü (hermes)

**Faz 1 (paralel):**
- **A, Claude (hermes-agent):** düşman sistemi. Kapsam:
  - İki düşmanla boss'un sim'i ve verisi; HUD, bestiary ve TR/EN metinleri.
  - Gerçek görsel gelene kadar yer tutucu görsel.
  - `chapters.ts`: 4. Bölüm'e `i28`–`i36` slotları, kayıtlı ada varsa `playable` olur.
  - Testler.
- **B, Codex (çalışma dizini 1):** iki düşmanın ve boss'un sprite atlasları ile bestiary görselleri. Yalnızca görsel.
- **C, Codex (çalışma dizini 2):** i28, i29, i30 haritaları. Kapsam: görsel, yol, kule yerleri, hikâye panelleri ve metinler. Dalgalar şimdilik mevcut düşmanlarla; yeni düşman Faz 2'de eklenir.

**Faz 2:**
- A ile B birleşir.
- C, i31–i33'e geçer, ardından i34–i36'yı yapar.
- Her üçlü bitince dalga ve denge işi ayrı bir ajana (agy ya da Claude) verilir, yeni düşmanlar dalgalara yerleştirilir.

**Faz 3:**
- Birleşik denge, gate, canlıya alma, iPhone.
- QA kuralı geçerli: tek Chromium, en fazla `--jobs 2`, bütün adaları tarama yok.

## Açık

- Ada ve düşman adları çalışma adı; değiştirilebilir.
- 5. Bölüm "Tutulma Gökleri" bu bölüm bitince planlanacak.
