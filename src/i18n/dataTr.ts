/**
 * Turkish text for the data tables, keyed by the data ids (src/data/** stays English and is the
 * fallback: a missing id here shows the English data text). Same glossary as tr.ts.
 * Place names are translated so the isles read like a Turkish storybook; "Skyhold" stays a name.
 */
export interface DataTr {
  readonly islands: Readonly<Record<string, { readonly name: string; readonly subtitle: string }>>;
  readonly towers: Readonly<
    Record<string, { readonly name: string; readonly short: string; readonly desc: string; readonly role: string; readonly sigName: string; readonly sigDesc: string; readonly strong: string; readonly weak: string }>
  >;
  readonly enemies: Readonly<Record<string, { readonly name: string; readonly desc: string; readonly counter: string }>>;
  /** Codex chips, keyed by the English tag. */
  readonly tags: Readonly<Record<string, string>>;
  readonly challenges: Readonly<Record<string, { readonly name: string; readonly desc: string }>>;
  readonly branches: Readonly<Record<string, string>>;
  readonly upgrades: Readonly<Record<string, { readonly name: string; readonly ranks: readonly string[] }>>;
  /** Endless medal tiers by English name. */
  readonly tiers: Readonly<Record<string, string>>;
  readonly feats: Readonly<Record<string, { readonly name: string; readonly desc: string }>>;
}

