# Bölüm planı: 5 bölüm × 9 ada

Durum: taslak, 2026-11-24. Sahibin onayını bekliyor (aşağıdaki "Kararlar" bölümü).

## Bugün ne var

- 25 oynanabilir ada: `l1c` (Meadow Crossing, öğretici) + `i01`–`i24`.
- Oyuncunun gördüğü bir bölüm yapısı yok. Dünya haritası soldan sağa tek bir rota (`src/render2d/ui/worldMap.ts`).
- Kodda yalnızca `chapterTwo` grubu var (`src/data/levels2d/index.ts`, i17–i24). Bu grup sadece düşman kaydı kontrolü için kullanılıyor.
- Mobilde ücretsiz kapsam: ilk 6 ada (`FREE_ISLANDS`, `src/platform/iap.ts`, sahibin kararı bekleyen bir yer tutucu).
- Zorluk: i01 Breezy, i02–i07 Challenging/Heroic, i08 sonrası Master. i17 yeniden Heroic'e iniyor; yeni düşmanlar orada tanıtılıyor.

## Mevcut adaların bölümlere dağılımı

Ada id'leri **değişmez**. Böylece kayıtlar, yıldızlar, Günlük ve meydan okumalar bozulmaz. Bölüm yalnızca bir sıralama ve gruplama katmanı olur.

| Bölüm | Biyom / tema | Adalar | Finali (9.) | Yeni düşmanlar | Durum |
|---|---|---|---|---|---|
| Önsöz | Çayır geçidi | `l1c` | — | grunt, runner, brute, flyer | var (öğretici, sayılmaz) |
| 1. Güneşli Çayırlar | çayır, köprü, yel değirmeni, lagün | i01–i09 | **i09 Grand Skyhold** | healer, splitter, boss | 9/9 var |
| 2. Fırtına Tacı | kuleler, fenerler, kehribar plato, ay kuyusu | i10–i15 + **2 yeni** + i16 | **i16 Emberglass Sanctum** | burrower, mite, warden, blinker, carrier, golem, hexer, tempest | 7/9, 2 yeni ada |
| 3. Çan ve Fener Adaları | manastır, cam atölyesi, meyve bahçesi, feribot | i17–i23 + **1 yeni** + i24 | **i24 Lastlight Head** | bellrunner, kilnback, reedpiper, draftwing | 8/9, 1 yeni ada |
| 4. (öneri) Kırağı Takımadası | buz, kar, aurora, donmuş şelale | 9 yeni | 9. ada + yeni boss | 2–3 yeni (ör. kuleyi yavaşlatan buz böceği, kalkanlı kızak) | güncelleme |
| 5. (öneri) Tutulma Gökleri | kararmış gök, kırık takımadalar, Skyhold'un kökeni | 9 yeni | final boss adası | 2–3 yeni + final boss | güncelleme |

Çıkışta önsöz + 27 ada olur; bunun için **3 yeni ada** gerekir. Sonra 4. ve 5. bölümlerle 18 ada daha eklenir; toplam önsöz + 45 ada.

Yeni adalar bölüm finalinden önce, ilgili bölümün biyomuna uyan araya girer. Zorluk eğrisi, 9. adada zirve yapıp sonraki bölümün 1. adasında biraz yumuşayacak şekilde ayarlanır. Bugün i17'de olan budur; bunu her bölüme uygularız.

Dalga sayısı da bölüme göre artar. Yaklaşık hedef:

| Bölüm | Dalga sayısı |
|---|---|
| 1 | 8–11 |
| 2 | 11–13 |
| 3 | 12–14 |
| 4–5 | 13–16 |

Bu, "hep 13 dalga" hissini de kırar.

## Yapılacak iş

### Faz A: bölüm iskeleti (yeni görsel yok, çıkış için şart)

