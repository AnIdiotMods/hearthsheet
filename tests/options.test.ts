import { describe, expect, it } from 'vitest';
import { buildLibrary, CompendiumFile, classView, lookup } from '../src/model/compendium';
import { Character, emptyAppState } from '../src/model/character';
import { checkPrerequisite, grantsExpertise, mentions, optionGroups, OptionContext } from '../src/rules/options';
import { applyLevelUp } from '../src/rules/level';
import { deriveSheet } from '../src/rules/derive';
import { parseXml } from '../src/xml/xml';

const file = (id: string, xml: string): CompendiumFile => ({ id, fileName: id, xml, importedAt: 0, enabled: true });
const XML = `<compendium>
  <class><name>Warlock</name><hd>8</hd><spellAbility>Charisma</spellAbility>
    <autolevel level="1"><feature><name>Pact Magic</name><text>.</text></feature><slots>2,1</slots></autolevel>
    <autolevel level="2"><feature><name>Eldritch Invocations</name><text>You gain two eldritch invocations of your choice.</text></feature></autolevel>
    <autolevel level="3"><feature><name>Pact Boon</name><text>Choose a boon.</text></feature>
      <feature optional="YES"><name>Pact Boon: Pact of the Blade</name><text>.</text></feature>
      <feature optional="YES"><name>Pact Boon: Pact of the Chain</name><text>.</text></feature></autolevel>
    <autolevel level="5"><feature><name>Additional Invocation</name><text>You learn one more invocation.</text></feature></autolevel>
  </class>
  <class><name>Sorcerer</name><hd>6</hd>
    <autolevel level="3"><feature><name>Metamagic</name><text>You gain two Metamagic options. You gain another one at 10th and 17th level.</text></feature>
      <feature optional="YES"><name>Metamagic: Careful Spell</name><text>.</text></feature>
      <feature optional="YES"><name>Metamagic: Quickened Spell</name><text>.</text></feature>
      <feature optional="YES"><name>Metamagic: Twinned Spell</name><text>.</text></feature></autolevel>
    <autolevel level="10"><feature><name>Metamagic</name><text>You gain another Metamagic option.</text></feature></autolevel>
  </class>
  <class><name>Rogue</name><hd>8</hd><proficiency>Dexterity, Intelligence, Stealth, Acrobatics, Perception</proficiency><numSkills>2</numSkills>
    <autolevel level="1"><feature><name>Expertise</name><text>Choose two of your skill proficiencies.</text></feature></autolevel>
  </class>
  <feat><name>Invocation: Agonizing Blast</name><prerequisite>Eldritch Blast cantrip</prerequisite><text>Add Cha to eldritch blast.</text></feat>
  <feat><name>Invocation: Armor of Shadows</name><prerequisite></prerequisite><text>Mage armor at will.</text></feat>
  <feat><name>Invocation: Thirsting Blade</name><prerequisite>5th level, Pact of the Blade</prerequisite><text>Attack twice.</text></feat>
  <feat><name>Maneuver: Trip Attack</name><text>Knock prone.</text></feat>
  <feat><name>Maneuver: Riposte</name><text>Reaction attack.</text></feat>
  <feat><name>Alert</name><text>+5 initiative.</text></feat>
</compendium>`;
const lib = buildLibrary([file('t', XML)]);
const cvOf = (n: string) => classView(lookup(lib, 'class', n)!.el);
const ctx = (cls: string, level: number, extra: Partial<OptionContext> = {}): OptionContext => {
  const cv = cvOf(cls);
  return {
    lib, cv, level, classFeatures: cv.features.filter((f) => !f.optional && f.level <= level).map((f) => ({ name: f.name, text: f.text, level: f.level })),
    known: new Set(), spells: new Set(), characterLevel: level, subclasses: [], ...extra,
  };
};

