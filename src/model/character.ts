// Character model, in the format of real character exports:
//
//   <pc version="5">
//     <character>
//       <version>38</version><uid>…</uid><name>…</name>
//       <race><name/><size/><speed/><feat>…</feat><mod>…</mod><proficiency>…</proficiency></race>
//       <class><name/><level/><hd/><hdCurrent/><wealth/><proficiency>…</proficiency><numClassSkills/>
//              <armor/><weapons/><tools/><slots/><slotsCurrent/><feat>…</feat><autolevel>…</autolevel>
//              <spellAbility/><spell>…</spell></class>
//       <background><name/><feat>…</feat><proficiency>…</proficiency></background>
//       <unarmed/><money/><slots/><slotsCurrent/>
//       <item>…</item><container>…</container>
//       <abilities>10,10,10,10,10,10,</abilities><hpMax/><hpCurrent/>
//     </character>
//   </pc>
//
// Compendium entries are "compiled" into this shape when added to a character
// (features become <feat>, names become numeric codes, see codes.ts). The
// document is kept as a tree, so anything this app does not understand is
// preserved and written back unchanged.
//
// Elements written under their compendium names (modifier, strength, stealth,
// range, magic, attuned, prerequisite) carry data the compiled format has no
// known home for; other apps ignore unknown elements.

import {
  XElement, XDocument, appendChild, child, childText, childTexts, cloneEl, el, elements, parseXml, removeChild,
  serializeXml, setChildText, textOf,
} from '../xml/xml';
import {
  ABILITIES, Ability, ClassFeature, Trait, classView, featView, itemView, parseAbility, parseAbilityBonuses, parseSlots,
  proficiencyNames, raceView, spellView, splitList, backgroundView, traitsOf,
} from './compendium';
import {
  SLOT, abilityIndex, damageTypeCode, hdCode, hdDie, itemTypeCode, itemTypeLetters, proficiencyCode, propertyMask,
  schoolCode, sizeCode, yes,
} from './codes';

export const CHARACTER_VERSION = '38';

/** Per-character state that has no place in the file format (kept locally only). */
export interface AppState {
  pactUsed: number;
  countersUsed: Record<string, number>;
  deathSaves: { success: number; failure: number };
  conditions: string[];
  inspiration: boolean;
  exhaustion: number;
  hpTemp: number;
}
export const emptyAppState = (): AppState => ({
  pactUsed: 0, countersUsed: {}, deathSaves: { success: 0, failure: 0 }, conditions: [], inspiration: false,
  exhaustion: 0, hpTemp: 0,
});

export interface CharacterRecord {
  id: string;
  xml: string;
  app: AppState;
  updatedAt: number;
}

const TOP_ORDER = ['version', 'uid', 'name', 'race', 'class', 'background', 'feat', 'unarmed', 'money', 'slots',
  'slotsCurrent', 'item', 'container', 'abilities', 'hpMax', 'hpCurrent', 'xp', 'tracker', 'note', 'companion'];
const CLASS_ORDER = ['id', 'name', 'level', 'hd', 'hdCurrent', 'wealth', 'proficiency', 'numClassSkills', 'armor',
  'weapons', 'tools', 'slots', 'slotsCurrent', 'feat', 'autolevel', 'spellAbility', 'spell'];

/** Insert `e` after the last sibling whose tag ranks at or before it. */
function insertOrdered(parent: XElement, e: XElement, order: string[]) {
  const rank = order.indexOf(e.name);
  if (rank < 0) { appendChild(parent, e); return e; }
  let at = -1;
  parent.children.forEach((c, i) => {
    if (c.type === 'el') { const r = order.indexOf(c.name); if (r >= 0 && r <= rank) at = i; }
  });
  if (at < 0) {
    const first = parent.children.findIndex((c) => c.type === 'el' && order.indexOf(c.name) > rank);
    if (first >= 0) { parent.children.splice(first, 0, e); return e; }
    appendChild(parent, e);
  } else parent.children.splice(at + 1, 0, e);
  return e;
}

const fmtSlots = (v: number[]) => Array.from({ length: 10 }, (_, i) => v[i] ?? 0).join(',') + ',';
const num = (s: string, d = 0) => { const n = parseFloat(s); return Number.isFinite(n) ? n : d; };

