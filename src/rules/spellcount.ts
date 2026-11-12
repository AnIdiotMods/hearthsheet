// How many spells a class can have prepared (or known), and how many it has.
//
// Compendium files rarely store this as data: 2014 files describe a formula in
// the Spellcasting text ("equal to your Wisdom modifier + your cleric level"),
// and 2024 files refer to a "Prepared Spells" table column the XML does not
// include. So, in order: the user's own limit (<preparedMax> on the class), the
// formula found in the class text, then the standard tables from the SRD 5.1
// (2014) and SRD 5.2 (2024).

import { Ability, ClassFeature, parseAbility, spellView, stripLevelPrefix } from '../model/compendium';
import { XElement, childText, elements, setChildText } from '../xml/xml';

export type LimitMode = 'prepared' | 'known';

export interface SpellLimit {
  /** "prepared": tick spells as prepared from a longer list; "known": every spell on the list counts. */
  mode: LimitMode;
  max: number | null;
  source: 'custom' | 'formula' | 'table' | null;
  /** Explanation shown to the user, e.g. "Wisdom modifier + Cleric level". */
  basis: string;
  count: number;
  cantrips: number;
  /** The 2024 rules call every class's list "prepared spells". */
  edition: '2014' | '2024';
}

// Index = class level - 1.
const T2014: Record<string, number[]> = {
  bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
};
const FULL_2024 = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const HALF_2024 = [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15];
const T2024: Record<string, number[]> = {
  bard: FULL_2024, cleric: FULL_2024, druid: FULL_2024,
  sorcerer: [2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  wizard: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  paladin: HALF_2024, ranger: HALF_2024,
};
/** Eldritch Knight / Arcane Trickster, by fighter or rogue level. */
const THIRD = [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13];

/** Classes that prepare from a longer list; the others count every spell they have. */
const PREPARE_FROM_LIST = new Set(['cleric', 'druid', 'wizard', 'paladin', 'artificer']);

/** "Warlock [5.5e]", "Cleric (2024)" → "warlock", "cleric". */
export const baseClassName = (name: string) => name.replace(/\s*[[(][^\])]*[\])]/g, '').trim().toLowerCase();

export function is2024(className: string, features: ClassFeature[]): boolean {
  return /\[5\.5e\]|\(2024\)|2024/i.test(className) || features.some((f) => /^level\s+\d+\s*:/i.test(f.name));
}