describe('class option lists', () => {
  it('offers invocation feats to a level 2 warlock, and not before', () => {
    expect(optionGroups(ctx('Warlock', 1)).map((g) => g.family)).toEqual([]);
    const g = optionGroups(ctx('Warlock', 2));
    expect(g.map((x) => [x.family, x.grantedBy, x.now])).toEqual([['Invocation', 'Eldritch Invocations', true]]);
    expect(g[0].options.map((o) => o.label)).toEqual(['Armor of Shadows', 'Agonizing Blast', 'Thirsting Blade']);
  });

  it('checks prerequisites against level, spells and features', () => {
    const at2 = optionGroups(ctx('Warlock', 2))[0].options;
    expect(at2.find((o) => o.label === 'Agonizing Blast')).toMatchObject({ prereqMet: false, prereqNote: 'Requires Eldritch Blast cantrip' });
    expect(at2.find((o) => o.label === 'Thirsting Blade')!.prereqMet).toBe(false);
    const at5 = optionGroups(ctx('Warlock', 5, {
      spells: new Set(['eldritch blast']), known: new Set(['Pact Boon: Pact of the Blade', 'Invocation: Armor of Shadows']),
    }));
    const inv = at5.find((g) => g.family === 'Invocation')!;
    expect(inv.now).toBe(true); // "Additional Invocation" at level 5
    expect(inv.options.every((o) => o.prereqMet === true)).toBe(true);
    expect(inv.options.find((o) => o.label === 'Armor of Shadows')!.taken).toBe(true);
  });

  it('re-offers options listed inside the class at later levels (Metamagic at 10)', () => {
    const at3 = optionGroups(ctx('Sorcerer', 3));
    expect(at3.map((g) => [g.family, g.now, g.options.length])).toEqual([['Metamagic', true, 3]]);
    const at10 = optionGroups(ctx('Sorcerer', 10, { known: new Set(['Metamagic: Careful Spell', 'Metamagic: Twinned Spell']) }));
    expect(at10[0].now).toBe(true);
    expect(at10[0].options.filter((o) => !o.taken).map((o) => o.label)).toEqual(['Quickened Spell']);
    expect(optionGroups(ctx('Sorcerer', 6))[0].now).toBe(false); // still available, just not new
  });

  it('keeps class-internal options (Pact Boon) and ignores plain feats', () => {
    const at3 = optionGroups(ctx('Warlock', 3));
    expect(at3.map((g) => g.family).sort()).toEqual(['Invocation', 'Pact Boon']);
    expect(at3.flatMap((g) => g.options.map((o) => o.name))).not.toContain('Alert');
    // Maneuvers are not offered to a class that never mentions them.
    expect(optionGroups(ctx('Sorcerer', 10)).map((g) => g.family)).not.toContain('Maneuver');
  });

  it('offers maneuvers once a chosen subclass feature mentions them', () => {
    const c = ctx('Sorcerer', 3);
    c.classFeatures.push({ name: 'Battle Master: Combat Superiority', text: 'You learn three maneuvers of your choice.', level: 3 });
    expect(optionGroups(c).find((g) => g.family === 'Maneuver')!.options.map((o) => o.label)).toEqual(['Riposte', 'Trip Attack']);
  });

  it('prerequisite parser handles patrons and unknown text', () => {
    const base = ctx('Warlock', 5, { subclasses: ['The Fiend'] });
    expect(checkPrerequisite('The Fiend patron', base).met).toBe(true);
    expect(checkPrerequisite('The Archfey patron', base).met).toBe(false);
    expect(checkPrerequisite('A suit of armor', base).met).toBe(true);
    expect(checkPrerequisite('Must love dogs', base).met).toBeNull();
    expect(mentions('Eldritch Invocations', 'Invocation')).toBe(true);
    expect(mentions('Combat Superiority', 'Maneuver')).toBe(false);
  });

  it('detects expertise features', () => {
    expect(grantsExpertise([{ name: 'Expertise', text: 'Choose two of your skill proficiencies.' }])).toBe(true);
    expect(grantsExpertise([{ name: 'Tool Expertise', text: 'tool' }])).toBe(false);
  });

  it('chosen options are stored as feats and level-up keeps class options as features', () => {
    const c = Character.create('W');
    let ce = applyLevelUp(c, { newClass: lookup(lib, 'class', 'Warlock')!.el, hp: { method: 'max' } }, () => 1);
    ce = applyLevelUp(c, { existing: ce, hp: { method: 'average' } }, () => 1);
    c.addFeat(lookup(lib, 'feat', 'Invocation: Armor of Shadows')!.el);
    applyLevelUp(c, { existing: ce, hp: { method: 'average' }, choices: ['Pact Boon: Pact of the Blade'] }, () => 1);
    const s = deriveSheet(c, emptyAppState());
    expect(s.features.map((f) => f.name)).toEqual(expect.arrayContaining(['Invocation: Armor of Shadows', 'Pact Boon: Pact of the Blade']));
    expect(parseXml(c.serialize()).warnings).toEqual([]);
  });
});

