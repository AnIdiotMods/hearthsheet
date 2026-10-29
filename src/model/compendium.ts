// Compendium model: typed read-only views over the preserved XML entries,
// plus merging of several imported files into one library.

import {
  XDocument, XElement, attr, child, childText, childTexts, el, elements, parseXml, serializeXml, textOf,
} from '../xml/xml';

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
 * Merge enabled files in import order. A later entry with the same kind and
 * (case-insensitive) name replaces the earlier one, and a warning records it.
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
      if (prev) {
        const prevFile = files.find((x) => x.id === prev.fileId)?.fileName ?? '?';
        lib.warnings.push({ fileId: f.id, message: `${kind} "${name}" replaces the copy from ${prevFile}` });
      }
      lib.entries.set(key, { kind, name, el: e, fileId: f.id });
    }
  }
  for (const e of lib.entries.values()) lib.byKind[e.kind].push(e);
  for (const k of KINDS) lib.byKind[k].sort((a, b) => a.name.localeCompare(b.name));
  return lib;
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

export const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export type Ability = (typeof ABILITIES)[number];
export const ABBR: Record<Ability, string> = {
  strength: 'STR', dexterity: 'DEX', constitution: 'CON', intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA',
};

export function parseAbility(s: string): Ability | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  return ABILITIES.find((a) => a === t || a.slice(0, 3) === t.slice(0, 3)) ?? null;
}

export const SKILLS: [string, Ability][] = [
  ['Acrobatics', 'dexterity'], ['Animal Handling', 'wisdom'], ['Arcana', 'intelligence'],
  ['Athletics', 'strength'], ['Deception', 'charisma'], ['History', 'intelligence'],
  ['Insight', 'wisdom'], ['Intimidation', 'charisma'], ['Investigation', 'intelligence'],
  ['Medicine', 'wisdom'], ['Nature', 'intelligence'], ['Perception', 'wisdom'],
  ['Performance', 'charisma'], ['Persuasion', 'charisma'], ['Religion', 'intelligence'],
  ['Sleight of Hand', 'dexterity'], ['Stealth', 'dexterity'], ['Survival', 'wisdom'],
];
export const isSkill = (s: string) => SKILLS.some(([n]) => n.toLowerCase() === s.trim().toLowerCase());
export const canonicalSkill = (s: string) => SKILLS.find(([n]) => n.toLowerCase() === s.trim().toLowerCase())?.[0];

// ---------------------------------------------------------------- modifiers

export interface Modifier {
  category: string;   // e.g. "bonus", "ability score", "saving throw", "skill"
  target: string;     // lowercased, e.g. "ac", "strength", "stealth"
  value: number;
  mode: 'add' | 'set';
  raw: string;
}

/** `<modifier category="bonus">ac +1</modifier>`; a bare number ("strength 19") sets a minimum. */
export function parseModifier(e: XElement): Modifier | null {
  const raw = textOf(e).trim();
  const category = (attr(e, 'category') ?? '').trim().toLowerCase();
  let m = /^(.*?)\s*([+-])\s*(\d+)\s*$/.exec(raw);
  if (m) return { category, target: m[1].trim().toLowerCase(), value: (m[2] === '-' ? -1 : 1) * +m[3], mode: 'add', raw };
  m = /^(.*?)\s*=?\s*(\d+)\s*$/.exec(raw);
  if (m && m[1].trim()) return { category, target: m[1].trim().toLowerCase(), value: +m[2], mode: 'set', raw };
  return null;
}

export const modifiersOf = (e: XElement) =>
  elements(e, 'modifier').map(parseModifier).filter((m): m is Modifier => !!m);

export const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const yes = (s: string) => /^(yes|1|true)$/i.test(s.trim());
const num = (s: string, d = 0) => { const n = parseFloat(s); return Number.isFinite(n) ? n : d; };

// ---------------------------------------------------------------- views

export interface Trait { name: string; text: string; modifiers: Modifier[]; el: XElement }

export const traitsOf = (e: XElement, tag = 'trait'): Trait[] =>
  elements(e, tag).map((t) => ({
    name: childText(t, 'name'), text: childTexts(t, 'text').join('\n'), modifiers: modifiersOf(t), el: t,
  }));

export function raceView(e: XElement) {
  return {
    name: childText(e, 'name'),
    size: childText(e, 'size'),
    speed: num(childText(e, 'speed'), 30),
    abilityBonuses: parseAbilityBonuses(childText(e, 'ability')),
    proficiencies: splitList(childText(e, 'proficiency')),
    spellAbility: parseAbility(childText(e, 'spellAbility')),
    traits: traitsOf(e),
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
    proficiencies: splitList(childText(e, 'proficiency')),
    traits: traitsOf(e),
    modifiers: modifiersOf(e),
  };
}

export function featView(e: XElement) {
  return {
    name: childText(e, 'name'),
    prerequisite: childText(e, 'prerequisite'),
    text: childTexts(e, 'text').join('\n'),
    proficiencies: splitList(childText(e, 'proficiency')),
    modifiers: modifiersOf(e),
  };
}

export interface ClassFeature {
  name: string; text: string; optional: boolean; level: number; modifiers: Modifier[];
  subclass: string; el: XElement;
}
export interface SlotRow { level: number; optional: boolean; values: number[] } // [cantrips, 1st..9th]
export interface Counter { name: string; value: number; reset: string; level: number; subclass: string }

