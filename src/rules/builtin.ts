// Built-in rules for class features whose compendium entries are description
// text only. Most compendium files encode no mechanics for the official
// classes (no modifiers, counters or special markers), so the sheet would
// miss Rage, Unarmored Movement, Aura of Protection and the like. Each rule
// here applies only when the feature carries no modifiers or special marker
// of its own, so a file that does encode the rule is never counted twice.

import { Ability, stripLevelPrefix } from '../model/compendium';
import { baseClassName } from './spellcount';

export type Edition = '2014' | '2024';

export interface FeatureRef { name: string; text: string; special: string; modifiers: unknown[]; source: string }

/** "Draconic Bloodline: Draconic Resilience" → ["draconic bloodline: draconic resilience", "draconic resilience"]. */
export function nameForms(name: string): string[] {
  const n = stripLevelPrefix(name).toLowerCase().replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  const i = n.indexOf(':');
  const paren = n.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return [...new Set([n, paren, ...(i > 0 ? [n.slice(i + 1).trim()] : [])])];
}

/** A feature that describes a rule but encodes nothing itself. */
export function plainFeature<T extends FeatureRef>(features: T[], re: RegExp): T | undefined {
  return features.find((f) => !f.modifiers.length && !f.special.trim() && nameForms(f.name).some((n) => re.test(n)));
}

export interface ClassInfo { name: string; base: string; level: number; edition: Edition; names: string[] }

export interface BuiltinCounter { name: string; value: number; reset: 'S' | 'L'; source: string; unlimited?: boolean }

interface CounterRule {
  cls: string;
  feature: RegExp;
  /** Existing counters that already track this resource. */
  existing: RegExp;
  /** A null value means unlimited (Rage at 20th level, Archdruid). */
  make: (L: number, ed: Edition, m: Record<Ability, number>) => { name: string; value: number | null; reset: 'S' | 'L' }[];
}

const byLevel = (L: number, steps: [number, number][]) => steps.reduce((v, [lvl, n]) => (L >= lvl ? n : v), 0);

