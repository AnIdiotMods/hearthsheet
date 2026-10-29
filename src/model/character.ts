// Character model.
//
// A character IS its XML document: the app reads and edits it through these
// accessors, so anything the app does not understand survives import/export.
// Compendium data (race, class, items, spells...) is copied into the
// character so that a character file is self-contained.
//
// PROVISIONAL FORMAT: the element names for character-level state below were
// chosen without access to real character exports. They are isolated here so
// they can be corrected in one place once sample files are available.

import {
  XDocument, XElement, appendChild, child, childText, cloneEl, el, elements, parseXml,
  removeChild, serializeXml, setChildText, stripWhitespace, textOf,
} from '../xml/xml';
import { ABILITIES, Ability, splitList } from './compendium';

export const CHARACTER_TAGS = {
  root: 'pc',
  character: 'character',
  name: 'name',
  abilities: 'abilities',
  hpMax: 'hpMax',
  hpCurrent: 'hpCurrent',
  hpTemp: 'hpTemp',
  xp: 'xp',
  skills: 'skills',
  expertise: 'expertise',
  languages: 'languages',
  alignment: 'alignment',
  level: 'level',
  hdCurrent: 'hdCurrent',
  subclass: 'subclass',
  choice: 'choice',
  quantity: 'quantity',
  equipped: 'equipped',
  attuned: 'attuned',
  prepared: 'prepared',
  note: 'note',
  currency: ['cp', 'sp', 'ep', 'gp', 'pp'] as const,
};
const T = CHARACTER_TAGS;

/** Per-character state that has no place in the file format (kept locally only). */
export interface AppState {
  slotsUsed: number[];            // index 1..9
  pactUsed: number;
  countersUsed: Record<string, number>;
  deathSaves: { success: number; failure: number };
  conditions: string[];
  inspiration: boolean;
  exhaustion: number;
}
export const emptyAppState = (): AppState => ({
  slotsUsed: Array(10).fill(0), pactUsed: 0, countersUsed: {},
  deathSaves: { success: 0, failure: 0 }, conditions: [], inspiration: false, exhaustion: 0,
});

export interface CharacterRecord {
  id: string;
  xml: string;
  app: AppState;
  updatedAt: number;
}

export class Character {
  constructor(public doc: XDocument, public ch: XElement) {}

  static create(name: string): Character {
    const ch = el(T.character);
    const root = el(T.root, undefined, [['version', '5']]);
    root.children.push(ch);
    const c = new Character({ prolog: [], root, epilog: [] }, ch);
    c.name = name;
    c.abilities = { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 };
    return c;
  }

