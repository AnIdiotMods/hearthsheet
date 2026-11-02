// Homebrew created in the app: classes, subclasses, races, spells, feats,
// backgrounds, items and creatures, written in the community compendium
// format and kept in one compendium file ("My homebrew.xml") so they merge
// into the library like any imported file and can be exported and shared.
//
// A subclass is stored the way subclass files ship it: a <class> element
// with the parent class's name and no <hd>, whose <autolevel> elements hold
// optional features named "Family: Subclass" (the introduction) and
// "Subclass: Feature". The library merges it into the parent class.

import { ABILITIES, Ability, classView, stripLevelPrefix, textsOf } from './compendium';
import { XElement, attr, child, childText, el, elements, parseXml, serializeXml } from '../xml/xml';

export const HOMEBREW_ID = 'homebrew';
export const HOMEBREW_FILE_NAME = 'My homebrew.xml';

export const CREATOR_KINDS = ['class', 'subclass', 'race', 'spell', 'feat', 'background', 'item', 'monster'] as const;
export type CreatorKind = (typeof CREATOR_KINDS)[number];
export const CREATOR_LABEL: Record<CreatorKind, string> = {
  class: 'Class', subclass: 'Subclass', race: 'Race', spell: 'Spell', feat: 'Feat', background: 'Background', item: 'Item', monster: 'Creature',
};
/** The XML element each kind is stored as. */
export const TAG: Record<CreatorKind, string> = {
  class: 'class', subclass: 'class', race: 'race', spell: 'spell', feat: 'feat', background: 'background', item: 'item', monster: 'monster',
};

export interface TemplateContext {
  name: string;
  /** Subclasses: the parent class as it is in the library. */
  parent?: XElement;
}
export interface Template { id: string; label: string; description: string; make: (ctx: TemplateContext) => XElement }

// ---------------------------------------------------------------- small builders

const node = (tag: string, children: (XElement | null | false | undefined)[] = [], attrs: [string, string][] = []): XElement => {
  const e = el(tag, undefined, attrs);
  for (const c of children) if (c) e.children.push(c);
  return e;
};
const t = (tag: string, text: string | number) => el(tag, String(text));
const texts = (text: string) => text.split('\n').map((line) => el('text', line));
export const trait = (name: string, text: string, tag = 'trait') => node(tag, [t('name', name), ...texts(text)]);
const feature = (name: string, text: string, optional = false) =>
  node('feature', [t('name', name), ...texts(text)], optional ? [['optional', 'YES']] : []);
const modifier = (category: string, text: string) => el('modifier', text, [['category', category]]);
const roll = (formula: string, description = '', level?: number) =>
  el('roll', formula, [...(description ? [['description', description]] as [string, string][] : []), ...(level !== undefined ? [['level', String(level)]] as [string, string][] : [])]);

