// Compendium model: typed read-only views over the preserved XML entries,
// plus merging of several imported files into one library.
//
// The views also accept the "compiled" shapes found inside character files
// (<feat> instead of <feature>, <level> as a child element, numeric codes),
// so the same code reads a class whether it comes from a compendium or from
// a character export.

import {
  XDocument, XElement, attr, child, childText, childTexts, cloneEl, el, elements, parseXml, serializeXml, textOf,
} from '../xml/xml';
import {
  damageTypeLetters, hdDie, itemTypeLetters, propertiesFromMask, schoolLetters, sizeLetters,
} from './codes';

export const KINDS = ['race', 'class', 'background', 'feat', 'spell', 'item', 'monster'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = {
  race: 'Races', class: 'Classes', background: 'Backgrounds', feat: 'Feats',
  spell: 'Spells', item: 'Items', monster: 'Monsters',
};

export interface Entry {
  kind: Kind;
  name: string;
  el: XElement;
  fileId: string;
}

export interface CompendiumFile {
  id: string;
  fileName: string;
  xml: string;
  importedAt: number;
  enabled: boolean;
}

export interface Library {
  entries: Map<string, Entry>;           // key: kind + ':' + lowercased name
  byKind: Record<Kind, Entry[]>;
  others: { fileId: string; el: XElement }[]; // unrecognized top-level elements, kept for export
  warnings: { fileId: string; message: string }[];
}

export const entryKey = (kind: string, name: string) => `${kind}:${name.trim().toLowerCase()}`;

/**
 * Merge enabled files in import order, the way the community build tools do:
 * - classes with the same name are merged: the copy with <hd> is the base and
 *   every copy's <autolevel> elements are appended (that is how subclass
 *   files extend a class);
 * - spells with the same name merge their <classes> lists; the copy with
 *   <level> provides the rest;
 * - any other duplicate replaces the earlier entry, with a warning.
 */
export function buildLibrary(files: CompendiumFile[]): Library {
  const lib: Library = { entries: new Map(), byKind: emptyByKind(), others: [], warnings: [] };
  for (const f of files) {
    if (!f.enabled) continue;
    const { doc, warnings } = parseXml(f.xml);
    for (const w of warnings) lib.warnings.push({ fileId: f.id, message: w });
    if (doc.root.name !== 'compendium') {
      lib.warnings.push({ fileId: f.id, message: `root element is <${doc.root.name}>, expected <compendium>` });
    }
    for (const e of elements(doc.root)) {
      const kind = (KINDS as readonly string[]).includes(e.name) ? (e.name as Kind) : null;
      if (!kind) { lib.others.push({ fileId: f.id, el: e }); continue; }
      const name = childText(e, 'name');
      if (!name) {
        lib.warnings.push({ fileId: f.id, message: `<${e.name}> without a <name> skipped` });
        continue;
      }
      const key = entryKey(kind, name);
      const prev = lib.entries.get(key);
      if (!prev) { lib.entries.set(key, { kind, name, el: e, fileId: f.id }); continue; }
      if (kind === 'class') {
        lib.entries.set(key, { kind, name, el: mergeClass(prev.el, e), fileId: child(e, 'hd') ? f.id : prev.fileId });
        continue;
      }
      if (kind === 'spell') {
        lib.entries.set(key, { kind, name, el: mergeSpell(prev.el, e), fileId: child(e, 'level') ? f.id : prev.fileId });
        continue;
      }
      const prevFile = files.find((x) => x.id === prev.fileId)?.fileName ?? '?';
      lib.warnings.push({ fileId: f.id, message: `${kind} "${name}" replaces the copy from ${prevFile}` });
      lib.entries.set(key, { kind, name, el: e, fileId: f.id });
    }
  }
  for (const e of lib.entries.values()) lib.byKind[e.kind].push(e);
  for (const k of KINDS) lib.byKind[k].sort((a, b) => a.name.localeCompare(b.name));
  return lib;
}

function mergeClass(a: XElement, b: XElement): XElement {
  const base = child(a, 'hd') || !child(b, 'hd') ? a : b;
  const extra = base === a ? b : a;
  const merged = cloneEl(base);
  for (const al of elements(extra, 'autolevel')) merged.children.push(cloneEl(al));
  // Scalar fields missing from the base but present in the extension (rare).
  for (const c of elements(extra)) {
    if (c.name !== 'autolevel' && c.name !== 'name' && !child(merged, c.name)) merged.children.push(cloneEl(c));
  }
  return merged;
}

function mergeSpell(a: XElement, b: XElement): XElement {
  const base = child(a, 'level') || !child(b, 'level') ? a : b;
  const extra = base === a ? b : a;
  const merged = cloneEl(base);
  const classes = new Set(splitList(childText(merged, 'classes')));
  for (const c of splitList(childText(extra, 'classes'))) classes.add(c);
  const ce = child(merged, 'classes');
  const text = [...classes].join(', ');
  if (ce) ce.children = [{ type: 'text', value: text }];
  else merged.children.push(el('classes', text));
  for (const c of elements(extra)) {
    if (c.name !== 'classes' && c.name !== 'name' && !child(merged, c.name)) merged.children.push(cloneEl(c));
  }
  return merged;
}

function emptyByKind(): Record<Kind, Entry[]> {
  return { race: [], class: [], background: [], feat: [], spell: [], item: [], monster: [] };
}

export function lookup(lib: Library, kind: Kind, name: string): Entry | undefined {
  return lib.entries.get(entryKey(kind, name));
}

/** Export the merged library as one compendium file. */
export function exportLibrary(lib: Library): string {
  const root = el('compendium', undefined, [['version', '5'], ['auto_indent', 'NO']]);
  for (const k of KINDS) for (const e of lib.byKind[k]) root.children.push(e.el);
  for (const o of lib.others) root.children.push(o.el);
  const doc: XDocument = { prolog: [], root, epilog: [] };
  return serializeXml(doc, { pretty: true });
}

// ---------------------------------------------------------------- codes

export const ITEM_TYPES: Record<string, string> = {
  LA: 'Light armor', MA: 'Medium armor', HA: 'Heavy armor', S: 'Shield', M: 'Melee weapon',
  R: 'Ranged weapon', A: 'Ammunition', RD: 'Rod', ST: 'Staff', WD: 'Wand', RG: 'Ring', P: 'Potion',
  SC: 'Scroll', W: 'Wondrous item', G: 'Adventuring gear', $: 'Wealth',
};
export const WEAPON_PROPERTIES: Record<string, string> = {
  A: 'Ammunition', F: 'Finesse', H: 'Heavy', L: 'Light', LD: 'Loading', R: 'Reach', S: 'Special',
  T: 'Thrown', '2H': 'Two-handed', V: 'Versatile', M: 'Martial',
};
export const DAMAGE_TYPES: Record<string, string> = {
  A: 'acid', B: 'bludgeoning', C: 'cold', F: 'fire', FC: 'force', L: 'lightning', N: 'necrotic',
  P: 'piercing', PS: 'poison', PY: 'psychic', R: 'radiant', S: 'slashing', T: 'thunder',
};
export const SCHOOLS: Record<string, string> = {
  A: 'Abjuration', C: 'Conjuration', D: 'Divination', EN: 'Enchantment', EV: 'Evocation',
  I: 'Illusion', N: 'Necromancy', T: 'Transmutation',
};
export const SIZES: Record<string, string> = {
  T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan',
};

export { ABILITIES, ABBR, SKILLS, isSkill, canonicalSkill, parseAbility } from './terms';
export type { Ability } from './terms';
import { ABILITIES, Ability, SKILLS, isSkill, canonicalSkill, parseAbility } from './terms';

// ---------------------------------------------------------------- modifiers

export type ModifierCategory = 'bonus' | 'ability score' | 'ability modifier' | 'saving throw' | 'skill' | 'other';

export interface Modifier {
  category: ModifierCategory;
  /** normalised target: an ability name, a skill name (lowercase), or a bonus key such as "ac" */
  target: string;
  /** numeric value, or null when it is a placeholder (see `dynamic`) */
  value: number | null;
  /** "%8" (proficiency bonus), "%2" (Dex modifier), "prof", ... resolved against the sheet */
  dynamic: string | null;
  mode: 'add' | 'set';
  raw: string;
}

const CATEGORY_ALIASES: Record<string, ModifierCategory> = {
  bonus: 'bonus', 'ability score': 'ability score', 'ability scores': 'ability score',
  'ability modifier': 'ability modifier', 'saving throw': 'saving throw', 'saving throws': 'saving throw',
  skill: 'skill', skills: 'skill',
};

const BONUS_ALIASES: Record<string, string> = {
  'armor class': 'ac', ac: 'ac', 'ac magic': 'ac', hp: 'hp', 'hit points': 'hp', speed: 'speed',
  initiative: 'initiative', 'proficiency bonus': 'proficiency bonus', 'saving throws': 'saving throws',
  'spell attack': 'spell attack', 'spell attacks': 'spell attack', 'spell dc': 'spell dc',
  'melee attack': 'melee attacks', 'melee attacks': 'melee attacks', 'melee damage': 'melee damage',
  'ranged attack': 'ranged attacks', 'ranged attacks': 'ranged attacks', 'ranged damage': 'ranged damage',
  'weapon attack': 'weapon attacks', 'weapon attacks': 'weapon attacks', 'weapon damage': 'weapon damage',
  'ability checks': 'ability checks', 'passive perception': 'passive perception',
  'passive investigation': 'passive investigation', 'passive insight': 'passive insight',
};

/**
 * `<modifier category="bonus">ac +1</modifier>`, `strength score +2`, `wisdom save +1`,
 * `stealth +%8` (placeholder), `strength 19` (minimum score).
 */
export function parseModifier(e: XElement): Modifier | null {
  const raw = textOf(e).trim();
  const catRaw = (attr(e, 'category') ?? childText(e, 'category')).trim().toLowerCase();
  let category: ModifierCategory = CATEGORY_ALIASES[catRaw] ?? 'other';
  const m = /^(.*?)\s*(?:([+-])\s*)?(\d+|%\d+|prof)\s*$/i.exec(raw);
  if (!m || !m[1].trim()) return null;
  let target = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
  const sign = m[2] === '-' ? -1 : 1;
  const tok = m[3].toLowerCase();
  const isNum = /^\d+$/.test(tok);
  let mode: 'add' | 'set' = m[2] || !isNum ? 'add' : 'set';

  // Normalise the target and infer the category when it is missing or odd.
  const passive = /^passive /.test(target);
  const abil = parseAbility(target.replace(/ (score|save|saving throws?|modifier)$/, ''));
  if (abil && !passive && !BONUS_ALIASES[target]) {
    if (/ save| saving throw/.test(target) || category === 'saving throw') category = 'saving throw';
    else if (/ modifier$/.test(target) || category === 'ability modifier') category = 'ability modifier';
    else category = 'ability score';
    target = abil;
  } else if (canonicalSkill(target)) {
    category = 'skill';
    target = canonicalSkill(target)!.toLowerCase();
  } else {
    target = BONUS_ALIASES[target] ?? target;
    if (category !== 'bonus' && category !== 'other') category = 'bonus';
    if (category === 'other') category = 'bonus';
    if (mode === 'set') mode = 'add'; // "speed 5" style entries are bonuses
  }
  return {
    category, target, mode, raw,
    value: isNum ? sign * +tok : null,
    dynamic: isNum ? null : (sign < 0 ? '-' : '') + tok,
  };
}

/** <modifier> elements (compendium form) and <mod> elements (character form, category 1 = ability score). */
export function modifiersOf(e: XElement): Modifier[] {
  const out: Modifier[] = [];
  for (const m of elements(e, 'modifier')) { const p = parseModifier(m); if (p) out.push(p); }
  for (const m of elements(e, 'mod')) {
    const cat = childText(m, 'category'), type = childText(m, 'type'), value = parseInt(childText(m, 'value'), 10);
    if (cat === '1' && Number.isFinite(value)) {
      const a = ABILITIES[parseInt(type || '0', 10)] ?? 'strength';
      out.push({ category: 'ability score', target: a, value, dynamic: null, mode: 'add', raw: `${a} +${value}` });
    }
  }
  return out;
}

export const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const yes = (s: string | undefined) => !!s && /^(yes|1|true)$/i.test(s.trim());
const num = (s: string, d = 0) => { const n = parseFloat(s); return Number.isFinite(n) ? n : d; };

/** Multiple <text> elements are paragraphs; empty ones are blank lines. */
export const textsOf = (e: XElement, tag = 'text') => childTexts(e, tag).join('\n');

export interface Roll { formula: string; description: string; level: number | null }
export const rollsOf = (e: XElement): Roll[] =>
  elements(e, 'roll').map((r) => ({
    formula: textOf(r).trim(), description: attr(r, 'description') ?? '',
    level: attr(r, 'level') ? parseInt(attr(r, 'level')!, 10) : null,
  })).filter((r) => r.formula);

// ---------------------------------------------------------------- views

export interface Trait {
  name: string; text: string; modifiers: Modifier[]; special: string; proficiencies: string[];
  rolls: Roll[]; el: XElement;
}

/** Traits (<trait>), or compiled features (<feat>) inside character files. */
export const traitsOf = (e: XElement, tag = 'trait'): Trait[] =>
  elements(e, tag).map((t) => ({
    name: childText(t, 'name'), text: textsOf(t), modifiers: modifiersOf(t), special: childText(t, 'special'),
    proficiencies: splitList(childText(t, 'proficiency')), rolls: rollsOf(t), el: t,
  }));

/** Proficiency lists hold names (compendium) or numeric codes (character files). */
export function proficiencyNames(e: XElement): string[] {
  const out: string[] = [];
  for (const p of elements(e, 'proficiency')) {
    for (const item of splitList(textOf(p))) {
      if (/^\d+$/.test(item)) {
        const code = +item;
        if (code <= 5) out.push(ABILITIES[code]);
        else if (code >= 100 && code - 100 < SKILLS.length) out.push(SKILLS[code - 100][0]);
      } else {
        out.push(item.replace(/\s+saving throws?$/i, ''));
      }
    }
  }
  return out;
}

export function raceView(e: XElement) {
  const traits = traitsOf(e).concat(traitsOf(e, 'feat'));
  return {
    name: childText(e, 'name'),
    size: sizeLetters(childText(e, 'size')),
    speed: num(childText(e, 'speed'), 30),
    abilityBonuses: parseAbilityBonuses(childText(e, 'ability')),
    proficiencies: proficiencyNames(e),
    spellAbility: parseAbility(childText(e, 'spellAbility')),
    traits,
    modifiers: modifiersOf(e),
  };
}

/** "Str 2, Cha 1" → { strength: 2, charisma: 1 } */
export function parseAbilityBonuses(s: string): Partial<Record<Ability, number>> {
  const out: Partial<Record<Ability, number>> = {};
  for (const part of splitList(s)) {
    const m = /^([A-Za-z]+)\s*([+-]?\d+)$/.exec(part);
    const a = m && parseAbility(m[1]);
    if (a) out[a] = (out[a] ?? 0) + +m![2];
  }
  return out;
}

export function backgroundView(e: XElement) {
  return {
    name: childText(e, 'name'),
    proficiencies: proficiencyNames(e),
    traits: traitsOf(e).concat(traitsOf(e, 'feat')),
    modifiers: modifiersOf(e),
  };
}

export function featView(e: XElement) {
  return {
    name: childText(e, 'name'),
    prerequisite: childText(e, 'prerequisite'),
    text: textsOf(e),
    proficiencies: proficiencyNames(e),
    modifiers: modifiersOf(e),
    special: childText(e, 'special'),
    rolls: rollsOf(e),
  };
}

/** 2024-rules files prefix feature names with their level ("Level 3: Warlock Subclass"); compare without it. */
export const stripLevelPrefix = (name: string) => name.replace(/^\s*level\s+\d+\s*:\s*/i, '').trim();

/** Inner text of a trailing parenthetical, allowing nesting: "Among the Dead (The Undying (Legacy))" → "The Undying (Legacy)". */
export function trailingParen(name: string): string | null {
  const t = name.trim();
  if (!t.endsWith(')')) return null;
  let depth = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === ')') depth++;
    else if (t[i] === '(' && --depth === 0) return i > 0 ? t.slice(i + 1, -1).trim() : null;
  }
  return null;
}

