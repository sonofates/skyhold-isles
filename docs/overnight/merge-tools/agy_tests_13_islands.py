"""Adapt agy-qa / agy-meta tests that pin 9 islands / 1 spawn / 2 endless Dreadnoughts (string edits, run once).
Usage (repo root, after merging the agy branches): python3 docs/overnight/merge-tools/agy_tests_13_islands.py .
Same result as docs/overnight/agy-tests-13-islands.patch, but survives line drift; an AssertionError prints the
anchor that no longer matches.
"""
import sys

root = sys.argv[1]


def patch(rel, pairs):
    p = f'{root}/{rel}'
    s = open(p).read()
    for old, new in pairs:
        assert s.count(old) >= 1, (rel, old[:90])
        s = s.replace(old, new)
    open(p, 'w').write(s)


patch('tests/data/contentContracts.test.ts', [
    ("""      expect(spawns).toEqual([lvl.pathWaypoints[0]]);""",
     """      // Islands with extra ground lanes (LevelDef.extraGroundPaths) have one spawn tile per lane.
      const expectedSpawns = [lvl.pathWaypoints[0], ...(lvl.extraGroundPaths ?? []).map((p) => p[0])]
        .map((s) => ({ col: s.col, row: s.row }))
        .sort((a, b) => a.row - b.row || a.col - b.col);
      expect(spawns).toEqual(expectedSpawns);"""),
    ("""      const walked = new Set<string>();
      for (let i = 0; i < lvl.pathWaypoints.length - 1; i++) {
        const a = lvl.pathWaypoints[i];
        const b = lvl.pathWaypoints[i + 1];
        expect((a.col === b.col) !== (a.row === b.row)).toBe(true);
        const dc = Math.sign(b.col - a.col);
        const dr = Math.sign(b.row - a.row);
        let c = a.col;
        let r = a.row;
        while (true) {
          const key = `${c},${r}`;
          const isJoin = i > 0 && c === a.col && r === a.row;
          if (!isJoin) {
            expect(walked.has(key)).toBe(false);
            walked.add(key);
          }
          expect(roadTiles.has(key)).toBe(true);
          if (c === b.col && r === b.row) break;
          c += dc;
          r += dr;
        }
      }
      expect(walked.size).toBe(roadTiles.size);""",
     """      // Every lane (main road + extraGroundPaths) is walked without revisiting its own tiles; extra
      // lanes merge into the main road, so the union of all lanes must cover every road tile.
      const walked = new Set<string>();
      for (const lane of [lvl.pathWaypoints, ...(lvl.extraGroundPaths ?? [])]) {
        const laneWalked = new Set<string>();
        for (let i = 0; i < lane.length - 1; i++) {
          const a = lane[i];
          const b = lane[i + 1];
          expect((a.col === b.col) !== (a.row === b.row)).toBe(true);
          const dc = Math.sign(b.col - a.col);
          const dr = Math.sign(b.row - a.row);
          let c = a.col;
          let r = a.row;
          while (true) {
            const key = `${c},${r}`;
            const isJoin = i > 0 && c === a.col && r === a.row;
            if (!isJoin) {
              expect(laneWalked.has(key)).toBe(false);
              laneWalked.add(key);
              walked.add(key);
            }
            expect(roadTiles.has(key)).toBe(true);
            if (c === b.col && r === b.row) break;
            c += dc;
            r += dr;
          }
        }
        expect(lane[lane.length - 1]).toEqual(lvl.pathWaypoints[lvl.pathWaypoints.length - 1]);
      }
      expect(walked.size).toBe(roadTiles.size);"""),
])

patch('tests/sim/endlessAndPool.test.ts', [
    ("""    // offset 9 -> 2 bosses with shorter interval
    const boss2 = buildEndlessWaveDef(shortLevel.waves.length + 9, shortLevel);
    const boss2Group = boss2.groups.find((g) => g.enemyType === 'boss');
    expect(boss2Group?.count).toBe(2);
    expect(boss2Group?.spawnInterval).toBeCloseTo(2.15, 5);""",
     """    // offset 9 -> a Tempest Colossus leads 1 Dreadnought (shorter interval); every 10th endless wave
    const boss2 = buildEndlessWaveDef(shortLevel.waves.length + 9, shortLevel);
    const boss2Group = boss2.groups.find((g) => g.enemyType === 'boss');
    expect(boss2Group?.count).toBe(1);
    expect(boss2Group?.spawnInterval).toBeCloseTo(2.15, 5);
    expect(boss2.groups.find((g) => g.enemyType === 'tempest')?.count).toBe(1);"""),
])

