// Class option lists: the choices a class grants that are not fixed
// features, such as Eldritch Invocations, Metamagic, Fighting Styles,
// Battle Master maneuvers, Artificer infusions, Elemental Disciplines,
// Arcane Shots, Runes and Pact Boons.
//
// Compendiums encode these in two ways:
//  - as optional features inside the class, named "Family: Option", listed
//    only at the level where the choice first appears (older files);
//  - as <feat> entries named "Family: Option" with a <prerequisite>, in
//    separate "optional features" files (current files). The class itself
//    only has a feature such as "Eldritch Invocations" that grants them.
//
// A family is offered to a class when one of the class's features (or a
// chosen subclass feature) mentions it by name, e.g. "Eldritch Invocations"
// mentions "Invocation" and "Combat Superiority" mentions "maneuvers".

import { ClassFeature, Entry, Library, featView, sourceOf, sourceTag, spellView, stripLevelPrefix, subclassOwner } from '../model/compendium';
import type { CV } from './derive';
import { baseClassName, is2024 } from './spellcount';

export interface OptionItem {
  /** Full name, e.g. "Invocation: Agonizing Blast". */
  name: string;
  /** Name without the family prefix. */
  label: string;
  text: string;
  prerequisite: string;
  /** true met, false not met, null cannot tell. */
  prereqMet: boolean | null;
  prereqNote: string;
  taken: boolean;
  level?: number;
  /** Set for options that live inside the class. */
  feature?: ClassFeature;
  /** Set for options that are compendium feats. */
  feat?: Entry;
  /** "UA", "Homebrew", ... for unofficial options; empty otherwise. */
  sourceTag: string;
}

export interface OptionGroup {
  family: string;
  /** Feature that grants the choice, e.g. "Eldritch Invocations". */
  grantedBy: string;
  /** The class grants (more of) this choice at the level being taken, or fewer are known than allowed. */
  now: boolean;
  options: OptionItem[];
  /** How many the class lets you know at this level, when the rules say (e.g. invocations known). */
  max: number | null;
  /** How many the character already knows. */
  known: number;
}

export interface OptionContext {
  lib: Library | null;
  cv: CV;
  /** Class level after the level being taken. */
  level: number;
  /** Features of this class the character has, plus those gained at this level. */
  classFeatures: { name: string; text: string; level?: number }[];
  /** Names of every feature and feat the character has. */
  known: Set<string>;
  /** Names of spells the character knows (lowercase). */
  spells: Set<string>;
  /** Total character level, for prerequisites such as "5th level". */
  characterLevel: number;
  subclasses: string[];
}

const rawFamily = (name: string) => { const n = stripLevelPrefix(name); const i = n.indexOf(':'); return i > 0 ? n.slice(0, i).trim() : ''; };
/** "Agonizing Blast [5.5e]" → "Agonizing Blast" */
const cleanLabel = (s: string) => s.replace(/\s*\[(5\.5e|5e|legacy|2024|2014)\]\s*$/i, '').trim();
const optionLabel = (name: string) => { const n = stripLevelPrefix(name); return cleanLabel(n.slice(rawFamily(name).length + 1)); };
/** "Metamagic Options" (Tasha's additions) is the same list as "Metamagic". */
const familyOf = (name: string) => rawFamily(name).replace(/\s+options?$/i, '');
export const optionFamily = familyOf;

// ---------------------------------------------------------------- how many options a class knows