export interface ClassFeature {
  name: string; text: string; optional: boolean; level: number; modifiers: Modifier[];
  special: string; proficiencies: string[]; rolls: Roll[]; subclass: string; el: XElement;
}
export interface SlotRow { level: number; optional: boolean; values: number[] } // [cantrips, 1st..9th]
export interface Counter { name: string; value: number; reset: string; level: number; subclass: string }

/** "2,3,0,0,0,0,0,0,0,0," or "4, 3, 2" → 10 numbers, cantrips first. */
export function parseSlots(s: string): number[] {
  const v = s.split(',').map((x) => x.trim()).filter((x) => x !== '').map((x) => num(x));
  return Array.from({ length: 10 }, (_, i) => v[i] ?? 0);
}

function autolevelLevel(al: XElement): number {
  const a = attr(al, 'level');
  if (a !== undefined) return num(a, 1);
  const c = childText(al, 'level');
  return c ? num(c, 1) : 1; // character files omit <level> at level 1
}

export function classView(e: XElement) {
  const features: ClassFeature[] = [];
  const slots: SlotRow[] = [];
  const counters: Counter[] = [];
  const asiLevels = new Set<number>();
  for (const al of elements(e, 'autolevel')) {
    const level = autolevelLevel(al);
    if (yes(attr(al, 'scoreImprovement')) || yes(childText(al, 'scoreImprovement'))) asiLevels.add(level);
    for (const f of [...elements(al, 'feature'), ...elements(al, 'feat')]) {
      features.push({
        name: childText(f, 'name'), text: textsOf(f),
        optional: yes(attr(f, 'optional')) || yes(childText(f, 'optional')), level, modifiers: modifiersOf(f),
        special: childText(f, 'special'), proficiencies: proficiencyNames(f), rolls: rollsOf(f),
        subclass: childText(f, 'subclass'), el: f,
      });
    }
    for (const s of elements(al, 'slots')) {
      slots.push({ level, optional: yes(attr(s, 'optional')), values: parseSlots(textOf(s)) });
    }
    for (const c of elements(al, 'counter')) {
      counters.push({
        name: childText(c, 'name'), value: num(childText(c, 'value')), reset: childText(c, 'reset'),
        level, subclass: childText(c, 'subclass'),
      });
    }
  }
  const prof = proficiencyNames(e);
  const subclasses = subclassNames(features, counters);
  const subclassLevels = new Map<string, number>();
  let subclassLabel = '';
  let labelIsFixed = false;
  for (const f of features) {
    if (!f.optional) continue;
    const owner = subclassOwner(f, subclasses);
    if (!owner) continue;
    subclassLevels.set(owner, Math.min(subclassLevels.get(owner) ?? 99, f.level));
    const m = /^([^:]+):\s*(.+)$/.exec(stripLevelPrefix(f.name));
    if (m && m[2].trim().toLowerCase() === owner.toLowerCase() && !subclasses.some((x) => x.toLowerCase() === m[1].trim().toLowerCase())) {
      const isFixed = features.some((g) => !g.optional && stripLevelPrefix(g.name).toLowerCase() === m[1].trim().toLowerCase());
      if (!subclassLabel || (isFixed && !labelIsFixed)) { subclassLabel = m[1].trim(); labelIsFixed = isFixed; }
    }
  }
  return {
    name: childText(e, 'name'),
    hd: hdDie(childText(e, 'hd'), 8),
    savingThrows: prof.map(parseAbility).filter((a): a is Ability => !!a),
    skillChoices: prof.filter(isSkill).map((s) => canonicalSkill(s)!),
    numSkills: num(childText(e, 'numSkills') || childText(e, 'numClassSkills'), 2),
    armor: childText(e, 'armor'),
    weapons: childText(e, 'weapons'),
    tools: childText(e, 'tools'),
    wealth: childText(e, 'wealth'),
    spellAbility: parseAbility(childText(e, 'spellAbility')),
    slotsReset: childText(e, 'slotsReset'),
    features, slots, counters, asiLevels,
    subclasses, subclassLevels, subclassLabel: subclassLabel || 'Subclass',
  };
}