export function classView(e: XElement) {
  const features: ClassFeature[] = [];
  const slots: SlotRow[] = [];
  const counters: Counter[] = [];
  for (const al of elements(e, 'autolevel')) {
    const level = num(attr(al, 'level') ?? '', 0);
    for (const f of elements(al, 'feature')) {
      features.push({
        name: childText(f, 'name'), text: childTexts(f, 'text').join('\n'),
        optional: yes(attr(f, 'optional') ?? ''), level, modifiers: modifiersOf(f),
        subclass: childText(f, 'subclass'), el: f,
      });
    }
    for (const s of elements(al, 'slots')) {
      slots.push({ level, optional: yes(attr(s, 'optional') ?? ''), values: splitList(textOf(s)).map((x) => num(x)) });
    }
    for (const c of elements(al, 'counter')) {
      counters.push({
        name: childText(c, 'name'), value: num(childText(c, 'value')), reset: childText(c, 'reset'),
        level, subclass: childText(c, 'subclass'),
      });
    }
  }
  const prof = splitList(childText(e, 'proficiency'));
  return {
    name: childText(e, 'name'),
    hd: num(childText(e, 'hd'), 8),
    savingThrows: prof.map(parseAbility).filter((a): a is Ability => !!a),
    skillChoices: prof.filter((p) => !parseAbility(p) || isSkill(p)).filter(isSkill),
    numSkills: num(childText(e, 'numSkills'), 2),
    armor: childText(e, 'armor'),
    weapons: childText(e, 'weapons'),
    tools: childText(e, 'tools'),
    wealth: childText(e, 'wealth'),
    spellAbility: parseAbility(childText(e, 'spellAbility')),
    features, slots, counters,
    subclasses: subclassNames(features),
  };
}

/**
 * Subclass names are not a dedicated element in older files; they are encoded
 * as optional features named "<Family>: <Subclass>" (e.g. "Martial Archetype:
 * Champion"), or carry an explicit <subclass> child.
 */
export function subclassNames(features: ClassFeature[]): string[] {
  const names = new Set<string>();
  for (const f of features) {
    if (f.subclass) { names.add(f.subclass); continue; }
    if (!f.optional) continue;
    const m = /^([^:()]+):\s*(.+)$/.exec(f.name);
    if (!m) continue;
    const family = m[1], candidate = m[2].trim();
    // "Fighting Style: Defense" is a one-off option, not a subclass: require a
    // subclass-like family name, or the candidate recurring at another level.
    const recurs = features.some((g) => g !== f && g.optional && g.level !== f.level
      && g.name.toLowerCase().includes(candidate.toLowerCase()));
    if (SUBCLASS_FAMILY.test(family) || recurs) names.add(candidate);
  }
  return [...names];
}
const SUBCLASS_FAMILY = /archetype|domain|circle|college|oath|tradition|patron|origin|path|conclave|subclass|school|way|order|sorcerous|otherworldly|primal|monastic|divine|bardic|arcane/i;

export function spellView(e: XElement) {
  const school = childText(e, 'school');
  return {
    name: childText(e, 'name'),
    level: num(childText(e, 'level')),
    school: SCHOOLS[school] ?? school,
    ritual: yes(childText(e, 'ritual')),
    time: childText(e, 'time'),
    range: childText(e, 'range'),
    components: childText(e, 'components'),
    duration: childText(e, 'duration'),
    classes: splitList(childText(e, 'classes')),
    text: childTexts(e, 'text').join('\n'),
    rolls: childTexts(e, 'roll').map((r) => r.trim()).filter(Boolean),
  };
}

export function itemView(e: XElement) {
  const type = childText(e, 'type');
  return {
    name: childText(e, 'name'),
    type,
    typeLabel: ITEM_TYPES[type] ?? type,
    magic: yes(childText(e, 'magic')),
    detail: childText(e, 'detail'),
    weight: num(childText(e, 'weight')),
    value: childText(e, 'value'),
    ac: num(childText(e, 'ac')),
    strength: num(childText(e, 'strength')),
    stealth: yes(childText(e, 'stealth')),
    dmg1: childText(e, 'dmg1'),
    dmg2: childText(e, 'dmg2'),
    dmgType: DAMAGE_TYPES[childText(e, 'dmgType')] ?? childText(e, 'dmgType'),
    properties: splitList(childText(e, 'property')),
    range: childText(e, 'range'),
    text: childTexts(e, 'text').join('\n'),
    rolls: childTexts(e, 'roll').map((r) => r.trim()).filter(Boolean),
    modifiers: modifiersOf(e),
  };
}

export function monsterView(e: XElement) {
  const t = (n: string) => childText(e, n);
  return {
    name: t('name'), size: SIZES[t('size')] ?? t('size'), type: t('type'), alignment: t('alignment'),
    ac: t('ac'), hp: t('hp'), speed: t('speed'),
    scores: ABILITIES.map((a) => num(t(a.slice(0, 3)), 10)),
    save: t('save'), skill: t('skill'), resist: t('resist'), vulnerable: t('vulnerable'),
    immune: t('immune'), conditionImmune: t('conditionImmune'), senses: t('senses'),
    passive: t('passive'), languages: t('languages'), cr: t('cr'),
    traits: traitsOf(e), actions: traitsOf(e, 'action'), reactions: traitsOf(e, 'reaction'),
    legendary: traitsOf(e, 'legendary'), description: t('description'),
  };
}

/** Generic text summary of any entry, used for unknown fields in the browser. */
export function fieldsOf(e: XElement): [string, string][] {
  return elements(e).filter((c) => !child(c, 'name')).map((c) => [c.name, textOf(c).trim()]);
}
