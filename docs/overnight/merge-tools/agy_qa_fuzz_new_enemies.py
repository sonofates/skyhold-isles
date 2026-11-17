"""Teach agy-qa's scripts/fuzzPlay.ts invariants about the ENEMIES branch mechanics (string edits, run once).
Usage (repo root, after merging hermes/skyhold-agy-qa): python3 docs/overnight/merge-tools/agy_qa_fuzz_new_enemies.py .
Same result as docs/overnight/agy-qa-fuzzPlay-new-enemies.patch, but survives line drift; an AssertionError
prints the anchor that no longer matches (agy-qa changed that line -> port that one rule by hand).
"""
import sys

p = sys.argv[1] + '/scripts/fuzzPlay.ts'
s = open(p).read()


def rep(old, new):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, 1)


rep("if (!e.isSplitChild && e.scaleOverride !== 1) {",
    "if (!e.isSplitChild && e.scaleOverride !== (e.elite ? ELITE_MODIFIERS.scaleMul : e.isDropped ? 0.86 : 1)) {")
rep("""      e.armor !== def.armor ||
      e.livesCost !== def.livesCost ||""",
    """      e.baseArmor !== def.armor + (e.elite ? ELITE_MODIFIERS.armorBonus : 0) ||
      (e.armorBreakTimer > 0 ? e.armor > e.baseArmor : e.armor !== e.baseArmor) ||
      e.livesCost !== def.livesCost ||""")
rep("""    const expectedPath = e.flying ? flightPath : groundPath;""",
    """    const expectedPath = world.enemySystem.getPath(e.flying, e.lane);""")
rep("""    const expectedPathLen = e.flying ? flightPathLen : groundPathLen;""",
    """    const expectedPathLen = Math.max(0.01, expectedPath.totalLength);""")
rep("""  const groundPath = world.enemySystem.getPath(false);
  const flightPath = world.enemySystem.getPath(true);
  const groundPathLen = Math.max(0.01, groundPath.totalLength);
  const flightPathLen = Math.max(0.01, flightPath.totalLength);
""", "")
rep("""    const maxStepDist = e.speed * BALANCE.fixedDt + 1e-4;""",
    """    const maxStepDist =
      e.speed * BALANCE.fixedDt * (e.burrowed ? (ENEMY_DEFS[e.type].burrowSpeedMul ?? 1) : 1) + 1e-4;""")
rep("const maxAllowedReward = Math.max(ENEMY_DEFS[ev.enemyType].reward, 2);",
    "const maxAllowedReward = Math.max(Math.round(ENEMY_DEFS[ev.enemyType].reward * ELITE_MODIFIERS.rewardMul), 2);")
rep("    if (_hashSeen.size !== activeEnemies) {",
    """    let burrowedCount = 0;
    for (let i = 0; i < activeEnemies; i++) {
      if (world.enemyPool.items[world.enemyPool.getActiveIndex(i)].burrowed) burrowedCount++;
    }
    if (_hashSeen.size !== activeEnemies - burrowedCount) {""")
rep("      if (!_hashSeen.has(poolIdx)) {",
    "      if (!_hashSeen.has(poolIdx) && !world.enemyPool.items[poolIdx].burrowed) {")
rep("      if (!_localHashProbe.includes(eIdx)) {",
    "      if (!enemy.burrowed && !_localHashProbe.includes(eIdx)) {")
rep("      if (!hovered || !hovered.active || hovered.flying !== sample.flying) {",
    "      if (!sample.burrowed && (!hovered || !hovered.active || hovered.flying !== sample.flying)) {")
rep("    if (ev.isBoss !== (ev.enemyType === 'boss')) {",
    "    if (ev.isBoss !== (ENEMY_DEFS[ev.enemyType].isBoss === true)) {")
rep("""const _localHashProbe: number[] = [];""",
    """const _localHashProbe: number[] = [];
// Enemies whose barrier (Aegis Warden pulse / Tempest Stormwall) soaked damage during the current tick. A fully
// soaked hit still lands (hit flash) but deals 0 HP damage, so the sim reports isBossHit=false for it. Cleared
// per tick, not per impact: Cannon T3 (TOWERS) emits its bomblet impacts before the main blast's impact event.
const _shieldSoakedThisTick = new Set<number>();""")
rep("""function assertTickInvariants(world: SimWorld, tracker: FuzzTracker, tick: number): string | null {""",
    """function assertTickInvariants(world: SimWorld, tracker: FuzzTracker, tick: number): string | null {
  _shieldSoakedThisTick.clear();""")
