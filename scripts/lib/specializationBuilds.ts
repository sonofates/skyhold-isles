import type { LevelDef, ScriptedBuildAction } from '../../src/data/levels/types.ts';
import type { TowerAbilityId, TowerSpecializationId } from '../../src/data/towers.ts';

export type BalanceBuildAction = ScriptedBuildAction
  | { readonly action: 'specialize'; readonly col: number; readonly row: number; readonly id: TowerSpecializationId }
  | { readonly action: 'buyAbility'; readonly col: number; readonly row: number; readonly id: TowerAbilityId };

interface BranchPlan {
  /** Start buying immediately after this ordinary upgrade in the island's build order. */
  readonly after: { readonly wave: number; readonly plot: number };
  readonly plot: number;
  readonly branch: TowerSpecializationId;
  readonly ability: TowerAbilityId;
}

const plans: Readonly<Partial<Record<string, BranchPlan>>> = {
  i18: { after: { wave: 9, plot: 13 }, plot: 7, branch: 'bellfoundry', ability: 'aftershock' },
  i21: { after: { wave: 10, plot: 18 }, plot: 18, branch: 'farwatch', ability: 'throughshot' },
};

/** The two campaign simulators play the same purchases. Other clients still use the base build script. */
export function balanceBuildOrder(level: LevelDef, kind: 'greedy' | 'weak'): readonly BalanceBuildAction[] {
  if (kind === 'weak') return level.weakBuildOrder ?? [];
  const base = level.scriptedBuildOrder ?? [];
  const plan = plans[level.id];
  if (!plan || !level.layout2d) return base;
  const index = base.findIndex(a => a.action === 'upgrade' && a.col === plan.after.plot && a.waveIndex === plan.after.wave);
  if (index < 0) throw new Error(`Missing upgrade for the ${level.id} specialization plan`);
  return [
    ...base.slice(0, index + 1),
    { action: 'specialize', col: plan.plot, row: 0, id: plan.branch },
    { action: 'buyAbility', col: plan.plot, row: 0, id: plan.ability },
    ...base.slice(index + 1),
  ];
}
