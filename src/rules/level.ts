// Character creation and level-up operations on the character document.

import { Ability, ABILITIES, ClassFeature, classView, subclassOwner } from '../model/compendium';
import {
  Character, addClassFeat, chosenSubclasses, classFeatNames, classFeats, classLevel, classSlots, classSlotsCurrent,
  hdCurrent, removeClassFeat, setClassLevel, setClassSkillProficiencies, setClassSlots, setHdCurrent,
} from '../model/character';
import { XElement, childText } from '../xml/xml';
import { CV, RulesOptions, averageHp, classSlotRow, defaultOptions, mod, progressionOf } from './derive';

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const pointBuyTotal = (s: Record<Ability, number>) =>
  ABILITIES.reduce((t, a) => t + (POINT_BUY_COST[s[a]] ?? NaN), 0);

export interface LevelUpPlan {
  /** Class already on the character, or a new class copied from the compendium. */
  existing?: XElement;
  newClass?: XElement;
  hp: { method: 'average' | 'roll' | 'max' | 'manual'; value?: number };
  /** Names of optional features chosen at this level (subclass introductions included). */
  choices?: string[];
  asi?: Partial<Record<Ability, number>>;
  feat?: XElement;
  /** Class skill proficiencies chosen when taking the first level. */
  skills?: string[];
}

export interface LevelOptions {
  cv: CV;
  level: number;
  gained: ClassFeature[];
  /** Label for the subclass choice, e.g. "Martial Archetype". */
  subclassLabel: string;
  /** Subclasses that can be chosen at this level (empty once one is chosen). */
  subclassChoices: string[];
  /** Optional features of subclasses already chosen (pre-selected). */
  subclassFeatures: ClassFeature[];
  /** Other optional features that belong to no subclass. */
  other: ClassFeature[];
  /** Optional features of subclasses not chosen; hidden by default. */
  otherSubclassFeatures: ClassFeature[];
  asi: boolean;
  chosenSubclasses: string[];
}

const NOISE = /^(starting |multiclass |becoming a)/i;

/** What a class offers when reaching `level`. */
export function levelOptions(classEl: XElement, level: number, opts: RulesOptions = defaultOptions): LevelOptions {
  const cv = progressionOf(classEl, opts);
  const chosen = classEl.name === 'class' && classEl.children.some((c) => c.type === 'el' && c.name === 'feat') ? chosenSubclasses(classEl) : [];
  const owner = (f: ClassFeature) => subclassOwner(f, cv.subclasses);
  const at = cv.features.filter((f) => f.level === level);
  const gained = at.filter((f) => !f.optional);
  const optional = at.filter((f) => f.optional && !NOISE.test(f.name));
  const subclassChoices = chosen.length ? [] : cv.subclasses.filter((s) => cv.subclassLevels.get(s) === level);
  const isChosen = (f: ClassFeature) => { const o = owner(f); return !!o && chosen.includes(o); };
  return {
    cv, level, gained, subclassLabel: cv.subclassLabel, subclassChoices,
    subclassFeatures: optional.filter(isChosen),
    other: optional.filter((f) => !owner(f)),
    otherSubclassFeatures: optional.filter((f) => { const o = owner(f); return !!o && !chosen.includes(o) && !subclassChoices.includes(o); }),
    asi: cv.asiLevels.has(level) || gained.some((f) => /ability score improvement/i.test(f.name)),
    chosenSubclasses: chosen,
  };
}

/** A subclass's features at `level`, including its introduction (used when it is picked). */
export function subclassFeaturesAt(cv: CV, subclass: string, level: number): ClassFeature[] {
  return cv.features.filter((f) => f.optional && f.level === level && subclassOwner(f, cv.subclasses) === subclass);
}

