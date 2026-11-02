import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildLibrary, classView, lookup, subclassNames, CompendiumFile, parseModifier, spellView, itemView, raceView,
} from '../src/model/compendium';
import {
  Character, classLevel, classFeatNames, emptyAppState, setEquipped, setAttuned, chosenSubclasses, classSlots,
  classSlotsCurrent, parseComponents,
} from '../src/model/character';
import { proficiencyCode, proficiencyName, propertyMask, propertiesFromMask, itemTypeCode, hdDie } from '../src/model/codes';
import { casterKind, deriveSheet, multiclassSlots, defaultOptions } from '../src/rules/derive';
import { applyLevelUp, levelOptions, removeLevel } from '../src/rules/level';
import { roll, resolveFormula } from '../src/rules/dice';
import { canonical, childText, elements, parseXml, serializeXml } from '../src/xml/xml';

const srdXml = readFileSync(new URL('../src/srd/srd-sample.xml', import.meta.url), 'utf8');
const sampleChar = readFileSync(new URL('./fixtures/sample-character.xml', import.meta.url), 'utf8');
const file = (id: string, xml: string): CompendiumFile => ({ id, fileName: `${id}.xml`, xml, importedAt: 0, enabled: true });
const lib = buildLibrary([file('srd', srdXml)]);
const get = (k: Parameters<typeof lookup>[1], n: string) => lookup(lib, k, n)!.el;
const avg = () => { throw new Error('should not roll'); };
const opts = { ...defaultOptions, classLookup: (n: string) => lookup(lib, 'class', n)?.el };

function build(race: string, cls: string, levels: number, scores: number[], extra: { choicesByLevel?: Record<number, string[]>; skills?: string[] } = {}) {
  const c = Character.create('Test');
  c.setRace(get('race', race));
  c.abilities = { strength: scores[0], dexterity: scores[1], constitution: scores[2], intelligence: scores[3], wisdom: scores[4], charisma: scores[5] };
  let ce = applyLevelUp(c, { newClass: get('class', cls), hp: { method: 'average' }, choices: extra.choicesByLevel?.[1], skills: extra.skills }, avg, opts);
  for (let i = 2; i <= levels; i++) {
    ce = applyLevelUp(c, { existing: ce, hp: { method: 'average' }, choices: extra.choicesByLevel?.[i] }, avg, opts);
  }
  return c;
}

describe('SRD sample compendium', () => {
  it('parses without warnings and indexes every entry', () => {
    expect(lib.warnings).toEqual([]);
    expect(lib.byKind.class.map((e) => e.name)).toEqual(['Fighter', 'Wizard']);
    expect(lib.byKind.spell.length).toBe(6);
  });
  it('round-trips losslessly', () => {
    expect(serializeXml(parseXml(srdXml).doc)).toBe(srdXml.replace(/^﻿/, ''));
  });
  it('detects subclasses in both naming conventions but not option families', () => {
    expect(subclassNames(classView(get('class', 'Fighter')).features)).toEqual(['Champion']);
    expect(subclassNames(classView(get('class', 'Wizard')).features)).toEqual(['School of Evocation']);
  });
});

