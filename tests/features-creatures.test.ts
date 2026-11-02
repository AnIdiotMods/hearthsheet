import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildLibrary, lookup } from '../src/model/compendium';
import {
  Character, addClassFeat, addCustomClassFeat, classFeatNames, classFeats, emptyAppState, featModifiers, setEquipped, updateFeat,
} from '../src/model/character';
import {
  addBlockEntry, blankCreature, blockEntries, creatureFromMonster, damageCreature, healCreature, hitDiceOf, hpCurrentOf,
  hpMaxOf, hpTempOf, parseBonusList, setHp, setHpTemp, sumExpression, updateBlockEntry,
} from '../src/model/creature';
import { defaultOptions, deriveSheet } from '../src/rules/derive';
import { resolveFormula } from '../src/rules/dice';
import { canonical, childText, elements, parseXml, removeChild } from '../src/xml/xml';

const srd = buildLibrary([{ id: 's', fileName: 's.xml', xml: readFileSync(new URL('../src/srd/srd-sample.xml', import.meta.url), 'utf8'), importedAt: 0, enabled: true }]);
const sample = readFileSync(new URL('./fixtures/sample-character.xml', import.meta.url), 'utf8');
const opts = { ...defaultOptions, classLookup: (n: string) => lookup(srd, 'class', n)?.el };

describe('editing class features', () => {
  it('custom features carry modifiers that change the sheet', () => {
    const c = Character.parse(sample);
    const ce = c.classes[0];
    const before = deriveSheet(c, emptyAppState(), opts);
    addCustomClassFeat(ce, 'Blessing of Speed', 'Your speed increases.', [{ category: 'bonus', text: 'speed +10' }, { category: 'skill', text: 'stealth +2' }]);
    const after = deriveSheet(c, emptyAppState(), opts);
    expect(after.speed).toBe(before.speed + 10);
    expect(after.skills.find((s) => s.name === 'Stealth')!.bonus).toBe(before.skills.find((s) => s.name === 'Stealth')!.bonus + 2);
    expect(after.features.map((f) => f.name)).toContain('Blessing of Speed');
    // Same compiled shape as the app's own features, and it survives a save/load cycle.
    const fe = classFeats(ce).find((f) => f.name === 'Blessing of Speed')!.el;
    expect(elements(fe).map((x) => x.name)).toEqual(['name', 'text', 'modifier', 'modifier', 'expanded']);
    expect(deriveSheet(Character.parse(c.serialize()), emptyAppState(), opts).speed).toBe(after.speed);
  });

  it('edits a feature in place and keeps children it does not edit', () => {
    const c = Character.parse(sample);
    const fe = classFeats(c.classes[0]).find((f) => f.name === 'Second Wind')!.el;
    fe.children.push({ type: 'el', name: 'roll', attrs: [['description', 'Healing']], children: [{ type: 'text', value: '1d10+%7' }] });
    updateFeat(fe, { name: 'Second Wind (homebrew)', text: 'Regain 1d10 + level hit points.', modifiers: [{ category: 'bonus', text: 'ac +1' }] });
    expect(childText(fe, 'name')).toBe('Second Wind (homebrew)');
    expect(childText(fe, 'text')).toBe('Regain 1d10 + level hit points.');
    expect(featModifiers(fe)).toEqual([{ category: 'bonus', text: 'ac +1' }]);
    expect(elements(fe, 'roll').length).toBe(1);
    expect(deriveSheet(c, emptyAppState(), opts).ac).toBe(20);
    updateFeat(fe, { modifiers: [] });
    expect(elements(fe, 'modifier').length).toBe(0);
  });

  it('removing features is respected, even when the list becomes empty', () => {
    const c = Character.parse(sample);
    const ce = c.classes[0];
    for (const f of classFeats(ce)) removeChild(ce, f.el);
    const s = deriveSheet(c, emptyAppState(), opts);
    expect(s.features.filter((f) => f.source === 'Fighter')).toEqual([]);
    expect(s.ac).toBe(18); // Defense style removed
    addClassFeat(ce, deriveSheetProgression(c).find((f) => f.name === 'Fighting Style: Defense')!);
    expect(deriveSheet(c, emptyAppState(), opts).ac).toBe(19);
    expect(classFeatNames(ce)).toEqual(['Fighting Style: Defense']);
  });

  it('features from a higher level or another option can be added', () => {
    const c = Character.parse(sample);
    const ce = c.classes[0];
    const prog = deriveSheetProgression(c);
    addClassFeat(ce, prog.find((f) => f.name === 'Extra Attack')!);
    addClassFeat(ce, prog.find((f) => f.name === 'Fighting Style: Dueling')!);
    expect(classFeatNames(ce)).toEqual(expect.arrayContaining(['Extra Attack', 'Fighting Style: Dueling']));
    const s = deriveSheet(c, emptyAppState(), opts);
    expect(s.attacks[0].damage).toBe('1d8+5'); // Dueling +2 with a one-handed weapon
  });
});

