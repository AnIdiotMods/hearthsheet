// Character creation and level-up operations on the character document.

import { Ability, ABILITIES, ClassFeature, classView, isOptionalRule, ownsFeature, stripLevelPrefix, subclassOwner } from '../model/compendium';
import {
  Character, addClassFeat, chosenSubclasses, classFeatNames, classFeats, classLevel, classSlots, classSlotsCurrent,
  classSpells, emptyAppState, hdCurrent, removeClassFeat, setClassLevel, setClassSkillProficiencies, setClassSlots, setHdCurrent,
  spellFromCompendium,
} from '../model/character';
import { XElement, childText, setChildText } from '../xml/xml';
import { CV, RulesOptions, averageHp, classSlotRow, defaultOptions, deriveSheet, progressionOf } from './derive';

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
  /** Subclass chosen at this level: features named like another version's are taken from this one. */
  subclass?: string;
  /** Allow an Ability Score Improvement to raise a score above 20 (the player was warned). */
  allowOverMax?: boolean;
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
  /** Optional rules offered at this level (Tasha's optional class features); never granted automatically. */
  optionalRules: ClassFeature[];
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
  const gained = at.filter((f) => !f.optional && !isOptionalRule(f));
  const optional = at.filter((f) => f.optional && !NOISE.test(f.name));
  const subclassChoices = chosen.length ? [] : cv.subclasses.filter((s) => cv.subclassLevels.get(s) === level);
  const isChosen = (f: ClassFeature) => chosen.some((s) => ownsFeature(cv, f, s));
  return {
    cv, level, gained, subclassLabel: cv.subclassLabel, subclassChoices,
    subclassFeatures: optional.filter(isChosen),
    other: optional.filter((f) => !owner(f) && !isOptionalRule(f)),
    otherSubclassFeatures: optional.filter((f) => !!owner(f) && !isChosen(f) && !subclassChoices.some((s) => ownsFeature(cv, f, s))),
    optionalRules: at.filter((f) => isOptionalRule(f) && !owner(f)),
    asi: cv.asiLevels.has(level) || gained.some((f) => /ability score improvement/i.test(f.name)),
    chosenSubclasses: chosen,
  };
}

/** A subclass's features at `level`, including its introduction (used when it is picked). */
export function subclassFeaturesAt(cv: CV, subclass: string, level: number): ClassFeature[] {
  return cv.features.filter((f) => f.optional && f.level === level && ownsFeature(cv, f, subclass));
}

export interface FeatureChoice {
  /** The feature that offers the choice, e.g. "Hunter: Hunter's Prey". */
  parent: ClassFeature;
  count: number;
  options: ClassFeature[];
}

const CHOICE_TEXT = /\b(one|two|three) of the following[^.]*\bof your choice|of your choice[^.]*\bfollowing|choose a totem spirit|totem animal of your choice/i;
const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3 };

/**
 * Subclass features where the player picks one of several, e.g. Hunter's Prey ("you gain one of the
 * following features of your choice") with Colossus Slayer, Giant Killer and Horde Breaker as separate
 * features, or the Totem Warrior's animals. The options are the subclass's other features at that level
 * that do not describe their own level ("At 3rd level, ...", which marks a fixed feature).
 */
export function subclassChoicesAt(cv: CV, subclass: string, level: number): FeatureChoice[] {
  const feats = subclassFeaturesAt(cv, subclass, level);
  const parents = feats.filter((f) => CHOICE_TEXT.test(f.text));
  if (!parents.length) return [];
  const intro = (f: ClassFeature) => { const m = /^([^:]+):\s*(.+)$/.exec(stripLevelPrefix(f.name)); return !!m && m[2].trim().toLowerCase() === subclass.replace(/ \(version \d+\)$/, '').toLowerCase(); };
  const options = feats.filter((f) => !parents.includes(f) && !intro(f) && !/\b\d+(st|nd|rd|th) level\b/i.test(f.text) && !/\bspells$/i.test(f.name));
  if (options.length < 2) return [];
  const m = CHOICE_TEXT.exec(parents[0].text);
  const count = m && m[1] ? COUNT_WORDS[m[1].toLowerCase()] ?? 1 : 1;
  return [{ parent: parents[0], count, options }];
}