export class Character {
  constructor(public doc: XDocument, public ch: XElement) {}

  static create(name: string): Character {
    const ch = el('character');
    ch.children.push(el('version', CHARACTER_VERSION), el('name', name), el('unarmed', '1'), el('money', '0.0'),
      el('slots', fmtSlots([])), el('slotsCurrent', fmtSlots([])), el('abilities', '10,10,10,10,10,10,'),
      el('hpMax', '0'), el('hpCurrent', '0'));
    const root = el('pc', undefined, [['version', '5']]);
    root.children.push(ch);
    return new Character({ prolog: [], root, epilog: [] }, ch);
  }

  /** A file may hold one or more characters; a bare <character> root is accepted too. */
  static parseAll(xml: string): { characters: Character[]; warnings: string[] } {
    const { doc, warnings } = parseXml(xml);
    if (doc.root.name === 'character') return { characters: [new Character(doc, doc.root)], warnings };
    const chars = elements(doc.root, 'character');
    if (doc.root.name !== 'pc') warnings.push(`root element is <${doc.root.name}>, expected <pc>`);
    if (!chars.length) return { characters: [], warnings };
    if (chars.length === 1) return { characters: [new Character(doc, chars[0])], warnings };
    return {
      characters: chars.map((c) => new Character({ prolog: doc.prolog, root: { ...doc.root, children: [c] }, epilog: [] }, c)),
      warnings,
    };
  }

  static parse(xml: string): Character {
    const r = Character.parseAll(xml);
    if (!r.characters.length) throw new Error('No <character> element found');
    return r.characters[0];
  }

  serialize(pretty = true): string {
    return serializeXml(this.doc, { pretty });
  }

  // ---- simple fields
  private get(tag: string) { return childText(this.ch, tag); }
  private num(tag: string, d = 0) { return num(this.get(tag), d); }
  private set(tag: string, value: string | number | undefined) {
    const v = value === undefined ? '' : String(value);
    const existing = child(this.ch, tag);
    if (!v) { if (existing) removeChild(this.ch, existing); return; }
    if (existing) existing.children = [{ type: 'text', value: v }];
    else insertOrdered(this.ch, el(tag, v), TOP_ORDER);
  }

  get name() { return this.get('name') || 'Unnamed'; }
  set name(v: string) { this.set('name', v); }
  get xp() { return this.num('xp'); }
  set xp(v: number) { this.set('xp', v > 0 ? String(v) : ''); }
  get hpMax() { return this.num('hpMax'); }
  set hpMax(v: number) { this.set('hpMax', String(Math.max(0, Math.round(v)))); }
  get hpCurrent() { return child(this.ch, 'hpCurrent') ? this.num('hpCurrent') : this.hpMax; }
  set hpCurrent(v: number) { this.set('hpCurrent', String(Math.round(v))); }
  get unarmed() { return !child(this.ch, 'unarmed') || yes(this.get('unarmed')); }
  set unarmed(v: boolean) { this.set('unarmed', v ? '1' : '0'); }
  /** Total wealth in gp, as the app stores it alongside the coin items. */
  get money() { return this.num('money'); }

  /** Base scores, before racial bonuses and modifiers. */
  get abilities(): Record<Ability, number> {
    const v = this.get('abilities').split(',').map((x) => parseInt(x, 10));
    const out = {} as Record<Ability, number>;
    ABILITIES.forEach((a, i) => { out[a] = Number.isFinite(v[i]) ? v[i] : 10; });
    return out;
  }
  set abilities(v: Record<Ability, number>) {
    this.set('abilities', ABILITIES.map((a) => v[a]).join(',') + ',');
  }

  /** Combined spell slots as stored at the top level: [cantrips, 1st..9th]. */
  get slots() { return parseSlots(this.get('slots')); }
  get slotsCurrent() { return child(this.ch, 'slotsCurrent') ? parseSlots(this.get('slotsCurrent')) : this.slots; }
  setSlots(total: number[], current: number[]) {
    this.set('slots', fmtSlots(total));
    this.set('slotsCurrent', fmtSlots(current));
  }