const FULL_SLOTS = [
  [3, 2], [3, 3], [3, 4, 2], [4, 4, 3], [4, 4, 3, 2], [4, 4, 3, 3], [4, 4, 3, 3, 1], [4, 4, 3, 3, 2], [4, 4, 3, 3, 3, 1],
  [5, 4, 3, 3, 3, 2], [5, 4, 3, 3, 3, 2, 1], [5, 4, 3, 3, 3, 2, 1], [5, 4, 3, 3, 3, 2, 1, 1], [5, 4, 3, 3, 3, 2, 1, 1],
  [5, 4, 3, 3, 3, 2, 1, 1, 1], [5, 4, 3, 3, 3, 2, 1, 1, 1], [5, 4, 3, 3, 3, 2, 1, 1, 1, 1], [5, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [5, 4, 3, 3, 3, 3, 2, 1, 1, 1], [5, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];
const HALF_SLOTS = [
  [], [0, 2], [0, 3], [0, 3], [0, 4, 2], [0, 4, 2], [0, 4, 3], [0, 4, 3], [0, 4, 3, 2], [0, 4, 3, 2], [0, 4, 3, 3], [0, 4, 3, 3],
  [0, 4, 3, 3, 1], [0, 4, 3, 3, 1], [0, 4, 3, 3, 2], [0, 4, 3, 3, 2], [0, 4, 3, 3, 3, 1], [0, 4, 3, 3, 3, 1], [0, 4, 3, 3, 3, 2], [0, 4, 3, 3, 3, 2],
];
const slotText = (row: number[]) => Array.from({ length: 10 }, (_, i) => row[i] ?? 0).join(',');
const ASI_LEVELS = [4, 8, 12, 16, 19];

interface ClassPlan {
  hd: number; saves: Ability[]; skills: string[]; numSkills: number; armor: string; weapons: string; tools: string; wealth: string;
  spellAbility?: Ability; slots?: number[][]; subclassLevel: number; subclassLevels: number[]; family: string;
  features: Record<number, [string, string][]>;
}
function makeClass(name: string, p: ClassPlan): XElement {
  const cap = (a: Ability) => a[0].toUpperCase() + a.slice(1);
  const e = node('class', [
    t('name', name), t('hd', p.hd), t('proficiency', [...p.saves.map(cap), ...p.skills].join(', ')), t('numSkills', p.numSkills),
    t('armor', p.armor), t('weapons', p.weapons), t('tools', p.tools), t('wealth', p.wealth),
    p.spellAbility ? t('spellAbility', cap(p.spellAbility)) : null,
  ]);
  for (let L = 1; L <= 20; L++) {
    const al = node('autolevel', [], [['level', String(L)], ...(ASI_LEVELS.includes(L) ? [['scoreImprovement', 'YES']] as [string, string][] : [])]);
    const row = p.slots?.[L - 1];
    if (row && row.some((v) => v > 0)) al.children.push(t('slots', slotText(row)));
    for (const [n, text] of p.features[L] ?? []) al.children.push(feature(n, text));
    if (L === p.subclassLevel) al.children.push(feature(p.family, `At ${ordinal(L)} level, you choose a ${p.family.toLowerCase()}. Your choice grants you features at ${ordinal(L)} level and again at ${p.subclassLevels.filter((x) => x > L).map(ordinal).join(', ')} level.`));
    else if (p.subclassLevels.includes(L)) al.children.push(feature(`${p.family} feature`, `At ${ordinal(L)} level, you gain a feature granted by your ${p.family}.`));
    if (ASI_LEVELS.includes(L)) al.children.push(feature('Ability Score Improvement', 'When you reach this level, you can increase one ability score of your choice by 2, or you can increase two ability scores of your choice by 1. As normal, you can\'t increase an ability score above 20 using this feature.'));
    e.children.push(al);
  }
  return e;
}
export const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

// ---------------------------------------------------------------- templates

export const TEMPLATES: Record<CreatorKind, Template[]> = {
  class: [
    {
      id: 'martial', label: 'Martial class', description: 'd10 hit die, all armor and weapons, a fighting style, Extra Attack at 5th level, subclass at 3rd, Ability Score Improvements.',
      make: ({ name }) => makeClass(name, {
        hd: 10, saves: ['strength', 'constitution'], skills: ['Acrobatics', 'Athletics', 'History', 'Insight', 'Intimidation', 'Perception', 'Survival'], numSkills: 2,
        armor: 'Light Armor, Medium Armor, Heavy Armor, Shields', weapons: 'Simple Weapons, Martial Weapons', tools: '', wealth: '5d4x10',
        subclassLevel: 3, subclassLevels: [3, 7, 10, 15, 18], family: `${name} Path`,
        features: {
          1: [['Fighting Style', 'You adopt a particular style of fighting as your specialty.'], ['Second Wind', 'On your turn, you can use a bonus action to regain hit points equal to 1d10 + your level in this class. Once you use this feature, you must finish a short or long rest before you can use it again.']],
          5: [['Extra Attack', 'You can attack twice, instead of once, whenever you take the Attack action on your turn.']],
        },
      }),
    },
    {
      id: 'full-caster', label: 'Full spellcaster', description: 'd6 hit die, Intelligence spellcasting with the full spell slot table (cantrips and 1st–9th level slots), subclass at 2nd.',
      make: ({ name }) => makeClass(name, {
        hd: 6, saves: ['intelligence', 'wisdom'], skills: ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Religion'], numSkills: 2,
        armor: '', weapons: 'Daggers, Darts, Slings, Quarterstaffs, Light Crossbows', tools: '', wealth: '4d4x10', spellAbility: 'intelligence',
        slots: FULL_SLOTS, subclassLevel: 2, subclassLevels: [2, 6, 10, 14], family: `${name} Tradition`,
        features: {
          1: [['Spellcasting', `Intelligence is your spellcasting ability for your ${name.toLowerCase()} spells. You prepare a number of spells equal to your Intelligence modifier + your ${name.toLowerCase()} level (minimum of one spell).`]],
        },
      }),
    },
    {
      id: 'half-caster', label: 'Half spellcaster', description: 'd10 hit die, Wisdom spellcasting from 2nd level (up to 5th-level slots), Extra Attack at 5th, subclass at 3rd.',
      make: ({ name }) => makeClass(name, {
        hd: 10, saves: ['strength', 'wisdom'], skills: ['Animal Handling', 'Athletics', 'Insight', 'Nature', 'Perception', 'Stealth', 'Survival'], numSkills: 3,
        armor: 'Light Armor, Medium Armor, Shields', weapons: 'Simple Weapons, Martial Weapons', tools: '', wealth: '5d4x10', spellAbility: 'wisdom',
        slots: HALF_SLOTS, subclassLevel: 3, subclassLevels: [3, 7, 11, 15], family: `${name} Oath`,
        features: {
          2: [['Spellcasting', `Wisdom is your spellcasting ability for your ${name.toLowerCase()} spells. You prepare a number of spells equal to your Wisdom modifier + half your ${name.toLowerCase()} level, rounded down (minimum of one spell).`]],
          5: [['Extra Attack', 'You can attack twice, instead of once, whenever you take the Attack action on your turn.']],
        },
      }),
    },
  ],
  subclass: [
    {
      id: 'follow-class', label: 'Follow the class\'s subclass levels', description: 'An introduction plus one feature at every level where the class\'s other subclasses gain features.',
      make: ({ name, parent }) => {
        const info = parent ? parentInfo(parent) : { name: 'Class', label: 'Subclass', levels: [3] };
        return buildSubclass(info.name, info.label, name, info.levels.map((L, i) => ({
          level: L, name: i === 0 ? 'First Feature' : `${ordinal(L)}-Level Feature`, text: `Starting at ${ordinal(L)} level, ...`,
        })), `Describe the ${name}.`);
      },
    },
  ],
  race: [
    {
      id: 'standard', label: 'Standard race', description: 'Fixed ability score increases, Medium size, 30 ft. speed, darkvision and languages.',
      make: ({ name }) => node('race', [
        t('name', name), t('size', 'M'), t('speed', 30), t('ability', 'Str 2, Con 1'), t('proficiency', ''), el('spellAbility'),
        trait('Age', `${name} reach adulthood in their late teens and live less than a century.`),
        trait('Size', 'Your size is Medium.'),
        trait('Darkvision', 'You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light.'),
        trait('Languages', 'You can speak, read, and write Common and one other language of your choice.'),
      ]),
    },
    {
      id: 'flexible', label: 'Flexible race', description: 'Like the variant human: +1 to two scores of your choice, a skill and a feat of your choice.',
      make: ({ name }) => node('race', [
        t('name', name), t('size', 'M'), t('speed', 30), el('ability'), el('proficiency'), el('spellAbility'),
        trait('Ability Score Increase', 'Two different ability scores of your choice increase by 1.'),
        trait('Skills', 'You gain proficiency in one skill of your choice.'),
        trait('Feat', 'You gain one feat of your choice.'),
        trait('Languages', 'You can speak, read, and write Common and one extra language of your choice.'),
      ]),
    },
  ],
  spell: [
    {
      id: 'damage-cantrip', label: 'Damage cantrip', description: 'A cantrip with a spell attack whose damage grows at 5th, 11th and 17th level.',
      make: ({ name }) => node('spell', [
        t('name', name), t('level', 0), t('school', 'EV'), t('time', '1 action'), t('range', '120 feet'), t('components', 'V, S'),
        t('duration', 'Instantaneous'), t('classes', 'Sorcerer, Wizard'),
        ...texts('You hurl a mote of energy at a creature or object within range. Make a ranged spell attack against the target. On a hit, the target takes 1d10 fire damage.\nThis spell\'s damage increases by 1d10 when you reach 5th level (2d10), 11th level (3d10), and 17th level (4d10).'),
        roll('1d10', 'Damage', 0), roll('2d10', 'Damage', 5), roll('3d10', 'Damage', 11), roll('4d10', 'Damage', 17),
      ]),
    },
    {
      id: 'damage-save', label: 'Damage spell (save for half)', description: 'A 1st-level area spell: Dexterity save, half damage on a success, more damage from higher-level slots.',
      make: ({ name }) => node('spell', [
        t('name', name), t('level', 1), t('school', 'EV'), t('time', '1 action'), t('range', 'Self (15-foot cone)'), t('components', 'V, S'),
        t('duration', 'Instantaneous'), t('classes', 'Sorcerer, Wizard'),
        ...texts('Each creature in a 15-foot cone must make a Dexterity saving throw. A creature takes 3d6 damage on a failed save, or half as much damage on a successful one.\nAt Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the damage increases by 1d6 for each slot level above 1st.'),
        ...Array.from({ length: 9 }, (_, i) => roll(`${3 + i}d6`, 'Damage', i + 1)),
      ]),
    },
    {
      id: 'healing', label: 'Healing spell', description: 'Touch healing: 1d8 + your spellcasting modifier, more from higher-level slots.',
      make: ({ name }) => node('spell', [
        t('name', name), t('level', 1), t('school', 'EV'), t('time', '1 action'), t('range', 'Touch'), t('components', 'V, S'),
        t('duration', 'Instantaneous'), t('classes', 'Bard, Cleric, Druid'),
        ...texts('A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.\nAt Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the healing increases by 1d8 for each slot level above 1st.'),
        ...Array.from({ length: 9 }, (_, i) => roll(`${1 + i}d8+SPELL`, 'Healing', i + 1)),
      ]),
    },
    {
      id: 'utility', label: 'Utility ritual', description: 'A 1st-level ritual with no damage roll.',
      make: ({ name }) => node('spell', [
        t('name', name), t('level', 1), t('school', 'D'), t('ritual', 'YES'), t('time', '1 minute'), t('range', 'Self'), t('components', 'V, S, M (a pinch of salt)'),
        t('duration', 'Concentration, up to 10 minutes'), t('classes', 'Wizard'), ...texts('Describe what the spell does.'),
      ]),
    },
  ],
  feat: [
    {
      id: 'half-feat', label: 'Half-feat (+1 to an ability)', description: 'Increase one ability score by 1, plus a benefit.',
      make: ({ name }) => node('feat', [t('name', name), ...texts('Increase your Dexterity score by 1, to a maximum of 20.\nDescribe the other benefit.'), modifier('ability score', 'dexterity +1')]),
    },
    {
      id: 'prerequisite', label: 'Feat with a prerequisite', description: 'A feat that needs an ability score, a feature or the ability to cast spells.',
      make: ({ name }) => node('feat', [t('name', name), t('prerequisite', 'The ability to cast at least one spell'), ...texts('Describe what the feat does.')]),
    },
    {
      id: 'bonus', label: 'Feat with a bonus', description: 'A flat bonus the sheet applies, e.g. +5 initiative or +10 speed.',
      make: ({ name }) => node('feat', [t('name', name), ...texts('You gain a +5 bonus to initiative.'), modifier('bonus', 'initiative +5')]),
    },
  ],
  background: [
    {
      id: 'standard', label: 'Standard background', description: 'Two skills, tools or languages, equipment and a background feature.',
      make: ({ name }) => node('background', [
        t('name', name), t('proficiency', 'Insight, Religion'),
        trait('Skill Proficiencies', 'Insight, Religion'),
        trait('Languages', 'Two of your choice'),
        trait('Equipment', 'A set of common clothes and a pouch containing 10 gp'),
        trait(`Feature: ${name} Contacts`, 'Describe the background feature.'),
      ]),
    },
  ],
  item: [
    {
      id: 'weapon', label: 'Weapon', description: 'A versatile martial melee weapon (1d8 slashing, 1d10 two-handed).',
      make: ({ name }) => node('item', [t('name', name), t('type', 'M'), t('weight', 3), t('value', 15), t('dmg1', '1d8'), t('dmg2', '1d10'), t('dmgType', 'S'), t('property', 'V,M'), ...texts('Describe the weapon.')]),
    },
    {
      id: 'armor', label: 'Armor', description: 'Medium armor, AC 14 + Dexterity (maximum 2).',
      make: ({ name }) => node('item', [t('name', name), t('type', 'MA'), t('weight', 20), t('value', 50), t('ac', 14), ...texts('Describe the armor.')]),
    },
    {
      id: 'shield', label: 'Shield', description: 'A shield, +2 AC.',
      make: ({ name }) => node('item', [t('name', name), t('type', 'S'), t('weight', 6), t('value', 10), t('ac', 2), ...texts('Describe the shield.')]),
    },
    {
      id: 'wondrous', label: 'Magic item (attunement)', description: 'A wondrous item that requires attunement and gives +1 AC and saving throws.',
      make: ({ name }) => node('item', [t('name', name), t('type', 'W'), t('magic', 'YES'), t('detail', 'uncommon (requires attunement)'), ...texts('While wearing this item, you gain a +1 bonus to AC and saving throws.'),
        modifier('bonus', 'ac +1'), modifier('bonus', 'saving throws +1')]),
    },
    {
      id: 'potion', label: 'Potion', description: 'A potion that heals 2d4 + 2 hit points.',
      make: ({ name }) => node('item', [t('name', name), t('type', 'P'), t('magic', 'YES'), t('detail', 'common'), t('weight', 0.5), t('value', 50), ...texts('You regain 2d4 + 2 hit points when you drink this potion.'), roll('2d4+2', 'Healing')]),
    },
  ],
  monster: [
    {
      id: 'beast', label: 'Beast companion', description: 'A Medium beast with a bite attack, good for pets and summons.',
      make: ({ name }) => node('monster', [
        t('name', name), t('size', 'M'), t('type', 'beast'), t('alignment', 'unaligned'), t('ac', '12 (natural armor)'), t('hp', '11 (2d8+2)'),
        t('speed', 'walk 40 ft.'), t('str', 14), t('dex', 14), t('con', 12), t('int', 3), t('wis', 12), t('cha', 6),
        t('skill', 'Perception +3'), t('senses', 'darkvision 60 ft.'), t('passive', 13), t('languages', ''), t('cr', '1/4'),
        trait('Keen Senses', 'The creature has advantage on Wisdom (Perception) checks that rely on hearing or smell.'),
        node('action', [t('name', 'Bite'), ...texts('Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage.'), t('attack', 'Bite|+4|2d4+2')]),
      ]),
    },
    {
      id: 'humanoid', label: 'Humanoid NPC', description: 'A Medium humanoid with a weapon attack, for hirelings and allies.',
      make: ({ name }) => node('monster', [
        t('name', name), t('size', 'M'), t('type', 'humanoid (any race)'), t('alignment', 'any alignment'), t('ac', '13 (leather armor)'), t('hp', '16 (3d8+3)'),
        t('speed', 'walk 30 ft.'), t('str', 11), t('dex', 14), t('con', 12), t('int', 10), t('wis', 10), t('cha', 10),
        t('skill', 'Perception +2'), t('passive', 12), t('languages', 'Common'), t('cr', '1/2'),
        node('action', [t('name', 'Shortsword'), ...texts('Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage.'), t('attack', 'Shortsword|+4|1d6+2')]),
      ]),
    },
  ],
};

/** The bare minimum for creating something from scratch. */
export function blankEntry(kind: CreatorKind, ctx: TemplateContext): XElement {
  const name = ctx.name;
  switch (kind) {
    case 'class': return node('class', [t('name', name), t('hd', 8), t('proficiency', ''), t('numSkills', 2), t('armor', ''), t('weapons', ''), t('tools', ''), t('wealth', ''),
      ...Array.from({ length: 20 }, (_, i) => node('autolevel', [], [['level', String(i + 1)]]))]);
    case 'subclass': {
      const info = ctx.parent ? parentInfo(ctx.parent) : { name: 'Class', label: 'Subclass', levels: [3] };
      return buildSubclass(info.name, info.label, name, [], `Describe the ${name}.`, info.levels[0]);
    }
    case 'race': return node('race', [t('name', name), t('size', 'M'), t('speed', 30), el('ability'), el('proficiency')]);
    case 'spell': return node('spell', [t('name', name), t('level', 1), t('school', 'EV'), t('time', '1 action'), t('range', ''), t('components', ''), t('duration', ''), t('classes', ''), el('text')]);
    case 'feat': return node('feat', [t('name', name), el('text')]);
    case 'background': return node('background', [t('name', name), el('proficiency')]);
    case 'item': return node('item', [t('name', name), t('type', 'G'), t('weight', 0), t('value', 0), el('text')]);
    case 'monster': return node('monster', [t('name', name), t('size', 'M'), t('type', ''), t('ac', 10), t('hp', '1'), t('speed', 'walk 30 ft.'),
      ...ABILITIES.map((a) => t(a.slice(0, 3), 10)), t('passive', 10), t('cr', '0')]);
  }
}

// ---------------------------------------------------------------- subclasses

export interface SubclassFeatureInput { level: number; name: string; text: string }

/** The parent class's name, its subclass heading ("Martial Archetype") and the levels its subclasses gain features. */
export function parentInfo(parent: XElement): { name: string; label: string; levels: number[] } {
  const cv = classView(parent);
  const first = Math.min(...[...cv.subclassLevels.values(), 99]);
  const counts = new Map<number, number>();
  for (const f of cv.features) {
    if (!f.optional) continue;
    const owner = cv.subclasses.find((s) => f.name.startsWith(`${s}:`) || f.name.endsWith(`(${s})`));
    if (owner) counts.set(f.level, (counts.get(f.level) ?? 0) + 1);
  }
  // Levels shared by at least a third of the subclasses (so one odd subclass does not add levels).
  const enough = Math.max(1, Math.floor(cv.subclasses.length / 3));
  let levels = [...counts].filter(([, n]) => n >= enough).map(([L]) => L).sort((a, b) => a - b);
  if (first < 99 && !levels.includes(first)) levels = [first, ...levels];
  let label = cv.subclassLabel;
  if (!cv.subclasses.length) {
    // No subclasses yet (e.g. a class just made here): the feature that introduces them is named like
    // "Martial Archetype" or "Sentinel Path", or says you choose one; "<it> feature" entries mark later levels.
    const fixed = cv.features.filter((f) => !f.optional);
    const heading = fixed.find((f) => SUBCLASS_HEADING.test(stripLevelPrefix(f.name)) && !/ feature$/i.test(f.name))
      ?? fixed.find((f) => /\byou choose (a|an|one)\b/i.test(f.text) && !/ feature$/i.test(f.name));
    if (heading) {
      label = stripLevelPrefix(heading.name);
      levels = [heading.level, ...fixed.filter((f) => f.name.toLowerCase() === `${label.toLowerCase()} feature`).map((f) => f.level)]
        .filter((L, i, a) => a.indexOf(L) === i).sort((a, b) => a - b);
    }
  }
  if (!levels.length) levels = [3];
  if (label === 'Subclass') label = `${cv.name} Subclass`;
  return { name: cv.name, label, levels };
}

const SUBCLASS_HEADING = /\b(path|archetype|tradition|oath|domain|circle|college|origin|patron|specialist|order|way|school|conclave|subclass|calling|discipline)$/i;

/** A <class> extension that adds one subclass to `parentName`, as subclass files do. */
export function buildSubclass(parentName: string, label: string, subclass: string, features: SubclassFeatureInput[], intro = '', introLevel?: number): XElement {
  const levels = new Map<number, XElement[]>();
  const at = (L: number) => { if (!levels.has(L)) levels.set(L, []); return levels.get(L)!; };
  const first = introLevel ?? Math.min(...features.map((f) => f.level), 99);
  at(first < 99 ? first : 3).push(feature(`${label}: ${subclass}`, intro || subclass, true));
  for (const f of features) at(f.level).push(feature(`${subclass}: ${f.name}`, f.text, true));
  const e = node('class', [t('name', parentName)]);
  for (const L of [...levels.keys()].sort((a, b) => a - b)) e.children.push(node('autolevel', levels.get(L)!, [['level', String(L)]]));
  return e;
}

/** Read a subclass extension back into its parts. */
export function subclassParts(e: XElement): { parent: string; label: string; name: string; intro: string; introLevel: number; features: SubclassFeatureInput[] } {
  const all = elements(e, 'autolevel').flatMap((al) => elements(al, 'feature').concat(elements(al, 'feat'))
    .map((f) => ({ level: parseInt(attr(al, 'level') ?? childText(al, 'level') ?? '1', 10) || 1, name: stripLevelPrefix(childText(f, 'name')), text: textsOf(f) })));
  const intro = all[0];
  const m = intro ? /^([^:]+):\s*(.+)$/.exec(intro.name) : null;
  const label = m ? m[1].trim() : 'Subclass';
  const name = m ? m[2].trim() : '';
  return {
    parent: childText(e, 'name'), label, name, intro: intro?.text ?? '', introLevel: intro?.level ?? 3,
    features: all.slice(1).map((f) => ({ level: f.level, name: f.name.startsWith(`${name}:`) ? f.name.slice(name.length + 1).trim() : f.name, text: f.text })),
  };
}

// ---------------------------------------------------------------- the homebrew file

export interface HomebrewEntry { kind: CreatorKind; name: string; el: XElement }

export const emptyHomebrewXml = () => '<?xml version="1.0" encoding="UTF-8"?>\n<compendium version="5" auto_indent="NO">\n</compendium>\n';

export function kindOf(e: XElement): CreatorKind | null {
  if (e.name === 'class') return child(e, 'hd') ? 'class' : 'subclass';
  return (CREATOR_KINDS as readonly string[]).includes(e.name) ? (e.name as CreatorKind) : null;
}
export const entryName = (e: XElement) => (kindOf(e) === 'subclass' ? subclassParts(e).name : childText(e, 'name'));

export function homebrewEntries(xml: string): HomebrewEntry[] {
  const { doc } = parseXml(xml || emptyHomebrewXml());
  return elements(doc.root).map((e) => ({ kind: kindOf(e), name: entryName(e), el: e }))
    .filter((x): x is HomebrewEntry => !!x.kind);
}

const same = (e: XElement, kind: CreatorKind, name: string) => kindOf(e) === kind && entryName(e).toLowerCase() === name.toLowerCase();

/** Add an entry, or replace the one called `previousName` (or with its own name). Returns the new file text. */
export function upsertEntry(xml: string, entry: XElement, previousName?: string): string {
  const { doc } = parseXml(xml || emptyHomebrewXml());
  const kind = kindOf(entry);
  if (!kind) throw new Error(`<${entry.name}> is not something the creator makes`);
  const name = previousName ?? entryName(entry);
  const i = doc.root.children.findIndex((c) => c.type === 'el' && same(c, kind, name));
  if (i >= 0) doc.root.children[i] = entry;
  else doc.root.children.push(entry);
  return serializeXml(doc, { pretty: true });
}

export function removeEntry(xml: string, kind: CreatorKind, name: string): string {
  const { doc } = parseXml(xml || emptyHomebrewXml());
  doc.root.children = doc.root.children.filter((c) => !(c.type === 'el' && same(c, kind, name)));
  return serializeXml(doc, { pretty: true });
}

/** Check an entry before saving; returns problems a player should fix. */
export function validateEntry(e: XElement): string[] {
  const kind = kindOf(e);
  const problems: string[] = [];
  if (!kind) return [`<${e.name}> is not something the creator makes`];
  if (!entryName(e).trim()) problems.push('Give it a name.');
  if (kind === 'subclass' && !childText(e, 'name').trim()) problems.push('Choose the class this subclass belongs to.');
  if (kind === 'class' && !/^\d+$/.test(childText(e, 'hd').replace(/^d/i, ''))) problems.push('The hit die must be a number such as 8 or d8.');
  return problems;
}