rep("""  events.on('projectileImpact', (ev) => {""",
    """  events.on('shieldAbsorb', (ev) => {
    _shieldSoakedThisTick.add(ev.enemyId);
  });
  events.on('projectileImpact', (ev) => {""")
rep("""          e.type === 'boss' &&
          e.hp > 0 &&
          Math.hypot(e.x - ev.x, e.z - ev.z) <= ev.radius - 1e-5""",
    """          e.type === 'boss' &&
          e.hp > 0 &&
          !_shieldSoakedThisTick.has(e.uid) &&
          Math.hypot(e.x - ev.x, e.z - ev.z) <= ev.radius - 1e-5""")
rep("""      (!e.isSplitChild && e.speed !== def.speed)
    ) {""",
    """      (!e.isSplitChild &&
        e.speed !==
          (e.type === 'tempest' && e.bossPhase === 2 ? def.speed * (def.enrageSpeedMul ?? 1.35) : def.speed))
    ) {""")
rep("""        e.type === 'boss' &&
        Math.hypot(e.x - ev.x, e.z - ev.z) <= 1e-5 &&
        Math.abs(ev.y - (e.y + 0.45)) <= 1e-6""",
    """        // The Tempest Colossus' phase-2 tower jams reuse the Dreadnought pulse (same stun rules).
        (e.type === 'boss' || (e.type === 'tempest' && e.bossPhase === 2)) &&
        Math.hypot(e.x - ev.x, e.z - ev.z) <= 1e-5 &&
        Math.abs(ev.y - (e.y + 0.45)) <= 1e-6""")
rep("""  events.on('bossPulse', (ev) => {""",
    """  // Gloam Hexer: a finished channel stuns one tower for hexStunSec (max with any running stun) — a legal new stun.
  events.on('towerHexed', (ev) => {
    const t = tracker.towerById.get(ev.towerId);
    if (!t || t.stunTimer + 1e-9 < ev.duration) {
      recordEventError(tracker, `towerHexed tower id=${ev.towerId} not stunned for ${ev.duration}s`);
    }
    tracker.newlyStunnedTowerIds.add(ev.towerId);
  });
  events.on('bossPulse', (ev) => {""")
rep("""  events.on('bossSummon', (ev) => {
    if (ev.count < 1 || ev.count > 2) {""",
    """  events.on('bossSummon', (ev) => {
    // Tempest Colossus enrage (phase 2) summons its own mite swarm, not Dreadnought escorts.
    world.spatialHash.query(ev.x, ev.z, 0.05, _localHashProbe);
    let tempestAtSource = false;
    for (let i = 0; i < _localHashProbe.length; i++) {
      const e = world.enemyPool.items[_localHashProbe[i]];
      if (
        e.active &&
        e.type === 'tempest' &&
        e.bossPhase === 2 &&
        Math.hypot(e.x - ev.x, e.z - ev.z) <= 1e-5 &&
        Math.abs(ev.y - (e.y + 0.8)) <= 1e-6
      ) {
        tempestAtSource = true;
        break;
      }
    }
    if (tempestAtSource) {
      if (ev.count < 1 || ev.count > (ENEMY_DEFS.tempest.enrageSummonCount ?? 6)) {
        recordEventError(tracker, `tempest bossSummon count=${ev.count} out of range`);
      }
      tracker.bossSummonCount++;
      tracker.stateHash = mixHash(mixHash(tracker.stateHash, 6), ev.count);
      return;
    }
    if (ev.count < 1 || ev.count > 2) {""")
rep("""      e.reward < 1 ||
      e.reward > def.reward
    ) {""",
    """      e.reward < 1 ||
      e.reward > (e.elite ? Math.round(def.reward * ELITE_MODIFIERS.rewardMul) : def.reward)
    ) {""")
if 'ELITE_MODIFIERS' not in s.split('\n\n')[0] and "import { ELITE_MODIFIERS" not in s:
    rep("import { ENEMY_DEFS", "import { ELITE_MODIFIERS, ENEMY_DEFS")
open(p, 'w').write(s)
print('patched')