type Table = (L: number, ed: '2014' | '2024') => number;
const steps = (L: number, s: [number, number][]) => s.reduce((v, [lvl, n]) => (L >= lvl ? n : v), 0);
const INVOCATIONS_2014 = [0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8];
const INVOCATIONS_2024 = [1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10];
/** Option families with a known count, the class that grants them, and the count by that class's level. */
const OPTION_COUNTS: { family: RegExp; cls: string; title: string; table: Table }[] = [
  { family: /^(eldritch )?invocations?$/i, cls: 'warlock', title: 'Eldritch Invocations', table: (L, ed) => (ed === '2024' ? INVOCATIONS_2024 : INVOCATIONS_2014)[L - 1] },
  { family: /^metamagic$/i, cls: 'sorcerer', title: 'Metamagic', table: (L, ed) => (ed === '2024' ? steps(L, [[2, 2], [10, 4], [17, 6]]) : steps(L, [[3, 2], [10, 3], [17, 4]])) },
  { family: /^maneuvers?$/i, cls: 'fighter', title: 'Maneuvers', table: (L) => steps(L, [[3, 3], [7, 5], [10, 7], [15, 9]]) },
  { family: /^(artificer )?infusions?$/i, cls: 'artificer', title: 'Artificer Infusions', table: (L) => steps(L, [[2, 4], [6, 6], [10, 8], [14, 10], [18, 12]]) },
  { family: /^elemental disciplines?$/i, cls: 'monk', title: 'Elemental Disciplines', table: (L) => steps(L, [[3, 1], [6, 2], [11, 3], [17, 4]]) },
  { family: /^arcane shots?$/i, cls: 'fighter', title: 'Arcane Shots', table: (L) => steps(L, [[3, 2], [7, 3], [10, 4], [15, 5], [18, 6]]) },
  { family: /^runes?$/i, cls: 'fighter', title: 'Runes', table: (L) => steps(L, [[3, 2], [7, 3], [10, 4], [15, 5]]) },
  { family: /^pact boons?$/i, cls: 'warlock', title: 'Pact Boon', table: (L) => (L >= 3 ? 1 : 0) },
];
/** Options that come free with the list and do not count (Elemental Attunement). */
const FREE_OPTION = /elemental attunement/i;

export interface ClassLevelInfo { name: string; base: string; level: number; edition: '2014' | '2024'; names: string[] }

/** How many options of a family a class lets you know at a level, if the rules say. */
export function expectedOptionCount(family: string, className: string, level: number, edition: '2014' | '2024', knownNames: string[] = []): number | null {
  if (/^fighting styles?$/i.test(family.trim())) {
    const grants = [...new Set(knownNames)].filter((n) => /^(fighting style|additional fighting style)$/i.test(stripLevelPrefix(n).replace(/^[^:]+:\s*(?=additional)/i, '').trim()));
    return grants.length || null;
  }
  const rule = OPTION_COUNTS.find((r) => r.family.test(family.trim()));
  if (!rule || baseClassName(className) !== rule.cls || level < 1) return null;
  const n = rule.table(Math.min(20, level), edition);
  return n || null;
}