/** Option families that use the "Family: Option" naming but are not subclasses. */
const OPTION_FAMILIES = /^(becoming a.*|fighting style|metamagic|eldritch invocations?|invocations?|maneuvers?|pact boon|totem spirit|hunter'?s prey|defensive tactics|multiattack|superior hunter'?s defense|arcane shot( options)?|infusions?|elemental disciplines?|runes?|psionic power|favou?red enemy|natural explorer|expertise|ability score improvement|starting|multiclass|artificer infusions?|maneuver options?|blessings?|elemental attunement|forms?|mystic arcanum.*|channel divinity.*|wild shape.*|optional class features?|dragon ancestor|totem.*|aspect of the beast|beast.*)$/i;

/**
 * Subclasses are not a dedicated element. Features belonging to a subclass are
 * named "Subclass: Feature" (older files, and character exports) or
 * "Feature (Subclass)" (newer files), and the subclass is introduced by an
 * optional feature named "Family: Subclass" ("Martial Archetype: Champion").
 */
export function subclassNames(rawFeatures: ClassFeature[], counters: Counter[] = []): string[] {
  const features = rawFeatures.map((f) => ({ ...f, name: stripLevelPrefix(f.name) }));
  const names = new Set<string>();
  const headingNames = new Set<string>();
  const nonOptional = new Set(features.filter((f) => !f.optional).map((f) => f.name.toLowerCase().trim()));
  for (const c of counters) if (c.subclass) names.add(c.subclass);
  for (const f of features) if (f.subclass) names.add(f.subclass);
  const optional = features.filter((f) => f.optional);
  const hasMembers = (s: string) => {
    const low = s.toLowerCase();
    return optional.some((g) => {
      const n = g.name.toLowerCase();
      if (n.startsWith(low + ': ') && n.length > low.length + 2) return true;
      // "Rite of the Dawn (Ghostslayer)" belongs to "Order of the Ghostslayer".
      const paren = trailingParen(n);
      return !!paren && (paren === low || (paren.length >= 4 && low.endsWith(' ' + paren)));
    });
  };
  // Introductions: "Family: Subclass" where Family is itself a (non-optional) feature.
  for (const f of optional) {
    const m = /^([^:]+):\s*(.+)$/.exec(f.name);
    if (!m) continue;
    const family = m[1].trim(), candidate = m[2].trim();
    if (!nonOptional.has(family.toLowerCase()) && !nonOptional.has(family.toLowerCase() + 's')) continue;
    if (OPTION_FAMILIES.test(family)) continue;
    if (hasMembers(candidate)) names.add(candidate);
  }
  // Prefix groups without an introduction ("Path of the Beast (UA): Form of the Beast").
  const prefixCount = new Map<string, number>();
  for (const f of optional) {
    const m = /^([^:]+):\s*(.+)$/.exec(f.name);
    if (m) prefixCount.set(m[1].trim(), (prefixCount.get(m[1].trim()) ?? 0) + 1);
  }
  // A prefix that is itself the name of a feature ("Deft Explorer" with "Deft Explorer: Canny") is a
  // feature with sub-options, not a subclass.
  const featureNames = new Set(features.map((f) => f.name.toLowerCase().trim()));
  const candidates = [...prefixCount].filter(([prefix, count]) => {
    const low = prefix.toLowerCase();
    return count >= 2 && !names.has(prefix) && !nonOptional.has(low) && !nonOptional.has(low + 's') && !featureNames.has(low) && !OPTION_FAMILIES.test(prefix);
  }).map(([prefix]) => prefix);
  // A prefix whose entries name two or more other subclasses is a heading that introduces them
  // ("Divine Domain: X", or "Otherworldly Patron: X" in files merged from another rules edition).
  // A heading names two or more known subclasses, or names at least one with all its entries at one level
  // (a real subclass has features spread over several levels).
  const known = new Set([...names, ...candidates].map((n) => n.toLowerCase()));
  const entriesOf = (prefix: string) => optional.filter((g) => g.name.startsWith(prefix + ':'));
  const suffix = (prefix: string, g: { name: string }) => g.name.slice(prefix.length + 1).trim();
  const headings = new Set(candidates.filter((prefix) => {
    const entries = entriesOf(prefix);
    const isSubclass = (x: string) => x.toLowerCase() !== prefix.toLowerCase() && (known.has(x.toLowerCase()) || hasMembers(x));
    const knownCount = entries.filter((g) => isSubclass(suffix(prefix, g))).length;
    return knownCount >= 2 || (knownCount >= 1 && new Set(entries.map((g) => g.level)).size === 1);
  }));
  for (const prefix of candidates) if (!headings.has(prefix)) names.add(prefix);
  for (const h of headings) {
    headingNames.add(h.toLowerCase());
    for (const g of entriesOf(h)) { const sub = suffix(h, g); if (hasMembers(sub)) names.add(sub); }
  }
  // A subclass is never an option list ("Eldritch Invocations") or one of the class's fixed features.
  return [...names].filter((n) => !OPTION_FAMILIES.test(n) && !nonOptional.has(n.toLowerCase()) && !headingNames.has(n.toLowerCase()) && !/^level\s+\d+$/i.test(n));
}

