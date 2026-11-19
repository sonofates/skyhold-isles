// First-clear campaign profile. Both tower scripts enter an island with the same inventory.
import type { HeroId } from '../../src/core/types.ts';
import { ABILITY_DEFS } from '../../src/data/abilities.ts';
import { defaultSkillsForLevel, heroLevelFromXp } from '../../src/data/heroes.ts';
import { buyRank, WORKSHOP_UPGRADES, workshopModifiers, workshopStarsSpent } from '../../src/data/workshop.ts';
import type { SimWorld } from '../../src/sim/world.ts';

function ranksForCampaignStars(stars: number) {
  let ranks: Record<string, number> = {};
  // Buy one rank in each family in menu order, then the second ranks. Bank the change.
  for (let tier = 1; tier <= Math.max(...WORKSHOP_UPGRADES.map(u => u.costs.length)); tier++) {
    for (const def of WORKSHOP_UPGRADES) {
      if (tier > def.costs.length) continue;
      const bought = buyRank(ranks, def.id, stars - workshopStarsSpent(ranks));
      if (!bought) return ranks;
      ranks = bought;
    }
  }
  return ranks;
}

export function campaignKit(xp: number, stars: number, heroId: HeroId = 'bran') {
  const heroLevel = heroLevelFromXp(xp);
  const ranks = ranksForCampaignStars(stars);
  return {
    heroId, heroLevel, heroSkills: defaultSkillsForLevel(heroId, heroLevel),
    modifiers: workshopModifiers(ranks), ranks, meteor: true, overcharge: true,
  };
}

// Diagnostic runs can isolate either spell or the Workshop by leaving the hero at home.
export type CampaignKit = Omit<ReturnType<typeof campaignKit>, 'heroId'> & { heroId: HeroId | null };

/** Check every half second. Aim Meteor at a cluster and surge towers already in combat. */
export function driveGlobalAbilities(world: SimWorld, kit: CampaignKit): void {
  const pool = world.enemyPool;
  const count = pool.getActiveCount();
  if (count < 3) return;
  if (kit.meteor && world.abilitySystem.canCast('meteor')) {
    let bestCount = 2;
    let best = null;
    const radiusSq = ABILITY_DEFS.meteor.radius ** 2;
    for (let i = 0; i < count; i++) {
      const center = pool.items[pool.getActiveIndex(i)];
      if (center.burrowed) continue;
      let hits = 0;
      for (let j = 0; j < count; j++) {
        const e = pool.items[pool.getActiveIndex(j)];
        if (!e.burrowed && (e.x - center.x) ** 2 + (e.z - center.z) ** 2 <= radiusSq) hits++;
      }
      if (hits > bestCount) {
        bestCount = hits;
        best = center;
      }
    }
    if (best) world.castMeteor(best.x, best.z);
  }
  if (kit.overcharge && count >= 4 && world.abilitySystem.canCast('overcharge')
      && world.towers.some(t => t.cooldownTimer > 0 || t.stunTimer > 0)) world.castOvercharge();
}
