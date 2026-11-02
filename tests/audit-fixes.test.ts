// Fixes from the player audit (docs/player-audit-2026-11-02.md), on small synthetic compendiums.
import { describe, expect, it } from 'vitest';
import {
  CompendiumFile, buildLibrary, classView, isOptionalRule, isPlaceholderFeature, isUnofficial, lookup, sourceOf, sourceTag,
} from '../src/model/compendium';
import { Character, chosenSubclasses, classSpells, emptyAppState, setEquipped } from '../src/model/character';
import { movementOf, setMovement } from '../src/model/movement';
import { RulesOptions, defaultOptions, deriveSheet } from '../src/rules/derive';
import {
  applyLevelUp, defaultSubclassPicks, featureSpellTable, levelOptions, subclassChoicesAt, subclassFeaturesAt,
} from '../src/rules/level';
import { expectedOptionCount, optionLimits } from '../src/rules/options';
import { builtinCounters, martialArtsDie, thirdCasterRow } from '../src/rules/builtin';
import { spellRolls } from '../src/ui/Sheet';
import { childText, elements } from '../src/xml/xml';

const file = (id: string, xml: string): CompendiumFile => ({ id, fileName: `${id}.xml`, xml, importedAt: 0, enabled: true });
const feature = (name: string, text: string, optional = false) =>
  `<feature${optional ? ' optional="YES"' : ''}><name>${name}</name><text>${text}</text></feature>`;
const al = (level: number, ...features: string[]) => `<autolevel level="${level}">${features.join('')}</autolevel>`;

const RANGER = `<class><name>Ranger</name><hd>10</hd><proficiency>Strength, Dexterity, Athletics, Stealth, Survival</proficiency><numSkills>2</numSkills>
  ${al(1, feature('Favored Enemy', 'x'), feature('Deft Explorer', '1st-level ranger optional class features, which replaces the Natural Explorer feature'))}
  ${al(3, feature('Ranger Archetype', 'Choose an archetype.'))}
  ${al(3, feature('Ranger Archetype: Hunter', 'Hunters...', true), feature("Hunter: Hunter's Prey", 'At 3rd level, you gain one of the following features of your choice.', true),
    feature('Hunter: Colossus Slayer', 'Extra 1d8.', true), feature('Hunter: Giant Killer', 'Reaction attack.', true), feature('Hunter: Horde Breaker', 'Second attack.', true))}
  ${al(3, feature('Ranger Archetype: Beast Master', 'Beasts...', true), feature("Beast Master: Ranger's Companion", 'At 3rd level, you gain a beast companion.', true))}
  ${al(7, feature('Beast Master: Exceptional Training', 'x', true), feature('Hunter: Defensive Tactics', 'At 7th level, you gain one of the following features of your choice.', true),
    feature('Hunter: Escape the Horde', 'x', true), feature('Hunter: Steel Will', 'x', true))}
</class>`;

const ARTIFICER = `<class><name>Artificer</name><hd>8</hd>
  ${al(3, feature('Artificer Specialist', 'Choose.'))}
  ${al(3, feature('Artificer Specialist: Artillerist', 'Version one. Source: Book A p. 1', true))}
  ${al(3, feature('Artillerist: Eldritch Cannon', 'Cannon.', true))}
  ${al(3, feature('Artificer Specialist: Artillerist', 'Version two. Source: Book B p. 2', true))}
  ${al(3, feature('Artillerist: Arcane Turret', 'Turret.', true))}
  ${al(3, feature('Artificer Specialist: Battle Smith', 'Smith.', true), feature('Battle Smith: Steel Defender', 'x', true))}
  ${al(5, feature('Artillerist: Arcane Firearm', 'x', true))}
</class>`;