function deriveSheetProgression(c: Character) {
  // The class's own embedded progression.
  return elements(c.classes[0], 'autolevel').flatMap((al) => elements(al, 'feat').map((f) => ({
    name: childText(f, 'name'), text: childText(f, 'text'), optional: childText(f, 'optional') === '1', level: parseInt(childText(al, 'level') || '1', 10),
    modifiers: [], special: '', proficiencies: [], rolls: [], subclass: '', el: f,
  })));
}

describe('creatures', () => {
  it('copies a compendium monster with its stat block and current HP', () => {
    const cr = creatureFromMonster(lookup(srd, 'monster', 'Goblin')!.el, 'Pet');
    expect(cr.name).toBe('companion');
    expect(childText(cr, 'role')).toBe('Pet');
    expect(hpMaxOf(cr)).toBe(7);
    expect(hitDiceOf(cr)).toBe('2d6');
    expect(hpCurrentOf(cr)).toBe(7);
    expect(blockEntries(cr, 'action').map((b) => [b.name, b.attackBonus, b.attackDamage])).toEqual([['Scimitar', '4', '1d6+2'], ['Shortbow', '4', '1d6+2']]);
    // The compendium entry itself is not changed.
    expect(lookup(srd, 'monster', 'Goblin')!.el.name).toBe('monster');
  });

  it('tracks damage, temporary HP and healing', () => {
    const cr = blankCreature('Wolf');
    setHp(cr, 11, '2d8+2');
    healCreature(cr, 100);
    expect(childText(cr, 'hp')).toBe('11 (2d8+2)');
    setHpTemp(cr, 3);
    damageCreature(cr, 5);
    expect(hpTempOf(cr)).toBe(0);
    expect(hpCurrentOf(cr)).toBe(9);
    damageCreature(cr, 50);
    expect(hpCurrentOf(cr)).toBe(0);
    healCreature(cr, 4);
    expect(hpCurrentOf(cr)).toBe(4);
  });

  it('edits actions, including attack formulas that use the owner\'s numbers', () => {
    const cr = blankCreature('Spirit');
    const a = addBlockEntry(cr, 'action', 'Slam');
    updateBlockEntry(a, { attackBonus: 'SPELL+PROF', attackDamage: '1d8+3+SPELL', text: 'Melee attack.' });
    expect(childText(a, 'attack')).toBe('Slam|SPELL+PROF|1d8+3+SPELL');
    const ctx = { abilityMods: [0, 0, 0, 3, 0, 0], spellMod: 3, prof: 2, level: 3, hpCurrent: 10 };
    expect(sumExpression(resolveFormula('SPELL+PROF', ctx))).toBe(5);
    expect(resolveFormula('1d8+3+SPELL', ctx)).toBe('1d8+3+3');
    expect(sumExpression('+4')).toBe(4);
    updateBlockEntry(a, { name: 'Smash' });
    expect(childText(a, 'name')).toBe('Smash');
    // Renaming keeps the attack label in step on the next attack edit.
    updateBlockEntry(a, { attackBonus: '5' });
    expect(childText(a, 'attack')).toBe('Smash|5|1d8+3+SPELL');
  });

  it('parses save and skill lists', () => {
    expect(parseBonusList('Dex +3, Con +5, Wis -1')).toEqual([['Dex', 3], ['Con', 5], ['Wis', -1]]);
    expect(parseBonusList('Perception +3, Stealth +4')).toEqual([['Perception', 3], ['Stealth', 4]]);
  });

  it('are stored in the character file and survive a round trip untouched', () => {
    const c = Character.parse(sample);
    const cr = c.addCreature(creatureFromMonster(lookup(srd, 'monster', 'Goblin')!.el, 'Hireling'));
    damageCreature(cr, 2);
    setEquipped(c.items[0], true);
    const xml = c.serialize();
    const again = Character.parse(xml);
    expect(again.creatures.length).toBe(1);
    expect(hpCurrentOf(again.creatures[0])).toBe(5);
    expect(canonical(again.creatures[0])).toEqual(canonical(cr));
    // Placed after the character's own data, and the sheet is unaffected.
    const tags = elements(again.ch).map((e) => e.name);
    expect(tags.indexOf('companion')).toBeGreaterThan(tags.indexOf('hpCurrent'));
    expect(deriveSheet(again, emptyAppState(), opts).ac).toBe(deriveSheet(Character.parse(sample), emptyAppState(), opts).ac);
    expect(canonical(parseXml(again.serialize()).doc.root)).toEqual(canonical(parseXml(xml).doc.root));
  });
});