  /** A file may hold one or more characters. */
  static parseAll(xml: string): { characters: Character[]; warnings: string[] } {
    const { doc, warnings } = parseXml(xml);
    if (doc.root.name === T.character) {
      return { characters: [new Character(doc, doc.root)], warnings };
    }
    if (doc.root.name !== T.root) warnings.push(`root element is <${doc.root.name}>, expected <${T.root}>`);
    const chars = elements(doc.root, T.character);
    if (chars.length <= 1) {
      return { characters: chars.map((ch) => new Character(doc, ch)), warnings };
    }
    // Split multi-character files into one document each, keeping root attributes.
    return {
      characters: chars.map((ch) => {
        const root: XElement = { ...doc.root, children: [ch] };
        return new Character({ prolog: doc.prolog, root, epilog: [] }, ch);
      }),
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
  private num(tag: string, d = 0) { const n = parseFloat(this.get(tag)); return Number.isFinite(n) ? n : d; }

  get name() { return this.get(T.name) || 'Unnamed'; }
  set name(v: string) { setChildText(this.ch, T.name, v); }
  get alignment() { return this.get(T.alignment); }
  set alignment(v: string) { setChildText(this.ch, T.alignment, v); }
  get xp() { return this.num(T.xp); }
  set xp(v: number) { setChildText(this.ch, T.xp, String(v)); }
  get hpMax() { return this.num(T.hpMax); }
  set hpMax(v: number) { setChildText(this.ch, T.hpMax, String(Math.max(0, Math.round(v)))); }
  get hpCurrent() { return child(this.ch, T.hpCurrent) ? this.num(T.hpCurrent) : this.hpMax; }
  set hpCurrent(v: number) { setChildText(this.ch, T.hpCurrent, String(Math.round(v))); }
  get hpTemp() { return this.num(T.hpTemp); }
  set hpTemp(v: number) { setChildText(this.ch, T.hpTemp, v > 0 ? String(v) : ''); }
  get languages() { return this.get(T.languages); }
  set languages(v: string) { setChildText(this.ch, T.languages, v); }

  /** Base scores, before racial bonuses and modifiers. Stored "STR,DEX,CON,INT,WIS,CHA,". */
  get abilities(): Record<Ability, number> {
    const v = this.get(T.abilities).split(',').map((x) => parseInt(x, 10));
    const out = {} as Record<Ability, number>;
    ABILITIES.forEach((a, i) => { out[a] = Number.isFinite(v[i]) ? v[i] : 10; });
    return out;
  }
  set abilities(v: Record<Ability, number>) {
    setChildText(this.ch, T.abilities, ABILITIES.map((a) => v[a]).join(',') + ',');
  }

  get skills() { return splitList(this.get(T.skills)); }
  set skills(v: string[]) { setChildText(this.ch, T.skills, v.join(', ')); }
  get expertise() { return splitList(this.get(T.expertise)); }
  set expertise(v: string[]) { setChildText(this.ch, T.expertise, v.join(', ')); }

  currency(tag: (typeof T.currency)[number]) { return this.num(tag); }
  setCurrency(tag: (typeof T.currency)[number], v: number) { setChildText(this.ch, tag, v ? String(v) : ''); }

  // ---- copied compendium data
  get race() { return child(this.ch, 'race'); }
  get background() { return child(this.ch, 'background'); }
  get classes() { return elements(this.ch, 'class'); }
  get feats() { return elements(this.ch, 'feat'); }
  get items() { return elements(this.ch, 'item'); }
  get spells() { return elements(this.ch, 'spell'); }
  get notes() { return elements(this.ch, T.note); }

  get totalLevel() { return this.classes.reduce((s, c) => s + classLevel(c), 0); }

  setRace(src: XElement | null) { this.replaceSingle('race', src); }
  setBackground(src: XElement | null) { this.replaceSingle('background', src); }

  private replaceSingle(tag: string, src: XElement | null) {
    const old = child(this.ch, tag);
    if (old) removeChild(this.ch, old);
    if (src) this.insert(copyOf(src));
  }

  /** Insert keeping a stable element order: identity, then race/background/classes, then lists. */
  insert(e: XElement): XElement {
    const order = ['race', 'background', 'class', 'feat', 'item', 'spell', T.note];
    const rank = order.indexOf(e.name);
    if (rank >= 0) {
      const idx = this.ch.children.findIndex((c) => c.type === 'el' && order.indexOf(c.name) > rank);
      if (idx >= 0) { this.ch.children.splice(idx, 0, e); return e; }
    }
    appendChild(this.ch, e);
    return e;
  }

  remove(e: XElement) { removeChild(this.ch, e); }

  addClass(src: XElement): XElement {
    const c = copyOf(src);
    setChildText(c, T.level, '0');
    return this.insert(c);
  }

  addItem(src: XElement, quantity = 1): XElement {
    const it = copyOf(src);
    if (quantity !== 1) setChildText(it, T.quantity, String(quantity));
    return this.insert(it);
  }

  addSpell(src: XElement): XElement { return this.insert(copyOf(src)); }
  addFeat(src: XElement): XElement { return this.insert(copyOf(src)); }

  addNote(name: string, text: string): XElement {
    const n = el(T.note);
    n.children.push(el('name', name), el('text', text));
    return this.insert(n);
  }
}

export const copyOf = (e: XElement) => stripWhitespace(cloneEl(e));

export const classLevel = (c: XElement) => Math.max(0, parseInt(childText(c, T.level), 10) || 0);
export const setClassLevel = (c: XElement, v: number) => setChildText(c, T.level, String(v));
export const classSubclass = (c: XElement) => childText(c, T.subclass);
export const setClassSubclass = (c: XElement, v: string) => setChildText(c, T.subclass, v);
export const classChoices = (c: XElement) => elements(c, T.choice).map((x) => textOf(x).trim());
export function addClassChoice(c: XElement, featureName: string) {
  if (!classChoices(c).includes(featureName)) appendChild(c, el(T.choice, featureName));
}
export function removeClassChoice(c: XElement, featureName: string) {
  for (const x of elements(c, T.choice)) if (textOf(x).trim() === featureName) removeChild(c, x);
}
export function hdCurrent(c: XElement) {
  const n = parseInt(childText(c, T.hdCurrent), 10);
  return Number.isFinite(n) ? n : classLevel(c);
}
export const setHdCurrent = (c: XElement, v: number) => setChildText(c, T.hdCurrent, String(v));

const yes = (s: string) => /^(yes|1|true)$/i.test(s.trim());
export const itemQuantity = (i: XElement) => { const n = parseFloat(childText(i, T.quantity)); return Number.isFinite(n) ? n : 1; };
export const setItemQuantity = (i: XElement, v: number) => setChildText(i, T.quantity, v === 1 ? '' : String(v));
export const isEquipped = (i: XElement) => yes(childText(i, T.equipped));
export const setEquipped = (i: XElement, v: boolean) => setChildText(i, T.equipped, v ? 'YES' : '');
export const isAttuned = (i: XElement) => yes(childText(i, T.attuned));
export const setAttuned = (i: XElement, v: boolean) => setChildText(i, T.attuned, v ? 'YES' : '');
export const isPrepared = (s: XElement) => yes(childText(s, T.prepared));
export const setPrepared = (s: XElement, v: boolean) => setChildText(s, T.prepared, v ? 'YES' : '');