  // ---- sections
  get race() { return child(this.ch, 'race'); }
  get background() { return child(this.ch, 'background'); }
  get classes() { return elements(this.ch, 'class'); }
  get feats() { return elements(this.ch, 'feat'); }
  get items() { return elements(this.ch, 'item'); }
  get containers() { return elements(this.ch, 'container'); }
  get notes() { return elements(this.ch, 'note'); }
  /** Pets, familiars, summons and other creatures (a Hearthsheet extension, see creature.ts). */
  get creatures() { return elements(this.ch, 'companion'); }
  /** Custom trackers (see tracker.ts). */
  get trackers() { return elements(this.ch, 'tracker'); }

  get totalLevel() { return this.classes.reduce((s, c) => s + classLevel(c), 0); }

  insert(e: XElement): XElement { return insertOrdered(this.ch, e, TOP_ORDER); }
  remove(e: XElement) { removeChild(this.ch, e); }

  setRace(src: XElement | null) {
    const old = this.race;
    if (old) this.remove(old);
    if (src) this.insert(raceFromCompendium(src));
  }
  setBackground(src: XElement | null) {
    const old = this.background;
    if (old) this.remove(old);
    if (src) this.insert(backgroundFromCompendium(src));
  }
  addClass(src: XElement): XElement { return this.insert(classFromCompendium(src)); }
  addItem(src: XElement, quantity = 1): XElement { return this.insert(itemFromCompendium(src, quantity)); }
  addFeat(src: XElement): XElement { return this.insert(featFromCompendium(src)); }
  addCreature(e: XElement): XElement { return this.insert(e); }
  addNote(name: string, text: string): XElement {
    const n = el('note');
    n.children.push(el('name', name), el('text', text));
    return this.insert(n);
  }

  /** Spells live under the class that knows them. */
  addSpell(classEl: XElement, src: XElement): XElement {
    return insertOrdered(classEl, spellFromCompendium(src), CLASS_ORDER);
  }

  /** All coins (type $ or the app's "Gold (gp)" style items) → gp total. */
  coinTotal(): number {
    let gp = 0;
    for (const it of this.items) {
      const coin = coinKind(it);
      if (coin) gp += itemQuantity(it) * COIN_GP[coin];
    }
    return Math.round(gp * 100) / 100;
  }
  syncMoney() { this.set('money', this.coinTotal().toFixed(coinDecimals(this.coinTotal()))); }
  coin(kind: CoinKind): number {
    const it = this.items.find((i) => coinKind(i) === kind);
    return it ? itemQuantity(it) : 0;
  }
  setCoin(kind: CoinKind, qty: number) {
    let it = this.items.find((i) => coinKind(i) === kind);
    if (!it) {
      if (qty <= 0) return;
      it = el('item');
      it.children.push(el('name', COIN_NAME[kind]), el('type', String(itemTypeCode('G'))), el('quantity', '0'),
        el('value', String(COIN_GP[kind])), el('weight', '0.02'));
      this.insert(it);
    }
    setChildText(it, 'quantity', String(Math.max(0, qty)));
    this.syncMoney();
  }
}

const coinDecimals = (gp: number) => (Math.abs(gp * 100 - Math.round(gp * 100)) > 1e-6 ? 2 : Number.isInteger(gp) ? 1 : 2);

export type CoinKind = 'cp' | 'sp' | 'ep' | 'gp' | 'pp';
export const COIN_KINDS: CoinKind[] = ['cp', 'sp', 'ep', 'gp', 'pp'];
export const COIN_GP: Record<CoinKind, number> = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 };
const COIN_NAME: Record<CoinKind, string> = {
  cp: 'Copper (cp)', sp: 'Silver (sp)', ep: 'Electrum (ep)', gp: 'Gold (gp)', pp: 'Platinum (pp)',
};
export function coinKind(it: XElement): CoinKind | null {
  const n = childText(it, 'name').toLowerCase();
  const m = /\((cp|sp|ep|gp|pp)\)\s*$/.exec(n) ?? /^(copper|silver|electrum|gold|platinum)( pieces?)?$/.exec(n);
  if (!m) return null;
  const k = m[1].length === 2 ? m[1] : m[1][0] + 'p';
  return (COIN_KINDS as string[]).includes(k) ? (k as CoinKind) : null;
}