const COUNTER_RULES: CounterRule[] = [
  {
    cls: 'barbarian', feature: /^rage$/, existing: /\brage/i,
    make: (L, ed) => [{ name: 'Rage', reset: 'L', value: ed === '2014' && L >= 20 ? null : byLevel(L, [[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]]) }],
  },
  {
    cls: 'bard', feature: /^bardic inspiration$/, existing: /bardic inspiration/i,
    make: (L, _ed, m) => [{ name: 'Bardic Inspiration', reset: L >= 5 ? 'S' : 'L', value: Math.max(1, m.charisma) }],
  },
  {
    cls: 'cleric', feature: /\bchannel divinity\b/, existing: /channel divinity/i,
    make: (L, ed) => [{ name: 'Channel Divinity', reset: 'S', value: ed === '2024' ? byLevel(L, [[2, 2], [6, 3], [18, 4]]) : byLevel(L, [[2, 1], [6, 2], [18, 3]]) }],
  },
  {
    cls: 'paladin', feature: /\bchannel divinity\b/, existing: /channel divinity/i,
    make: (L, ed) => [{ name: 'Channel Divinity', reset: 'S', value: ed === '2024' ? byLevel(L, [[3, 2], [11, 3]]) : 1 }],
  },
  {
    cls: 'druid', feature: /^wild shape$/, existing: /wild shape/i,
    make: (L, ed) => [{ name: 'Wild Shape', reset: 'S', value: ed === '2024' ? byLevel(L, [[2, 2], [6, 3], [17, 4]]) : L >= 20 ? null : 2 }],
  },
  {
    cls: 'fighter', feature: /^second wind$/, existing: /second wind/i,
    make: (L, ed) => [{ name: 'Second Wind', reset: 'S', value: ed === '2024' ? byLevel(L, [[1, 2], [4, 3], [10, 4]]) : 1 }],
  },
  {
    cls: 'fighter', feature: /^action surge/, existing: /action surge/i,
    make: (L) => [{ name: 'Action Surge', reset: 'S', value: L >= 17 ? 2 : 1 }],
  },
  {
    cls: 'fighter', feature: /^indomitable/, existing: /indomitable/i,
    make: (L) => [{ name: 'Indomitable', reset: 'L', value: byLevel(L, [[9, 1], [13, 2], [17, 3]]) }],
  },
  {
    cls: 'fighter', feature: /^combat superiority$/, existing: /superiority/i,
    make: (L) => [{ name: 'Superiority Dice', reset: 'S', value: byLevel(L, [[3, 4], [7, 5], [15, 6]]) }],
  },
  {
    cls: 'monk', feature: /^(ki|monk's focus|focus points)$/, existing: /\bki\b|focus points/i,
    make: (L, ed) => [{ name: ed === '2024' ? 'Focus Points' : 'Ki Points', reset: 'S', value: L >= 2 ? L : 0 }],
  },
  {
    cls: 'paladin', feature: /^lay on hands$/, existing: /lay on hands/i,
    make: (L) => [{ name: 'Lay on Hands', reset: 'L', value: 5 * L }],
  },
  {
    cls: 'paladin', feature: /^divine sense$/, existing: /divine sense/i,
    make: (_L, _ed, m) => [{ name: 'Divine Sense', reset: 'L', value: Math.max(1, 1 + m.charisma) }],
  },
  {
    cls: 'wizard', feature: /^arcane recovery$/, existing: /arcane recovery/i,
    make: () => [{ name: 'Arcane Recovery', reset: 'L', value: 1 }],
  },
  {
    cls: 'warlock', feature: /^mystic arcanum/, existing: /mystic arcanum/i,
    make: (L) => ([[11, 6], [13, 7], [15, 8], [17, 9]] as const).filter(([lvl]) => L >= lvl)
      .map(([, sl]) => ({ name: `Mystic Arcanum (${sl}th level)`, reset: 'L' as const, value: 1 })),
  },
  {
    cls: 'artificer', feature: /^flash of genius$/, existing: /flash of genius/i,
    make: (_L, _ed, m) => [{ name: 'Flash of Genius', reset: 'L', value: Math.max(1, m.intelligence) }],
  },
  {
    cls: 'rogue', feature: /^stroke of luck$/, existing: /stroke of luck/i,
    make: () => [{ name: 'Stroke of Luck', reset: 'S', value: 1 }],
  },
];

/** Resources of the official classes that the class's own data does not track. */
export function builtinCounters(classes: ClassInfo[], existing: string[], mods: Record<Ability, number>): BuiltinCounter[] {
  const out: BuiltinCounter[] = [];
  for (const k of classes) {
    for (const rule of COUNTER_RULES) {
      if (k.base !== rule.cls) continue;
      if (!k.names.some((n) => nameForms(n).some((x) => rule.feature.test(x)))) continue;
      if (existing.some((n) => rule.existing.test(n)) || out.some((o) => rule.existing.test(o.name))) continue;
      for (const c of rule.make(k.level, k.edition, mods)) {
        if (c.value === null) out.push({ name: c.name, value: 0, reset: c.reset, source: k.name, unlimited: true });
        else if (c.value > 0) out.push({ name: c.name, value: c.value, reset: c.reset, source: k.name });
      }
    }
  }
  return out;
}

/** Martial Arts die by monk level. */
export const martialArtsDie = (L: number, ed: Edition) =>
  ed === '2024' ? byLevel(L, [[1, 6], [5, 8], [11, 10], [17, 12]]) : byLevel(L, [[1, 4], [5, 6], [11, 8], [17, 10]]);

/** Unarmored Movement bonus by monk level. */
export const unarmoredMovement = (L: number) => byLevel(L, [[2, 10], [6, 15], [10, 20], [14, 25], [18, 30]]);

/** Eldritch Knight / Arcane Trickster slots by fighter or rogue level: [cantrips, 1st..4th]. */
const THIRD_SLOTS: number[][] = [
  [], [], [2], [3], [3], [3], [4, 2], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 2],
  [4, 3, 3], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
];

/**
 * Built-in slot row for subclass spellcasting (Eldritch Knight, Arcane Trickster) when the class has no
 * slot table for it: [cantrips, 1st, ..., 9th].
 */
export function thirdCasterRow(level: number, activeNames: string[]): number[] | null {
  if (level < 3) return null;
  const names = activeNames.join('|').toLowerCase();
  const trickster = /arcane trickster/.test(names);
  const knight = /eldritch knight/.test(names);
  if (!trickster && !knight && !/(^|\|)[^|]*: spellcasting/.test(names)) return null;
  const slots = THIRD_SLOTS[Math.min(20, level) - 1];
  const cantrips = trickster ? (level >= 10 ? 4 : 3) : (level >= 10 ? 3 : 2);
  return [cantrips, ...Array.from({ length: 9 }, (_, i) => slots[i] ?? 0)];
}

export const editionOf = (className: string, featureNames: string[]): Edition =>
  /\[5\.5e\]|\(2024\)|2024/i.test(className) || featureNames.some((n) => /^level\s+\d+\s*:/i.test(n)) ? '2024' : '2014';

export const classBase = baseClassName;
