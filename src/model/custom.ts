// Custom ability scores, custom skills and per-skill settings.
//
// Stored inside <character> as Hearthsheet extension elements:
//   <customAbility><id>c1</id><name>Sanity</name><abbr>SAN</abbr><score>12</score><save>1</save></customAbility>
//   <customSkill><id>k1</id><name>Cooking</name><ability>wisdom</ability><prof>1</prof><bonus>0</bonus></customSkill>
//   <skillSetting><name>Intimidation</name><ability>strength</ability><prof>2</prof><bonus>1</bonus></skillSetting>
//
// An ability key is one of the six ability names or "custom:<id>".
// <prof> is 0 (none), 1 (proficient) or 2 (expertise); a skill setting
// without <prof> keeps the proficiency the character gets from its race,
// class, background and feats. Other apps are expected to ignore these.

import { XElement, child, childText, el, elements, setChildText } from '../xml/xml';
import { ABBR, ABILITIES, Ability } from './terms';

export type ProfLevel = 0 | 1 | 2;
export const PROF_LABEL: Record<ProfLevel, string> = { 0: 'Not proficient', 1: 'Proficient', 2: 'Expertise' };

export interface CustomAbility { id: string; name: string; abbr: string; score: number; saveProf: boolean; el: XElement }
export interface CustomSkill { id: string; name: string; ability: string; prof: ProfLevel; bonus: number; el: XElement }
export interface SkillSetting { ability: string | null; prof: ProfLevel | null; bonus: number }

const int = (s: string, d = 0) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : d; };
const profOf = (s: string): ProfLevel | null => (s === '' ? null : (Math.max(0, Math.min(2, int(s))) as ProfLevel));

function nextId(ch: XElement, tag: string, prefix: string): string {
  const used = new Set(elements(ch, tag).map((e) => childText(e, 'id')));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

// ---- custom ability scores

export function customAbilities(ch: XElement): CustomAbility[] {
  return elements(ch, 'customAbility').map((e) => {
    const name = childText(e, 'name') || 'Ability';
    return {
      id: childText(e, 'id'), name, abbr: childText(e, 'abbr') || name.slice(0, 3).toUpperCase(),
      score: int(childText(e, 'score'), 10), saveProf: /^(1|yes|true)$/i.test(childText(e, 'save')), el: e,
    };
  });
}

export function newCustomAbility(ch: XElement, v: { name: string; abbr: string; score: number; saveProf: boolean }): XElement {
  const e = el('customAbility');
  e.children.push(el('id', nextId(ch, 'customAbility', 'c')));
  e.children.push(el('name', v.name), el('abbr', v.abbr), el('score', String(v.score)));
  if (v.saveProf) e.children.push(el('save', '1'));
  return e;
}

export function updateCustomAbility(e: XElement, v: Partial<{ name: string; abbr: string; score: number; saveProf: boolean }>) {
  if (v.name !== undefined) setChildText(e, 'name', v.name);
  if (v.abbr !== undefined) setChildText(e, 'abbr', v.abbr);
  if (v.score !== undefined) setChildText(e, 'score', String(v.score));
  if (v.saveProf !== undefined) setChildText(e, 'save', v.saveProf ? '1' : '');
}

/** Remove a custom ability; skills that used it go back to their default ability. */
export function removeCustomAbility(ch: XElement, ab: CustomAbility) {
  const key = `custom:${ab.id}`;
  ch.children = ch.children.filter((c) => c !== ab.el);
  for (const s of elements(ch, 'customSkill')) if (childText(s, 'ability') === key) setChildText(s, 'ability', 'intelligence');
  for (const s of elements(ch, 'skillSetting')) if (childText(s, 'ability') === key) { setChildText(s, 'ability', ''); pruneSetting(ch, s); }
}

// ---- abilities by key (standard or custom)

export interface AbilityOption { key: string; label: string; name: string }
export function abilityOptions(ch: XElement): AbilityOption[] {
  return [
    ...ABILITIES.map((a) => ({ key: a, label: ABBR[a], name: a[0].toUpperCase() + a.slice(1) })),
    ...customAbilities(ch).map((c) => ({ key: `custom:${c.id}`, label: c.abbr, name: c.name })),
  ];
}
export const isStandardAbility = (key: string): key is Ability => (ABILITIES as readonly string[]).includes(key);

// ---- custom skills

export function customSkills(ch: XElement): CustomSkill[] {
  return elements(ch, 'customSkill').map((e) => ({
    id: childText(e, 'id'), name: childText(e, 'name') || 'Skill', ability: childText(e, 'ability') || 'intelligence',
    prof: profOf(childText(e, 'prof')) ?? 0, bonus: int(childText(e, 'bonus')), el: e,
  }));
}

export function newCustomSkill(ch: XElement, v: { name: string; ability: string; prof: ProfLevel; bonus: number }): XElement {
  const e = el('customSkill');
  e.children.push(el('id', nextId(ch, 'customSkill', 'k')), el('name', v.name), el('ability', v.ability), el('prof', String(v.prof)));
  if (v.bonus) e.children.push(el('bonus', String(v.bonus)));
  return e;
}

export function updateCustomSkill(e: XElement, v: Partial<{ name: string; ability: string; prof: ProfLevel; bonus: number }>) {
  if (v.name !== undefined) setChildText(e, 'name', v.name);
  if (v.ability !== undefined) setChildText(e, 'ability', v.ability);
  if (v.prof !== undefined) setChildText(e, 'prof', String(v.prof));
  if (v.bonus !== undefined) setChildText(e, 'bonus', v.bonus ? String(v.bonus) : '');
}

// ---- settings for the standard skills

const settingEl = (ch: XElement, name: string) =>
  elements(ch, 'skillSetting').find((s) => childText(s, 'name').toLowerCase() === name.toLowerCase());

export function skillSetting(ch: XElement, name: string): SkillSetting | null {
  const s = settingEl(ch, name);
  if (!s) return null;
  return { ability: childText(s, 'ability') || null, prof: profOf(childText(s, 'prof')), bonus: int(childText(s, 'bonus')) };
}

/**
 * Change one standard skill. `null` clears a field back to the default
 * (the skill's usual ability, or the proficiency the character's sources give).
 */
export function setSkillSetting(ch: XElement, name: string, patch: Partial<{ ability: string | null; prof: ProfLevel | null; bonus: number }>,
  insert: (e: XElement) => void) {
  let s = settingEl(ch, name);
  if (!s) { s = el('skillSetting'); s.children.push(el('name', name)); insert(s); }
  if (patch.ability !== undefined) setChildText(s, 'ability', patch.ability ?? '');
  if (patch.prof !== undefined) setChildText(s, 'prof', patch.prof === null ? '' : String(patch.prof));
  if (patch.bonus !== undefined) setChildText(s, 'bonus', patch.bonus ? String(patch.bonus) : '');
  pruneSetting(ch, s);
}

function pruneSetting(ch: XElement, s: XElement) {
  if (!child(s, 'ability') && !child(s, 'prof') && !child(s, 'bonus')) ch.children = ch.children.filter((c) => c !== s);
}