// ---------------------------------------------------------------- compiled features

function compiledFeat(name: string, text: string, extras: XElement[] = [], optional = false): XElement {
  const f = el('feat');
  f.children.push(el('name', name), el('text', text), ...extras, el('expanded', '0'));
  if (optional) f.children.push(el('optional', '1'));
  return f;
}

/** Keep modifier/proficiency/special/roll data from a compendium trait or feature. */
function featureExtras(src: XElement): XElement[] {
  return elements(src).filter((c) => ['modifier', 'special', 'proficiency', 'roll', 'subclass', 'tools'].includes(c.name)).map(cloneEl);
}

export function raceFromCompendium(src: XElement): XElement {
  const v = raceView(src);
  const r = el('race');
  r.children.push(el('name', v.name));
  const size = sizeCode(v.size);
  if (size !== null) r.children.push(el('size', String(size)));
  if (childText(src, 'speed')) r.children.push(el('speed', String(v.speed)));
  for (const t of v.traits) r.children.push(compiledFeat(t.name, t.text, featureExtras(t.el)));
  for (const [a, bonus] of Object.entries(parseAbilityBonuses(childText(src, 'ability')))) {
    r.children.push(abilityMod(a as Ability, bonus!));
  }
  // Race-level modifiers (rare) are kept in compendium form; ability-score ones become <mod>.
  for (const m of elements(src, 'modifier')) r.children.push(cloneEl(m));
  for (const p of v.proficiencies) { const code = proficiencyCode(p); if (code !== null) r.children.push(el('proficiency', String(code))); }
  if (v.spellAbility) r.children.push(el('spellAbility', String(abilityIndex(v.spellAbility))));
  return r;
}

function abilityMod(a: Ability, value: number): XElement {
  const m = el('mod');
  m.children.push(el('category', '1'), el('type', String(abilityIndex(a))), el('value', String(value)));
  return m;
}

export function backgroundFromCompendium(src: XElement): XElement {
  const v = backgroundView(src);
  const b = el('background');
  b.children.push(el('name', v.name));
  for (const t of v.traits) b.children.push(compiledFeat(t.name, t.text, featureExtras(t.el)));
  for (const p of v.proficiencies) { const code = proficiencyCode(p); if (code !== null) b.children.push(el('proficiency', String(code))); }
  return b;
}

export function featFromCompendium(src: XElement): XElement {
  const v = featView(src);
  const extras = featureExtras(src);
  if (v.prerequisite) extras.unshift(el('prerequisite', v.prerequisite));
  const f = compiledFeat(v.name, v.text, extras.filter((x) => x.name !== 'proficiency'));
  for (const p of v.proficiencies) { const code = proficiencyCode(p); if (code !== null) f.children.push(el('proficiency', String(code))); }
  return f;
}

/** Copy a compendium class at level 0 (no features yet); level-up fills it in. */
export function classFromCompendium(src: XElement): XElement {
  const cv = classView(src);
  const c = el('class');
  c.children.push(el('name', cv.name), el('level', '0'), el('hd', String(hdCode(cv.hd))));
  if (cv.wealth) c.children.push(el('wealth', cv.wealth));
  for (const a of cv.savingThrows) c.children.push(el('proficiency', String(abilityIndex(a))));
  c.children.push(el('numClassSkills', String(cv.numSkills)));
  c.children.push(el('armor', cv.armor), el('weapons', cv.weapons), el('tools', cv.tools));
  c.children.push(el('slots', fmtSlots([])), el('slotsCurrent', fmtSlots([])));
  // Full progression, in the compiled shape (<level> child, <feat> children).
  for (const al of elements(src, 'autolevel')) {
    const lv = parseInt(al.attrs.find(([k]) => k === 'level')?.[1] ?? childText(al, 'level') ?? '1', 10) || 1;
    const out = el('autolevel');
    if (lv > 1) out.children.push(el('level', String(lv)));
    if (yes(al.attrs.find(([k]) => k === 'scoreImprovement')?.[1]) || yes(childText(al, 'scoreImprovement'))) {
      out.children.push(el('scoreImprovement', '1'));
    }
    for (const s of elements(al, 'slots')) {
      const se = el('slots', fmtSlots(parseSlots(textOf(s))));
      if (yes(s.attrs.find(([k]) => k === 'optional')?.[1])) se.attrs.push(['optional', 'YES']);
      out.children.push(se);
    }
    for (const f of [...elements(al, 'feature'), ...elements(al, 'feat')]) {
      const optional = yes(f.attrs.find(([k]) => k === 'optional')?.[1]) || yes(childText(f, 'optional'));
      const fe = el('feat');
      fe.children.push(el('name', childText(f, 'name')), el('text', childTexts(f, 'text').join('\n')), ...featureExtras(f));
      if (optional) fe.children.push(el('optional', '1'));
      out.children.push(fe);
    }
    for (const ct of elements(al, 'counter')) out.children.push(cloneEl(ct));
    c.children.push(out);
  }
  if (cv.spellAbility) c.children.push(el('spellAbility', String(abilityIndex(cv.spellAbility))));
  if (cv.slotsReset) c.children.push(el('slotsReset', cv.slotsReset));
  return c;
}