describe('subclass detection', () => {
  const lib = buildLibrary([file('a', `<compendium>${RANGER}${ARTIFICER}</compendium>`)]);
  const ranger = classView(lookup(lib, 'class', 'Ranger')!.el);
  const art = classView(lookup(lib, 'class', 'Artificer')!.el);

  it('finds Beast Master (no longer mistaken for an option list)', () => {
    expect(ranger.subclasses.sort()).toEqual(['Beast Master', 'Hunter']);
  });

  it('offers one-of-several subclass features as a choice', () => {
    const g = subclassChoicesAt(ranger, 'Hunter', 3);
    expect(g).toHaveLength(1);
    expect(g[0].count).toBe(1);
    expect(g[0].options.map((f) => f.name)).toEqual(['Hunter: Colossus Slayer', 'Hunter: Giant Killer', 'Hunter: Horde Breaker']);
    expect(defaultSubclassPicks(ranger, 'Hunter', 3).map((f) => f.name)).toEqual(['Ranger Archetype: Hunter', "Hunter: Hunter's Prey"]);
    expect(subclassChoicesAt(ranger, 'Hunter', 7)[0].options.map((f) => f.name)).toEqual(['Hunter: Escape the Horde', 'Hunter: Steel Will']);
    expect(subclassChoicesAt(ranger, 'Beast Master', 3)).toEqual([]);
  });

  it('splits two printings of one subclass into versions', () => {
    expect(art.subclasses).toEqual(['Artillerist', 'Artillerist (version 2)', 'Battle Smith']);
    expect(subclassFeaturesAt(art, 'Artillerist', 3).map((f) => f.name)).toEqual(['Artificer Specialist: Artillerist', 'Artillerist: Eldritch Cannon']);
    expect(subclassFeaturesAt(art, 'Artillerist (version 2)', 3).map((f) => f.name)).toEqual(['Artificer Specialist: Artillerist', 'Artillerist: Arcane Turret']);
    expect(subclassFeaturesAt(art, 'Artillerist (version 2)', 5).map((f) => f.name)).toEqual(['Artillerist: Arcane Firearm']);
    // Picking version 2 takes version 2's text for the shared introduction name, and is recognised again.
    const c = Character.create('A');
    c.abilities = { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 };
    const ce = applyLevelUp(c, { newClass: lookup(lib, 'class', 'Artificer')!.el, hp: { method: 'max' } }, () => 1);
    applyLevelUp(c, { existing: ce, hp: { method: 'average' } }, () => 1);
    applyLevelUp(c, {
      existing: ce, hp: { method: 'average' }, subclass: 'Artillerist (version 2)',
      choices: defaultSubclassPicks(art, 'Artillerist (version 2)', 3).map((f) => f.name),
    }, () => 1);
    expect(chosenSubclasses(ce)).toEqual(['Artillerist (version 2)']);
    const intro = elements(ce, 'feat').find((x) => childText(x, 'name') === 'Artificer Specialist: Artillerist');
    expect(intro && childText(intro, 'text')).toMatch(/Version two/);
  });

  it('does not grant Tasha\'s optional class features, and hides placeholders', () => {
    const lo = levelOptions(lookup(lib, 'class', 'Ranger')!.el, 1);
    expect(lo.gained.map((f) => f.name)).toEqual(['Favored Enemy']);
    expect(lo.optionalRules.map((f) => f.name)).toEqual(['Deft Explorer']);
    expect(isOptionalRule({ text: '3rd-level barbarian optional class features\nWhen you reach...' })).toBe(true);
    expect(isPlaceholderFeature({ name: 'Path Feature', text: 'At 6th level, you gain a feature from your Primal Path.\nSource: PHB p. 46' })).toBe(true);
    expect(isPlaceholderFeature({ name: 'Extra Attack', text: 'You can attack twice.' })).toBe(false);
  });
});