export function applyLevelUp(c: Character, plan: LevelUpPlan, rollDie: (sides: number) => number, opts: RulesOptions = defaultOptions): XElement {
  const ce = plan.existing ?? c.addClass(plan.newClass!);
  const cv = progressionOf(ce, opts);
  const newLevel = classLevel(ce) + 1;
  const firstCharacterLevel = c.totalLevel === 0;
  setClassLevel(ce, newLevel);
  setHdCurrent(ce, Math.min(newLevel, (newLevel === 1 ? 0 : hdCurrent(ce)) + 1));
  if (plan.skills) setClassSkillProficiencies(ce, plan.skills);

  for (const f of cv.features.filter((f) => f.level === newLevel && !f.optional)) addClassFeat(ce, f);
  for (const name of plan.choices ?? []) {
    const f = cv.features.find((x) => x.name === name);
    if (f) addClassFeat(ce, f);
  }
  syncClassSlots(ce, cv);

  if (plan.asi) {
    const a = c.abilities;
    for (const [k, v] of Object.entries(plan.asi)) a[k as Ability] = Math.min(20, a[k as Ability] + (v ?? 0));
    c.abilities = a;
  }
  if (plan.feat) c.addFeat(plan.feat);

  const con = mod(c.abilities.constitution + raceBonus(c, 'constitution'));
  const die = cv.hd;
  let gain: number;
  if (firstCharacterLevel || plan.hp.method === 'max') gain = die;
  else if (plan.hp.method === 'average') gain = averageHp(die);
  else if (plan.hp.method === 'roll') gain = rollDie(die);
  else gain = plan.hp.value ?? averageHp(die);
  const delta = Math.max(1, gain + con);
  const wasFull = c.hpCurrent >= c.hpMax;
  c.hpMax = c.hpMax + delta;
  c.hpCurrent = wasFull ? c.hpMax : c.hpCurrent + delta;
  return ce;
}

/** Recompute the class's stored slot row, keeping slots already spent. */
export function syncClassSlots(ce: XElement, cv: CV = classView(ce)) {
  const row = classSlotRow(cv, classLevel(ce), classFeatNames(ce)) ?? Array(10).fill(0);
  const oldTotal = classSlots(ce), oldCur = classSlotsCurrent(ce);
  const used = oldTotal.map((t, i) => Math.max(0, t - (oldCur[i] ?? t)));
  setClassSlots(ce, row, row.map((t, i) => (i === 0 ? t : Math.max(0, t - used[i]))));
}

function raceBonus(c: Character, a: Ability): number {
  const r = c.race;
  if (!r) return 0;
  let total = 0;
  for (const m of r.children) {
    if (m.type !== 'el' || m.name !== 'mod') continue;
    if (childText(m, 'category') === '1' && +(childText(m, 'type') || '0') === ABILITIES.indexOf(a)) total += parseInt(childText(m, 'value'), 10) || 0;
  }
  const el = new RegExp(`\\b${a.slice(0, 3)}[a-z]*\\s*([+-]?\\d+)`, 'i').exec(childText(r, 'ability'));
  if (el && !total) total += +el[1];
  return total;
}

/** Undo the last level of a class (HP is reduced by the average for the die). */
export function removeLevel(c: Character, ce: XElement, opts: RulesOptions = defaultOptions) {
  const cv = progressionOf(ce, opts);
  const lv = classLevel(ce);
  if (lv <= 0) return;
  const con = mod(c.abilities.constitution + raceBonus(c, 'constitution'));
  const loss = c.totalLevel === 1 ? c.hpMax : Math.max(1, averageHp(cv.hd) + con);
  c.hpMax = Math.max(0, c.hpMax - loss);
  c.hpCurrent = Math.min(c.hpCurrent, c.hpMax);
  if (lv === 1) { c.remove(ce); return; }
  // Drop features gained at the removed level (optional choices included).
  const atLevel = new Set(cv.features.filter((f) => f.level === lv).map((f) => f.name));
  for (const f of classFeats(ce)) if (atLevel.has(f.name)) removeClassFeat(ce, f.name);
  setClassLevel(ce, lv - 1);
  setHdCurrent(ce, Math.min(hdCurrent(ce), lv - 1));
  syncClassSlots(ce, cv);
}

/** XP thresholds for character levels 1-20. */
export const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
