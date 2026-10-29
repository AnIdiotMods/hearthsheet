import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildLibrary, classView, lookup, subclassNames, CompendiumFile } from '../src/model/compendium';
import { Character, emptyAppState, setEquipped } from '../src/model/character';
import { casterKind, deriveSheet, multiclassSlots, defaultOptions } from '../src/rules/derive';
import { applyLevelUp } from '../src/rules/level';
import { roll } from '../src/rules/dice';
import { canonical, parseXml, serializeXml } from '../src/xml/xml';

const srdXml = readFileSync(new URL('../src/srd/srd-sample.xml', import.meta.url), 'utf8');
const file = (id: string, xml: string): CompendiumFile => ({ id, fileName: `${id}.xml`, xml, importedAt: 0, enabled: true });
const lib = buildLibrary([file('srd', srdXml)]);
const get = (k: Parameters<typeof lookup>[1], n: string) => lookup(lib, k, n)!.el;
const avg = () => { throw new Error('should not roll'); };

function build(race: string, cls: string, levels: number, scores: number[], opts: { subclass?: string; choices?: string[] } = {}) {
  const c = Character.create('Test');
  c.setRace(get('race', race));
  c.abilities = { strength: scores[0], dexterity: scores[1], constitution: scores[2], intelligence: scores[3], wisdom: scores[4], charisma: scores[5] };
  let ce = applyLevelUp(c, { newClass: get('class', cls), hp: { method: 'average' }, choices: opts.choices }, avg);
  for (let i = 1; i < levels; i++) {
    ce = applyLevelUp(c, { existing: ce, hp: { method: 'average' }, subclass: i === 2 ? opts.subclass : undefined }, avg);
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
    const a = parseXml(srdXml).doc;
    expect(serializeXml(a)).toBe(srdXml.replace(/^﻿/, ''));
  });
  it('detects subclasses but not fighting styles', () => {
    expect(subclassNames(classView(get('class', 'Fighter')).features)).toEqual(['Champion']);
    expect(subclassNames(classView(get('class', 'Wizard')).features)).toEqual(['School of Evocation']);
  });
});

describe('merging', () => {
  it('later files replace same-named entries (case-insensitive) and warn', () => {
    const extra = '<compendium><spell><name>fire bolt</name><level>0</level><text>homebrew</text></spell></compendium>';
    const merged = buildLibrary([file('srd', srdXml), file('hb', extra)]);
    expect(lookup(merged, 'spell', 'Fire Bolt')!.fileId).toBe('hb');
    expect(merged.warnings.some((w) => w.message.includes('replaces'))).toBe(true);
    expect(merged.byKind.spell.length).toBe(6);
  });
  it('keeps unknown top-level elements', () => {
    const merged = buildLibrary([file('x', '<compendium><vehicle><name>Cart</name></vehicle></compendium>')]);
    expect(merged.others.length).toBe(1);
  });
});

describe('derived stats: Human Fighter 5 (standard array)', () => {
  const c = build('Human', 'Fighter', 5, [15, 14, 13, 12, 10, 8], { subclass: 'Champion', choices: ['Fighting Style: Defense'] });
  for (const n of ['Chain Mail', 'Shield', 'Longsword']) setEquipped(c.addItem(get('item', n)), true);
  const s = deriveSheet(c, emptyAppState());
  it('scores, proficiency, saves', () => {
    expect(s.scores).toMatchObject({ strength: 16, dexterity: 15, constitution: 14, charisma: 9 });
    expect(s.prof).toBe(3);
    expect(s.saves.find((x) => x.ability === 'strength')!.bonus).toBe(6);
    expect(s.saves.find((x) => x.ability === 'constitution')!.bonus).toBe(5);
    expect(s.saves.find((x) => x.ability === 'dexterity')!.bonus).toBe(2);
  });
  it('AC: chain mail 16 + shield 2 + Defense 1', () => expect(s.ac).toBe(19));
  it('HP: 10+2 at 1st, then 6+2 per level', () => expect(s.hpMax).toBe(44));
  it('longsword attack and damage', () => {
    const a = s.attacks.find((x) => x.name === 'Longsword')!;
    expect(a.bonus).toBe(6);
    expect(a.damage).toBe('1d8+3');
    expect(a.versatile).toBe('1d10+3');
  });
  it('subclass and counters', () => {
    expect(s.features.map((f) => f.name)).toContain('Improved Critical (Champion)');
    expect(s.features.map((f) => f.name)).not.toContain('Fighting Style: Dueling');
    expect(s.counters.map((x) => x.name).sort()).toEqual(['Action Surge', 'Second Wind']);
  });
  it('initiative, speed, no spellcasting', () => {
    expect(s.initiative).toBe(2);
    expect(s.speed).toBe(30);
    expect(s.spellcasting).toEqual([]);
  });
});