1. **Veri:** `src/data/chapters.ts` dosyasında bölüm listesi olur: id, ad (TR/EN), biyom, ada sırası, final adası, renk. `LEVELS_2D` sırası buradan üretilir.
2. **Dünya haritası:** Her bölüm bir sayfa olur ve kendi deniz renk tonu ile 9 ada düğümü taşır. Üstte bölüm sekmeleri ya da oklar olur (Bölüm 1 · 6/9 ★). Kilitli bölüm sisli görünür.
3. **Kilit kuralı:** Bir bölümün finali kazanılınca sonraki bölüm açılır. Bölüm içindeki adalar bugünkü kuralla açılır.
4. **Bölüm kartları:**
   - Bölüm başlangıcında başlık kartı ve giriş hikâye paneli.
   - Finalden sonra "Bölüm tamamlandı" ekranı: yıldız toplamı ve sonraki bölüm.
5. **Mağaza:** Ücretsiz kapsam bölüm bazlı olur (öneri: önsöz + Bölüm 1). Kilit ekranında "Bölüm 2 ve sonrası tam macerada" yazar.
6. **Kayıt göçü:** Göç gerekmez çünkü id'ler aynı kalır. Yalnızca "bölüm tamamlandı" bayrakları mevcut yıldızlardan hesaplanır.
7. **Metin ve test:**
   - TR/EN metinler.
   - Testler: bölüm sırası, kilit zinciri, ücretsiz kapsam, eski kayıt yüklenince doğru bölümün açılması.

Tahmini süre: 1 ajan (Opus) ile yarım–1 gün, ardından iPhone kontrolü.

### Faz B: 3 yeni ada (çıkış için)

Her ada için yapılacaklar:
- Arazi ve sahne objeleri, yol dokusu, giriş/çıkış hikâye panelleri. Codex'in görsel üreticisiyle yapılır; Bölüm 2 adaları da böyle boyandı (`design/art-2d/chapter2/islands.md`).
- Yol ve kule yerleri `json`'u.
- Dalgalar ve map-life (rüzgâr, su, bulut).
- Denge sim'i ve TR/EN metin.

Flow kredisi **gerekmez**; map-life prosedürel. İstersek yalnızca bölüm finallerine video döngüsü ekleriz: ada başına yaklaşık 3 döngü × 24 = 72 kredi.

Tahmini süre: ada başına bir ajan (paralel en fazla 2), adalar 1–2 gün.

### Faz C: Bölüm 4 ve 5 (çıkış sonrası güncellemeler)

- Bölüm başına 9 ada, 2–3 yeni düşman ve 1 boss.
- Bölüm başına bir yeni öğe de düşünülebilir: yeni bir kule uzmanlığı ya da kahraman.
- Görsel üretimi en büyük iş. Boss ve düşman sprite'ları da yeni olur.

Kaba tahmin: bölüm başına 1–2 hafta (ajan + inceleme + telefon testi). Flow yalnızca finaller için kullanılırsa bölüm başına yaklaşık 72–150 kredi.

## Ajan kuralları (2026-11-24 hermes olayından sonra)

- Tarayıcı testi: tek Chromium, en fazla `--jobs 2`, bütün adaları tarama yok.
- Ajanlar yalnızca kendi `hermes/<slug>` branch'lerinde çalışır. Birleştirme, gate ve canlıya alma bizde.

## Kararlar (sahip)

1. **Ücretsiz kapsam:** önsöz + Bölüm 1 (10 ada). Bugün 6 ada; öneri 10.
2. **Satın alma:** Tam macera Bölüm 2–3'ü açar. Bölüm 4–5 satın alanlara bedava güncelleme olarak mı gelir (öneri: evet; yorumlar ve geri dönüş için iyi), yoksa ayrı paket mi olur?
3. **Bölüm 4–5 teması:** "Kırağı Takımadası" ve "Tutulma Gökleri" önerisi uygun mu?
4. **Bölüm finallerine özel boss:** Çıkışta mı (Bölüm 2 ve 3 için 2 yeni boss), yoksa güncellemeyle mi gelsin? Bugün boss çıkan bütün adalarda aynı `boss` düşmanı var.
5. **Bölüm adları:** Yukarıdaki adlar çalışma adı; değiştirilebilir.