describe('merging', () => {
  it('appends autolevels of same-named classes (subclass files) and merges spell class lists', () => {
    const ext = `<compendium>
      <class><name>Fighter</name><autolevel level="3"><feature optional="YES"><name>Martial Archetype: Samurai</name><text>x</text></feature>
        <feature optional="YES"><name>Fighting Spirit (Samurai)</name><text>x</text></feature></autolevel></class>
      <spell><name>Fire Bolt</name><classes>Artificer</classes></spell>
    </compendium>`;
    const merged = buildLibrary([file('srd', srdXml), file('ext', ext)]);
    const cv = classView(lookup(merged, 'class', 'Fighter')!.el);
    expect(cv.hd).toBe(10);
    expect(cv.subclasses.sort()).toEqual(['Champion', 'Samurai']);
    expect(spellView(lookup(merged, 'spell', 'Fire Bolt')!.el).classes).toEqual(['Sorcerer', 'Wizard', 'Artificer']);
    expect(merged.warnings).toEqual([]);
  });
  it('other same-named entries replace earlier ones (case-insensitive) with a note', () => {
    const extra = '<compendium><item><name>DAGGER</name><type>M</type><text>homebrew</text></item></compendium>';
    const merged = buildLibrary([file('srd', srdXml), file('hb', extra)]);
    expect(lookup(merged, 'item', 'Dagger')!.fileId).toBe('hb');
    expect(merged.warnings.some((w) => w.message.includes('replaces'))).toBe(true);
  });
  it('keeps unknown top-level elements', () => {
    expect(buildLibrary([file('x', '<compendium><vehicle><name>Cart</name></vehicle></compendium>')]).others.length).toBe(1);
  });
});

describe('format conventions', () => {
  const m = (s: string) => parseModifier(parseXml(s).doc.root)!;
  it('parses modifier variants', () => {
    expect(m('<modifier category="bonus">ac +1</modifier>')).toMatchObject({ category: 'bonus', target: 'ac', value: 1 });
    expect(m('<modifier category="Bonus">Armor Class +2</modifier>')).toMatchObject({ target: 'ac', value: 2 });
    expect(m('<modifier category="ability score">Strength Score +2</modifier>')).toMatchObject({ category: 'ability score', target: 'strength', value: 2 });
    expect(m('<modifier category="saving throw">wisdom save +1</modifier>')).toMatchObject({ category: 'saving throw', target: 'wisdom' });
    expect(m('<modifier category="skills">Stealth +%8</modifier>')).toMatchObject({ category: 'skill', target: 'stealth', value: null, dynamic: '%8' });
    expect(m('<modifier category="bonus">weapon attack +1</modifier>')).toMatchObject({ target: 'weapon attacks' });
    expect(m('<modifier category="ability score">Charisma 19</modifier>')).toMatchObject({ mode: 'set', value: 19 });
  });
  it('reads item codes in both forms', () => {
    const compiled = itemView(parseXml('<item><name>X</name><type>5</type><damage1H>1d8</damage1H><damageType>3</damageType><weaponProperty>1536</weaponProperty></item>').doc.root);
    expect(compiled).toMatchObject({ type: 'M', dmg1: '1d8', dmgType: 'slashing', properties: ['V', 'M'] });
    expect(propertyMask(['L'])).toBe(8);
    expect(propertiesFromMask('256')).toEqual(['2H']);
    expect(itemTypeCode('LA')).toBe(1);
    expect(hdDie('4')).toBe(12);
  });
  it('maps proficiency codes', () => {
    expect(proficiencyCode('Strength Saving Throws')).toBe(0);
    expect(proficiencyCode('Animal Handling')).toBe(101);
    expect(proficiencyName(117)).toBe('Survival');
  });
  it('handles compiled races, spells and components', () => {
    const r = raceView(parseXml('<race><name>G</name><size>1</size><mod><category>1</category><type>2</type><value>1</value></mod></race>').doc.root);
    expect(r.size).toBe('S');
    expect(r.modifiers[0]).toMatchObject({ category: 'ability score', target: 'constitution', value: 1 });
    const sp = spellView(parseXml('<spell><name>S</name><school>4</school><v>1</v><m>1</m><materials>a pearl</materials><sclass>Bard</sclass><sclass>Wizard</sclass></spell>').doc.root);
    expect(sp.school).toBe('Enchantment');
    expect(sp.components).toBe('V, M (a pearl)');
    expect(sp.classes).toEqual(['Bard', 'Wizard']);
    expect(parseComponents('V, S, M (a tiny ball of bat guano and sulfur)')).toEqual({ v: true, s: true, m: true, materials: 'a tiny ball of bat guano and sulfur' });
  });
  it('resolves roll placeholders', () => {
    const ctx = { abilityMods: [3, 2, 1, 0, -1, -2], spellMod: 4, prof: 3, level: 5, hpCurrent: 20 };
    expect(resolveFormula('1d8+%0', ctx)).toBe('1d8+4');
    expect(resolveFormula('8+%8+%1', ctx)).toBe('8+3+3');
    expect(resolveFormula('1d4+SPELL', ctx)).toBe('1d4+4');
    expect(resolveFormula('(1d4+1)+(1d4+1)', ctx)).toBe('1d4+1+1d4+1');
    expect(resolveFormula('1d6+%10', ctx)).toBe('1d6+2');
  });
});