export function itemFromCompendium(src: XElement, quantity = 1): XElement {
  const v = itemView(src);
  const it = el('item');
  it.children.push(el('name', v.name));
  if (v.detail) it.children.push(el('detail', v.detail));
  if (v.text) it.children.push(el('text', v.text));
  const type = itemTypeCode(v.type);
  if (type !== null) it.children.push(el('type', String(type)));
  if (quantity !== 1) it.children.push(el('quantity', String(quantity)));
  it.children.push(el('value', fmtFloat(num(v.value))), el('weight', fmtFloat(v.weight)));
  if (v.ac) it.children.push(el('ac', String(v.ac)));
  if (v.dmg1) it.children.push(el('damage1H', v.dmg1));
  if (v.dmg2) it.children.push(el('damage2H', v.dmg2));
  const dt = damageTypeCode(v.dmgTypeCode);
  if (dt !== null) it.children.push(el('damageType', String(dt)));
  if (v.properties.length) it.children.push(el('weaponProperty', String(propertyMask(v.properties))));
  if (v.type === 'M') { const m = el('mod'); m.children.push(el('type', '1')); it.children.push(m); }
  // Data the compiled format has no known home for, kept under compendium names.
  for (const tag of ['magic', 'strength', 'stealth', 'range']) if (childText(src, tag)) it.children.push(el(tag, childText(src, tag)));
  for (const c of elements(src)) if (c.name === 'modifier' || c.name === 'roll') it.children.push(cloneEl(c));
  return it;
}

const fmtFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 1000) / 1000));

export function spellFromCompendium(src: XElement): XElement {
  const v = spellView(src);
  const s = el('spell');
  s.children.push(el('name', v.name));
  const sc = schoolCode(v.schoolCode);
  if (sc !== null) s.children.push(el('school', String(sc)));
  if (v.ritual) s.children.push(el('ritual', '1'));
  if (v.level > 0) s.children.push(el('level', String(v.level)));
  s.children.push(el('time', v.time), el('range', v.range));
  const comp = parseComponents(v.components);
  if (comp.v) s.children.push(el('v', '1'));
  if (comp.s) s.children.push(el('s', '1'));
  if (comp.m) { s.children.push(el('m', '1')); if (comp.materials) s.children.push(el('materials', comp.materials)); }
  s.children.push(el('duration', v.duration), el('text', v.text));
  for (const r of elements(src, 'roll')) s.children.push(cloneEl(r));
  for (const c of v.classes) s.children.push(el('sclass', c));
  return s;
}

export function parseComponents(s: string): { v: boolean; s: boolean; m: boolean; materials: string } {
  const m = /M\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/i.exec(s);
  const head = s.replace(/M\s*\(.*\)/i, 'M');
  const toks = head.split(/[,\s]+/).map((x) => x.trim().toUpperCase());
  return { v: toks.includes('V'), s: toks.includes('S'), m: toks.includes('M'), materials: m ? m[1].trim() : '' };
}

// ---------------------------------------------------------------- class helpers

