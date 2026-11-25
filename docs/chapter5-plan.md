# 5. Bölüm planı: Tutulma Gökleri / Eclipse Skies

Durum: 2026-11-25, sahibin "5. Bölüm'e başla" kararıyla başladı. Kampanyanın son bölümü.

- 9 yeni ada `i37`–`i45`, final `i45`. 4. Bölüm finali `i36` kazanılınca açılır.
- Dalga sayısı 14–16 arasında, bölüm boyunca artar. Final 16 dalga.
- 2 yeni düşman ve oyunun son boss'u.
- Hikâye: Gök kararmış, takımadalar kırılmış. Skyhold'un ilk kurulduğu yere dönülüyor.
- Görseller Codex'in görsel üreticisiyle yapılır. Map-life prosedürel olduğu için **Flow kredisi gerekmez**.
- Süreç 4. Bölüm'deki gibi (`docs/chapter4-plan.md`): düşmanlar ile görselleri paralel yapılır, adalar 3'erli gruplar halinde gelir, her grubun ardından dalga ve denge işi, en sonda bütün bölüm için tek bir denge turu.

## Yeni düşmanlar

Mevcut 22 düşmanla çakışmasın diye seçildi:
- hexer kuleyi susturur, tempest ve boss kuleleri sıkıştırır, rimebeetle ateş hızını düşürür.
- Bu bölümde menzil düşüşü ve sürü öfkesi yeni.

| id | EN / TR | Rol | Mekanik | Karşılığı |
|---|---|---|---|---|
| `duskhound` | Dusk Hound / Alacakaranlık Tazısı | yer, hızlı, sürü | 4–6'lık sürüler halinde gelir. Sürüden biri ölünce, 5 kare içindeki diğerleri 4 sn boyunca %30 hızlanır (öfke). Üst üste en fazla 2 kez biner. | Sürüyü birlikte vurmak (havan, tesla zinciri) ya da yavaşlatmak. Tek tek vurmak sürüyü hızlandırır. |
| `veilcaster` | Veilcaster / Örtü Büyücüsü | yer, destek | 6 sn'de bir, menzilindeki en yakın kuleye karanlık örtü atar: kulenin menzili 4 sn boyunca %30 kısalır. Aynı kuleye üst üste binmez. Görsel: kulenin etrafında koyu halka. | Öncelikli hedef. Uzun menzilli kuleler (ballista, havan) ya da kahraman. |
| `eclipse_sovereign` | Eclipse Sovereign / Tutulma Hükümdarı (son boss, yalnız `i45`) | yer, boss | **%66'da** tutulma: gök kararır (ekran filtresi), bütün kuleler 8 sn boyunca %20 menzil kaybeder. **%40'ta** ikiye bölünür: iki "Gölge Yarısı" çıkar, her birinin canı kalan canın %55'i; ikisi de ölmeden savaş bitmez. Bölünürken 4 `duskhound` çağırır. | Patlama hasarını bölünmeye saklamak, kuleleri yola yaymak, Overcharge'ı tutulmaya ayırmak. |

Kurallar:
- Sim, mevcut boss evre, çağırma ve bölünme sistemlerini kullanır (`splitter` bölünmesi örnek). Yeni sistem küçük tutulur ve test edilir.
- Menzil düşüşü yalnız saldırı menzilini etkiler. Aura menzili, satma ve yükseltme etkilenmez. UI'da menzil halkası daralmış çizilir.
- Kayıt ve tekrarların aynı kalması şart. Yeni durum, yalnız var olduğunda hash'e girer (4. Bölüm'de olduğu gibi).
- Her düşmanın kaydı eksiksiz olur: defs, melee, HUD ikonu, bestiary metni (TR/EN), ölüm notu, ses, 3D figür, "Yeni" etiketi ve endless spotlight.
- Örnek: `docs/handoff-ch4-foes.md`.

## Adalar (çalışma adları)

| id | EN | TR | Tema / imza obje | Tanıtılan | Dalga |
|---|---|---|---|---|---|
| i37 | Duskfall Landing | Alacakaranlık İskelesi | Kopmuş zincirli yüzen iskele, mor gök | — (açılış, biraz yumuşak) | 14 |
| i38 | Shardfloat Isles | Kırık Adacıklar | Köprülerle bağlı küçük yüzen kayalar | `duskhound` | 14 |
| i39 | Umbral Grove | Gölge Korusu | Siyah yapraklı ağaçlar, parlayan mantarlar | — | 14 |
| i40 | Starfall Crater | Yıldız Düşüğü | Göktaşı krateri, parlayan yıldız madeni | `veilcaster` | 15 |
| i41 | Sundial Ruins | Güneş Saati Harabesi | Dev kırık güneş saati, gölgesi yolu keser | — | 15 |
| i42 | Chainward Bastion | Zincir Burcu | Adaları tutan dev çapa zincirleri | — | 15 |
| i43 | The First Forge | İlk Ocak | Skyhold'un kurulduğu kadim gök ocağı | — | 15 |
| i44 | Lumen Archive | Işık Arşivi | İlk kurucuların kütüphanesi, uçuşan sayfalar | — | 16 |
| i45 | Eclipse Throne | Tutulma Tahtı | Final: tutulmuş güneş altında taht, boss sahnesi | `eclipse_sovereign` | 16 |

Görsel çıta (4. Bölüm'den öğrenilenler):
- Boyalı kenar mimarisi, büyük bir imza obje ve 2–3 orta boy obje olsun.
- Zeminde çeşitlilik olsun, düşman kapıları biyoma özel olsun.
- Telefonda yolun okunması için değer zıtlığı güçlü olsun. Karanlık bölümde yol özellikle zor okunabilir; sıcak ışık kaynakları (fenerler, yıldız madeni, ocak) kullanılmalı.
- **Yol düzeni her adada farklı olsun.** Önceki bölümlerde kullanılan "soldan iki giriş birleşip sağdaki kaleye gider" kalıbı tekrar edilmez.

## İş bölümü (hermes)

**Faz 1, paralel:**
- **A, Claude:** iki düşman ve son boss: sim, veri, kayıtlar, UI, metinler, testler, yer tutucu görsel.
- **B, Codex (çalışma dizini 2):** üç birimin sprite atlasları ve bestiary görselleri. Boss için iki atlas: tam hali ve Gölge Yarısı.
- **C, Codex (çalışma dizini 1):** i37–i39. Dalgalar şimdilik mevcut düşmanlarla.

**Faz 2:**
- Dalga ajanı `duskhound`'u i38'de tanıtır.
- Codex i40–i42'yi yapar; `veilcaster` i40'ta tanıtılır.
- Dalga ve denge ajanı.

**Faz 3:**
- Codex i43–i45'i ve boss finalini yapar.
- Bütün bölüm için son denge turu: zorluk eğrisi, can kayıplarının yayılması, boss evreleri.
- Gate, canlıya alma, iPhone.

QA kuralı: tek Chromium, en fazla `--jobs 2`, bütün adaları tarama yok.

## Açık

- Ad ve düşman adları çalışma adı; değiştirilebilir.
- Oyunun sonu, yani i45 kazanılınca ne olacağı (bitiş sahnesi, jenerik) bu planın dışında. Ayrıca konuşulacak.