/**
 * Which subclass owns a feature, judged from its name:
 * "Subclass: Feature", "Feature (Subclass)", "Feature (Short name)" (e.g. "(Ghostslayer)" for
 * "Order of the Ghostslayer"), or the introduction "Family: Subclass".
 */
export function subclassOwner(f: { name: string; subclass?: string }, subclasses: string[]): string | null {
  if (f.subclass) return subclasses.find((s) => s.toLowerCase() === f.subclass!.toLowerCase()) ?? f.subclass;
  const n = stripLevelPrefix(f.name);
  const byLength = [...subclasses].sort((a, b) => b.length - a.length);
  const find = (x: string) => byLength.find((s) => s.toLowerCase() === x.trim().toLowerCase()) ?? null;
  const colon = n.indexOf(':');
  if (colon > 0) { const hit = find(n.slice(0, colon)); if (hit) return hit; }
  const paren = trailingParen(n);
  if (paren) {
    const hit = find(paren);
    if (hit) return hit;
    const p = paren.toLowerCase();
    const bySuffix = p.length >= 4 ? byLength.filter((s) => s.toLowerCase().endsWith(' ' + p)) : [];
    if (bySuffix.length === 1) return bySuffix[0];
  }
  if (colon > 0) { const hit = find(n.slice(colon + 1)); if (hit) return hit; }
  return null;
}