export const classLevel = (c: XElement) => { const n = parseInt(childText(c, 'level'), 10); return Number.isFinite(n) && n > 0 ? n : (child(c, 'level') ? 0 : 1); };
export function setClassLevel(c: XElement, v: number) {
  const existing = child(c, 'level');
  if (v === 1) { if (existing) removeChild(c, existing); return; } // level 1 is implicit in exports
  if (existing) existing.children = [{ type: 'text', value: String(v) }];
  else insertOrdered(c, el('level', String(v)), CLASS_ORDER);
}
export const classHitDie = (c: XElement) => hdDie(childText(c, 'hd'), 8);
export function hdCurrent(c: XElement) {
  const n = parseInt(childText(c, 'hdCurrent'), 10);
  return Number.isFinite(n) ? n : classLevel(c);
}
export function setHdCurrent(c: XElement, v: number) {
  const existing = child(c, 'hdCurrent');
  if (existing) existing.children = [{ type: 'text', value: String(v) }];
  else insertOrdered(c, el('hdCurrent', String(v)), CLASS_ORDER);
}
export const classSlots = (c: XElement) => parseSlots(childText(c, 'slots'));
export const classSlotsCurrent = (c: XElement) => (child(c, 'slotsCurrent') ? parseSlots(childText(c, 'slotsCurrent')) : classSlots(c));
export function setClassSlots(c: XElement, total: number[], current: number[]) {
  for (const [tag, v] of [['slots', total], ['slotsCurrent', current]] as const) {
    const existing = child(c, tag);
    if (existing) existing.children = [{ type: 'text', value: fmtSlots(v) }];
    else insertOrdered(c, el(tag, fmtSlots(v)), CLASS_ORDER);
  }
}
export const classSpellAbility = (c: XElement): Ability | null => parseAbility(childText(c, 'spellAbility'));
export const classSpells = (c: XElement) => elements(c, 'spell');
/** Class proficiencies as names (codes decoded). */
export const classProficiencies = (c: XElement) => proficiencyNames(c);
export function setClassSkillProficiencies(c: XElement, skills: string[]) {
  for (const p of elements(c, 'proficiency')) {
    const code = parseInt(textOf(p), 10);
    if (code >= 100) removeChild(c, p);
  }
  for (const s of skills) { const code = proficiencyCode(s); if (code !== null && code >= 100) insertOrdered(c, el('proficiency', String(code)), CLASS_ORDER); }
}

/** Features the character has from this class (the class's <feat> list). */
export const classFeats = (c: XElement): Trait[] => traitsOf(c, 'feat');
export const classFeatNames = (c: XElement) => classFeats(c).map((f) => f.name);
export function addClassFeat(c: XElement, f: ClassFeature) {
  if (classFeatNames(c).includes(f.name)) return;
  const fe = el('feat');
  fe.children.push(el('name', f.name), el('text', f.text), ...featureExtras(f.el), el('expanded', '0'));
  if (f.optional) fe.children.push(el('optional', '1'));
  insertOrdered(c, fe, CLASS_ORDER);
}
export function removeClassFeat(c: XElement, name: string) {
  for (const f of elements(c, 'feat')) if (childText(f, 'name') === name) removeChild(c, f);
}

/** A modifier as edited in the app: category plus "target +N" text. */
export interface ModifierInput { category: string; text: string }

/** Add a feature the user wrote, in the same compiled shape as the app's own features. */
export function addCustomClassFeat(c: XElement, name: string, text: string, modifiers: ModifierInput[] = []): XElement {
  const fe = el('feat');
  fe.children.push(el('name', name), el('text', text));
  for (const m of modifiers) if (m.text.trim()) fe.children.push(el('modifier', m.text.trim(), [['category', m.category]]));
  fe.children.push(el('expanded', '0'));
  return insertOrdered(c, fe, CLASS_ORDER);
}