/** Features of a subclass to tick by default when it is picked, or when reaching `level` with it: all but the pick-one options. */
export function defaultSubclassPicks(cv: CV, subclass: string, level: number): ClassFeature[] {
  const opts = new Set(subclassChoicesAt(cv, subclass, level).flatMap((g) => g.options));
  return subclassFeaturesAt(cv, subclass, level).filter((f) => !opts.has(f));
}

export function applyLevelUp(c: Character, plan: LevelUpPlan, rollDie: (sides: number) => number, opts: RulesOptions = defaultOptions): XElement {
  const before = deriveSheet(c, emptyAppState(), opts);
  const previousLevel = c.totalLevel;
  const ce = plan.existing ?? c.addClass(plan.newClass!);
  const cv = progressionOf(ce, opts);
  const newLevel = classLevel(ce) + 1;
  const firstCharacterLevel = previousLevel === 0;
  setClassLevel(ce, newLevel);
  setHdCurrent(ce, Math.min(newLevel, (newLevel === 1 ? 0 : hdCurrent(ce)) + 1));
  if (plan.skills) setClassSkillProficiencies(ce, plan.skills);

  const choices = new Set(plan.choices ?? []);
  for (const f of cv.features.filter((f) => f.level === newLevel && !f.optional)) {
    if (isOptionalRule(f) && !choices.has(f.name)) continue;
    addClassFeat(ce, f);
  }
  const subs = [...(plan.subclass ? [plan.subclass] : []), ...chosenSubclasses(ce)];
  for (const name of choices) {
    const same = cv.features.filter((x) => x.name === name);
    const f = same.find((x) => x.level === newLevel && subs.some((s) => ownsFeature(cv, x, s))) ?? same.find((x) => x.level === newLevel) ?? same[0];
    if (f) addClassFeat(ce, f);
  }
  syncClassSlots(ce, cv);

  if (plan.asi) {
    // The usual maximum of 20 applies to the final score (racial and other bonuses included).
    const a = c.abilities;
    for (const [k, v] of Object.entries(plan.asi)) {
      const key = k as Ability;
      const add = v ?? 0;
      if (plan.allowOverMax) { a[key] += add; continue; }
      const bonus = before.naturalScores[key] - a[key];
      a[key] = Math.max(a[key], Math.min(a[key] + add, 20 - bonus));
    }
    c.abilities = a;
  }
  if (plan.feat) c.addFeat(plan.feat);
  grantFeatureSpells(ce, opts);

  const after = deriveSheet(c, emptyAppState(), opts);
  const con = after.mods.constitution;
  const die = cv.hd;
  let gain: number;
  if (firstCharacterLevel || plan.hp.method === 'max') gain = die;
  else if (plan.hp.method === 'average') gain = averageHp(die);
  else if (plan.hp.method === 'roll') gain = rollDie(die);
  else gain = plan.hp.value ?? averageHp(die);
  // A higher Constitution modifier also raises the hit points of every earlier level.
  const retro = firstCharacterLevel ? 0 : (con - before.mods.constitution) * previousLevel;
  const delta = Math.max(1, gain + con) + retro;
  // Compare with the full maximum, which adds bonuses not stored in hpMax (Dwarven Toughness, Tough).
  const wasFull = c.hpCurrent >= before.hpMax;
  c.hpMax = Math.max(1, c.hpMax + delta);
  const fullMax = deriveSheet(c, emptyAppState(), opts).hpMax;
  c.hpCurrent = wasFull ? fullMax : Math.max(0, c.hpCurrent + fullMax - before.hpMax);
  return ce;
}

const SPELL_ROW = /^\s*(\d+)(?:st|nd|rd|th)\s*(?:\||:|\t)\s*(.+)$/i;
/** A table heading such as "Life Domain Spells" or "Gloom Stalker Spells" (not "… Expanded Spells"). */
const SPELL_HEADING = /^[^.|:]{1,60}\bspells$/i;

/**
 * "3rd | protection from evil and good, sanctuary" rows of an "Oath Spells" / "Domain Spells" style table:
 * either a feature of that name, or a table under such a heading inside another feature's text (many
 * files put domain spells in the subclass introduction and ranger spells in "… Magic").
 */