/** Count options of each family the character knows against the class's allowance. */
export function optionLimits(names: string[], classes: ClassLevelInfo[]): { title: string; have: number; max: number }[] {
  const out: { title: string; have: number; max: number }[] = [];
  const famOf = (n: string) => familyOf(n).toLowerCase();
  const allKnown = classes.flatMap((k) => k.names);
  const uniq = [...new Set(names)];
  for (const rule of OPTION_COUNTS) {
    const k = classes.find((x) => x.base === rule.cls);
    if (!k) continue;
    const max = expectedOptionCount(rule.title, k.name, k.level, k.edition, allKnown);
    if (max === null) continue;
    const have = uniq.filter((n) => rule.family.test(famOf(n)) && !FREE_OPTION.test(n)).length;
    if (have) out.push({ title: rule.title, have, max });
  }
  const styles = uniq.filter((n) => /^fighting styles?$/i.test(famOf(n))).length;
  const styleMax = expectedOptionCount('Fighting Style', '', 0, '2014', allKnown);
  if (styles && styleMax !== null) out.push({ title: 'Fighting Styles', have: styles, max: styleMax });
  return out;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Family name as words, each optionally plural: "Invocation" matches "Eldritch Invocations",
 * "Elemental Discipline" matches "elemental disciplines", "Infusion" does not match "infusing".
 */
export function mentions(text: string, family: string): boolean {
  const words = family.trim().split(/\s+/).filter(Boolean).map((w) => escape(w.replace(/s$/i, '')));
  if (!words.length || family.trim().length < 3) return false;
  return new RegExp(`\\b${words.join('(s|es)?\\s+')}(s|es)?\\b`, 'i').test(text);
}

/** How much of a feature's text is searched for a family name: mentions further in are usually asides. */
const TEXT_WINDOW = 300;

/** Option families that are really subclasses or noise, never offered as option lists. */
const NOT_OPTIONS = /^(starting|multiclass|becoming a|ability score improvement)/i;

export function checkPrerequisite(prereq: string, ctx: OptionContext): { met: boolean | null; note: string } {
  const p = prereq.trim();
  if (!p) return { met: true, note: '' };
  const parts = p.split(/,\s*(?![^()]*\))/).map((x) => x.trim()).filter(Boolean);
  const unmet: string[] = [];
  let unknown = false;
  const knownLower = [...ctx.known].map((k) => k.toLowerCase());
  const hasFeature = (needle: string) => knownLower.some((k) => k.includes(needle.toLowerCase()));
  for (const part of parts) {
    let m: RegExpExecArray | null;
    if ((m = /^(\d+)(st|nd|rd|th) level( [a-z][\w ]*)?$/i.exec(part)) || (m = /^level (\d+)\+?( [a-z][\w ]*)?$/i.exec(part))) {
      if (ctx.level < +m[1]) unmet.push(`${part} (${ctx.cv.name} ${ctx.level})`);
    } else if ((m = /^(.+?) cantrip$/i.exec(part)) || (m = /^(?:the ability to cast )?(.+?) spell$/i.exec(part))) {
      const names = m[1].split(/\s+or\s+|\//).map((x) => x.trim().toLowerCase());
      if (!names.some((n) => ctx.spells.has(n))) unmet.push(part);
    } else if ((m = /^(pact of the \w+)( feature| invocation| boon)?$/i.exec(part))) {
      if (!hasFeature(m[1])) unmet.push(part);
    } else if ((m = /^the (.+?) patron$/i.exec(part))) {
      if (!ctx.subclasses.some((s) => s.toLowerCase().includes(m![1].toLowerCase()))) unmet.push(part);
    } else if ((m = /^(.+?) feature$/i.exec(part))) {
      if (!hasFeature(m[1])) unmet.push(part);
    } else if (/^(a |an )/i.test(part)) {
      // Item requirements ("A suit of armor"): not checked.
    } else {
      unknown = true;
    }
  }
  if (unmet.length) return { met: false, note: `Requires ${unmet.join(', ')}` };
  return { met: unknown ? null : true, note: '' };
}

/** A spell entry that is really a class option: named "Family: Option" and assigned to no real class. */
export function isOptionSpell(e: Entry): boolean {
  if (!rawFamily(e.name)) return false;
  const v = spellView(e.el);
  return v.level === 0 && v.classes.length > 0 && v.classes.every((c) => !/^(artificer|barbarian|bard|cleric|druid|fighter|monk|paladin|ranger|rogue|sorcerer|warlock|wizard)( \[[^\]]*\])?$/i.test(c.trim()));
}

/** Prerequisite of an option spell is the "Prerequisite: ..." line at the start of its text. */
function optionSpellView(e: Entry): { text: string; prerequisite: string } {
  const text = spellView(e.el).text;
  const m = /^\s*prerequisites?:\s*(.+)$/im.exec(text.split('\n').slice(0, 3).join('\n'));
  return { text: m ? text.replace(m[0], '').trim() : text, prerequisite: m ? m[1].trim() : '' };
}