/** Edit a feature in place; children this app does not edit (rolls, special markers, ...) are kept. */
export function updateFeat(fe: XElement, patch: { name?: string; text?: string; modifiers?: ModifierInput[] }) {
  if (patch.name !== undefined) setChildText(fe, 'name', patch.name);
  if (patch.text !== undefined) {
    const texts = elements(fe, 'text');
    if (texts.length) {
      texts[0].children = patch.text ? [{ type: 'text', value: patch.text }] : [];
      for (const t of texts.slice(1)) removeChild(fe, t);
    } else if (patch.text) {
      const at = fe.children.findIndex((x) => x.type === 'el' && x.name === 'name');
      fe.children.splice(at + 1, 0, el('text', patch.text));
    }
  }
  if (patch.modifiers) {
    const old = elements(fe, 'modifier');
    const at = old.length ? fe.children.indexOf(old[0]) : fe.children.findIndex((x) => x.type === 'el' && x.name === 'expanded');
    for (const m of old) removeChild(fe, m);
    const fresh = patch.modifiers.filter((m) => m.text.trim()).map((m) => el('modifier', m.text.trim(), [['category', m.category]]));
    fe.children.splice(at >= 0 ? Math.min(at, fe.children.length) : fe.children.length, 0, ...fresh);
  }
}

export const featModifiers = (fe: XElement): ModifierInput[] =>
  elements(fe, 'modifier').map((m) => ({ category: m.attrs.find(([k]) => k === 'category')?.[1] ?? 'bonus', text: textOf(m).trim() }));

/** Does this class carry its own progression? Then its <feat> list is authoritative, even when empty. */
export const hasEmbeddedProgression = (c: XElement) => elements(c, 'autolevel').length > 0;

/** Subclasses the character has chosen in this class, inferred from its optional features. */
export function chosenSubclasses(c: XElement): string[] {
  const cv = classView(c);
  const chosen = new Set(classFeats(c).map((f) => f.name));
  return cv.subclasses.filter((s) => cv.features.some((f) => f.optional && chosen.has(f.name)
    && (f.name === `${subclassFamily(cv.features, s)}: ${s}` || f.name.toLowerCase().startsWith(s.toLowerCase() + ': ') || f.name.toLowerCase().endsWith(`(${s.toLowerCase()})`))));
}
function subclassFamily(features: ClassFeature[], subclass: string): string {
  const intro = features.find((f) => f.optional && f.name.endsWith(`: ${subclass}`));
  return intro ? intro.name.slice(0, -subclass.length - 2) : '';
}

// ---------------------------------------------------------------- item helpers

export const itemQuantity = (i: XElement) => { const n = parseFloat(childText(i, 'quantity')); return Number.isFinite(n) ? n : 1; };
export const setItemQuantity = (i: XElement, v: number) => setChildText(i, 'quantity', v === 1 ? '' : String(v));
export const itemSlot = (i: XElement): number | null => { const n = parseInt(childText(i, 'slot'), 10); return Number.isFinite(n) ? n : null; };
export const isEquipped = (i: XElement) => itemSlot(i) !== null || yes(childText(i, 'equipped'));
/** Equip into the slot the item type implies; unequip removes <slot>. */
export function setEquipped(i: XElement, v: boolean) {
  const old = child(i, 'equipped');
  if (old) removeChild(i, old);
  if (!v) { setChildText(i, 'slot', ''); return; }
  const type = itemTypeLetters(childText(i, 'type'));
  const props = splitList(childText(i, 'weaponProperty') || childText(i, 'property'));
  const twoHanded = /^\d+$/.test(props[0] ?? '') ? !!(+props[0] & (1 << 8)) : props.includes('2H');
  const slot = ['LA', 'MA', 'HA'].includes(type) ? SLOT.armor : type === 'S' ? SLOT.shield
    : ['M', 'R'].includes(type) ? (twoHanded ? SLOT.twoHands : SLOT.mainHand) : SLOT.mainHand;
  setChildText(i, 'slot', String(slot));
}
export const isAttuned = (i: XElement) => yes(childText(i, 'attuned'));
export const setAttuned = (i: XElement, v: boolean) => setChildText(i, 'attuned', v ? '1' : '');
export const isPrepared = (s: XElement) => yes(childText(s, 'prepared'));
export const setPrepared = (s: XElement, v: boolean) => setChildText(s, 'prepared', v ? '1' : '');
export const containerCarried = (c: XElement) => !child(c, 'carried') || yes(childText(c, 'carried'));

/** Make a bare custom item in the compiled shape. */
export function customItem(name: string): XElement {
  const it = el('item');
  it.children.push(el('name', name), el('type', String(itemTypeCode('G'))), el('value', '0.0'), el('weight', '0.0'));
  return it;
}

export { textOf as elementText };
