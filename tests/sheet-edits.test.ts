// Hand edits on the sheet: spellcasting settings, Armor Class and Initiative, and XML round trips.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CompendiumFile, buildLibrary, lookup } from '../src/model/compendium';
import { Character, emptyAppState } from '../src/model/character';
import { castingSettings, setCastingSettings } from '../src/model/casting';
import { adjustmentOf, setAdjustment } from '../src/model/adjustments';
import { defaultOptions, deriveSheet } from '../src/rules/derive';
import { applyLevelUp } from '../src/rules/level';

const srdXml = readFileSync(new URL('../src/srd/srd-sample.xml', import.meta.url), 'utf8');
const lib = buildLibrary([{ id: 'srd', fileName: 'srd.xml', xml: srdXml, importedAt: 0, enabled: true } as CompendiumFile]);
const make = (cls: string) => {
  const c = Character.create('T');
  c.abilities = { strength: 10, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 12, charisma: 8 };
  const ce = applyLevelUp(c, { newClass: lookup(lib, 'class', cls)!.el, hp: { method: 'max' } }, () => 1);
  return { c, ce, sheet: () => deriveSheet(c, emptyAppState(), defaultOptions) };
};

describe('spellcasting settings', () => {
  it('changes the ability, bonuses and limits of a casting class', () => {
    const { c, ce, sheet } = make('Wizard');
    const before = sheet().spellcasting[0];
    expect(before).toMatchObject({ ability: 'intelligence', dc: 13, attack: 5 });
    setCastingSettings(ce, { ...castingSettings(ce), ability: 'wisdom', dcBonus: 2, attackBonus: 1, spellsMax: 9, cantripsMax: 5 });
    const after = deriveSheet(Character.parse(c.serialize()), emptyAppState(), defaultOptions).spellcasting[0];
    expect(after).toMatchObject({ ability: 'wisdom', dc: 8 + 2 + 1 + 2, attack: 2 + 1 + 1, cantrips: 5 });
    expect(after.limit).toMatchObject({ max: 9, source: 'custom' });
    // Clearing the limits brings back the class rules.
    setCastingSettings(ce, { ability: 'intelligence', dcBonus: 0, attackBonus: 0, spellsMax: null, cantripsMax: null, enabled: false });
    expect(sheet().spellcasting[0]).toMatchObject({ dc: 13, cantrips: before.cantrips });
    expect(c.serialize()).not.toMatch(/spellDcBonus|cantripsMax|preparedMax|customCasting/);
  });

  it('can show a class without spell slots as a spellcaster', () => {
    const { ce, sheet } = make('Fighter');
    expect(sheet().spellcasting).toEqual([]);
    setCastingSettings(ce, { ...castingSettings(ce), ability: 'intelligence', enabled: true, cantripsMax: 2 });
    const s = sheet();
    expect(s.spellcasting[0]).toMatchObject({ className: 'Fighter', ability: 'intelligence', kind: 'none', cantrips: 2, dc: 8 + 2 + 3 });
    expect(s.slots.slice(1).every((v) => v === 0)).toBe(true);
  });
});

describe('Armor Class and Initiative edits', () => {
  it('sets or adds to the calculated value, and survives export', () => {
    const { c, sheet } = make('Fighter');
    expect(sheet().ac).toBe(12);
    setAdjustment(c.ch, 'ac', { set: 17, bonus: 1 }, (e) => { c.insert(e); });
    setAdjustment(c.ch, 'initiative', { set: null, bonus: 3 }, (e) => { c.insert(e); });
    const again = Character.parse(c.serialize());
    const s = deriveSheet(again, emptyAppState(), defaultOptions);
    expect(s.ac).toBe(18);
    expect(s.acNotes).toContain('Set by hand to 17 (calculated 12)');
    expect(s.initiative).toBe(2 + 3);
    expect(adjustmentOf(again.ch, 'initiative')).toEqual({ set: null, bonus: 3 });
    setAdjustment(c.ch, 'ac', { set: null, bonus: 0 }, (e) => { c.insert(e); });
    setAdjustment(c.ch, 'initiative', { set: null, bonus: 0 }, (e) => { c.insert(e); });
    expect(c.serialize()).not.toContain('<adjustments');
    expect(sheet().ac).toBe(12);
  });
});
