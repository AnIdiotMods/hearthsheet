// Creatures that belong to a character: pets, familiars, summons, mounts,
// hirelings, wild shapes and so on.
//
// Each creature is a <companion> element inside <character>, holding the
// same children as a compendium <monster> (name, size, ac, hp, str..cha,
// trait, action, ...) plus its current state (role, hpCurrent, hpTemp,
// notes). This is a Hearthsheet extension: the official apps have no known
// equivalent and are expected to ignore it.

import { XElement, child, childText, cloneEl, el, elements, removeChild, setChildText, stripWhitespace, textOf } from '../xml/xml';
import { ABILITIES } from './terms';

export const CREATURE_TAG = 'companion';
export const CREATURE_ROLES = ['Pet', 'Familiar', 'Summon', 'Mount', 'Companion', 'Hireling', 'Wild Shape', 'Other'];
export const BLOCK_TAGS = ['trait', 'action', 'bonus', 'reaction', 'legendary'] as const;
export type BlockTag = (typeof BLOCK_TAGS)[number];
export const BLOCK_LABEL: Record<BlockTag, string> = {
  trait: 'Traits', action: 'Actions', bonus: 'Bonus actions', reaction: 'Reactions', legendary: 'Legendary actions',
};
export const ABILITY_TAGS = ABILITIES.map((a) => a.slice(0, 3));

// Order of the stat block fields, as in compendium <monster> entries.
const ORDER = ['name', 'role', 'size', 'type', 'alignment', 'ac', 'hp', 'hpCurrent', 'hpTemp', 'speed', ...ABILITY_TAGS,
  'save', 'skill', 'resist', 'vulnerable', 'immune', 'conditionImmune', 'senses', 'passive', 'languages', 'cr',
  ...BLOCK_TAGS, 'spells', 'slots', 'description', 'notes'];

function setOrdered(e: XElement, tag: string, value: string) {
  const existing = child(e, tag);
  if (!value) { if (existing) removeChild(e, existing); return; }
  if (existing) { existing.children = [{ type: 'text', value }]; return; }
  const rank = ORDER.indexOf(tag);
  const at = e.children.findIndex((c) => c.type === 'el' && ORDER.indexOf(c.name) > rank);
  const fresh = el(tag, value);
  if (rank >= 0 && at >= 0) e.children.splice(at, 0, fresh);
  else e.children.push(fresh);
}

/** Copy a compendium monster as a new creature. */
export function creatureFromMonster(src: XElement, role = 'Pet'): XElement {
  const e = stripWhitespace(cloneEl(src));
  e.name = CREATURE_TAG;
  setOrdered(e, 'role', role);
  setOrdered(e, 'hpCurrent', String(hpMaxOf(e)));
  return e;
}

export function blankCreature(name: string, role = 'Pet'): XElement {
  const e = el(CREATURE_TAG);
  e.children.push(el('name', name), el('role', role), el('size', 'S'), el('type', 'beast'), el('ac', '10'),
    el('hp', '1'), el('hpCurrent', '1'), el('speed', '30 ft.'));
  for (const a of ABILITY_TAGS) e.children.push(el(a, '10'));
  return e;
}

/** "13 (3d8)" → 13 */
export function hpMaxOf(e: XElement): number {
  const n = parseInt(childText(e, 'hp'), 10);
  return Number.isFinite(n) ? n : 0;
}
/** "13 (3d8)" → "3d8" */
export function hitDiceOf(e: XElement): string {
  const m = /\(([^)]*)\)/.exec(childText(e, 'hp'));
  return m ? m[1].trim() : '';
}
export function setHp(e: XElement, max: number, dice: string) {
  setOrdered(e, 'hp', `${Math.max(0, Math.round(max))}${dice.trim() ? ` (${dice.trim()})` : ''}`);
}