describe('derived stats: Human Fighter 5 (standard array)', () => {
  const c = build('Human', 'Fighter', 5, [15, 14, 13, 12, 10, 8], {
    skills: ['Athletics', 'Perception'],
    choicesByLevel: { 1: ['Fighting Style: Defense'], 3: ['Martial Archetype: Champion', 'Improved Critical (Champion)'] },
  });
  for (const n of ['Chain Mail', 'Shield', 'Longsword']) setEquipped(c.addItem(get('item', n)), true);
  const s = deriveSheet(c, emptyAppState(), opts);
  it('scores, proficiency, saves', () => {
    expect(s.scores).toMatchObject({ strength: 16, dexterity: 15, constitution: 14, charisma: 9 });
    expect(s.prof).toBe(3);
    expect(s.saves.find((x) => x.ability === 'strength')!.bonus).toBe(6);
    expect(s.saves.find((x) => x.ability === 'constitution')!.bonus).toBe(5);
    expect(s.saves.find((x) => x.ability === 'dexterity')!.bonus).toBe(2);
    expect(s.skills.find((x) => x.name === 'Athletics')!.bonus).toBe(6);
  });
  it('AC: chain mail 16 + shield 2 + Defense 1', () => expect(s.ac).toBe(19));
  it('HP: 10+2 at 1st, then 6+2 per level', () => expect(s.hpMax).toBe(44));
  it('longsword attack and damage', () => {
    const a = s.attacks.find((x) => x.name === 'Longsword')!;
    expect(a.bonus).toBe(6);
    expect(a.damage).toBe('1d8+3');
    expect(a.versatile).toBe('1d10+3');
  });
  it('subclass, features and counters', () => {
    expect(s.classes[0].subclasses).toEqual(['Champion']);
    expect(s.features.map((f) => f.name)).toContain('Improved Critical (Champion)');
    expect(s.features.map((f) => f.name)).not.toContain('Fighting Style: Dueling');
    expect(s.counters.map((x) => x.name).sort()).toEqual(['Action Surge', 'Second Wind']);
  });
  it('initiative, speed, no spellcasting', () => {
    expect(s.initiative).toBe(2);
    expect(s.speed).toBe(30);
    expect(s.spellcasting).toEqual([]);
  });
  it('writes the compiled character format', () => {
    const xml = c.serialize();
    expect(xml).toMatch(/<pc version="5">\s*<character>\s*<version>38<\/version>/);
    const ce = c.classes[0];
    expect(childText(ce, 'level')).toBe('5');
    expect(childText(ce, 'hd')).toBe('3');
    expect(elements(ce, 'proficiency').map((p) => childText({ ...ce, children: [p] }, 'proficiency'))).toEqual(['0', '2', '103', '111']);
    expect(classFeatNames(ce)).toContain('Extra Attack');
    expect(elements(ce, 'autolevel').length).toBe(5);
    expect(childText(elements(ce, 'autolevel')[0], 'level')).toBe('');
    expect(childText(elements(ce, 'autolevel')[1], 'level')).toBe('2');
    const race = c.race!;
    expect(elements(race, 'mod').length).toBe(6);
    expect(childText(elements(c.items[0], 'slot').length ? c.items[0] : c.items[0], 'slot')).toBe('5');
    expect(childText(c.items[2], 'weaponProperty')).toBe(String(propertyMask(['M', 'V'])));
    expect(childText(c.items[2], 'damageType')).toBe('3');
    expect(xml).not.toContain('<feature');
  });
  it('removing a level drops that level\'s features and HP', () => {
    const c2 = Character.parse(c.serialize());
    removeLevel(c2, c2.classes[0], opts);
    expect(classLevel(c2.classes[0])).toBe(4);
    expect(classFeatNames(c2.classes[0])).not.toContain('Extra Attack');
    expect(c2.hpMax).toBe(36);
  });
});