export const DATA_TR: DataTr = {
  islands: {
    l1c: { name: 'Çayır Geçidi', subtitle: 'İki akıncı kapısı, kaleye giden tek bir yol' },
    i01: { name: 'Güneşli Çayır', subtitle: 'Kır çiçekli çayırlar ve şirin bir kulübe arasında kıvrılan yumuşak bir patika' },
    i02: { name: 'İkiz Köprü Adacığı', subtitle: 'Ahşap iskeleli, kayıklı bir liman adacığı; bir kanal ve ikiz köprülerle ikiye bölünmüş' },
    i03: { name: 'Yayla Hisarı', subtitle: 'Karlı çamlar arasında avlusunu sarmal saran bir dağ kalesi; yarlardan şelaleler dökülür' },
    i04: { name: 'Zümrüt Basamaklar', subtitle: 'Yosunlu zümrüt teraslar, ışıldayan kristal korular ve fenerli halat köprüler' },
    i05: { name: 'Yel Değirmeni Virajları', subtitle: 'Altın buğday tarlaları, gıcırdayan yel değirmenleri ve güz bahçeleri çevresinde ikiz firkete' },
    i06: { name: 'Hilal Lagünü', subtitle: 'Kumsallı bir fener lagününü çevreleyen, palmiyeli bir mercan adası' },
    i07: { name: 'Gök Köprüsü Geçidi', subtitle: 'Rüzgârın dövdüğü bir uçurumun iki yakasında, taş gök köprüleriyle bağlı ikiz kaleler' },
    i08: { name: 'Batık Burç', subtitle: 'Yosunlu yıkıntılar, meşaleler ve hendekli bir iç kaleyle yarı yarıya suya gömülmüş bir burç' },
    i09: { name: 'Büyük Skyhold', subtitle: 'Bulutların üstündeki taç hisar: mermer avlular ve altın sancaklar' },
    i10: { name: 'Kavşak Terasları', subtitle: 'İki akıncı kolu basamaklı kavşakta buluşur: muhafızlarını böl ya da birleştikleri yeri tut' },
    i11: { name: 'Rüzgârgözü Sivrileri', subtitle: 'Gök yolunun hiç uyumadığı, rüzgârın yırttığı sivri kayalar' },
    i12: { name: 'Fenerdüşü Vadisi', subtitle: 'Lanetçilerin en yakın kuleleri söndürdüğü, alacakaranlıkta dönemeçli bir yol' },
    i13: { name: 'Fırtınataç Hisarı', subtitle: 'Fırtınanın gözündeki sarmal kale: Adaların son direnişi' },
    i14: { name: 'Kehribartaş Yaylası', subtitle: 'Üç çöl kapısı güneşte kavrulan tek bir yola akar ve meydan hepsini birden görür' },
    i15: { name: 'Ayçeşmesi Geçidi', subtitle: 'Ayçeşmesinde kendi üstünden geçen düğüm gibi bir yol ve onu atlayan geç bir kapı' },
    i16: { name: 'Közcam Tapınağı', subtitle: 'İki ordunun ters yönlerde döndüğü halka bir kale; kuzey kapısı çoktan açık' },
    // Chapter two.
    i17: { name: 'Bulut Çanı Manastırı', subtitle: 'Yıkık çan kulesinin altında iki yol birleşiyor. Tavşanlar çanların tokmaklarını kaçırmış.' },
    i18: { name: 'Cam Fener Atölyesi', subtitle: 'Fırınlar sönmüş. Cevher yolunu izleyip kristal mağaranın çevresini dolaş.' },
    i19: { name: 'Fener İnciri', subtitle: 'Tohum sepetleri düşüyor. Yaşlı incir ağacının çevresini dolanan iki kök yolunu izle.' },
    i20: { name: 'Üç Flama Burnu', subtitle: 'Üç fırtına flaması ipinden kopmuş. Tekneler kayalıkları geçene kadar burnu savun.' },
    i21: { name: 'Uçurtmacı Çayırı', subtitle: 'Rüzgârı ölçen uçurtma düştü. Uçurtmacı kopan ipi sarana dek kayalıklardaki virajları savun.' },
    i22: { name: 'Tuzcam Salı', subtitle: 'Salın halatı koptu. Son yük karşı kıyıya varana kadar iki tuz yolunu da savun.' },
    i23: { name: 'Mum Işığı Bahçesi', subtitle: 'Deniz fenerini yeniden yakmak için bir alev gerek. Son balmumu arabası geçene dek armut bahçesinin yollarını açık tut.' },
    i24: { name: 'Son Işık Burnu', subtitle: 'Deniz feneri söndü. Fenerci lambayı yeniden yakana dek deniz kalesini ve iki iskeleyi savun.' },
  },
  towers: {
    archer: {
      name: 'Okçu Kulesi',
      short: 'Okçu',
      desc: 'Hızlı, tek hedefli oklar. Karaya ve uçanlara vurur.',
      role: 'Hızlı oklar · kara ve hava',
      sigName: 'Ok Yağmuru',
      sigDesc: 'Her 6. atışta yakındaki bir düşmana fazladan bir ok daha salar.',
      strong: 'Ucuz ve hızlı; havada da karada da her işi görür.',
      weak: 'Küçük vuruşları zırha takılır (Zorbalar, Golemler).',
    },
    cannon: {
      name: 'Top Burcu',
      short: 'Top',
      desc: 'Kavis çizip patlayan, çevreye hasar saçan gülleler. Yalnızca kara.',
      role: 'Patlayan gülleler · yalnız kara',
      sigName: 'Misket Gülle',
      sigDesc: 'Her patlama, kraterin çevresindeki düşmanlara çarpan bombacıklar saçar.',
      strong: 'Patlayan gülleler kalabalıkları, bölünenleri ve sürüleri ezer.',
      weak: 'Uçanlara vuramaz; gülleleri hızlı koşucuları ıskalar.',
    },
    frost: {
      name: 'Ayaz Kulesi',
      short: 'Ayaz',
      desc: 'Hedefleri küçük bir ayaz patlamasıyla üşütür; yavaşlatma birikir. Karaya ve uçanlara vurur.',
      role: 'Üşütür, yavaşlatır · kara ve hava',
      sigName: 'Kırılgan',
      sigDesc: 'Üşüyen düşmanlar ayaz oklarından fazladan hasar alır: ne kadar soğuksa o kadar sert.',
      strong: 'Biriken yavaşlatma bütün kuleleri güçlendirir; sıçramaları geciktirir, Golem zırhını çatlatır.',
      weak: 'Tek başına neredeyse hiç hasar vermez.',
    },
    tesla: {
      name: 'Tesla Bobini',
      short: 'Tesla',
      desc: 'Yakındaki düşmanlar arasında zincirleme şimşek sıçratır. Karaya ve uçanlara vurur.',
      role: 'Zincir şimşek · kara ve hava',
      sigName: 'Aşırı Yük',
      sigDesc: 'Her 6. boşalma çok daha sert vurur ve bir sıçrama daha öteye gider.',
      strong: 'Zincir şimşek sürüleri, kalkanlı grupları ve hava yollarını eritir.',
      weak: 'Menzili kısa; tek ve iri hedeflere karşı zayıf.',
    },
    mortar: {
      name: 'Kuşatma Havanı',
      short: 'Havan',
      desc: 'Çok uzun menzilli ağır mermiler; dibinde kör bir nokta var. Yalnızca kara.',
      role: 'Dev menzil · dibi kör',
      sigName: 'Yangın',
      sigDesc: 'Mermiler yanan bir zemin bırakır; alevler zırhı hiçe sayıp düşmanları kavurur.',
      strong: 'Dev menzil ve patlama; Yangın zırhı hiçe sayar.',
      weak: 'Dibi kör, mermileri yavaş, yalnız karaya vurur.',
    },
    ballista: {
      name: 'Gökdelici Balista',
      short: 'Balista',
      desc: 'Zırhı delen uzun menzilli oklar. Yavaş; karaya ve uçanlara vurur.',
      role: 'Zırh delen oklar · kara ve hava',
      sigName: 'Şiş',
      sigDesc: 'Oklar, hedefin arkasında sıralanmış iki düşmanın daha içinden geçer.',
      strong: 'Oklar zırhı deler, sıra sıra düşmanın içinden geçer: Zorbalar, Golemler ve elebaşları.',
      weak: 'Yavaş dolar; sürülere harcanır.',
    },
    beacon: {
      name: 'Rüzgârçağıran Fener',
      short: 'Fener',
      desc: 'Hiç saldırmaz. Çevresindeki kulelerin atış hızını artırır.',
      role: 'Destek · yakın kuleleri hızlandırır',
      sigName: 'Uzak Görüş',
      sigDesc: 'Halesindeki kulelerin menzilini de uzatır.',
      strong: 'Hiç ateş etmez ama ışığındaki her kule daha hızlı atar (III. seviye: menzil de artar).',
      weak: 'Tek başına bir şey yapmaz; elebaşı tıkamaları onu söndürür. Haleler üst üste binmez.',
    },
    barracks: {
      name: 'Milis Kışlası',
      short: 'Kışla',
      desc: 'Yolu tutmaları için asker yollar. Kara düşmanlarını yakın dövüşte durdururlar; uçanlar üstlerinden geçer.',
      role: 'Askerler yolu tutar',
      sigName: 'Yarma',
      sigDesc: 'Her asker savuruşu, hedefin yanındaki ikinci bir düşmana da vurur.',
      strong: 'Askerler yolu tutar: durdurulan düşmanlar kulelerinin ateşi altında çakılı kalır.',
      weak: 'Uçanlar üstten, kazıcılar alttan geçer, sıçrayıcılar atlar; sürüler ve elebaşları bir mangayı ezer.',
    },
  },
  enemies: {
    grunt: {
      name: 'Akıncı Er',
      desc: 'Yol boyunca kararlı adımlarla yürüyen dengeli bir piyade.',
      counter: 'Her şey işe yarar. Okçular ve Toplar onları ucuza halleder.',
    },
    runner: {
      name: 'Meltem Koşucusu',
      desc: 'Yavaş kulelerin önünden fırlayıp geçen, canı az, çevik bir öncü.',
      counter: 'Ayaz onu yavaşlatır; Tesla zincirleri bütün sürüyü patlatır. Yavaş gülleler çoğu zaman ıskalar.',
    },
    brute: {
      name: 'Demir Zorba',
      desc: 'Ağır zırhlı bir dev. Her vuruştan sabit bir miktar hasarı yutar.',
      counter: 'Sık değil, sert vur: Top, Havan ya da Balista (oklar zırhı deler). Okçu okları onu zor çizer.',
    },
    flyer: {
      name: 'Gök Süzücüsü',
      desc: 'Arazinin üstünden kendi hava yolunda süzülür. Yalnızca havaya vuran kuleler ona yetişir.',
      counter: 'Yalnızca Okçu, Ayaz, Tesla ve Balista vurabilir.',
    },
    healer: {
      name: 'Koru Şifacısı',
      desc: 'Belli aralıklarla yakındaki dostlarını iyileştiren bir hale yayar.',
      counter: 'Önce onu indir. Tesla zincirleri ve Havan patlamaları kalabalığın içine uzanır; En güçlü hedeflemesini dene.',
    },
    splitter: {
      name: 'Kor Bölünen',
      desc: 'Ölünce iki çevik yavruya parçalanan, kararsız bir kor yaratığı.',
      counter: 'Patlama (Top, Havan) yavruları temizler; Tesla aralarında sıçrar.',
    },
    warden: {
      name: 'Kalkan Muhafızı',
      desc: 'Birkaç saniyede bir yakındaki dostlarına parıldayan bir kalkan örer. Kalkanlar hasarı candan önce emer.',
      counter: 'Önce ona yüklen. Patlama ve zincir şimşek birçok kalkanı birden kırar.',
    },
    burrower: {
      name: 'Toprak Kazıcı',
      desc: 'Yolun altında kısa kısa tünel kazar: yer altındayken hedef alınamaz ve daha hızlıdır.',
      counter: 'Bütün yolu kapsa ki yüzeye çıktığında menzilde bir kule olsun; çıktığı yerde patlama işe yarar.',
    },
    carrier: {
      name: 'Bulut Taşıyıcı',
      desc: 'Hava yolunda ağır ağır ilerleyen bir gök mavnası. Düşürülünce yola iki akıncı bırakır.',
      counter: 'Okçu ya da Tesla ile erkenden düşür; geç düşerse akıncıları sığınağın dibine bırakır.',
    },
    blinker: {
      name: 'Yarık Sıçrayıcı',
      desc: 'Bir yarık doldurur ve yol boyunca ileri sıçrar. Ayaz, yüklenmesini yavaşlatır.',
      counter: 'Ayaz her sıçramayı geciktirir. Sıçramadan önce hızla indir.',
    },
    golem: {
      name: 'Bazalt Golem',
      desc: 'Muazzam zırhlı, yürüyen bir bazalt kütlesi. Üşüten vuruşlar kabuğunu birkaç saniyeliğine çatlatır.',
      counter: 'Ayaz kabuğunu birkaç saniyeliğine çatlatır; ardından ağır vuruşlarla gir. Balista ve Yangın zırhı hiçe sayar.',
    },
    mite: {
      name: 'Tıkırtı Böceği',
      desc: 'Kalabalık sürüler halinde gelen, minicik, tıkır tıkır bir haşere.',
      counter: 'Patlama ve zincir şimşek sürüleri dağıtır; tek hedefli kuleler atış israf eder.',
    },
    hexer: {
      name: 'Alacakaranlık Lanetçisi',
      desc: 'Fener taşıyan bir lanetçi. Yola yakın bir kule görünce durur, fenerini kaldırır ve o kuleyi bir süreliğine susturur.',
      counter: 'Kulelerine varmadan indir. Yoldan iki kare uzaktaki kulelere yetişemez; Aşırı Şarj lanetleri kaldırır.',
    },
    tempest: {
      name: 'Fırtına Devi',
      desc: 'Fırtınada dövülmüş bir dev. Canı üçte ikiye inince kendisinin ve yakın dostlarının üstüne bir Fırtına Duvarı örer; üçte bire inince öfkelenir, hızlanır ve gök gürültüsüyle kuleleri tıkar.',
      counter: 'Ani hasarını her evre için sakla. Aşırı Şarj gök gürültüsü tıkamalarını açar; Balista ve Meteor zırhı yarar.',
    },
    boss: {
      name: 'Skyhold Dehşeti',
      desc: 'Devasa, zırhlı bir savaş beyi. Canı yarıya inince muhafızlarını çağırır, dalgalar yayarak yakındaki kuleleri tıkar. Sığınağa ulaşırsa 5 can götürür.',
      counter: 'Balista ve Havan yığ, tıkamaları açmak için Aşırı Şarj hazır olsun; muhafızlarıyla toplandığında Meteor indir.',
    },
    // Chapter two.
    bellrunner: {
      name: 'Çan Tavşanı',
      desc: 'Açık yolda hızlandıkça koşumundaki çanlar da sıklaşan adımlarına ayak uydurur.',
      counter: 'Önüne bir asker çıkar ya da ayazla hızını kes. Yeniden hızlanması zaman alır.',
    },
    kilnback: {
      name: 'Fırın Sırtlı Kaplumbağa',
      desc: 'Kabuğuna ulaşan her darbe, pişmiş toprak plakalarından birini gevşetir. Ateş kesilince plakalar yeniden yerine oturur.',
      counter: 'Hızlı atışlarla kabuğunu gevşet, ardından plakalar yerine oturmadan ağır bir darbe indir.',
    },
    reedpiper: {
      name: 'Kamış Kavalcısı',
      desc: 'Durup kaval çalar. Son notası, yakındaki kara birliklerini yavaşlatan ayazı dağıtır.',
      counter: 'Çalarken sersemlet ya da ayaz saldırısını son notadan sonraya sakla.',
    },
    draftwing: {
      name: 'Esinti Güvesi',
      desc: 'Gök yolunda önündeki güvenin kanat çırpışlarıyla oluşan hava akımına girip hızlanır.',
      counter: 'Zincirleme yıldırımla sürüyü dağıt. Öndeki güveyi düşürürsen arkasındaki de yavaşlar.',
    },
  },
  tags: {
    Ground: 'Kara',
    Fast: 'Hızlı',
    Armored: 'Zırhlı',
    Air: 'Hava',
    Support: 'Destek',
    Splits: 'Bölünür',
    Evasive: 'Kaçak',
    Carrier: 'Taşıyıcı',
    Teleports: 'Sıçrar',
    Swarm: 'Sürü',
    Disables: 'Susturur',
    Boss: 'Elebaşı',
    'Air + Ground': 'Hava + Kara',
    'Single target': 'Tek hedef',
    'Ground only': 'Yalnız kara',
    Splash: 'Patlama',
    Slow: 'Yavaşlatır',
    Chain: 'Zincir',
    'Long range': 'Uzun menzil',
    'Armor-piercing': 'Zırh deler',
    Aura: 'Hale',
    Blocking: 'Yol keser',
    'Any foe': 'Her düşman',
    'Gold aura': 'Altın hale',
  },
  challenges: {
    thaw: { name: 'Çözülme', desc: 'Ayaz Kulesi kurulamaz' },
    quietGuns: { name: 'Sessiz Toplar', desc: 'Top ve Havan kurulamaz' },
    bowless: { name: 'Yaysız', desc: 'Okçu Kulesi kurulamaz' },
    staticFree: { name: 'Durgun Hava', desc: 'Tesla Bobini kurulamaz' },
    galeForce: { name: 'Sert Rüzgâr', desc: 'Düşmanlar %12 daha hızlı' },
    ironTide: { name: 'Demir Akın', desc: 'Düşmanların canı %12 fazla' },
    thinPurse: { name: 'İnce Kese', desc: 'Başlangıç altını %30 az, düşmanlar %15 az altın bırakır' },
    glassSanctuary: { name: 'Cam Sığınak', desc: 'Yalnızca 8 can (Atölye canları sayılmaz)' },
    silentSkies: { name: 'Sessiz Gökler', desc: 'Meteor Yağmuru ve Aşırı Şarj kapalı' },
    championHost: { name: 'Şampiyon Ordu', desc: 'Her dalganın en büyük grubu Güçlenmiş gelir' },
  },
  branches: { economy: 'Ekonomi', defense: 'Savunma', towers: 'Kuleler' },
  upgrades: {
    treasury: { name: 'Gök Hazinesi', ranks: ['+10 başlangıç altını', '+20 başlangıç altını'] },
    bounty: { name: 'Ödül Fermanı', ranks: ['Düşman başına +%2 altın', 'Düşman başına +%4 altın'] },
    bastion: { name: 'Burç Surları', ranks: ['+1 can', '+2 can'] },
    quickcast: { name: 'Çabuk Rünler', ranks: ['Yetenek bekleme süresi −%8', 'Yetenek bekleme süresi −%15'] },
    fletcher: { name: 'Okçu Takımı', ranks: ['+%1 atış hızı', '+%2 atış hızı'] },
    powder: { name: 'Barut İşliği', ranks: ['+%1 atış hızı', '+%2 atış hızı'] },
    storm: { name: 'Fırtına Bilgisi', ranks: ['+%1 atış hızı', '+%2 atış hızı'] },
  },
  tiers: { Bronze: 'Bronz', Silver: 'Gümüş', Gold: 'Altın' },
  feats: {
    firstLanding: { name: 'İlk Kıyı', desc: 'İlk adanı geç' },
    islandHopper: { name: 'Ada Gezgini', desc: '5 ada geç' },
    skyCharted: { name: 'Gökler Haritada', desc: 'Bütün adaları geç' },
    starcatcher: { name: 'Yıldız Avcısı', desc: 'Herhangi bir adada 3 yıldız kazan' },
    stargazer: { name: 'Yıldız Gözcüsü', desc: 'Sefer yıldızlarının yarısını topla' },
    fullFirmament: { name: 'Dolu Gökkubbe', desc: 'Bütün sefer yıldızlarını topla' },
    masterStroke: { name: 'Usta İşi', desc: 'Usta bir adada 3 yıldız kazan' },
    badgeHunter: { name: 'Rozet Avcısı', desc: '6 ada meydan okuması kazan' },
    crowned: { name: 'Taç Giyen', desc: 'Bir adayı taçlandır (3 yıldız ve iki rozet)' },
    stormChaser: { name: 'Fırtına Kovalayan', desc: 'Altın sonsuz madalyası kazan (tek adada 10 sonsuz dalga)' },
    squallRider: { name: 'Fırtına Binicisi', desc: '7 kez Günün Fırtınası kazan' },
    steadyWinds: { name: 'Kararlı Rüzgârlar', desc: 'Günün Fırtınası’nda 3 günlük seriye ulaş' },
    veteran: { name: 'Kıdemli Muhafız', desc: '30 savaş kazan' },
  },
};