export const creatureRole = (e: XElement) => childText(e, 'role') || 'Other';
export function hpCurrentOf(e: XElement): number {
  const n = parseInt(childText(e, 'hpCurrent'), 10);
  return Number.isFinite(n) ? n : hpMaxOf(e);
}
export const hpTempOf = (e: XElement) => parseInt(childText(e, 'hpTemp'), 10) || 0;
export const setHpCurrent = (e: XElement, v: number) => setOrdered(e, 'hpCurrent', String(Math.round(v)));
export const setHpTemp = (e: XElement, v: number) => setOrdered(e, 'hpTemp', v > 0 ? String(Math.round(v)) : '');
export const creatureNotes = (e: XElement) => childText(e, 'notes');

/** Set a plain stat block field (name, ac, speed, str, save, senses, ...). */
export const setField = (e: XElement, tag: string, value: string) => setOrdered(e, tag, value);

/** Damage goes to temporary hit points first. */
export function damageCreature(e: XElement, amount: number) {
  let d = amount;
  const t = Math.min(hpTempOf(e), d);
  setHpTemp(e, hpTempOf(e) - t);
  d -= t;
  setHpCurrent(e, Math.max(0, hpCurrentOf(e) - d));
}
export function healCreature(e: XElement, amount: number) {
  setHpCurrent(e, Math.min(hpMaxOf(e), Math.max(0, hpCurrentOf(e)) + amount));
}

// ---- traits, actions, reactions ...

export interface BlockEntry { name: string; text: string; attackBonus: string; attackDamage: string; recharge: string; el: XElement }

export function blockEntries(e: XElement, tag: BlockTag): BlockEntry[] {
  return elements(e, tag).map((b) => {
    const attack = childText(b, 'attack').split('|');
    return {
      name: childText(b, 'name'), text: elements(b, 'text').map(textOf).join('\n'),
      attackBonus: (attack[1] ?? '').trim(), attackDamage: (attack[2] ?? '').trim(), recharge: childText(b, 'recharge'), el: b,
    };
  });
}

export function addBlockEntry(e: XElement, tag: BlockTag, name: string): XElement {
  const b = el(tag);
  b.children.push(el('name', name), el('text', ''));
  const rank = ORDER.indexOf(tag);
  const at = e.children.findIndex((c) => c.type === 'el' && ORDER.indexOf(c.name) > rank);
  if (at >= 0) e.children.splice(at, 0, b);
  else e.children.push(b);
  return b;
}

export function updateBlockEntry(b: XElement, patch: Partial<Pick<BlockEntry, 'name' | 'text' | 'attackBonus' | 'attackDamage' | 'recharge'>>) {
  if (patch.name !== undefined) setChildText(b, 'name', patch.name);
  if (patch.text !== undefined) {
    const texts = elements(b, 'text');
    for (const t of texts.slice(1)) removeChild(b, t);
    if (texts[0]) texts[0].children = patch.text ? [{ type: 'text', value: patch.text }] : [];
    else b.children.push(el('text', patch.text));
  }
  if (patch.recharge !== undefined) setChildText(b, 'recharge', patch.recharge);
  if (patch.attackBonus !== undefined || patch.attackDamage !== undefined) {
    const cur = childText(b, 'attack').split('|');
    const bonus = patch.attackBonus ?? (cur[1] ?? '').trim();
    const damage = patch.attackDamage ?? (cur[2] ?? '').trim();
    const name = childText(b, 'name');
    setChildText(b, 'attack', bonus || damage ? `${name}|${bonus}|${damage}` : '');
  }
}

/** "Dex +3, Con +5" → [["Dex", 3], ["Con", 5]]; also used for skills ("Perception +4"). */
export function parseBonusList(s: string): [string, number][] {
  return s.split(',').map((x) => x.trim()).filter(Boolean).flatMap((part) => {
    const m = /^(.+?)\s*([+-]\s*\d+)$/.exec(part);
    return m ? [[m[1].trim(), parseInt(m[2].replace(/\s+/g, ''), 10)] as [string, number]] : [];
  });
}

/** Evaluate a resolved bonus such as "3+4" or "+5". */
export function sumExpression(s: string): number | null {
  const t = s.replace(/\s+/g, '');
  if (!/^[+-]?\d+([+-]\d+)*$/.test(t)) return null;
  return (t.match(/[+-]?\d+/g) ?? []).reduce((a, b) => a + parseInt(b, 10), 0);
}