describe('derived stats: High Elf Wizard 5', () => {
  const c = build('Elf (High)', 'Wizard', 5, [8, 14, 13, 15, 12, 10]);
  const s = deriveSheet(c, emptyAppState());
  it('spell DC, attack and slots', () => {
    expect(s.spellcasting[0]).toMatchObject({ ability: 'intelligence', dc: 14, attack: 6, cantrips: 4, kind: 'full' });
    expect(s.slots.slice(1, 5)).toEqual([4, 3, 2, 0]);
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
    expect(deriveSheet(c, emptyAppState()).ac).toBe(13);
    ring.children.push({ type: 'el', name: 'attuned', attrs: [], children: [{ type: 'text', value: 'YES' }] });
    const s2 = deriveSheet(c, emptyAppState());
    expect(s2.ac).toBe(14);
    expect(s2.saves.find((x) => x.ability === 'intelligence')!.bonus).toBe(3 + 3 + 1);
  });
});

describe('multiclass spellcasting', () => {
  const half = parseXml(`<class><name>Warden</name><hd>10</hd><spellAbility>Wisdom</spellAbility>
    <autolevel level="2"><slots>0,2</slots></autolevel><autolevel level="5"><slots>0,4,2</slots></autolevel>
    <autolevel level="20"><slots>0,4,3,3,3,2</slots></autolevel></class>`).doc.root;
  const pact = parseXml(`<class><name>Pactbound</name><hd>8</hd><spellAbility>Charisma</spellAbility>
    <autolevel level="1"><feature><name>Pact Magic</name><text>.</text></feature><slots>2,1</slots></autolevel>
    <autolevel level="3"><slots>2,0,2</slots></autolevel></class>`).doc.root;
  it('classifies caster kinds from the slot table', () => {
    expect(casterKind(classView(get('class', 'Wizard')))).toBe('full');
    expect(casterKind(classView(half))).toBe('half');
    expect(casterKind(classView(pact))).toBe('pact');
    expect(casterKind(classView(get('class', 'Fighter')))).toBe('none');
  });
  it('uses the multiclass table: Wizard 3 / Warden 5', () => {
    const c = build('Human', 'Wizard', 3, [8, 14, 13, 15, 12, 10]);
    let w = applyLevelUp(c, { newClass: half, hp: { method: 'average' } }, avg);
    for (let i = 1; i < 5; i++) w = applyLevelUp(c, { existing: w, hp: { method: 'average' } }, avg);
    const s14 = deriveSheet(c, emptyAppState());
    expect(s14.slots).toEqual(multiclassSlots(5));
    expect(s14.slots.slice(1, 4)).toEqual([4, 3, 2]);
    const s24 = deriveSheet(c, emptyAppState(), { ...defaultOptions, multiclassRounding: '2024' });
    expect(s24.slots.slice(1, 4)).toEqual([4, 3, 3]);
    expect(s14.saves.find((x) => x.ability === 'intelligence')!.proficient).toBe(true);
    expect(s14.saves.find((x) => x.ability === 'wisdom')!.proficient).toBe(true);
  });
  it('keeps pact slots separate', () => {
    const c = build('Human', 'Wizard', 2, [8, 14, 13, 15, 12, 10]);
    let p = applyLevelUp(c, { newClass: pact, hp: { method: 'average' } }, avg);
    p = applyLevelUp(c, { existing: p, hp: { method: 'average' } }, avg);
    applyLevelUp(c, { existing: p, hp: { method: 'average' } }, avg);
    const s = deriveSheet(c, emptyAppState());
    expect(s.pact).toEqual({ level: 2, count: 2 });
    expect(s.slots.slice(1, 3)).toEqual([3, 0]);
  });
});

describe('character documents', () => {
  it('round-trip and preserve unknown content after edits', () => {
    const src = `<?xml version="1.0" encoding="UTF-8"?>
<pc version="5">
  <character>
    <name>Mira</name>
    <abilities>10,16,12,14,13,8,</abilities>
    <hpMax>9</hpMax>
    <futureField mode="x"><nested>keep me</nested></futureField>
  </character>
</pc>`;
    const c = Character.parse(src);
    expect(c.abilities.dexterity).toBe(16);
    c.hpCurrent = 4;
    const out = c.serialize();
    expect(out).toContain('<futureField mode="x">');
    expect(out).toContain('<nested>keep me</nested>');
    const again = Character.parse(out);
    expect(again.hpCurrent).toBe(4);
    expect(canonical(parseXml(again.serialize()).doc.root)).toEqual(canonical(parseXml(out).doc.root));
  });
  it('splits multi-character files', () => {
    const r = Character.parseAll('<pc><character><name>A</name></character><character><name>B</name></character></pc>');
    expect(r.characters.map((c) => c.name)).toEqual(['A', 'B']);
  });
  it('created characters survive a save/load cycle with identical derived stats', () => {
    const c = build('Dwarf (Hill)', 'Fighter', 3, [15, 14, 13, 12, 10, 8], { subclass: 'Champion' });
    setEquipped(c.addItem(get('item', 'Scale Mail')), true);
    const before = deriveSheet(c, emptyAppState());
    const after = deriveSheet(Character.parse(c.serialize()), emptyAppState());
    expect(after).toEqual(before);
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