/** "equal to your Wisdom modifier + your cleric level", "+ half your paladin level (rounded down)". */
export function preparedFormula(features: { name: string; text: string }[]): { ability: Ability; half: 'down' | 'up' | null } | null {
  for (const f of features) {
    if (!/spellcasting|preparing|prepar/i.test(stripLevelPrefix(f.name)) && !/prepare the list/i.test(f.text)) continue;
    const m = /equal to your (\w+) modifier \+ (half )?your [\w' ]*?level(?:\s*\(?,?\s*rounded (down|up)\)?)?/i.exec(f.text);
    const ability = m && parseAbility(m[1]);
    if (m && ability) return { ability, half: m[2] ? ((m[3]?.toLowerCase() as 'down' | 'up') ?? 'down') : null };
  }
  return null;
}

/**
 * A "Prepared Spells: 4, 5, 6, …" line (20 numbers, one per class level) in a class feature's text: how
 * homebrew classes in the 2024 style state their Prepared Spells column, which the XML format has no
 * field for.
 */
export function preparedTable(features: { name: string; text: string }[]): number[] | null {
  for (const f of features) {
    const m = /^\s*prepared spells:\s*([\d,\s]+)$/im.exec(f.text);
    if (!m) continue;
    const nums = m[1].split(/[,\s]+/).filter(Boolean).map(Number);
    if (nums.length >= 20 && nums.every(Number.isFinite)) return nums.slice(0, 20);
  }
  return null;
}

export const customLimit = (ce: XElement): number | null => {
  const n = parseInt(childText(ce, 'preparedMax'), 10);
  return Number.isFinite(n) ? n : null;
};
export const setCustomLimit = (ce: XElement, v: number | null) => setChildText(ce, 'preparedMax', v === null ? '' : String(Math.max(0, v)));

export function spellLimit(p: {
  ce: XElement; className: string; level: number; features: ClassFeature[]; activeNames: string[];
  mods: Record<Ability, number>; casterKind: string; ability?: Ability | null;
}): SpellLimit {
  const base = baseClassName(p.className);
  const edition2024 = is2024(p.className, p.features);
  // Spells a feature grants (Oath Spells, racial cantrips) do not count against the limits.
  const spells = elements(p.ce, 'spell').filter((s) => !childText(s, 'grantedBy'))
    .map((s) => ({ v: spellView(s), prepared: /^(1|yes|true)$/i.test(childText(s, 'prepared')) }));
  const third = p.casterKind === 'third' || /(eldritch knight|arcane trickster)/i.test(p.activeNames.join('|'));
  const mode: LimitMode = PREPARE_FROM_LIST.has(base) ? 'prepared' : 'known';
  const count = spells.filter((s) => s.v.level > 0 && (mode === 'known' || s.prepared)).length;
  const cantrips = spells.filter((s) => s.v.level === 0).length;
  const lvl = Math.max(1, Math.min(20, p.level));
  const label = p.className.replace(/\s*\[[^\]]*\]/g, '');

  const custom = customLimit(p.ce);
  if (custom !== null) return { mode, max: custom, source: 'custom', basis: 'your own limit', count, cantrips, edition: edition2024 ? '2024' : '2014' };

  // A table stated in the class's own text: every spell on the list counts, as in the 2024 rules.
  const own = preparedTable(p.features.filter((x) => x.level <= Math.max(1, p.level)));
  if (own) {
    const known = spells.filter((s) => s.v.level > 0).length;
    return { mode: 'known', max: own[lvl - 1], source: 'table', basis: `${label} table (Prepared Spells column)`, count: known, cantrips, edition: '2024' };
  }

  if (!edition2024) {
    const f = preparedFormula(p.features.filter((x) => x.level <= p.level));
    if (f) {
      const lvlPart = f.half ? (f.half === 'up' ? Math.ceil(p.level / 2) : Math.floor(p.level / 2)) : p.level;
      const abbr = f.ability[0].toUpperCase() + f.ability.slice(1);
      return {
        mode: 'prepared', max: Math.max(1, p.mods[f.ability] + lvlPart), source: 'formula',
        basis: `${abbr} modifier + ${f.half ? `half ${label} level (rounded ${f.half})` : `${label} level`}, minimum 1`, count, cantrips, edition: edition2024 ? '2024' : '2014',
      };
    }
  }
  // 2014 prepare-from-a-list classes whose text does not spell the formula out.
  const rule2014 = !edition2024 && PREPARE_FROM_LIST.has(base) ? (['paladin', 'artificer'].includes(base) ? 'half' : 'full') : null;
  if (rule2014 && p.ability) {
    const lvlPart = rule2014 === 'half' ? Math.floor(p.level / 2) : p.level;
    const abbr = p.ability[0].toUpperCase() + p.ability.slice(1);
    return {
      mode, max: Math.max(1, p.mods[p.ability] + lvlPart), source: 'table',
      basis: `standard 2014 rule: ${abbr} modifier + ${rule2014 === 'half' ? `half ${label} level` : `${label} level`}, minimum 1`, count, cantrips, edition: edition2024 ? '2024' : '2014',
    };
  }
  const table = third && !(base in (edition2024 ? T2024 : T2014)) ? THIRD : (edition2024 ? T2024 : T2014)[base];
  if (table) {
    return { mode, max: table[lvl - 1], source: 'table', basis: `standard ${edition2024 ? '2024' : '2014'} ${third && table === THIRD ? 'subclass spellcasting' : label} table`, count, cantrips, edition: edition2024 ? '2024' : '2014' };
  }
  return { mode, max: null, source: null, basis: '', count, cantrips, edition: edition2024 ? '2024' : '2014' };
}