describe('library sources and duplicates', () => {
  const xml = `<compendium>
    <race><name>Goblin</name><trait><name>Description</name><text>Source: Volo's Guide to Monsters p. 119</text></trait></race>
    <race><name>Goblin</name><trait><name>Description</name><text>Source: Guildmasters' Guide to Ravnica p. 17</text></trait></race>
    <race><name>Goblin</name><trait><name>Description</name><text>Source: Guildmasters' Guide to Ravnica p. 17</text></trait></race>
    <race><name>Kor</name><trait><name>Description</name><text>Source: Plane Shift: Zendikar p. 4</text></trait></race>
    <feat><name>Alert</name><text>Source: Player's Handbook p. 165</text></feat>
    <feat><name>Fey Teleportation (UA)</name><text>x</text></feat>
    <class><name>Blood Hunter</name><hd>10</hd>${al(1, feature('Hunter\'s Bane', 'x'))}</class>
    <class><name>Fighter</name><hd>10</hd>${al(1, feature('Second Wind', 'x. Source: Player\'s Handbook p. 72'))}${al(3, feature('Martial Archetype', 'x'),
      feature('Martial Archetype: Champion', 'Source: Player\'s Handbook p. 72', true), feature('Champion: Improved Critical', 'x', true),
      feature('Martial Archetype: Gunslinger', 'Source: Matthew Mercer - Gunslinger 1.3', true), feature('Gunslinger: Firearm Properties', 'Source: Matthew Mercer - Gunslinger 1.3', true))}</class>
  </compendium>`;

  it('keeps different same-named entries of one file under distinct names, and drops exact copies', () => {
    const lib = buildLibrary([file('a', xml)]);
    expect(lib.byKind.race.map((e) => e.name)).toEqual(['Goblin', "Goblin (Guildmasters' Guide to Ravnica)", 'Kor']);
    expect(lib.warnings).toEqual([]);
    expect(childText(lookup(lib, 'race', "Goblin (Guildmasters' Guide to Ravnica)")!.el, 'name')).toBe("Goblin (Guildmasters' Guide to Ravnica)");
  });

  it('still lets a later file override an entry, with a note', () => {
    const lib = buildLibrary([file('a', xml), file('b', '<compendium><feat><name>Alert</name><text>House rule</text></feat></compendium>')]);
    expect(lib.warnings.map((w) => w.message)).toEqual(['feat "Alert" replaces the copy from a.xml']);
  });

  it('detects unofficial content for tagging', () => {
    expect(sourceOf(lookup(buildLibrary([file('a', xml)]), 'race', 'Kor')!.el)).toBe('Plane Shift: Zendikar');
    expect(isUnofficial('Kor', 'Plane Shift: Zendikar')).toBe(true);
    expect(isUnofficial('Alert', "Player's Handbook")).toBe(false);
    expect(sourceTag('Fey Teleportation (UA)', '')).toBe('UA');
  });
});

describe('level-up arithmetic', () => {
  const FIGHTER = `<class><name>Fighter</name><hd>10</hd>${al(1, feature('Second Wind', 'x'))}<autolevel level="4" scoreImprovement="YES">${feature('Ability Score Improvement', 'x')}</autolevel></class>`;
  const lib = buildLibrary([file('a', `<compendium><race><name>Orc</name><ability>Str 2, Con 1</ability></race>${FIGHTER}
    <spell><name>Sanctuary</name><level>1</level></spell><spell><name>Bless</name><level>1</level></spell></compendium>`)]);
  const opts: RulesOptions = { ...defaultOptions, spellLookup: (n) => lookup(lib, 'spell', n)?.el };
  const make = (str: number, con: number) => {
    const c = Character.create('F');
    c.setRace(lookup(lib, 'race', 'Orc')!.el);
    c.abilities = { strength: str, dexterity: 10, constitution: con, intelligence: 10, wisdom: 10, charisma: 10 };
    const ce = applyLevelUp(c, { newClass: lookup(lib, 'class', 'Fighter')!.el, hp: { method: 'max' } }, () => 1, opts);
    for (let i = 2; i <= 3; i++) applyLevelUp(c, { existing: ce, hp: { method: 'average' } }, () => 1, opts);
    return { c, ce };
  };

  it('caps an Ability Score Improvement at a final score of 20', () => {
    const { c, ce } = make(17, 10); // 17 + 2 = 19
    applyLevelUp(c, { existing: ce, hp: { method: 'average' }, asi: { strength: 2 } }, () => 1, opts);
    expect(deriveSheet(c, emptyAppState(), opts).scores.strength).toBe(20);
    expect(c.abilities.strength).toBe(18);
    const other = make(17, 10);
    applyLevelUp(other.c, { existing: other.ce, hp: { method: 'average' }, asi: { strength: 2 }, allowOverMax: true }, () => 1, opts);
    const sheet = deriveSheet(other.c, emptyAppState(), opts);
    expect(sheet.scores.strength).toBe(21);
    expect(sheet.overLimits).toEqual(['STR 21 (maximum 20)']);
  });

  it('ignores items that set a score when capping (Belt of Giant Strength)', () => {
    const belt = buildLibrary([file('b', '<compendium><item><name>Belt</name><type>W</type><modifier category="ability score">strength 21</modifier></item></compendium>')]);
    const { c, ce } = make(14, 10); // 14 + 2 = 16, belt sets 21
    const it = c.addItem(lookup(belt, 'item', 'Belt')!.el);
    setEquipped(it, true);
    expect(deriveSheet(c, emptyAppState(), opts).scores.strength).toBe(21);
    applyLevelUp(c, { existing: ce, hp: { method: 'average' }, asi: { strength: 2 } }, () => 1, opts);
    expect(c.abilities.strength).toBe(16);
    expect(deriveSheet(c, emptyAppState(), opts).overLimits).toEqual([]);
  });

  it('raises hit points retroactively when the Constitution modifier goes up', () => {
    const { c, ce } = make(10, 13); // Con 14 (+2): 10+2, then 6+2 twice = 28
    expect(c.hpMax).toBe(28);
    applyLevelUp(c, { existing: ce, hp: { method: 'average' }, asi: { constitution: 2 } }, () => 1, opts); // Con 16 (+3)
    expect(c.hpMax).toBe(28 + 3 + (6 + 3));
  });

  it('reads subclass spell tables and adds them as always prepared', () => {
    const f = { name: 'Oath of Devotion: Oath Spells', text: 'You gain oath spells.\nPaladin Level | Spells\n3rd | Sanctuary, Bless\n5th | Zone of Truth' };
    expect(featureSpellTable(f)).toEqual([{ level: 3, spells: ['Sanctuary', 'Bless'] }, { level: 5, spells: ['Zone of Truth'] }]);
    expect(featureSpellTable({ name: 'Circle Spells', text: '3rd | a\n3rd | b' })).toEqual([]);
  });
});