describe('2024-style files', () => {
  const X = `<compendium>
    <class><name>Warlock [5.5e]</name><hd>8</hd><spellAbility>Charisma</spellAbility>
      <autolevel level="1"><feature><name>Level 1: Eldritch Invocations</name><text>You gain one invocation.</text></feature>
        <feature optional="YES"><name>Becoming A Warlock As A Level 1 Character</name><text>.</text></feature><slots>2,1</slots></autolevel>
      <autolevel level="3"><feature><name>Level 3: Warlock Subclass</name><text>Choose a patron.</text></feature>
        <feature optional="YES"><name>Warlock Subclass: Fiend Patron</name><text>.</text></feature>
        <feature optional="YES"><name>Level 3: Dark One's Blessing (Fiend Patron)</name><text>.</text></feature>
        <feature optional="YES"><name>Warlock Subclass: Archfey Patron</name><text>.</text></feature>
        <feature optional="YES"><name>Level 3: Steps of the Fey (Archfey Patron)</name><text>.</text></feature>
        <feature optional="YES"><name>Otherworldly Patron: The Undying (Legacy)</name><text>.</text></feature>
        <feature optional="YES"><name>Otherworldly Patron: The Genie (Legacy)</name><text>.</text></feature>
        <feature optional="YES"><name>Among the Dead (The Undying (Legacy))</name><text>.</text></feature>
        <feature optional="YES"><name>Genie's Vessel (The Genie (Legacy))</name><text>.</text></feature></autolevel>
      <autolevel level="6"><feature optional="YES"><name>Level 6: Dark One's Own Luck (Fiend Patron)</name><text>.</text></feature>
        <feature optional="YES"><name>Level 6: Misty Escape (Archfey Patron)</name><text>.</text></feature>
        <feature optional="YES"><name>Defy Death (The Undying (Legacy))</name><text>.</text></feature>
        <feature optional="YES"><name>Elemental Gift (The Genie (Legacy))</name><text>.</text></feature></autolevel>
    </class>
    <class><name>Ranger</name><hd>10</hd>
      <autolevel level="1"><feature optional="YES"><name>Deft Explorer</name><text>.</text></feature><feature optional="YES"><name>Deft Explorer: Canny</name><text>.</text></feature></autolevel>
      <autolevel level="6"><feature optional="YES"><name>Deft Explorer: Roving</name><text>.</text></feature></autolevel>
      <autolevel level="3"><feature><name>Ranger Archetype</name><text>.</text></feature>
        <feature optional="YES"><name>Ranger Archetype: Hunter</name><text>.</text></feature><feature optional="YES"><name>Hunter: Hunter's Prey</name><text>.</text></feature></autolevel>
    </class>
    <spell><name>Invocation: Armor of Shadows [5.5e]</name><level>0</level><classes>Eldritch Invocations [5.5e]</classes><text>You can cast Mage Armor at will.</text></spell>
    <spell><name>Invocation: Agonizing Blast [5.5e]</name><level>0</level><classes>Eldritch Invocations [5.5e]</classes><text>Prerequisite: Level 2+ Warlock, a Warlock Cantrip That Deals Damage

Add your Charisma modifier.</text></spell>
    <spell><name>Hex [5.5e]</name><level>1</level><classes>Warlock [5.5e]</classes><text>.</text></spell>
  </compendium>`;
  const lib2 = buildLibrary([file('x', X)]);
  const w = classView(lookup(lib2, 'class', 'Warlock [5.5e]')!.el);

  it('"Level N:" prefixes and legacy headings are not patrons', () => {
    expect(w.subclasses.sort()).toEqual(['Archfey Patron', 'Fiend Patron', 'The Genie (Legacy)', 'The Undying (Legacy)']);
    expect(w.subclassLabel).toBe('Warlock Subclass');
    expect(w.subclassLevels.get('Fiend Patron')).toBe(3);
    expect(classView(lookup(lib2, 'class', 'Ranger')!.el).subclasses).toEqual(['Hunter']);
  });

  it('invocations written as spells are offered, with the prerequisite read from the text', () => {
    const ctx2 = (level: number): OptionContext => ({
      lib: lib2, cv: w, level, classFeatures: w.features.filter((f) => !f.optional && f.level <= level).map((f) => ({ name: f.name, text: f.text, level: f.level })),
      known: new Set(), spells: new Set(), characterLevel: level, subclasses: [],
    });
    const g1 = optionGroups(ctx2(1));
    expect(g1.map((g) => [g.family, g.now])).toEqual([['Invocation', true]]);
    expect(g1[0].options.map((o) => [o.label, o.prereqMet])).toEqual([['Armor of Shadows', true], ['Agonizing Blast', false]]);
    expect(g1[0].options[1]).toMatchObject({ prerequisite: 'Level 2+ Warlock, a Warlock Cantrip That Deals Damage' });
    expect(optionGroups(ctx2(2))[0].options.find((o) => o.label === 'Agonizing Blast')!.prereqMet).toBe(true);
    expect(g1[0].options.map((o) => o.name)).not.toContain('Hex [5.5e]');
  });
});
