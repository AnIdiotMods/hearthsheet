// Content made in the Creator: templates, blank entries, subclasses and the homebrew file.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CompendiumFile, buildLibrary, classView, featView, itemView, lookup, monsterView, raceView, spellView,
} from '../src/model/compendium';
import { Character, chosenSubclasses, emptyAppState } from '../src/model/character';
import {
  CREATOR_KINDS, CreatorKind, HOMEBREW_ID, TEMPLATES, blankEntry, buildSubclass, emptyHomebrewXml, entryName, homebrewEntries,
  kindOf, parentInfo, removeEntry, subclassParts, upsertEntry, validateEntry,
} from '../src/model/homebrew';
import { deriveSheet, defaultOptions, casterKind } from '../src/rules/derive';
import { applyLevelUp, defaultSubclassPicks, levelOptions } from '../src/rules/level';
import { serializeXml } from '../src/xml/xml';

const srdXml = readFileSync(new URL('../src/srd/srd-sample.xml', import.meta.url), 'utf8');
const file = (id: string, xml: string): CompendiumFile => ({ id, fileName: `${id}.xml`, xml, importedAt: id === HOMEBREW_ID ? 1 : 0, enabled: true });
const srd = buildLibrary([file('srd', srdXml)]);

describe('creator templates', () => {
  it('makes a valid entry of every kind from every template and from scratch', () => {
    const parent = lookup(srd, 'class', 'Fighter')!.el;
    for (const kind of CREATOR_KINDS) {
      const made = [...TEMPLATES[kind].map((tp) => tp.make({ name: `Test ${kind}`, parent })), blankEntry(kind, { name: `Test ${kind}`, parent })];
      for (const e of made) {
        expect(kindOf(e)).toBe(kind);
        expect(entryName(e)).toBe(`Test ${kind}`);
        expect(validateEntry(e)).toEqual([]);
      }
    }
  });

  it('builds entries the views and the sheet understand', () => {
    const spell = spellView(TEMPLATES.spell[0].make({ name: 'Sparkle' }));
    expect(spell).toMatchObject({ level: 0, school: 'Evocation', classes: ['Sorcerer', 'Wizard'] });
    expect(spell.rolls.map((r) => r.level)).toEqual([0, 5, 11, 17]);
    expect(itemView(TEMPLATES.item[0].make({ name: 'Glaive-ish' }))).toMatchObject({ type: 'M', dmg1: '1d8', dmg2: '1d10', dmgType: 'slashing' });
    expect(itemView(TEMPLATES.item[3].make({ name: 'Charm' }))).toMatchObject({ magic: true, attunement: true });
    expect(featView(TEMPLATES.feat[0].make({ name: 'Nimble' })).modifiers[0]).toMatchObject({ category: 'ability score', target: 'dexterity', value: 1 });
    expect(raceView(TEMPLATES.race[0].make({ name: 'Stoneborn' })).abilityBonuses).toEqual({ strength: 2, constitution: 1 });
    expect(monsterView(TEMPLATES.monster[0].make({ name: 'Wolfish' })).actions[0].attacks[0]).toMatchObject({ name: 'Bite', bonus: 4, damage: '2d4+2' });
    const caster = classView(TEMPLATES.class[1].make({ name: 'Arcanist' }));
    expect(caster.hd).toBe(6);
    expect(caster.asiLevels).toEqual(new Set([4, 8, 12, 16, 19]));
    expect(casterKind(caster)).toBe('full');
    expect(casterKind(classView(TEMPLATES.class[2].make({ name: 'Warden' })))).toBe('half');
  });

  it('plays a homebrew class from level 1 to 5 with a homebrew subclass', () => {
    const parent = TEMPLATES.class[0].make({ name: 'Sentinel' });
    let xml = upsertEntry(emptyHomebrewXml(), parent);
    const sub = TEMPLATES.subclass[0].make({ name: 'Iron Vow', parent });
    xml = upsertEntry(xml, sub);
    const lib = buildLibrary([file('srd', srdXml), file(HOMEBREW_ID, xml)]);
    const cv = classView(lookup(lib, 'class', 'Sentinel')!.el);
    expect(cv.subclasses).toEqual(['Iron Vow']);
    expect(cv.subclassLabel).toBe('Sentinel Path');
    const c = Character.create('S');
    c.abilities = { strength: 15, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 };
    const ce = applyLevelUp(c, { newClass: lookup(lib, 'class', 'Sentinel')!.el, hp: { method: 'max' } }, () => 1);
    for (let L = 2; L <= 5; L++) {
      const lo = levelOptions(ce, L);
      const picks = lo.subclassChoices.includes('Iron Vow') ? defaultSubclassPicks(lo.cv, 'Iron Vow', L).map((f) => f.name) : [];
      applyLevelUp(c, { existing: ce, hp: { method: 'average' }, choices: picks, subclass: picks.length ? 'Iron Vow' : undefined }, () => 1);
    }
    expect(chosenSubclasses(ce)).toEqual(['Iron Vow']);
    const s = deriveSheet(c, emptyAppState(), defaultOptions);
    expect(s.features.map((f) => f.name)).toEqual(expect.arrayContaining(['Fighting Style', 'Extra Attack', 'Sentinel Path: Iron Vow', 'Iron Vow: First Feature']));
  });

  it('follows the parent class\'s subclass levels', () => {
    expect(parentInfo(TEMPLATES.class[0].make({ name: 'Sentinel' }))).toEqual({ name: 'Sentinel', label: 'Sentinel Path', levels: [3, 7, 10, 15, 18] });
    const fighter = lookup(srd, 'class', 'Fighter')!.el;
    expect(parentInfo(fighter)).toMatchObject({ name: 'Fighter', label: 'Martial Archetype' });
    expect(parentInfo(fighter).levels[0]).toBe(3);
  });
});