describe('derived stats: High Elf Wizard 5', () => {
  const c = build('Elf (High)', 'Wizard', 5, [8, 14, 13, 15, 12, 10], { choicesByLevel: { 2: ['Arcane Tradition: School of Evocation', 'Sculpt Spells (School of Evocation)'] } });
  const s = deriveSheet(c, emptyAppState(), opts);
  it('spell DC, attack and slots', () => {
    expect(s.spellcasting[0]).toMatchObject({ ability: 'intelligence', dc: 14, attack: 6, cantrips: 4, kind: 'full' });
    expect(s.slots.slice(1, 5)).toEqual([4, 3, 2, 0]);
    expect(classSlots(c.classes[0]).slice(0, 4)).toEqual([4, 4, 3, 2]);
    expect(chosenSubclasses(c.classes[0])).toEqual(['School of Evocation']);
  });
  it('racial skill proficiency feeds passive perception', () => {
    expect(s.skills.find((x) => x.name === 'Perception')!.bonus).toBe(4);
    expect(s.passivePerception).toBe(14);
  });
  it('HP and unarmored AC', () => {
    expect(s.hpMax).toBe(27);
    expect(s.ac).toBe(13);
  });
  it('magic items requiring attunement apply only when attuned', () => {
    const ring = c.addItem(get('item', 'Ring of Protection'));
    setEquipped(ring, true);
    expect(deriveSheet(c, emptyAppState(), opts).ac).toBe(13);
    setAttuned(ring, true);
    const s2 = deriveSheet(c, emptyAppState(), opts);
    expect(s2.ac).toBe(14);
    expect(s2.saves.find((x) => x.ability === 'intelligence')!.bonus).toBe(3 + 3 + 1);
  });
  it('spells are stored under the class in compiled form and slot use is tracked in the file', () => {
    const ce = c.classes[0];
    c.addSpell(ce, get('spell', 'Magic Missile'));
    c.addSpell(ce, get('spell', 'Fire Bolt'));
    const sp = elements(ce, 'spell');
    expect(sp.length).toBe(2);
    expect(childText(sp[0], 'school')).toBe('5');
    expect(childText(sp[0], 'level')).toBe('1');
    expect(childText(sp[1], 'level')).toBe('');
    expect(elements(sp[0], 'sclass').length).toBe(2);
    c.setSlots(s.slots, s.slots.map((t, i) => (i === 1 ? t - 2 : t)));
    const again = deriveSheet(Character.parse(c.serialize()), emptyAppState(), opts);
    expect(again.slotsUsed[1]).toBe(2);
    expect(classSlotsCurrent(c.classes[0])[1]).toBe(4);
  });
});

