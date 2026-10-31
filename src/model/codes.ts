// Numeric codes used inside character files, as observed in real exports
// (character <version>38</version>), and their compendium letter equivalents.
//
// Observed directly: proficiency codes, ability indexes, mod category 1,
// hd for d8/d12, item type for LA/M/G, damage type for B/S, weapon property
// bits for L/V/M/2H, school for several schools, size for Small.
// The rest of each table follows the same ordering as the compendium
// documentation, which fits every observed value; entries not observed are
// marked "inferred" below.

import { ABILITIES, Ability, SKILLS } from './terms';

export const abilityIndex = (a: Ability) => ABILITIES.indexOf(a);
export const abilityFromIndex = (i: number): Ability | null => ABILITIES[i] ?? null;

/** Skills in the order the app numbers them (100 + index): alphabetical. */
export const SKILL_ORDER = SKILLS.map(([n]) => n);

export function proficiencyName(code: number): string | null {
  if (code >= 0 && code <= 5) return ABILITIES[code];
  if (code >= 100 && code < 100 + SKILL_ORDER.length) return SKILL_ORDER[code - 100];
  return null;
}
export function proficiencyCode(name: string): number | null {
  const t = name.trim().toLowerCase().replace(/\s+saving throws?$/, '').replace(/\s+save$/, '');
  const a = ABILITIES.findIndex((x) => x === t || x.slice(0, 3) === t);
  if (a >= 0) return a;
  const s = SKILL_ORDER.findIndex((x) => x.toLowerCase() === t);
  return s >= 0 ? 100 + s : null;
}

/** <mod><category>1</category> is an ability score bonus; other categories are not observed. */
export const MOD_CATEGORY_ABILITY = 1;

// Item types, 1-based in the documented order LA, MA, HA, S, M, R, A, RD, ST, WD, RG, P, SC, W, G, $.
// Observed: LA=1, M=5, G=15 (coins are stored as 15 too).
export const ITEM_TYPE_ORDER = ['LA', 'MA', 'HA', 'S', 'M', 'R', 'A', 'RD', 'ST', 'WD', 'RG', 'P', 'SC', 'W', 'G', '$'];
export const itemTypeCode = (letters: string) => { const i = ITEM_TYPE_ORDER.indexOf(letters); return i < 0 ? null : i + 1; };
export function itemTypeLetters(v: string): string {
  const t = v.trim();
  if (!t) return '';
  if (/^\d+$/.test(t)) return ITEM_TYPE_ORDER[+t - 1] ?? '';
  return t.toUpperCase();
}

// Damage types, 1-based in the documented order. Observed: B=1, S=3.
export const DAMAGE_TYPE_ORDER = ['B', 'P', 'S', 'A', 'C', 'F', 'FC', 'L', 'N', 'PS', 'R', 'T'];
export const damageTypeCode = (letters: string) => { const i = DAMAGE_TYPE_ORDER.indexOf(letters); return i < 0 ? null : i + 1; };
export function damageTypeLetters(v: string): string {
  const t = v.trim();
  if (/^\d+$/.test(t)) return DAMAGE_TYPE_ORDER[+t - 1] ?? '';
  return t.toUpperCase();
}

// Weapon properties as a bit mask in the documented order. Observed: L=8, 2H=256, V+M=1536.
export const PROPERTY_ORDER = ['A', 'F', 'H', 'L', 'LD', 'R', 'S', 'T', '2H', 'V', 'M'];
export const propertyMask = (props: string[]) =>
  props.reduce((m, p) => { const i = PROPERTY_ORDER.indexOf(p.trim().toUpperCase()); return i < 0 ? m : m | (1 << i); }, 0);
export function propertiesFromMask(v: string): string[] {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return t.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const n = +t;
  return PROPERTY_ORDER.filter((_, i) => n & (1 << i));
}

// Spell schools, 1-based. Observed: D=3, EN=4, EV=5, N=7, T=8.
export const SCHOOL_ORDER = ['A', 'C', 'D', 'EN', 'EV', 'I', 'N', 'T'];
export const schoolCode = (letters: string) => { const i = SCHOOL_ORDER.indexOf(letters); return i < 0 ? null : i + 1; };
export function schoolLetters(v: string): string {
  const t = v.trim();
  if (/^\d+$/.test(t)) return SCHOOL_ORDER[+t - 1] ?? '';
  return t.toUpperCase();
}

// Sizes, 0-based T, S, M, L, H, G. Observed: S=1.
export const SIZE_ORDER = ['T', 'S', 'M', 'L', 'H', 'G'];
export const sizeCode = (letters: string) => { const i = SIZE_ORDER.indexOf(letters); return i < 0 ? null : i; };
export function sizeLetters(v: string): string {
  const t = v.trim();
  if (/^\d+$/.test(t)) return SIZE_ORDER[+t] ?? '';
  return t.toUpperCase();
}

// Hit die: d8 -> 2, d12 -> 4 observed; (die - 4) / 2 fits both (d6 -> 1, d10 -> 3).
export const hdCode = (die: number) => Math.max(0, Math.round((die - 4) / 2));
export function hdDie(v: string, fallback = 8): number {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 5) return n * 2 + 4; // code
  return n; // some tools may write the die size itself
}

// Equipment slot ids. Observed: armor=5, one-handed melee weapon=2, two-handed weapon=3.
// Off hand and shield are inferred.
export const SLOT = { offHand: 1, mainHand: 2, twoHands: 3, shield: 4, armor: 5 } as const;

export const yes = (s: string | undefined) => !!s && /^(yes|1|true)$/i.test(s.trim());