describe('built-in class rules', () => {
  const mods = { strength: 0, dexterity: 3, constitution: 2, intelligence: 1, wisdom: 2, charisma: 3 };
  const k = (base: string, level: number, names: string[], edition: '2014' | '2024' = '2014') => ({ name: base, base, level, edition, names });
  const counters = (...cs: ReturnType<typeof k>[]) => Object.fromEntries(builtinCounters(cs, [], mods).map((x) => [x.name, x.value]));

  it('tracks resources when the data has none', () => {
    expect(counters(k('barbarian', 12, ['Rage']))).toEqual({ Rage: 5 });
    expect(builtinCounters([k('barbarian', 20, ['Rage'])], [], mods)).toMatchObject([{ name: 'Rage', unlimited: true }]); // 2014
    expect(counters(k('barbarian', 20, ['Rage'], '2024'))).toEqual({ Rage: 6 });
    expect(counters(k('monk', 5, ['Ki']))).toEqual({ 'Ki Points': 5 });
    expect(counters(k('warlock', 15, ['Mystic Arcanum']))).toEqual({ 'Mystic Arcanum (6th level)': 1, 'Mystic Arcanum (7th level)': 1, 'Mystic Arcanum (8th level)': 1 });
    expect(counters(k('paladin', 3, ['Lay on Hands', 'Divine Sense', 'Oath of Devotion: Channel Divinity: Sacred Weapon']))).toEqual({ 'Lay on Hands': 15, 'Divine Sense': 4, 'Channel Divinity': 1 });
    // A counter already in the data wins.
    expect(builtinCounters([k('barbarian', 3, ['Rage'])], ['Rage'], mods)).toEqual([]);
  });

  it('has Martial Arts dice and third-caster slots', () => {
    expect([1, 5, 11, 17].map((L) => martialArtsDie(L, '2014'))).toEqual([4, 6, 8, 10]);
    expect([1, 5, 11, 17].map((L) => martialArtsDie(L, '2024'))).toEqual([6, 8, 10, 12]);
    expect(thirdCasterRow(3, ['Arcane Trickster: Spellcasting'])).toEqual([3, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(thirdCasterRow(13, ['Eldritch Knight: Spellcasting'])).toEqual([3, 4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(thirdCasterRow(2, ['Arcane Trickster: Spellcasting'])).toBeNull();
  });

  it('knows how many options a class lets you know', () => {
    expect(expectedOptionCount('Invocation', 'Warlock', 5, '2014')).toBe(3);
    expect(expectedOptionCount('Eldritch Invocations', 'Warlock', 1, '2024')).toBe(1);
    expect(expectedOptionCount('Infusion', 'Artificer', 10, '2014')).toBe(8);
    expect(expectedOptionCount('Metamagic', 'Wizard', 10, '2014')).toBeNull();
    // The granting feature listed twice (known and gained) still grants one style.
    expect(expectedOptionCount('Fighting Style', 'Fighter', 2, '2014', ['Fighting Style', 'Second Wind', 'Fighting Style'])).toBe(1);
    expect(expectedOptionCount('Fighting Style', 'Fighter', 10, '2014', ['Fighting Style', 'Champion: Additional Fighting Style'])).toBe(2);
    expect(optionLimits(['Invocation: A', 'Invocation: B', 'Invocation: C'], [k('warlock', 2, [])])).toEqual([{ title: 'Eldritch Invocations', have: 3, max: 2 }]);
  });
});

describe('movement and spell rolls', () => {
  it('stores movement speeds and applies them', () => {
    const c = Character.create('M');
    setMovement(c.ch, { walk: 25, bonus: 10, other: { fly: 'walk', swim: 30, climb: null, burrow: null }, hover: true }, (e) => { c.insert(e); });
    expect(movementOf(Character.parse(c.serialize()).ch)).toEqual({ walk: 25, bonus: 10, other: { fly: 'walk', swim: 30, climb: null, burrow: null }, hover: true });
    const s = deriveSheet(c, emptyAppState());
    expect(s.speed).toBe(35);
    expect(s.speeds).toEqual({ fly: 35, swim: 30 });
    setMovement(c.ch, { walk: null, bonus: 0, other: { fly: null, swim: null, climb: null, burrow: null }, hover: false }, (e) => { c.insert(e); });
    expect(c.serialize()).not.toContain('<movement');
  });

  it('shows the cantrip damage for the character level', () => {
    const rolls = ['1d8', '2d8', '3d8', '4d8'].map((formula) => ({ formula, description: '', level: null }));
    expect(spellRolls({ level: 0, rolls }, 1).map((r) => r.formula)).toEqual(['1d8']);
    expect(spellRolls({ level: 0, rolls }, 11).map((r) => r.formula)).toEqual(['3d8']);
    const toll = ['1d8', '1d12', '2d8', '2d12', '3d8', '3d12', '4d8', '4d12'].map((formula) => ({ formula, description: '', level: null }));
    expect(spellRolls({ level: 0, rolls: toll }, 5).map((r) => r.formula)).toEqual(['2d8', '2d12']);
    const cure = Array.from({ length: 9 }, (_, i) => ({ formula: `${i + 1}d8`, description: '', level: null }));
    expect(spellRolls({ level: 1, rolls: cure }, 3).map((r) => r.formula)).toEqual(['1d8']);
  });

  it('does not count granted spells against limits', () => {
    const c = Character.create('S');
    const lib = buildLibrary([file('a', `<compendium><spell><name>Fire Bolt</name><level>0</level></spell>
      <class><name>Wizard</name><hd>6</hd><spellAbility>Intelligence</spellAbility><autolevel level="1"><slots>3,2</slots>${feature('Spellcasting', 'x')}</autolevel></class></compendium>`)]);
    c.abilities = { strength: 10, dexterity: 10, constitution: 10, intelligence: 16, wisdom: 10, charisma: 10 };
    const ce = applyLevelUp(c, { newClass: lookup(lib, 'class', 'Wizard')!.el, hp: { method: 'max' } }, () => 1);
    c.addSpell(ce, lookup(lib, 'spell', 'Fire Bolt')!.el, 'High Elf');
    expect(childText(classSpells(ce)[0], 'grantedBy')).toBe('High Elf');
    expect(deriveSheet(c, emptyAppState()).spellcasting[0].limit.cantrips).toBe(0);
  });
});