describe('multiclass spellcasting', () => {
  const half = parseXml(`<class><name>Warden</name><hd>10</hd><spellAbility>Wisdom</spellAbility>
    <autolevel level="2"><slots>0,2</slots></autolevel><autolevel level="5"><slots>0,4,2</slots></autolevel>
    <autolevel level="20"><slots>0,4,3,3,3,2</slots></autolevel></class>`).doc.root;
  const pact = parseXml(`<class><name>Pactbound</name><hd>8</hd><spellAbility>Charisma</spellAbility>
    <autolevel level="1"><feature><name>Pact Magic</name><text>.</text></feature><slots>2,1</slots></autolevel>
    <autolevel level="3"><slots>2,0,2</slots></autolevel></class>`).doc.root;
  const third = parseXml(`<class><name>Knight</name><hd>10</hd><spellAbility>Intelligence</spellAbility>
    <autolevel level="3"><slots optional="YES">2,2</slots><feature><name>Archetype</name><text>.</text></feature>
      <feature optional="YES"><name>Archetype: Eldritch Knight</name><text>.</text></feature>
      <feature optional="YES"><name>Spellcasting (Eldritch Knight)</name><text>.</text></feature></autolevel>
    <autolevel level="7"><slots optional="YES">2,4,2</slots></autolevel></class>`).doc.root;
  it('classifies caster kinds from the slot table', () => {
    expect(casterKind(classView(get('class', 'Wizard')))).toBe('full');
    expect(casterKind(classView(half))).toBe('half');
    expect(casterKind(classView(pact))).toBe('pact');
    expect(casterKind(classView(get('class', 'Fighter')))).toBe('none');
  });
  it('optional slot rows apply only when the subclass casting feature is chosen', () => {
    const c = Character.create('K');
    let k = applyLevelUp(c, { newClass: third, hp: { method: 'max' } }, avg);
    k = applyLevelUp(c, { existing: k, hp: { method: 'average' } }, avg);
    k = applyLevelUp(c, { existing: k, hp: { method: 'average' } }, avg);
    expect(deriveSheet(c, emptyAppState()).spellcasting).toEqual([]);
    const lo = levelOptions(k, 3);
    expect(lo.subclassChoices).toEqual(['Eldritch Knight']);
    expect(lo.subclassLabel).toBe('Archetype');
    removeLevel(c, k);
    applyLevelUp(c, { existing: k, hp: { method: 'average' }, choices: ['Archetype: Eldritch Knight', 'Spellcasting (Eldritch Knight)'] }, avg);
    const s = deriveSheet(c, emptyAppState());
    expect(s.spellcasting[0]).toMatchObject({ kind: 'third', cantrips: 2 });
    expect(s.slots[1]).toBe(2);
  });
  it('uses the multiclass table: Wizard 3 / Warden 5', () => {
    const c = build('Human', 'Wizard', 3, [8, 14, 13, 15, 12, 10]);
    let w = applyLevelUp(c, { newClass: half, hp: { method: 'average' } }, avg, opts);
    for (let i = 1; i < 5; i++) w = applyLevelUp(c, { existing: w, hp: { method: 'average' } }, avg, opts);
    const s14 = deriveSheet(c, emptyAppState(), opts);
    expect(s14.slots.slice(1)).toEqual(multiclassSlots(5).slice(1));
    expect(s14.slots.slice(1, 4)).toEqual([4, 3, 2]);
    const s24 = deriveSheet(c, emptyAppState(), { ...opts, multiclassRounding: '2024' });
    expect(s24.slots.slice(1, 4)).toEqual([4, 3, 3]);
    expect(s14.saves.find((x) => x.ability === 'intelligence')!.proficient).toBe(true);
    expect(s14.saves.find((x) => x.ability === 'wisdom')!.proficient).toBe(true);
    expect(s14.saves.find((x) => x.ability === 'strength')!.proficient).toBe(false);
  });
  it('keeps pact slots separate', () => {
    const c = build('Human', 'Wizard', 2, [8, 14, 13, 15, 12, 10]);
    let p = applyLevelUp(c, { newClass: pact, hp: { method: 'average' } }, avg, opts);
    p = applyLevelUp(c, { existing: p, hp: { method: 'average' } }, avg, opts);
    applyLevelUp(c, { existing: p, hp: { method: 'average' } }, avg, opts);
    const s = deriveSheet(c, emptyAppState(), opts);
    expect(s.pact).toEqual({ level: 2, count: 2 });
    expect(s.slots.slice(1, 3)).toEqual([3, 0]);
  });
});

