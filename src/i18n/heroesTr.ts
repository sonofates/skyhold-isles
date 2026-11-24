/** Turkish hero text, keyed by hero id / skill-node id (src/data/heroes.ts is the English fallback). */
export interface HeroTr {
  readonly name: string;
  readonly title: string;
  readonly shortDesc: string;
  /** One short role line, e.g. EN "Melee tank · holds the road". */
  readonly role: string;
  readonly passive: { readonly name: string; readonly desc: string };
  readonly actives: readonly [{ readonly name: string; readonly desc: string }, { readonly name: string; readonly desc: string }];
  /** Keyed by branch id. */
  readonly branches: Readonly<Record<string, { readonly name: string; readonly desc: string }>>;
  /** Keyed by skill-node id (all 13 nodes incl. the capstone). */
  readonly nodes: Readonly<Record<string, { readonly name: string; readonly desc: string }>>;
}

/** English role lines (no English role exists in the data). */
export const HERO_ROLE_EN: Readonly<Record<string, string>> = {
  bran: 'Melee tank · holds the road',
  wren: 'Long range · hits flyers',
  mira: 'Fire mage · area damage',
  tobb: 'Support · boosts towers',
  sela: 'Control · heals soldiers',
};

export const HEROES_TR: Readonly<Record<string, HeroTr>> = {
  bran: {
    name: 'Bran Demirmeşe',
    title: 'Kalkan Şövalyesi',
    shortDesc: 'Yolu tutan, düşman darbelerini zayıflatan ve yakındaki milisleri toparlayan yiğit bir yakın dövüş muhafızı.',
    role: 'Yakın dövüş tankı · yolu tutar',
    passive: {
      name: 'Siper',
      desc: 'Bran’ın durdurduğu kara düşmanları %22 daha az yakın dövüş hasarı verir.',
    },
    actives: [
      {
        name: 'Kalkan Darbesi',
        desc: 'Meşe kalkanını kısa bir koni içinde ileri savurur; çarpma hasarı verir ve kara düşmanlarını sersemletir.',
      },
      {
        name: 'Toplanma Sancağı',
        desc: 'Demirmeşe sancağını yere diker; yakındaki askerler fazladan zırh ve yakın dövüş hasarı kazanır.',
      },
    ],
    branches: {
      oakheart: { name: 'Meşeyürek', desc: 'Dayanıklılık, ağır zırh ve yol tutma gücü.' },
      ironclad: { name: 'Demirzırh', desc: 'Yarma vuruşları ve ezici kalkan darbeleri.' },
      vanguard: { name: 'Öncü', desc: 'Siper koruması ve milis sancakları.' },
    },
    nodes: {
      bran_oak_1: { name: 'Derin Kökler', desc: '+%15 azami can.' },
      bran_oak_2: { name: 'Tunç Kenar', desc: '+2 zırh.' },
      bran_oak_3: { name: 'Kalkan Duvarı', desc: 'Fazladan +1 kara düşmanı tutar ve %15 daha hızlı yeniden doğar.' },
      bran_oak_4: { name: 'Kadim Kütük', desc: '+%25 azami can ve +2 zırh.' },
      bran_iron_1: { name: 'Ağır Kabza', desc: '+%16 yakın dövüş saldırı hasarı.' },
      bran_iron_2: { name: 'Koçbaşı', desc: '+%25 Kalkan Darbesi hasarı ve +0,4 koni erimi.' },
      bran_iron_3: {
        name: 'Savuran Meşe',
        desc: 'Yakın dövüş savuruşları yakındaki bir düşmanı da %40 hasarla yarar ve 3 zırhı hiçe sayar.',
      },
      bran_iron_4: {
        name: 'Çan Çalan',
        desc: '+0,6 sn Kalkan Darbesi sersemletmesi, Darbe bekleme süresi −%20 ve +%15 saldırı hızı.',
      },
      bran_van_1: { name: 'Sağlam Nöbet', desc: 'Siper, durdurulan düşmanların hasarını %32 daha fazla azaltır.' },
      bran_van_2: { name: 'Yüce Sancak', desc: '+1,5 sn Toplanma Sancağı süresi ve +0,6 hale yarıçapı.' },
      bran_van_3: {
        name: 'Çelik Yemini',
        desc: 'Toplanma Sancağı askerlere fazladan +%15 hasar ve fazladan +2 zırh verir.',
      },
      bran_van_4: {
        name: 'Solmayan Nöbet',
        desc: 'Siper +%40 daha güçlü, Toplanma Sancağı bekleme süresi −%20.',
      },
      bran_cap: {
        name: 'Demirmeşe’nin Yüreği',
        desc: '+%20 can ve hasar; Kalkan Darbesi düşmanları ardından üşütür, Toplanma Sancağı yakındaki dostları iyileştirir.',
      },
    },
  },

  wren: {
    name: 'Wren Göktüy',
    title: 'Gök Korucusu',
    shortDesc: 'Uçanları kritik oklarla cezalandıran ve öncelikli hedefleri işaretleyen çevik bir uzun yay nişancısı.',
    role: 'Uzun menzil · uçanları vurur',
    passive: {
      name: 'Keskin Göz',
      desc: 'Okları uçan düşmanlara %35 ihtimalle kritik vurur ve +%75 fazladan hasar verir.',
    },
    actives: [
      {
        name: 'Ok Sağanağı',
        desc: 'Hedef alana tüylü oklardan bir yağmur salar; kara ve uçan düşmanlara vurur.',
      },
      {
        name: 'Avcı İşareti',
        desc: 'Hedef noktanın yakınındaki öncelikli bir düşmanı işaretler; o düşman bütün kulelerden fazladan +%25 hasar alır.',
      },
    ],
    branches: {
      skybow: { name: 'Gökyay', desc: 'Germe hızı, menzil ve zırh delen temrenler.' },
      quiver: { name: 'Bora Sadağı', desc: 'Keskin Göz kritikleri ve daha ağır ok sağanakları.' },
      stalker: { name: 'Rüzgâr İzcisi', desc: 'Avcı İşareti gücü ve çevik konumlanma.' },
    },
    nodes: {
      wren_bow_1: { name: 'Esnek Porsuk', desc: '+%14 saldırı hızı.' },
      wren_bow_2: { name: 'Delici Temrenler', desc: '+0,7 saldırı menzili ve +2 zırh delme.' },
      wren_bow_3: { name: 'Sert Germe', desc: '+%20 ok hasarı.' },
      wren_bow_4: { name: 'Bulanık Kiriş', desc: '+%20 saldırı hızı ve +3 zırh delme.' },
      wren_vol_1: { name: 'Şahin Gözü', desc: '+%15 Keskin Göz kritik ihtimali.' },
      wren_vol_2: { name: 'Geniş Bulut', desc: '+%25 Ok Sağanağı hasarı ve +0,4 alan yarıçapı.' },
      wren_vol_3: {
        name: 'Has Tüy',
        desc: 'Keskin Göz’e +%40 kritik bonus hasarı; kara düşmanlarına da yarı ihtimalle kritik vurur.',
      },
      wren_vol_4: {
        name: 'Çivileyen Yağmur',
        desc: 'Ok Sağanağı bekleme süresi −%20; Sağanak vurduğu düşmanları 2 sn boyunca %30 yavaşlatır.',
      },
      wren_mrk_1: { name: 'Hafif Pelerin', desc: '+%12 hareket hızı ve yeniden doğma süresi −%15.' },
      wren_mrk_2: { name: 'Kaçamayan Av', desc: '+1,5 sn Avcı İşareti süresi.' },
      wren_mrk_3: { name: 'Zırh Aralığı', desc: 'Avcı İşareti, alınan hasarı fazladan +%15 artırır.' },
      wren_mrk_4: {
        name: 'Sürü Gözcüsü',
        desc: 'Avcı İşareti yakındaki +1 düşmanı daha işaretler ve %20 daha hızlı dolar.',
      },
      wren_cap: {
        name: 'Göktüy Ustası',
        desc: '+%20 hasar, her 3. atışta ikiz ok salar ve Ok Sağanağı %45 hasarla ikinci bir yağmur daha indirir.',
      },
    },
  },

  mira: {
    name: 'Mira Korperi',
    title: 'Kor Büyücüsü',
    shortDesc: 'Saçılan korları ve atılan alev perisiyle zırhlı sürüleri eriten, fener asalı bir ateş büyücüsü.',
    role: 'Ateş büyücüsü · alan hasarı',
    passive: {
      name: 'Çıra',
      desc: 'Mira’nın vuruşları düşmanları 2,0 sn boyunca tutuşturur ve zırhı hiçe sayan ateşle kavurur.',
    },
    actives: [
      {
        name: 'Ateş Çemberi',
        desc: 'Bir noktada yanan bir çember çağırır; çember belirince patlar ve içindeki düşmanları kavurur.',
      },
      {
        name: 'Peri Atılışı',
        desc: 'Alev perisini bir hat boyunca fırlatır; yolundaki her kara ve uçan düşmanı kavurur.',
      },
    ],
    branches: {
      embercraft: { name: 'Kor Sanatı', desc: 'Daha sıcak Çıra yanıkları ve daha geniş kor patlamaları.' },
      hearthring: { name: 'Ocak Çemberi', desc: 'Dar geçitleri tutan kalıcı Ateş Çemberleri.' },
      lanternwisp: { name: 'Fener Perisi', desc: 'Daha uzun, daha ölümcül Peri Atılışları ve korumalı cüppeler.' },
    },
    nodes: {
      mira_emb_1: { name: 'Kuru Kav', desc: '+%30 Çıra saniyelik yanık hasarı.' },
      mira_emb_2: { name: 'Kızgın Kömürler', desc: '+1,0 sn Çıra süresi ve +0,25 mermi patlama yarıçapı.' },
      mira_emb_3: { name: 'Körük Nefesi', desc: '+%18 mermi hasarı ve +%15 saldırı hızı.' },
      mira_emb_4: { name: 'Akkor Kıvılcımlar', desc: '+%45 Çıra saniyelik yanık hasarı ve mermilere +3 zırh delme.' },
      mira_rng_1: { name: 'Geniş Halka', desc: '+0,45 Ateş Çemberi yarıçapı.' },
      mira_rng_2: { name: 'Kavuran Kenar', desc: '+%25 Ateş Çemberi patlama ve yanık hasarı.' },
      mira_rng_3: { name: 'Küllenmiş Ateş', desc: '+1,5 sn Ateş Çemberi süresi ve bekleme süresi −%15.' },
      mira_rng_4: { name: 'Sıcak Pus', desc: '+%20 Ateş Çemberi hasarı; içindeki düşmanları %25 yavaşlatır.' },
      mira_wsp_1: { name: 'Kor Dokuma Cüppe', desc: '+%18 azami can ve yeniden doğma süresi −%15.' },
      mira_wsp_2: { name: 'Kuyruklu Yıldız', desc: '+%25 Peri Atılışı hasarı ve +1,0 atılış uzunluğu.' },
      mira_wsp_3: { name: 'Parlak Fener', desc: '+0,7 saldırı menzili ve Peri Atılışı bekleme süresi −%20.' },
      mira_wsp_4: {
        name: 'Alev Kabarması',
        desc: '+%30 Peri Atılışı hasarı; hasar vermeden önce düşman kalkanlarını kırar.',
      },
      mira_cap: {
        name: 'Yangın Güneşi',
        desc: '+%25 mermi ve Çıra hasarı; Peri Atılışı, atılışın bittiği yerde alev alev bir Ateş Çemberi bırakır.',
      },
    },
  },

  tobb: {
    name: 'Tobb Çarkusta',
    title: 'Usta Mucit',
    shortDesc: 'Yakındaki kuleleri ayarlayan, otomatik düzenekler kuran ve sersemleyen kuleleri elden geçiren, pirinç sırt çantalı neşeli bir mühendis.',
    role: 'Destek · kuleleri güçlendirir',
    passive: {
      name: 'İnce Ayar',
      desc: 'Tobb’un yakınındaki kuleler %10 daha hızlı saldırır.',
    },
    actives: [
      {
        name: 'Düzenek Kur',
        desc: 'Kara ve uçan düşmanlara seri perçin atan, geçici bir pirinç otomatik taret kurar.',
      },
      {
        name: 'Elden Geçir',
        desc: 'Yakındaki bir kulenin sersemlemesini giderir, onu anında doldurur ve atış hızını 5 sn boyunca +%40 artırır.',
      },
    ],
    branches: {
      clockwork: { name: 'Saat İşi', desc: 'İnce Ayar erimi, kule ayarı ve ağır perçinler.' },
      automata: { name: 'Otomatlar', desc: 'Daha uzun dayanan, daha sert vuran Düzenek taretleri.' },
      wrenchworks: { name: 'Anahtar İşliği', desc: 'Elden Geçir gücü ve sağlam pirinç kaplama.' },
    },
    nodes: {
      tobb_clk_1: { name: 'Uzun Vinç', desc: '+0,6 İnce Ayar hale yarıçapı.' },
      tobb_clk_2: {
        name: 'Yağlı Dişliler',
        desc: 'İnce Ayar, yakındaki kulelerin atış hızını %35 daha fazla artırır.',
      },
      tobb_clk_3: { name: 'Çelik Perçinler', desc: '+%20 perçin hasarı ve +3 zırh delme.' },
      tobb_clk_4: {
        name: 'Nişan Mercekleri',
        desc: 'İnce Ayar yakındaki kulelere +%8 menzil de verir; hız bonusu +%25 daha güçlü.',
      },
      tobb_giz_1: { name: 'Kurulu Zemberek', desc: '+2,5 sn Düzenek Kur süresi.' },
      tobb_giz_2: { name: 'Yivli Namlu', desc: '+%25 Düzenek hasarı ve +0,5 Düzenek atış menzili.' },
      tobb_giz_3: { name: 'Çift Cırcır', desc: 'Düzenek Kur bekleme süresi −%20 ve +0,4 atış/sn.' },
      tobb_giz_4: {
        name: 'Barut Kapsülleri',
        desc: '+%30 Düzenek hasarı; Düzenek atışları küçük bir patlamayla dağılır.',
      },
      tobb_ovh_1: { name: 'Kazan Önlüğü', desc: '+%20 azami can ve +2 zırh.' },
      tobb_ovh_2: { name: 'Yedek Pimler', desc: '+2,0 sn Elden Geçir süresi.' },
      tobb_ovh_3: {
        name: 'Yüksek Basınç',
        desc: 'Elden Geçir atış hızı artışına fazladan +%25 ve Elden Geçir bekleme süresi −%18.',
      },
      tobb_ovh_4: {
        name: 'Ekip Başı',
        desc: 'Elden Geçir komşu +1 kuleyi daha ayarlar ve Tobb’a +%18 saldırı hızı verir.',
      },
      tobb_cap: {
        name: 'Muazzam Makine',
        desc: 'Aynı anda 2 Düzenek kurulabilir, Tobb ve Düzenek hasarı +%20; Elden Geçir etkin Düzenekleri de tam güce çıkarır.',
      },
    },
  },

  sela: {
    name: 'Sela Gelgitçağıran',
    title: 'Fırtına Rahibesi',
    shortDesc: 'Milis askerlerini iyileştiren, dalgaları yavaşlatan ve zincir şimşek sıçratan, dingin bir gelgit ve fırtına büyücüsü.',
    role: 'Kontrol · askerleri iyileştirir',
    passive: {
      name: 'Durgun Sular',
      desc: 'Yakındaki askerlerin canını her saniye yeniler.',
    },
    actives: [
      {
        name: 'Dip Akıntısı',
        desc: 'Bir alana kabaran bir gelgit çeker; içine düşen her düşmana hasar verir ve onu çok yavaşlatır.',
      },
      {
        name: 'Yıldırım Çağrısı',
        desc: 'Yakındaki en çok 3 düşman arasında zincirlenen bir fırtına şimşeği indirir.',
      },
    ],
    branches: {
      calm: { name: 'Sığınak Gelgiti', desc: 'Durgun Sular şifası ve koruyucu deniz tılsımları.' },
      riptide: { name: 'Anafor', desc: 'Dip Akıntısı kontrolü ve üşüten deniz camı mermileri.' },
      squall: { name: 'Bora Ustası', desc: 'Çok kollu Yıldırım Çağrıları ve fırtına menzili.' },
    },
    nodes: {
      sela_cal_1: { name: 'Yumuşak Kabarma', desc: '+%35 Durgun Sular şifası.' },
      sela_cal_2: { name: 'Büyük Gelgit', desc: '+0,8 Durgun Sular yarıçapı ve +%18 azami can.' },
      sela_cal_3: {
        name: 'Kabuk Tılsımı',
        desc: 'Durgun Sular’daki askerler +2 zırh kazanır; Sela %15 daha hızlı yeniden doğar.',
      },
      sela_cal_4: { name: 'Kutlu Pınar', desc: '+%45 Durgun Sular şifası ve +%15 saldırı hızı.' },
      sela_und_1: { name: 'Geniş Kabarış', desc: '+0,5 Dip Akıntısı yarıçapı.' },
      sela_und_2: {
        name: 'Çeken Akıntı',
        desc: '+1,2 sn Dip Akıntısı yavaşlatma süresi ve +%30 Dip Akıntısı hasarı.',
      },
      sela_und_3: {
        name: 'Kırağı Serpintisi',
        desc: 'Normal saldırılar hedefleri üşütür (1,6 sn boyunca %22 yavaşlatma) ve +%18 hasar verir.',
      },
      sela_und_4: {
        name: 'Dipsiz Çekim',
        desc: '+%12 Dip Akıntısı yavaşlatma gücü ve Dip Akıntısı bekleme süresi −%20.',
      },
      sela_thn_1: { name: 'Çatal Şimşek', desc: 'Yıldırım Çağrısı fazladan +1 düşmana sıçrar.' },
      sela_thn_2: { name: 'Gök Örsü', desc: '+%25 Yıldırım Çağrısı hasarı.' },
      sela_thn_3: { name: 'Uzak Ufuk', desc: '+0,7 saldırı menzili ve Yıldırım Çağrısı bekleme süresi −%18.' },
      sela_thn_4: {
        name: 'Fırtına Korosu',
        desc: 'Yıldırım Çağrısı fazladan +2 kez sıçrar ve çarptığı kara düşmanlarını kısa süre sersemletir.',
      },
      sela_cap: {
        name: 'Girdabın Sesi',
        desc: '+%22 hasar; Yıldırım Çağrısı üşümüş düşmanlara +%30 daha sert vurur ve Dip Akıntısı yakındaki askerleri bir anda iyileştirir.',
      },
    },
  },
};
