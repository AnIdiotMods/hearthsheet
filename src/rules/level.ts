// Character creation and level-up operations on the character document.

import { Ability, ABILITIES, ClassFeature, classView } from '../model/compendium';
import {
  Character, addClassChoice, classChoices, classLevel, classSubclass, hdCurrent, setClassLevel,
  setClassSubclass, setHdCurrent,
} from '../model/character';
import { XElement, childText } from '../xml/xml';
import { averageHp, mod } from './derive';

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const pointBuyTotal = (s: Record<Ability, number>) =>
  ABILITIES.reduce((t, a) => t + (POINT_BUY_COST[s[a]] ?? NaN), 0);

export interface LevelUpPlan {
  /** Class already on the character, or a new class copied from the compendium. */
  existing?: XElement;
  newClass?: XElement;
  hp: { method: 'average' | 'roll' | 'max' | 'manual'; value?: number };
  subclass?: string;
  choices?: string[];
  asi?: Partial<Record<Ability, number>>;
  feat?: XElement;
}

/** What a class offers when reaching `level`. */
export function levelOptions(classEl: XElement, level: number, currentSubclass: string) {
  const cv = classView(classEl);
  const at = cv.features.filter((f) => f.level === level);
  const subclassIntro = !currentSubclass && cv.subclasses.length > 0
    && at.some((f) => f.optional && cv.subclasses.some((s) => f.name.includes(s) || f.subclass === s));
  const sub = currentSubclass.toLowerCase();
  const optional = at.filter((f) => f.optional && !isSubclassFeature(f, cv.subclasses));
  const gained = at.filter((f) => !f.optional || (sub && isSubclassFeature(f, cv.subclasses)
    && (f.subclass.toLowerCase() === sub || f.name.toLowerCase().includes(sub))));
  const asi = at.some((f) => /ability score improvement/i.test(f.name));
  return { cv, subclassIntro, subclasses: cv.subclasses, optional, gained, asi };
}

const isSubclassFeature = (f: ClassFeature, subs: string[]) =>
  !!f.subclass || subs.some((s) => f.name.toLowerCase().includes(s.toLowerCase()));

export function applyLevelUp(c: Character, plan: LevelUpPlan, rollDie: (sides: number) => number): XElement {
  const ce = plan.existing ?? c.addClass(plan.newClass!);
  const cv = classView(ce);
  const newLevel = classLevel(ce) + 1;
  const firstCharacterLevel = c.totalLevel === 0;
  setClassLevel(ce, newLevel);
  setHdCurrent(ce, Math.min(newLevel, hdCurrent(ce) + 1));
  if (plan.subclass && !classSubclass(ce)) setClassSubclass(ce, plan.subclass);
  for (const ch of plan.choices ?? []) addClassChoice(ce, ch);

  if (plan.asi) {
    const a = c.abilities;
    for (const [k, v] of Object.entries(plan.asi)) a[k as Ability] = Math.min(20, a[k as Ability] + (v ?? 0));
    c.abilities = a;
  }
  if (plan.feat) c.addFeat(plan.feat);

  const con = mod(c.abilities.constitution + raceBonus(c, 'constitution'));
  let gain: number;
  if (firstCharacterLevel || plan.hp.method === 'max') gain = cv.hd;
  else if (plan.hp.method === 'average') gain = averageHp(cv.hd);
  else if (plan.hp.method === 'roll') gain = rollDie(cv.hd);
  else gain = plan.hp.value ?? averageHp(cv.hd);
  const delta = Math.max(1, gain + con);
  const wasFull = c.hpCurrent >= c.hpMax;
  c.hpMax = c.hpMax + delta;
  c.hpCurrent = wasFull ? c.hpMax : c.hpCurrent + delta;
  return ce;
}

function raceBonus(c: Character, a: Ability): number {
  const r = c.race;
  if (!r) return 0;
  const m = new RegExp(`\\b${a.slice(0, 3)}[a-z]*\\s*([+-]?\\d+)`, 'i').exec(childText(r, 'ability'));
  return m ? +m[1] : 0;
}

/** Undo the last level of a class (HP is reduced by the average for the die). */
export function removeLevel(c: Character, ce: XElement) {
  const cv = classView(ce);
  const lv = classLevel(ce);
  if (lv <= 0) return;
  const con = mod(c.abilities.constitution + raceBonus(c, 'constitution'));
  const loss = c.totalLevel === 1 ? c.hpMax : Math.max(1, averageHp(cv.hd) + con);
  c.hpMax = Math.max(0, c.hpMax - loss);
  c.hpCurrent = Math.min(c.hpCurrent, c.hpMax);
  if (lv === 1) c.remove(ce);
  else { setClassLevel(ce, lv - 1); setHdCurrent(ce, Math.min(hdCurrent(ce), lv - 1)); }
}

export const choicesOf = classChoices;

/** XP thresholds for character levels 1-20. */
export const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
