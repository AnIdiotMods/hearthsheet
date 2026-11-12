import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildLibrary, classView, lookup } from '../src/model/compendium';
import { Character, emptyAppState, setPrepared } from '../src/model/character';
import { deriveSheet } from '../src/rules/derive';
import { applyLevelUp } from '../src/rules/level';
import { baseClassName, preparedFormula, setCustomLimit, spellLimit } from '../src/rules/spellcount';
import { parseXml } from '../src/xml/xml';

const srd = buildLibrary([{ id: 's', fileName: 's', xml: readFileSync(new URL('../src/srd/srd-sample.xml', import.meta.url), 'utf8'), importedAt: 0, enabled: true }]);
const mods = { strength: 0, dexterity: 2, constitution: 1, intelligence: 3, wisdom: 2, charisma: 4 };
const cls = (xml: string) => parseXml(xml).doc.root;

describe('prepared and known spell limits', () => {
  it('reads the 2014 formula from the class text', () => {
    expect(preparedFormula([{ name: 'Spellcasting', text: 'When you do so, choose a number of cleric spells equal to your Wisdom modifier + your cleric level (minimum of one spell).' }]))
      .toEqual({ ability: 'wisdom', half: null });
    expect(preparedFormula([{ name: 'Spellcasting', text: 'You prepare the list... choose a number of paladin spells equal to your Charisma modifier + half your paladin level, rounded down (minimum of one spell).' }]))
      .toEqual({ ability: 'charisma', half: 'down' });
    expect(preparedFormula([{ name: 'Hex Warrior', text: 'equal to your Charisma modifier + your warlock level' }])).toBeNull();
  });

  it('Wizard 5 with Intelligence 16 prepares 8, counting only ticked spells', () => {
    const c = Character.create('W');
    c.abilities = { strength: 8, dexterity: 14, constitution: 13, intelligence: 16, wisdom: 12, charisma: 10 };
    let ce = applyLevelUp(c, { newClass: lookup(srd, 'class', 'Wizard')!.el, hp: { method: 'max' } }, () => 1);
    for (let i = 0; i < 4; i++) ce = applyLevelUp(c, { existing: ce, hp: { method: 'average' } }, () => 1);
    const mm = c.addSpell(ce, lookup(srd, 'spell', 'Magic Missile')!.el);
    c.addSpell(ce, lookup(srd, 'spell', 'Shield')!.el);
    c.addSpell(ce, lookup(srd, 'spell', 'Fire Bolt')!.el);
    setPrepared(mm, true);
    const sc = deriveSheet(c, emptyAppState()).spellcasting[0];
    expect(sc.limit).toMatchObject({ mode: 'prepared', max: 8, count: 1, cantrips: 1, source: 'table' });
    expect(sc.cantrips).toBe(4);
    setCustomLimit(ce, 10);
    expect(deriveSheet(c, emptyAppState()).spellcasting[0].limit).toMatchObject({ max: 10, source: 'custom' });
    setCustomLimit(ce, null);
    expect(deriveSheet(c, emptyAppState()).spellcasting[0].limit.max).toBe(8);
  });

  it('known casters count every spell, using the standard tables', () => {
    const sorc = cls('<class><name>Sorcerer</name><spell><name>A</name><level>1</level></spell><spell><name>B</name><level>2</level></spell><spell><name>C</name></spell></class>');
    const r = spellLimit({ ce: sorc, className: 'Sorcerer', level: 3, features: [], activeNames: [], mods, casterKind: 'full' });
    expect(r).toMatchObject({ mode: 'known', max: 4, count: 2, cantrips: 1 });
    expect(spellLimit({ ce: cls('<class/>'), className: 'Warlock [5.5e]', level: 5, features: [], activeNames: [], mods, casterKind: 'pact' }))
      .toMatchObject({ mode: 'known', max: 6, basis: 'standard 2024 Warlock table' });
    expect(spellLimit({ ce: cls('<class/>'), className: 'Cleric [5.5e]', level: 5, features: [], activeNames: [], mods, casterKind: 'full' }).max).toBe(9);
    expect(spellLimit({ ce: cls('<class/>'), className: 'Fighter', level: 7, features: [], activeNames: ['Spellcasting (Eldritch Knight)'], mods, casterKind: 'third' }).max).toBe(5);
    expect(spellLimit({ ce: cls('<class/>'), className: 'Artisan (HB)', level: 7, features: [], activeNames: [], mods, casterKind: 'full' }).max).toBeNull();
  });

  it('2014 paladins and clerics use the formula; 2024 files use the table', () => {
    const pal = classView(cls(`<class><name>Paladin</name><autolevel level="2"><feature><name>Spellcasting</name><text>You prepare the list of paladin spells. Choose a number of paladin spells equal to your Charisma modifier + half your paladin level, rounded down (minimum of one spell).</text></feature></autolevel></class>`));
    expect(spellLimit({ ce: cls('<class/>'), className: 'Paladin', level: 5, features: pal.features, activeNames: [], mods, casterKind: 'half' }))
      .toMatchObject({ mode: 'prepared', max: 6, source: 'formula' });
    expect(spellLimit({ ce: cls('<class/>'), className: 'Paladin [5.5e]', level: 5, features: pal.features, activeNames: [], mods, casterKind: 'half' }).max).toBe(6);
    expect(baseClassName('Cleric [5.5e]')).toBe('cleric');
  });
});

describe('prepared spells stated in a homebrew class', () => {
  it('reads a "Prepared Spells:" line with one number per level', async () => {
    const { preparedTable } = await import('../src/rules/spellcount');
    const nums = Array.from({ length: 20 }, (_, i) => i + 4).join(', ');
    expect(preparedTable([{ name: 'Spellcasting', text: `You prepare spells.\nPrepared Spells: ${nums}` }])?.slice(0, 3)).toEqual([4, 5, 6]);
    expect(preparedTable([{ name: 'Spellcasting', text: 'Prepared Spells: 4, 5' }])).toBeNull();
  });
});