patch('tests/sim/metaMutatorsAndDaily.test.ts', [
    ("""    const expandedLevels = [...LEVELS, island10, island11];""",
     """    // Pin to the original 9 islands so the fake 10/11 sit at indices 9/10 however many real islands ship.
    const expandedLevels = [...LEVELS.slice(0, 9), island10, island11];"""),
])

patch('tests/sim/metaSaveAndStats.test.ts', [
    ("""    world.gold = 6000;
""",
     """    world.gold = 6000;
    world.lives = 100; // meta bookkeeping test, not a balance check: endless spotlight groups can overrun this build
"""),
    ("""    rawWorld.gold = 6000;
""",
     """    rawWorld.gold = 6000;
    rawWorld.lives = 100; // see above: meta bookkeeping, not balance
"""),
    # Lives can't be padded here (verifyWorldIntegrity tracks lives from BALANCE.startingLives), so the
    # build gets two more T3 towers to hold 5 Iron-Skies endless waves with the spotlight groups.
    ("""      [5, 7, 'mortar'],
      [7, 3, 'cannon'],
    ];
    for (const [col, row, type] of spots) {
      const tw = mutWorld.placeTower(col, row, type);""",
     """      [5, 7, 'mortar'],
      [7, 3, 'cannon'],
      [6, 2, 'tesla'],
      [9, 3, 'cannon'],
    ];
    for (const [col, row, type] of spots) {
      const tw = mutWorld.placeTower(col, row, type);"""),
    # The Daily island is drawn from all islands; the long roads of 10-13 need more than 40 s for 2 grunts.
    ("""    for (let i = 0; i < 60 * 40 && dailyWorld.outcome === 'ongoing'; i++) {""",
     """    for (let i = 0; i < 60 * 120 && dailyWorld.outcome === 'ongoing'; i++) {"""),
])

patch('tests/sim/fuzzPlay.test.ts', [
    ("""    expect([...summary.coverage.enemyTypesSpawned].sort()).toEqual([...ENEMY_TYPES].sort());
    expect([...summary.coverage.enemyTypesKilled].sort()).toEqual([...ENEMY_TYPES].sort());""",
     """    // The Tempest Colossus only appears in Stormcrown Citadel's final wave (22) and every 10th endless
    // wave, which this short smoke fuzz (random builds, 2 endless waves) never reaches; its phases are
    // covered by tests/sim/newEnemies.test.ts.
    const coveredTypes = ENEMY_TYPES.filter((t) => t !== 'tempest');
    expect([...summary.coverage.enemyTypesSpawned]).toEqual(expect.arrayContaining(coveredTypes));
    expect([...summary.coverage.enemyTypesKilled]).toEqual(expect.arrayContaining(coveredTypes));"""),
])
# Sim-heavy tests: ~4 s alone, but the full merged suite (50 files in parallel) pushed them past 15 s.
patch('tests/sim/metaMutatorsAndDaily.test.ts', [
    ("""  it('wins Challenging, Heroic, and Master Daily Watch runs in SimWorld with mutators, tower bans, and economy integrity intact', () => {""",
     """  it('wins Challenging, Heroic, and Master Daily Watch runs in SimWorld with mutators, tower bans, and economy integrity intact', { timeout: 40_000 }, () => {"""),
])
patch('tests/sim/metaChallenges.test.ts', [
    ("""  it('confirms tight curated challenges across Islands 2-9 are winnable in SimWorld', () => {""",
     """  it('confirms tight curated challenges across Islands 2-9 are winnable in SimWorld', { timeout: 40_000 }, () => {"""),
])
print('agy tests adapted')