/** Does this optional feature belong to the named subclass? */
export function featureInSubclass(f: ClassFeature, subclass: string, subclasses: string[] = [subclass]): boolean {
  if (!subclass.trim()) return false;
  return subclassOwner(f, subclasses.includes(subclass) ? subclasses : [...subclasses, subclass])?.toLowerCase() === subclass.toLowerCase();
}

/** The subclass a feature introduces or belongs to, if its name says so. */
export function subclassOfFeature(f: ClassFeature, subclasses: string[]): string | null {
  return subclassOwner(f, subclasses);
}

export function spellView(e: XElement) {
  const school = schoolLetters(childText(e, 'school'));
  const components = childText(e, 'components') || compiledComponents(e);
  const classes = splitList(childText(e, 'classes')).concat(childTexts(e, 'sclass').map((x) => x.trim()).filter(Boolean));
  return {
    name: childText(e, 'name'),
    level: num(childText(e, 'level')),
    school: SCHOOLS[school] ?? school,
    schoolCode: school,
    ritual: yes(childText(e, 'ritual')),
    time: childText(e, 'time'),
    range: childText(e, 'range'),
    components,
    duration: childText(e, 'duration'),
    classes: [...new Set(classes)],
    text: textsOf(e),
    rolls: rollsOf(e),
  };
}