describe('character files in the compiled format', () => {
  it('reads a real-format export and derives the sheet', () => {
    const c = Character.parse(sampleChar);
    const s = deriveSheet(c, emptyAppState(), opts);
    expect(c.name).toBe('Brakka');
    expect(s.scores).toMatchObject({ strength: 16, dexterity: 15, constitution: 14, intelligence: 13, wisdom: 11, charisma: 9 });
    expect(s.level).toBe(1);
    expect(s.ac).toBe(19);
    expect(s.saves.filter((x) => x.proficient).map((x) => x.ability)).toEqual(['strength', 'constitution']);
    expect(s.skills.filter((x) => x.proficient).map((x) => x.name)).toEqual(['Athletics', 'Insight', 'Perception', 'Religion']);
    expect(s.attacks[0]).toMatchObject({ name: 'Longsword', bonus: 5, damage: '1d8+3' });
    expect(s.hitDice[0]).toMatchObject({ die: 10, total: 1, current: 1 });
    expect(c.coinTotal()).toBe(15.5);
    expect(s.carried).toBe(55 + 6 + 3 + 20 * 0.02 + 5 + 7 + 10);
    expect(s.features.map((f) => f.name)).toContain('Fighting Style: Defense');
  });
  it('round-trips byte for byte and preserves unknown content after edits', () => {
    const c = Character.parse(sampleChar);
    expect(c.serialize(false)).toBe(sampleChar);
    c.hpCurrent = 4;
    const out = c.serialize();
    expect(out).toContain('<futureField mode="x">');
    expect(out).toContain('<nested>keep me</nested>');
    const again = Character.parse(out);
    expect(again.hpCurrent).toBe(4);
    expect(canonical(parseXml(again.serialize()).doc.root)).toEqual(canonical(parseXml(out).doc.root));
  });
  it('levels up an imported character using its embedded progression', () => {
    const c = Character.parse(sampleChar);
    const ce = c.classes[0];
    applyLevelUp(c, { existing: ce, hp: { method: 'average' } }, avg);
    applyLevelUp(c, { existing: ce, hp: { method: 'average' }, choices: ['Martial Archetype: Champion', 'Champion: Improved Critical'] }, avg);
    expect(classLevel(ce)).toBe(3);
    expect(classFeatNames(ce)).toContain('Action Surge');
    expect(chosenSubclasses(ce)).toEqual(['Champion']);
    expect(c.hpMax).toBe(12 + 8 + 8);
    expect(childText(ce, 'hdCurrent')).toBe('3');
  });
  it('splits multi-character files and accepts a bare <character> root', () => {
    const r = Character.parseAll('<pc><character><name>A</name></character><character><name>B</name></character></pc>');
    expect(r.characters.map((c) => c.name)).toEqual(['A', 'B']);
    expect(Character.parse('<character><name>C</name></character>').name).toBe('C');
  });
  it('created characters survive a save/load cycle with identical derived stats', () => {
    const c = build('Dwarf (Hill)', 'Fighter', 3, [15, 14, 13, 12, 10, 8]);
    setEquipped(c.addItem(get('item', 'Scale Mail')), true);
    const strip = (s: ReturnType<typeof deriveSheet>) => ({ ...s, classes: s.classes.map(({ el: _el, ...k }) => k) });
    const before = deriveSheet(c, emptyAppState(), opts);
    const after = deriveSheet(Character.parse(c.serialize()), emptyAppState(), opts);
    expect(strip(after)).toEqual(strip(before));
    expect(before.speed).toBe(25);
    expect(before.ac).toBe(16); // 14 + min(2, Dex +2)
  });
});

describe('dice', () => {
  const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
  it('sums dice and constants', () => expect(roll('2d6+3', seq(4, 5)).total).toBe(12));
  it('keeps highest', () => expect(roll('4d6kh3', seq(1, 6, 3, 5)).total).toBe(14));
  it('advantage on a d20', () => expect(roll('1d20+2 adv', seq(3, 17)).total).toBe(19));
  it('rejects garbage', () => expect(() => roll('2d6+foo')).toThrow());
});