/** All option groups a class offers at `ctx.level`. */
export function optionGroups(ctx: OptionContext): OptionGroup[] {
  const groups = new Map<string, OptionGroup>();
  const triggers = ctx.classFeatures;
  const allNames = ctx.cv.features.map((f) => f.name);
  // If any feature of the class is named after the family, only named features grant it;
  // otherwise the start of a feature's description may ("Combat Superiority: you learn maneuvers").
  const grants = (f: { name: string; text: string }, family: string) => {
    if (familyOf(f.name).toLowerCase() === family.toLowerCase()) return false;
    if (mentions(f.name, family)) return true;
    const named = allNames.some((n) => familyOf(n).toLowerCase() !== family.toLowerCase() && mentions(n, family));
    return !named && mentions(f.text.slice(0, TEXT_WINDOW), family);
  };
  const grantedAt = (family: string) => triggers.filter((f) => grants(f, family));
  const ensure = (family: string, grantedBy: string) => {
    const key = family.toLowerCase();
    let g = groups.get(key);
    if (!g) { g = { family, grantedBy, now: false, options: [], max: null, known: 0 }; groups.set(key, g); }
    return g;
  };
  const subclassFamilies = new Set(ctx.cv.subclasses.map((s) => s.toLowerCase()));
  // Features that are themselves named after a family ("Deft Explorer") own their options.
  const ownerFeature = new Set(ctx.cv.features.map((f) => stripLevelPrefix(f.name).toLowerCase()).filter((n) => !n.includes(':')));
  const label = ctx.cv.subclassLabel.toLowerCase();

  // 1. Options inside the class, at or below the current level.
  for (const f of ctx.cv.features) {
    if (!f.optional || f.level > ctx.level || NOT_OPTIONS.test(stripLevelPrefix(f.name))) continue;
    const family = familyOf(f.name);
    if (!family || subclassFamilies.has(family.toLowerCase()) || family.toLowerCase() === label || subclassOwner(f, ctx.cv.subclasses)) continue;
    const g = ensure(family, grantedAt(family)[0]?.name ?? family);
    // Sub-options of a feature the character does not have ("Deft Explorer: Canny" without Deft Explorer).
    if (ownerFeature.has(family.toLowerCase()) && !triggers.some((t) => stripLevelPrefix(t.name).toLowerCase() === family.toLowerCase())) continue;
    if (g.options.some((o) => o.name === f.name)) continue;
    g.options.push({
      name: f.name, label: optionLabel(f.name), text: f.text, prerequisite: '', prereqMet: true, prereqNote: '',
      taken: ctx.known.has(f.name), level: f.level, feature: f, sourceTag: sourceTag(f.name, sourceOf(f.el)),
    });
    if (f.level === ctx.level) g.now = true;
  }

  // 2. Option feats from the compendium whose family the class mentions, and option "spells"
  //    (current community files write invocations, maneuvers, ... as <spell> entries whose
  //    <classes> names the granting feature, e.g. "Eldritch Invocations").
  if (ctx.lib) {
    const byFamily = new Map<string, Entry[]>();
    for (const e of [...ctx.lib.byKind.feat, ...ctx.lib.byKind.spell.filter(isOptionSpell)]) {
      const family = familyOf(e.name);
      if (!family) continue;
      byFamily.set(family, [...(byFamily.get(family) ?? []), e]);
    }
    for (const [family, entries] of byFamily) {
      if (entries.length < 2) continue; // a lone "X: Y" feat is just a feat with a colon in its name
      const by = grantedAt(family);
      if (!by.length) continue;
      const g = ensure(family, by[0].name);
      for (const e of entries) {
        if (g.options.some((o) => o.name.toLowerCase() === e.name.toLowerCase())) continue;
        const v = e.kind === 'spell' ? optionSpellView(e) : featView(e.el);
        const pre = checkPrerequisite(v.prerequisite, ctx);
        g.options.push({
          name: e.name, label: optionLabel(e.name), text: v.text, prerequisite: v.prerequisite,
          prereqMet: pre.met, prereqNote: pre.note, taken: ctx.known.has(e.name), feat: e,
          sourceTag: sourceTag(e.name, sourceOf(e.el)),
        });
      }
    }
  }

  // A group is "now" when a feature gained at this level mentions it (e.g. "Additional Invocation").
  const edition = is2024(ctx.cv.name, ctx.cv.features) ? '2024' : '2014';
  for (const g of groups.values()) {
    if (triggers.some((f) => f.level === ctx.level && grants(f, g.family))) g.now = true;
    g.known = g.options.filter((o) => o.taken && !FREE_OPTION.test(o.name)).length;
    g.max = expectedOptionCount(g.family, ctx.cv.name, ctx.level, edition, [...ctx.known, ...triggers.map((t) => t.name)]);
    if (g.max !== null && g.known < g.max) g.now = true;
    g.options.sort((a, b) => Number(b.prereqMet !== false) - Number(a.prereqMet !== false) || a.label.localeCompare(b.label));
  }
  return [...groups.values()].filter((g) => g.options.length).sort((a, b) => Number(b.now) - Number(a.now) || a.family.localeCompare(b.family));
}

/** Features at this level that let the character pick skills for expertise. */
export const grantsExpertise = (features: { name: string; text: string }[]) =>
  features.some((f) => /(^|: |\b)expertise$/i.test(f.name.trim()) && !/tool expertise/i.test(f.name) && /skill/i.test(f.text));