/** Character files store components as <v/>, <s/>, <m/> flags plus <materials>. */
function compiledComponents(e: XElement): string {
  const parts: string[] = [];
  if (yes(childText(e, 'v'))) parts.push('V');
  if (yes(childText(e, 's'))) parts.push('S');
  if (yes(childText(e, 'm'))) parts.push(childText(e, 'materials') ? `M (${childText(e, 'materials')})` : 'M');
  return parts.join(', ');
}

/** "Fighter (Eldritch Knight)" → base class "fighter", subclass "eldritch knight". */
export function spellClassMatches(entry: string, className: string, subclasses: string[] = []): boolean {
  const m = /^([^(]+?)\s*(?:\((.*)\))?\s*$/.exec(entry.trim());
  if (!m) return false;
  if (m[1].trim().toLowerCase() !== className.trim().toLowerCase()) return false;
  if (!m[2]) return true;
  const sub = m[2].toLowerCase();
  return subclasses.some((s) => sub.includes(s.toLowerCase()) || s.toLowerCase().includes(sub.replace(/\s*\(.*\)\s*$/, '')));
}

export function itemView(e: XElement) {
  const type = itemTypeLetters(childText(e, 'type'));
  const detail = childText(e, 'detail');
  return {
    name: childText(e, 'name'),
    type,
    typeLabel: ITEM_TYPES[type] ?? type,
    magic: yes(childText(e, 'magic')) || /\brarity\b|uncommon|\brare\b|legendary|artifact/i.test(detail) && !/non-?magical/i.test(detail),
    detail,
    weight: num(childText(e, 'weight')),
    value: childText(e, 'value'),
    ac: num(childText(e, 'ac')),
    strength: num(childText(e, 'strength')),
    stealth: yes(childText(e, 'stealth')),
    dmg1: childText(e, 'dmg1') || childText(e, 'damage1H'),
    dmg2: childText(e, 'dmg2') || childText(e, 'damage2H'),
    dmgTypeCode: damageTypeLetters(childText(e, 'dmgType') || childText(e, 'damageType')),
    dmgType: DAMAGE_TYPES[damageTypeLetters(childText(e, 'dmgType') || childText(e, 'damageType'))] ?? '',
    properties: propertiesFromMask(childText(e, 'property') || childText(e, 'weaponProperty')),
    range: childText(e, 'range'),
    text: textsOf(e),
    rolls: rollsOf(e),
    modifiers: modifiersOf(e),
    attunement: /requires attunement/i.test(detail) || /requires attunement/i.test(textsOf(e).slice(0, 200)),
  };
}

export interface MonsterAttack { name: string; bonus: number | null; bonusRaw: string; damage: string }
export const parseAttack = (s: string): MonsterAttack | null => {
  const parts = s.split('|');
  if (parts.length < 2) return null;
  const b = parts[1].trim();
  const n = /^[+-]?\d+$/.test(b) ? parseInt(b, 10) : null;
  return { name: parts[0].trim(), bonus: n, bonusRaw: b, damage: (parts[2] ?? '').trim() };
};

export function monsterView(e: XElement) {
  const t = (n: string) => childText(e, n);
  const block = (tag: string) => elements(e, tag).map((x) => ({
    name: childText(x, 'name'), text: textsOf(x), recharge: childText(x, 'recharge'),
    attacks: childTexts(x, 'attack').map(parseAttack).filter((a): a is MonsterAttack => !!a),
  }));
  return {
    name: t('name'), size: SIZES[sizeLetters(t('size'))] ?? t('size'), type: t('type'), alignment: t('alignment'),
    ac: t('ac'), hp: t('hp'), speed: t('speed'),
    scores: ABILITIES.map((a) => num(t(a.slice(0, 3)), 10)),
    save: t('save'), skill: t('skill'), resist: t('resist'), vulnerable: t('vulnerable'),
    immune: t('immune'), conditionImmune: t('conditionImmune'), senses: t('senses'),
    passive: t('passive'), languages: t('languages'), cr: t('cr'),
    traits: block('trait'), actions: block('action'), reactions: block('reaction'), legendary: block('legendary'),
    spells: splitList(t('spells')), slots: t('slots') ? parseSlots(t('slots')) : null,
    description: childTexts(e, 'description').join('\n'), environment: t('environment'),
  };
}

/** Generic text summary of any entry, used for unknown fields in the browser. */
export function fieldsOf(e: XElement): [string, string][] {
  return elements(e).filter((c) => !child(c, 'name')).map((c) => [c.name, textOf(c).trim()]);
}