export function featureSpellTable(f: { name: string; text: string }): { level: number; spells: string[] }[] {
  const name = stripLevelPrefix(f.name);
  if (/expanded spell/i.test(name)) return [];
  let lines = f.text.split('\n');
  if (!/\bspells$/i.test(name)) {
    const start = lines.findIndex((l) => SPELL_HEADING.test(l.trim()) && !/expanded spell/i.test(l));
    if (start < 0) return [];
    const table: string[] = [];
    for (const l of lines.slice(start + 1)) {
      if (SPELL_ROW.test(l) || l.includes('|')) table.push(l);
      else if (l.trim() || table.some((t) => SPELL_ROW.test(t))) break;
    }
    lines = table;
  }
  const rows: { level: number; spells: string[] }[] = [];
  for (const line of lines) {
    const m = SPELL_ROW.exec(line);
    if (!m) continue;
    rows.push({ level: +m[1], spells: m[2].split(/\s*[,;]\s*/).map((x) => x.replace(/\*+$/, '').trim()).filter(Boolean) });
  }
  // Several tables (e.g. one per terrain) need a choice the file does not record.
  return new Set(rows.map((r) => r.level)).size === rows.length ? rows : [];
}

/**
 * Add the always-prepared spells of features such as Oath Spells, Domain Spells or Artillerist Spells
 * up to the class's level, marked with <grantedBy> so they do not count against the prepared limit.
 */
export function grantFeatureSpells(ce: XElement, opts: RulesOptions = defaultOptions): string[] {
  if (!opts.spellLookup) return [];
  const level = classLevel(ce);
  const have = new Set(classSpells(ce).map((s) => childText(s, 'name').toLowerCase()));
  const added: string[] = [];
  for (const f of classFeats(ce)) {
    for (const row of featureSpellTable(f)) {
      if (row.level > level) continue;
      for (const sp of row.spells) {
        if (have.has(sp.toLowerCase())) continue;
        const src = opts.spellLookup(sp);
        if (!src) continue;
        const el = spellFromCompendium(src);
        setChildText(el, 'prepared', '1');
        setChildText(el, 'grantedBy', stripLevelPrefix(f.name));
        ce.children.push(el);
        have.add(sp.toLowerCase());
        added.push(childText(el, 'name'));
      }
    }
  }
  return added;
}

/** Recompute the class's stored slot row, keeping slots already spent. */
export function syncClassSlots(ce: XElement, cv: CV = classView(ce)) {
  const row = classSlotRow(cv, classLevel(ce), classFeatNames(ce)) ?? Array(10).fill(0);
  const oldTotal = classSlots(ce), oldCur = classSlotsCurrent(ce);
  const used = oldTotal.map((t, i) => Math.max(0, t - (oldCur[i] ?? t)));
  setClassSlots(ce, row, row.map((t, i) => (i === 0 ? t : Math.max(0, t - used[i]))));
}

/** Undo the last level of a class (HP is reduced by the average for the die). */
export function removeLevel(c: Character, ce: XElement, opts: RulesOptions = defaultOptions) {
  const cv = progressionOf(ce, opts);
  const lv = classLevel(ce);
  if (lv <= 0) return;
  const con = deriveSheet(c, emptyAppState(), opts).mods.constitution;
  const loss = c.totalLevel === 1 ? c.hpMax : Math.max(1, averageHp(cv.hd) + con);
  const wasFull = c.hpCurrent >= deriveSheet(c, emptyAppState(), opts).hpMax;
  c.hpMax = Math.max(0, c.hpMax - loss);
  if (lv === 1) c.remove(ce);
  else {
    // Drop features gained at the removed level (optional choices included).
    const atLevel = new Set(cv.features.filter((f) => f.level === lv).map((f) => f.name));
    for (const f of classFeats(ce)) if (atLevel.has(f.name)) removeClassFeat(ce, f.name);
    setClassLevel(ce, lv - 1);
    setHdCurrent(ce, Math.min(hdCurrent(ce), lv - 1));
    syncClassSlots(ce, cv);
  }
  const fullMax = deriveSheet(c, emptyAppState(), opts).hpMax;
  c.hpCurrent = wasFull ? fullMax : Math.min(c.hpCurrent, fullMax);
}

/** XP thresholds for character levels 1-20. */
export const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
