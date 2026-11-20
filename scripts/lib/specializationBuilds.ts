import type { LevelDef, ScriptedBuildAction } from '../../src/data/levels/types.ts';
import type { TowerAbilityId, TowerSpecializationId } from '../../src/data/towers.ts';

export type BalanceBuildAction = ScriptedBuildAction
  | { readonly action: 'specialize'; readonly col: number; readonly row: number; readonly id: TowerSpecializationId }
  | { readonly action: 'buyAbility'; readonly col: number; readonly row: number; readonly id: TowerAbilityId };

interface BranchPlan {
  /** Start buying immediately after this ordinary upgrade in the island's build order. */
  readonly after: { readonly wave: number; readonly plot: number };
  /** Move this earlier upgrade behind the ability to reserve the gold for the branch. */
  readonly deferUpgrade?: { readonly wave: number; readonly plot: number };
  readonly plot: number;
  readonly branch: TowerSpecializationId;
  readonly ability: TowerAbilityId;
}

const plans: Readonly<Partial<Record<string, BranchPlan>>> = {
  i15: { after: { wave: 11, plot: 6 }, plot: 15, branch: 'cloudbreak', ability: 'stonepetals' },
  i16: { after: { wave: 17, plot: 15 }, plot: 15, branch: 'rimeglass', ability: 'coldfracture' },
  i18: { after: { wave: 8, plot: 0 }, plot: 0, branch: 'bellfoundry', ability: 'aftershock' },
  i19: { after: { wave: 7, plot: 15 }, plot: 9, branch: 'relay', ability: 'livewire' },
  i20: { after: { wave: 9, plot: 15 }, plot: 17, branch: 'stormheart', ability: 'thunderbeat' },
  i21: { after: { wave: 10, plot: 18 }, plot: 18, branch: 'farwatch', ability: 'throughshot' },
  i22: { after: { wave: 8, plot: 8 }, plot: 14, branch: 'honeycomb', ability: 'waxcaps' },
  i23: {
    after: { wave: 9, plot: 8 }, deferUpgrade: { wave: 6, plot: 17 },
    plot: 8, branch: 'anchor', ability: 'dragchain',
  },
  i24: {
    after: { wave: 13, plot: 9 }, deferUpgrade: { wave: 12, plot: 4 },
    plot: 9, branch: 'briar', ability: 'widesweep',
  },
};

/** The two campaign simulators play the same purchases. Other clients still use the base build script. */
export function balanceBuildOrder(level: LevelDef, kind: 'greedy' | 'weak'): readonly BalanceBuildAction[] {
  if (kind === 'weak') return level.weakBuildOrder ?? [];
  const base = level.scriptedBuildOrder ?? [];
  const plan = plans[level.id];
  if (!plan || !level.layout2d) return base;
  const index = base.findIndex(a => a.action === 'upgrade' && a.col === plan.after.plot && a.waveIndex === plan.after.wave);
  if (index < 0) throw new Error(`Missing upgrade for the ${level.id} specialization plan`);
  const opening = base.slice(0, index + 1);
  const deferred: ScriptedBuildAction[] = [];
  if (plan.deferUpgrade) {
    const { plot, wave } = plan.deferUpgrade;
    const at = opening.findIndex(a => a.action === 'upgrade' && a.col === plot && a.waveIndex === wave);
    if (at < 0) throw new Error(`Missing deferred upgrade for the ${level.id} specialization plan`);
    deferred.push(...opening.splice(at, 1));
  }
  return [
    ...opening,
    { action: 'specialize', col: plan.plot, row: 0, id: plan.branch },
    { action: 'buyAbility', col: plan.plot, row: 0, id: plan.ability },
    ...deferred,
    ...base.slice(index + 1),
  ];
}
