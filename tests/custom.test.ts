import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Character, emptyAppState } from '../src/model/character';
import {
  abilityOptions, customAbilities, newCustomAbility, newCustomSkill, removeCustomAbility, setSkillSetting, skillSetting,
  updateCustomAbility,
} from '../src/model/custom';
import { deriveSheet } from '../src/rules/derive';
import { contrast, mix, readableOn } from '../src/ui/theme';
import { canonical, elements, parseXml } from '../src/xml/xml';

const sample = readFileSync(new URL('./fixtures/sample-character.xml', import.meta.url), 'utf8');
// Sample character: level 1 (prof +2), Str 16, Dex 15, Con 14, Int 13, Wis 11, Cha 9; proficient in Athletics, Insight, Perception, Religion.
const load = () => Character.parse(sample);
const sk = (c: Character, n: string) => deriveSheet(c, emptyAppState()).skills.find((s) => s.name === n)!;

describe('per-skill settings', () => {
  it('changes the ability a standard skill uses', () => {
    const c = load();
    expect(sk(c, 'Intimidation')).toMatchObject({ ability: 'charisma', abilityLabel: 'CHA', bonus: -1 });
    setSkillSetting(c.ch, 'Intimidation', { ability: 'strength' }, (e) => c.insert(e));
    expect(sk(c, 'Intimidation')).toMatchObject({ ability: 'strength', abilityLabel: 'STR', bonus: 3, overridden: true });
  });

  it('overrides proficiency both ways and adds expertise', () => {
    const c = load();
    expect(sk(c, 'Athletics')).toMatchObject({ level: 1, sourceLevel: 1, bonus: 5 });
    setSkillSetting(c.ch, 'Athletics', { prof: 2 }, (e) => c.insert(e));
    expect(sk(c, 'Athletics')).toMatchObject({ level: 2, expertise: true, bonus: 7 });
    setSkillSetting(c.ch, 'Religion', { prof: 0 }, (e) => c.insert(e));
    expect(sk(c, 'Religion')).toMatchObject({ level: 0, proficient: false, bonus: 1 });
    setSkillSetting(c.ch, 'Stealth', { prof: 1, bonus: 1 }, (e) => c.insert(e));
    expect(sk(c, 'Stealth')).toMatchObject({ level: 1, bonus: 2 + 2 + 1, misc: 1 });
  });

  it('passives follow the changed skill', () => {
    const c = load();
    const before = deriveSheet(c, emptyAppState()).passivePerception;
    setSkillSetting(c.ch, 'Perception', { prof: 2 }, (e) => c.insert(e));
    expect(deriveSheet(c, emptyAppState()).passivePerception).toBe(before + 2);
  });

  it('clearing every field removes the setting element', () => {
    const c = load();
    setSkillSetting(c.ch, 'Arcana', { ability: 'wisdom', prof: 1 }, (e) => c.insert(e));
    expect(elements(c.ch, 'skillSetting').length).toBe(1);
    setSkillSetting(c.ch, 'Arcana', { ability: null, prof: null, bonus: 0 }, (e) => c.insert(e));
    expect(elements(c.ch, 'skillSetting').length).toBe(0);
    expect(skillSetting(c.ch, 'Arcana')).toBeNull();
  });
});

describe('custom ability scores and skills', () => {
  it('custom abilities get a modifier and a save', () => {
    const c = load();
    c.insert(newCustomAbility(c.ch, { name: 'Sanity', abbr: 'SAN', score: 14, saveProf: true }));
    const s = deriveSheet(c, emptyAppState());
    expect(s.customAbilities).toEqual([expect.objectContaining({ key: 'custom:c1', name: 'Sanity', abbr: 'SAN', score: 14, mod: 2, save: 4 })]);
    expect(abilityOptions(c.ch).map((o) => o.label)).toEqual(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'SAN']);
  });

  it('standard and custom skills can use a custom ability', () => {
    const c = load();
    c.insert(newCustomAbility(c.ch, { name: 'Honor', abbr: 'HON', score: 18, saveProf: false }));
    setSkillSetting(c.ch, 'Persuasion', { ability: 'custom:c1' }, (e) => c.insert(e));
    c.insert(newCustomSkill(c.ch, { name: 'Etiquette', ability: 'custom:c1', prof: 1, bonus: 0 }));
    c.insert(newCustomSkill(c.ch, { name: 'Cooking', ability: 'wisdom', prof: 2, bonus: 1 }));
    expect(sk(c, 'Persuasion')).toMatchObject({ abilityLabel: 'HON', bonus: 4 });
    const s = deriveSheet(c, emptyAppState());
    expect(s.skills.find((x) => x.name === 'Etiquette')).toMatchObject({ custom: true, abilityLabel: 'HON', bonus: 4 + 2 });
    expect(s.skills.find((x) => x.name === 'Cooking')).toMatchObject({ custom: true, expertise: true, bonus: 0 + 4 + 1 });
    updateCustomAbility(customAbilities(c.ch)[0].el, { score: 10 });
    expect(sk(c, 'Persuasion').bonus).toBe(0);
  });

  it('removing a custom ability sends its skills back to normal', () => {
    const c = load();
    c.insert(newCustomAbility(c.ch, { name: 'Honor', abbr: 'HON', score: 18, saveProf: false }));
    setSkillSetting(c.ch, 'Persuasion', { ability: 'custom:c1' }, (e) => c.insert(e));
    c.insert(newCustomSkill(c.ch, { name: 'Etiquette', ability: 'custom:c1', prof: 1, bonus: 0 }));
    removeCustomAbility(c.ch, customAbilities(c.ch)[0]);
    const s = deriveSheet(c, emptyAppState());
    expect(s.customAbilities).toEqual([]);
    expect(s.skills.find((x) => x.name === 'Persuasion')).toMatchObject({ ability: 'charisma', overridden: false });
    expect(s.skills.find((x) => x.name === 'Etiquette')).toMatchObject({ ability: 'intelligence' });
  });

  it('everything is saved in the character file', () => {
    const c = load();
    c.insert(newCustomAbility(c.ch, { name: 'Sanity', abbr: 'SAN', score: 12, saveProf: false }));
    c.insert(newCustomSkill(c.ch, { name: 'Cooking', ability: 'custom:c1', prof: 1, bonus: 0 }));
    setSkillSetting(c.ch, 'Intimidation', { ability: 'strength', prof: 2 }, (e) => c.insert(e));
    const again = Character.parse(c.serialize());
    const a = deriveSheet(c, emptyAppState()), b = deriveSheet(again, emptyAppState());
    expect(b.skills.map((x) => [x.name, x.bonus, x.abilityLabel])).toEqual(a.skills.map((x) => [x.name, x.bonus, x.abilityLabel]));
    expect(canonical(parseXml(again.serialize()).doc.root)).toEqual(canonical(parseXml(c.serialize()).doc.root));
    const tags = elements(again.ch).map((e) => e.name);
    expect(tags.indexOf('customAbility')).toBeGreaterThan(tags.indexOf('hpCurrent'));
  });
});

describe('theme colors', () => {
  it('computes contrast and readable button text', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(readableOn('#8a3b2a')).toBe('#ffffff');
    expect(readableOn('#f0e060')).toBe('#111111');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