describe('subclass entries', () => {
  it('round-trips through buildSubclass and subclassParts', () => {
    const e = buildSubclass('Fighter', 'Martial Archetype', 'Duelist', [{ level: 3, name: 'Riposte', text: 'A\nB' }, { level: 7, name: 'Feint', text: 'C' }], 'Intro');
    expect(subclassParts(e)).toEqual({
      parent: 'Fighter', label: 'Martial Archetype', name: 'Duelist', intro: 'Intro', introLevel: 3,
      features: [{ level: 3, name: 'Riposte', text: 'A\nB' }, { level: 7, name: 'Feint', text: 'C' }],
    });
    const lib = buildLibrary([file('srd', srdXml), file(HOMEBREW_ID, upsertEntry(emptyHomebrewXml(), e))]);
    const cv = classView(lookup(lib, 'class', 'Fighter')!.el);
    expect(cv.subclasses.sort()).toEqual(['Champion', 'Duelist']);
    expect(cv.hd).toBe(10);
  });
});

describe('the homebrew file', () => {
  it('adds, renames, replaces and removes entries', () => {
    const spell = TEMPLATES.spell[2].make({ name: 'Mend Flesh' });
    let xml = upsertEntry(emptyHomebrewXml(), spell);
    xml = upsertEntry(xml, TEMPLATES.item[4].make({ name: 'Tonic' }));
    expect(homebrewEntries(xml).map((x) => [x.kind, x.name])).toEqual([['spell', 'Mend Flesh'], ['item', 'Tonic']]);
    const renamed = TEMPLATES.spell[2].make({ name: 'Mend Wounds' });
    xml = upsertEntry(xml, renamed, 'Mend Flesh');
    expect(homebrewEntries(xml).map((x) => x.name)).toEqual(['Mend Wounds', 'Tonic']);
    xml = removeEntry(xml, 'item', 'Tonic');
    expect(homebrewEntries(xml).map((x) => x.name)).toEqual(['Mend Wounds']);
    const lib = buildLibrary([file(HOMEBREW_ID, xml)]);
    expect(lib.warnings).toEqual([]);
    expect(lookup(lib, 'spell', 'Mend Wounds')).toBeTruthy();
  });

  it('rejects entries without a name', () => {
    const e = blankEntry('feat', { name: '' });
    expect(validateEntry(e)).toEqual(['Give it a name.']);
    const kinds: CreatorKind[] = ['spell'];
    expect(kinds).toHaveLength(1);
    expect(serializeXml({ prolog: [], root: e, epilog: [] })).toContain('<feat>');
  });
});
