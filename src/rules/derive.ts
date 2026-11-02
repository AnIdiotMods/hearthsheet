// Rules engine: derives the character sheet from the character document.
// Pure functions of (character, app state, options); no UI or storage.

import {
  ABILITIES, Ability, ClassFeature, Counter, Modifier, SKILLS, Trait, backgroundView, canonicalSkill, classView,
  isSkill, itemView, proficiencyNames, raceView, traitsOf,
} from '../model/compendium';
import {
  AppState, Character, chosenSubclasses, classFeats, classHitDie, classLevel, classSlots,
  classSpellAbility, containerCarried, hasEmbeddedProgression, hdCurrent, isAttuned, isEquipped, itemQuantity,
} from '../model/character';
import { XElement, childText, elements } from '../xml/xml';
import { FormulaContext, resolveFormula } from './dice';

export interface RulesOptions {
  /** 2024 rules round half-caster levels up when multiclassing; 2014 rounds down. */
  multiclassRounding: '2014' | '2024';
  /** Finds a compendium class by name, used when a character's embedded class lacks progression data. */
  classLookup?: (name: string) => XElement | undefined;
}
export const defaultOptions: RulesOptions = { multiclassRounding: '2014' };

export const mod = (score: number) => Math.floor((score - 10) / 2);
export const profBonus = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
export const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export interface SourcedModifier extends Modifier { source: string }
export interface ActiveFeature { name: string; text: string; source: string; level?: number; special: string; rolls: { formula: string; description: string }[]; modifiers: Modifier[] }

export type CasterKind = 'full' | 'half' | 'third' | 'pact' | 'none';

export interface Spellcasting {
  className: string;
  ability: Ability;
  dc: number;
  attack: number;
  cantrips: number;
  kind: CasterKind;
  slots: number[]; // the class's own slot row (index 1..9)
}

export interface Attack {
  name: string; bonus: number; damage: string; versatile?: string; damageType: string; range: string; notes: string;
}

export interface Sheet {
  level: number;
  prof: number;
  scores: Record<Ability, number>;
  mods: Record<Ability, number>;
  saves: { ability: Ability; bonus: number; proficient: boolean }[];
  skills: { name: string; ability: Ability; bonus: number; proficient: boolean; expertise: boolean; half: boolean }[];
  ac: number;
  acNotes: string[];
  initiative: number;
  speed: number;
  passivePerception: number;
  passiveInvestigation: number;
  passiveInsight: number;
  hpMax: number;
  hitDice: { className: string; die: number; total: number; current: number }[];
  spellcasting: Spellcasting[];
  slots: number[];               // combined (index 1..9)
  slotsUsed: number[];
  pact: { level: number; count: number } | null;
  attacks: Attack[];
  features: ActiveFeature[];
  counters: (Counter & { source: string })[];
  proficiencies: { armor: string[]; weapons: string[]; tools: string[]; other: string[] };
  skillProficiencies: string[];
  expertise: string[];
  carried: number;
  capacity: number;
  modifiers: SourcedModifier[];
  formula: FormulaContext;
  classes: { el: XElement; name: string; level: number; subclasses: string[] }[];
  warnings: string[];
}

// SRD multiclass spellcaster table, caster levels 1-20, slot levels 1-9.
const MULTICLASS_SLOTS: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
export const multiclassSlots = (casterLevel: number): number[] => {
  const row = casterLevel >= 1 ? MULTICLASS_SLOTS[Math.min(20, casterLevel) - 1] : [];
  return [0, ...Array.from({ length: 9 }, (_, i) => row[i] ?? 0)];
};

export type CV = ReturnType<typeof classView>;

const CASTING_FEATURE = /(^|: |\()(spellcasting|pact magic)(\)|$| \()/i;

/** Optional slot rows apply once a subclass casting feature has been chosen. */
export const subclassCastingActive = (activeNames: string[]) =>
  activeNames.some((n) => CASTING_FEATURE.test(n) && !/^(spellcasting|pact magic)$/i.test(n.trim()));

/**
 * The slot row that applies at `level`: the highest non-optional row at or
 * below it, or the highest optional row when subclass casting is active.
 */
export function classSlotRow(cv: CV, level: number, activeNames: string[]): number[] | null {
  const optionalOk = subclassCastingActive(activeNames);
  const rows = cv.slots.filter((r) => r.level <= level && (!r.optional || optionalOk));
  if (!rows.length) return null;
  const regular = rows.filter((r) => !r.optional);
  const pool = regular.length ? regular : rows;
  return pool.reduce((a, b) => (b.level >= a.level ? b : a)).values;
}

/** Classify how a class casts from the shape of its slot table. */
export function casterKind(cv: CV, activeNames: string[] = []): CasterKind {
  const optionalOk = subclassCastingActive(activeNames);
  const rows = cv.slots.filter((r) => !r.optional || optionalOk);
  const highestOf = (v: number[]) => v.slice(1).reduce((h, n, i) => (n > 0 ? i + 1 : h), 0);
  const casting = rows.filter((r) => highestOf(r.values) > 0);
  if (!casting.length) return 'none';
  if (activeNames.some((n) => /pact magic/i.test(n)) || cv.features.some((f) => /^pact magic$/i.test(f.name))) return 'pact';
  if (casting.every((r) => r.values.slice(1).filter((n) => n > 0).length === 1) && casting.some((r) => highestOf(r.values) > 1)) return 'pact';
  // Closest standard progression; ties go to the kind whose casting starts at the first row's level
  // (full 1, half 2, third 3), and optional rows (subclass casting) favour third casters.
  const firstLevel = Math.min(...casting.map((r) => r.level));
  const starts = { full: 1, half: 2, third: 3 } as const;
  const score = (kind: 'full' | 'half' | 'third') =>
    -casting.reduce((d, r) => d + Math.abs(highestOf(r.values) - expectedHighest(kind, r.level)), 0)
    - Math.abs(firstLevel - starts[kind]) * 0.5
    + (kind === 'third' && casting.every((r) => r.optional) ? 0.25 : 0);
  const kinds = (['full', 'half', 'third'] as const).map((k) => [k, score(k)] as const);
  return kinds.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/** Highest spell slot level of the standard progressions at a class level. */
function expectedHighest(kind: 'full' | 'half' | 'third', L: number): number {
  if (kind === 'full') return Math.min(9, Math.ceil(L / 2));
  if (kind === 'half') return L < 2 ? 0 : Math.min(5, Math.floor((L - 1) / 4) + 1);
  return L < 3 ? 0 : L < 7 ? 1 : L < 13 ? 2 : L < 19 ? 3 : 4;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Resolve a class's progression: its own autolevels, or the compendium's copy. */
export function progressionOf(ce: XElement, opts: RulesOptions): CV {
  const own = classView(ce);
  if (own.features.length || own.slots.length) return own;
  const lib = opts.classLookup?.(own.name);
  if (!lib) return own;
  const cv = classView(lib);
  return { ...cv, hd: own.hd || cv.hd, name: own.name };
}

/** Active features of a class: its <feat> list, or (older files) the non-optional progression up to its level. */
export function activeClassFeatures(ce: XElement, cv: CV): Trait[] {
  const feats = classFeats(ce);
  if (feats.length || hasEmbeddedProgression(ce)) return feats;
  const level = classLevel(ce);
  return cv.features.filter((f) => !f.optional && f.level <= level).map((f) => ({
    name: f.name, text: f.text, modifiers: f.modifiers, special: f.special, proficiencies: f.proficiencies, rolls: f.rolls, el: f.el,
  }));
}

export function deriveSheet(c: Character, app: AppState, opts: RulesOptions = defaultOptions): Sheet {
  const warnings: string[] = [];
  const modifiers: SourcedModifier[] = [];
  const features: ActiveFeature[] = [];
  const counters: Sheet['counters'] = [];
  const addMods = (ms: Modifier[], source: string) => ms.forEach((m) => modifiers.push({ ...m, source }));
  const addFeature = (t: { name: string; text: string; special: string; rolls: { formula: string; description: string }[]; modifiers: Modifier[] }, source: string, level?: number) =>
    features.push({ name: t.name, text: t.text, source, level, special: t.special, rolls: t.rolls, modifiers: t.modifiers });
  const prof = { armor: new Set<string>(), weapons: new Set<string>(), tools: new Set<string>(), other: new Set<string>() };
  const skillProf = new Set<string>();
  const expertise = new Set<string>();
  const saveProf = new Set<Ability>();
  const addProfList = (list: string[], allowSaves = false) => list.forEach((p) => {
    const sk = canonicalSkill(p);
    const ab = ABILITIES.find((a) => a === p.toLowerCase());
    if (sk) skillProf.add(sk);
    else if (ab) { if (allowSaves) saveProf.add(ab); }
    else prof.other.add(p);
  });

  // ---- race
  const raceEl = c.race;
  const race = raceEl ? raceView(raceEl) : null;
  if (race) {
    addMods(race.modifiers, race.name);
    race.traits.forEach((t) => { addMods(t.modifiers, `${race.name}: ${t.name}`); addFeature(t, race.name); addProfList(t.proficiencies); });
    addProfList(race.proficiencies);
  } else warnings.push('No race selected');

  // ---- background
  const bgEl = c.background;
  if (bgEl) {
    const bg = backgroundView(bgEl);
    addMods(bg.modifiers, bg.name);
    bg.traits.forEach((t) => { addMods(t.modifiers, `${bg.name}: ${t.name}`); addFeature(t, bg.name); addProfList(t.proficiencies); });
    addProfList(bg.proficiencies);
  }

  // ---- feats (character level)
  for (const t of traitsOf(c.ch, 'feat')) {
    addMods(t.modifiers, t.name);
    addProfList(t.proficiencies, true);
    addFeature(t, 'Feat');
  }

  // ---- classes
  const classes = c.classes.map((ce) => {
    const cv = progressionOf(ce, opts);
    const level = classLevel(ce);
    const active = activeClassFeatures(ce, cv);
    return { ce, cv, level, active, names: active.map((f) => f.name), subclasses: chosenSubclasses(ce) };
  });
  const level = sum(classes.map((x) => x.level));
  if (!classes.length) warnings.push('No class selected');
  classes.forEach(({ ce, cv, level: lv, active, subclasses }, i) => {
    const source = cv.name;
    const levelOf = new Map(cv.features.map((f) => [f.name, f.level] as const));
    for (const f of active) {
      addMods(f.modifiers, `${cv.name}: ${f.name}`);
      addFeature(f, source, levelOf.get(f.name));
      addProfList(f.proficiencies, true);
    }
    // Saving throws: the first class only. Its proficiency list holds saves (codes 0-5) and chosen skills.
    const names = elements(ce, 'proficiency').length ? proficiencyNames(ce) : (cv.savingThrows as string[]);
    for (const p of names) {
      const ab = ABILITIES.find((a) => a === p.toLowerCase());
      if (ab) { if (i === 0) saveProf.add(ab); }
      else if (canonicalSkill(p)) skillProf.add(canonicalSkill(p)!);
    }
    if (i === 0 && !names.some((p) => ABILITIES.includes(p.toLowerCase() as Ability))) cv.savingThrows.forEach((a) => saveProf.add(a));
    const latest = new Map<string, Counter>();
    for (const ct of cv.counters) {
      if (ct.level > lv) continue;
      if (ct.subclass && !subclasses.some((s) => s.toLowerCase() === ct.subclass.toLowerCase())) continue;
      const prev = latest.get(ct.name);
      if (!prev || ct.level >= prev.level) latest.set(ct.name, ct);
    }
    latest.forEach((ct) => counters.push({ ...ct, source }));
    splitLoose(childText(ce, 'armor') || cv.armor).forEach((a) => prof.armor.add(a));
    splitLoose(childText(ce, 'weapons') || cv.weapons).forEach((w) => prof.weapons.add(w));
    splitLoose(childText(ce, 'tools') || cv.tools).forEach((t) => prof.tools.add(t));
    if (i > 0 && (cv.armor || cv.weapons)) {
      warnings.push(`${cv.name}: multiclass proficiencies are a subset of the class list; review manually`);
    }
  });

  // ---- equipment (modifiers from worn items)
  const items = c.items.map((ie) => ({ ie, v: itemView(ie), equipped: isEquipped(ie), attuned: isAttuned(ie), qty: itemQuantity(ie) }));
  for (const it of items) {
    if (!it.equipped && !it.attuned) continue;
    if (it.v.attunement && !it.attuned) continue;
    addMods(it.v.modifiers, it.v.name);
  }
  const attunedCount = items.filter((i) => i.attuned).length;
  if (attunedCount > 3) warnings.push(`${attunedCount} items attuned (limit is normally 3)`);

  // ---- ability scores (static modifiers first; placeholders are resolved afterwards)
  const base = c.abilities;
  const scores = { ...base };
  if (race && race.modifiers.every((m) => m.category !== 'ability score')) {
    for (const [a, v] of Object.entries(race.abilityBonuses)) scores[a as Ability] += v!;
  }
  for (const m of modifiers) {
    if (m.category !== 'ability score' || m.value === null) continue;
    const a = ABILITIES.find((x) => x === m.target);
    if (!a) continue;
    if (m.mode === 'add') scores[a] += m.value;
    else scores[a] = Math.max(scores[a], m.value);
  }
  const mods = {} as Record<Ability, number>;
  ABILITIES.forEach((a) => { mods[a] = mod(scores[a]); });

  const pbBase = profBonus(level);
  // Spellcasting ability for %0: first class with one.
  const firstCaster = classes.map(({ ce, cv, active }) => classSpellAbility(ce) ?? cv.spellAbility ?? guessSpellAbility(active)).find((a): a is Ability => !!a);
  const formula: FormulaContext = {
    abilityMods: ABILITIES.map((a) => mods[a]), spellMod: firstCaster ? mods[firstCaster] : 0,
    prof: pbBase, level, hpCurrent: c.hpCurrent,
  };
  const valueOf = (m: Modifier): number => {
    if (m.value !== null) return m.value;
    const r = resolveFormula(m.dynamic ?? '', formula);
    const n = parseInt(r, 10);
    return Number.isFinite(n) ? n : 0;
  };
  for (const m of modifiers) if (m.category === 'ability modifier') { const a = ABILITIES.find((x) => x === m.target); if (a) mods[a] += valueOf(m); }
  formula.abilityMods = ABILITIES.map((a) => mods[a]);
  if (firstCaster) formula.spellMod = mods[firstCaster];

  const sumMods = (pred: (m: SourcedModifier) => boolean) => sum(modifiers.filter((m) => m.mode === 'add' && pred(m)).map(valueOf));
  const pb = pbBase + sumMods((m) => m.category === 'bonus' && m.target === 'proficiency bonus');
  formula.prof = pb;
  const bonus = (target: string) => sumMods((m) => m.category === 'bonus' && m.target === target);

  // ---- special flags from features
  const specials = features.map((f) => `${f.special}|${f.name}`.toLowerCase());
  const has = (re: RegExp) => specials.some((s) => re.test(s));
  const joat = has(/jack of all trades/);

  // ---- saves
  for (const m of modifiers) {
    if (m.category === 'saving throw' && m.mode === 'set') { const a = ABILITIES.find((x) => x === m.target); if (a) saveProf.add(a); }
  }
  const saves = ABILITIES.map((a) => ({
    ability: a,
    proficient: saveProf.has(a),
    bonus: mods[a] + (saveProf.has(a) ? pb : 0) + bonus('saving throws')
      + sumMods((m) => m.category === 'saving throw' && m.target === a),
  }));

  // ---- skills
  const skills = SKILLS.map(([name, ab]) => {
    const proficient = skillProf.has(name) || expertise.has(name);
    const exp = expertise.has(name);
    const half = !proficient && joat;
    const b = mods[ab] + (exp ? pb * 2 : proficient ? pb : half ? Math.floor(pb / 2) : 0)
      + bonus('ability checks') + sumMods((m) => m.category === 'skill' && m.target === name.toLowerCase());
    return { name, ability: ab, bonus: b, proficient, expertise: exp, half };
  });
  const skill = (n: string) => skills.find((s) => s.name === n)!.bonus;

  // ---- armor class
  const acNotes: string[] = [];
  const armor = items.filter((i) => i.equipped && ['LA', 'MA', 'HA'].includes(i.v.type)).sort((a, b) => b.v.ac - a.v.ac)[0];
  const shields = items.filter((i) => i.equipped && i.v.type === 'S');
  let ac: number;
  if (armor) {
    const dex = armor.v.type === 'LA' ? mods.dexterity : armor.v.type === 'MA' ? Math.min(2, mods.dexterity) : 0;
    ac = armor.v.ac + dex;
    acNotes.push(`${armor.v.name} ${armor.v.ac}${dex ? ` ${fmt(dex)} Dex` : ''}`);
    if (armor.v.type === 'HA' && armor.v.strength && scores.strength < armor.v.strength) {
      warnings.push(`${armor.v.name} requires Strength ${armor.v.strength}: speed -10`);
    }
    if (items.filter((i) => i.equipped && ['LA', 'MA', 'HA'].includes(i.v.type)).length > 1) {
      warnings.push('More than one suit of armor equipped; using the best');
    }
    // Fighting Style: Defense, unless the feature already carries an explicit AC modifier.
    const defense = features.find((f) => /fighting style: defense|^fighting style defense/.test(`${f.special}|${f.name}`.toLowerCase()));
    if (defense && !defense.modifiers.some((m) => m.category === 'bonus' && m.target === 'ac')) { ac += 1; acNotes.push('Defense +1'); }
  } else {
    ac = 10 + mods.dexterity;
    acNotes.push(`Unarmored 10 ${fmt(mods.dexterity)} Dex`);
    // Unarmored Defense: "<special>Unarmored Defense: Constitution</special>" or the feature text.
    const ud = features.find((f) => /unarmored defense/i.test(f.special) || /unarmored defense/i.test(f.name));
    if (ud) {
      const src = `${ud.special} ${ud.text}`.toLowerCase();
      const extra: Ability | null = /\bcon(stitution)?\b/.test(src) ? 'constitution' : /\bwis(dom)?\b/.test(src) ? 'wisdom' : null;
      if (extra && !(extra === 'wisdom' && shields.length)) {
        ac += mods[extra]; acNotes.push(`${ud.name} ${fmt(mods[extra])}`);
      }
    }
    // Natural Armor: "<special>Natural Armor: 13+%2</special>" (base + ability modifier).
    const na = features.find((f) => /natural armor/i.test(f.special));
    if (na) {
      const m = /natural armor:\s*([^,]+)/i.exec(na.special);
      if (m) {
        const expr = m[1].trim().replace(/\bAC\b/i, String(ac));
        const n = parseInt(resolveFormula(expr, formula), 10);
        if (Number.isFinite(n) && n > ac) { ac = n; acNotes.length = 0; acNotes.push(`${na.name} ${expr}`); }
      }
    }
  }
  if (shields.length) {
    const s = shields[0].v.ac || 2;
    ac += s;
    acNotes.push(`${shields[0].v.name} +${s}`);
  }
  const acBonus = bonus('ac');
  if (acBonus) { ac += acBonus; acNotes.push(`Bonuses ${fmt(acBonus)}`); }

  // ---- speed, initiative, hit points
  let speed = (race?.speed ?? 30) + bonus('speed');
  if (armor && armor.v.type === 'HA' && armor.v.strength && scores.strength < armor.v.strength) speed -= 10;
  const initiative = mods.dexterity + bonus('initiative') + (joat ? Math.floor(pb / 2) : 0);
  const hpMax = c.hpMax + bonus('hp') + (has(/^toughness\||, toughness|^toughness$/) ? 2 * level : 0);

  // ---- spellcasting
  const spellcasting: Spellcasting[] = [];
  let casterLevel = 0;
  let pact: Sheet['pact'] = null;
  const ownSlots: number[][] = [];
  for (const { ce, cv, level: lv, active, names } of classes) {
    const ability = classSpellAbility(ce) ?? cv.spellAbility ?? guessSpellAbility(active);
    let row = classSlotRow(cv, lv, names);
    if (!row && !cv.slots.length) { const stored = classSlots(ce); if (stored.some((v) => v > 0)) row = stored; }
    if (!row || !row.some((v) => v > 0)) continue;
    const kind = cv.slots.length ? casterKind(cv, names) : 'full';
    const slots = [0, ...Array.from({ length: 9 }, (_, i) => row![i + 1] ?? 0)];
    const ab = ability ?? 'intelligence';
    if (!ability) warnings.push(`${cv.name}: spellcasting ability unknown, assuming Intelligence`);
    spellcasting.push({
      className: cv.name, ability: ab, kind, cantrips: row[0] ?? 0, slots,
      dc: 8 + pb + mods[ab] + bonus('spell dc'),
      attack: pb + mods[ab] + bonus('spell attack'),
    });
    if (kind === 'pact') {
      const lvl = slots.findIndex((v, i) => i > 0 && v > 0);
      if (lvl > 0) pact = { level: lvl, count: slots[lvl] };
    } else {
      ownSlots.push(slots);
      const r = opts.multiclassRounding === '2024' ? Math.ceil : Math.floor;
      casterLevel += kind === 'full' ? lv : kind === 'half' ? r(lv / 2) : kind === 'third' ? Math.floor(lv / 3) : 0;
    }
  }
  const slots = ownSlots.length === 1 ? ownSlots[0] : ownSlots.length > 1 ? multiclassSlots(casterLevel) : Array(10).fill(0);
  slots[0] = sum(spellcasting.filter((s) => s.kind !== 'pact').map((s) => s.cantrips));
  // Used slots come from the stored <slotsCurrent> (combined), clamped to the computed totals.
  const stored = c.slots, storedCur = c.slotsCurrent;
  const slotsUsed = slots.map((total, i) => (i === 0 ? 0 : Math.max(0, Math.min(total, (stored[i] ?? total) - (storedCur[i] ?? total)))));

  // ---- attacks
  const weaponProfText = [...prof.weapons].join(', ').toLowerCase();
  const isProficient = (name: string, props: string[]) => {
    const martial = props.includes('M');
    if (martial ? /martial/.test(weaponProfText) : /simple/.test(weaponProfText)) return true;
    const base = name.toLowerCase().replace(/^\+\d\s*|,?\s*\+\d$/g, '').trim();
    return weaponProfText.split(/,\s*/).some((w) => w && (base.includes(w.replace(/s$/, '')) || w.includes(base)));
  };
  const attacks: Attack[] = [];
  const styleArchery = has(/fighting style: archery|^fighting style archery/);
  const styleDueling = has(/fighting style: dueling|^fighting style dueling/);
  const equippedWeapons = items.filter((it) => it.equipped && ['M', 'R'].includes(it.v.type) && it.v.dmg1);
  // A weapon's own attack/damage modifiers ("+1 longsword") apply to that weapon only.
  const weaponOwned = (t: string) => sum(equippedWeapons.flatMap((w) => w.v.modifiers.filter((m) => m.category === 'bonus' && m.target === t).map(valueOf)));
  const general = (t: string) => bonus(t) - weaponOwned(t);
  for (const it of equippedWeapons) {
    const ranged = it.v.type === 'R';
    const finesse = it.v.properties.includes('F');
    const thrown = it.v.properties.includes('T');
    const ab: Ability = ranged ? 'dexterity' : finesse && mods.dexterity > mods.strength ? 'dexterity' : 'strength';
    const kind = ranged ? 'ranged' : 'melee';
    const own = (t: string) => sum(it.v.modifiers.filter((m) => m.category === 'bonus' && m.target === t).map(valueOf));
    // The item's own modifiers are already in `modifiers` when equipped; keep them from applying to other weapons.
    const globalAtk = general(`${kind} attacks`) + general('weapon attacks');
    const globalDmg = general(`${kind} damage`) + general('weapon damage');
    const atk = mods[ab] + (isProficient(it.v.name, it.v.properties) ? pb : 0) + globalAtk + own(`${kind} attacks`) + own('weapon attacks')
      + (ranged && styleArchery ? 2 : 0);
    const dueling = styleDueling && !ranged && !it.v.properties.includes('2H') && equippedWeapons.length === 1 ? 2 : 0;
    const dmgBonus = mods[ab] + globalDmg + own(`${kind} damage`) + own('weapon damage') + dueling;
    const d = (dice: string) => (dmgBonus ? `${dice}${fmt(dmgBonus)}` : dice);
    attacks.push({
      name: it.v.name, bonus: atk, damage: d(it.v.dmg1), versatile: it.v.dmg2 ? d(it.v.dmg2) : undefined,
      damageType: it.v.dmgType, range: it.v.range || (thrown ? 'thrown' : ''),
      notes: it.v.properties.join(', '),
    });
  }
  if (c.unarmed) {
    attacks.push({
      name: 'Unarmed Strike', bonus: mods.strength + pb + general('melee attacks') + general('weapon attacks'),
      damage: `${Math.max(1, 1 + mods.strength + general('melee damage') + general('weapon damage'))}`, damageType: 'bludgeoning', range: '', notes: '',
    });
  }

  // ---- carrying
  let carried = sum(items.map((i) => i.v.weight * i.qty));
  for (const ct of c.containers) {
    if (!containerCarried(ct)) continue;
    carried += parseFloat(childText(ct, 'weight')) || 0;
    for (const it of elements(ct, 'item')) carried += (parseFloat(childText(it, 'weight')) || 0) * itemQuantity(it);
  }
  const capacity = scores.strength * 15 * (has(/powerful build/) ? 2 : 1);

  const hitDice = classes.map(({ ce, cv, level: lv }) => ({ className: cv.name, die: classHitDie(ce) || cv.hd, total: lv, current: hdCurrent(ce) }));

  if (app.exhaustion > 0) warnings.push(`Exhaustion level ${app.exhaustion}`);

  return {
    level, prof: pb, scores, mods, saves, skills, ac, acNotes, initiative, speed,
    passivePerception: 10 + skill('Perception') + bonus('passive perception'),
    passiveInvestigation: 10 + skill('Investigation') + bonus('passive investigation'),
    passiveInsight: 10 + skill('Insight') + bonus('passive insight'),
    hpMax, hitDice, spellcasting, slots, slotsUsed, pact, attacks, features, counters,
    proficiencies: {
      armor: [...prof.armor], weapons: [...prof.weapons], tools: [...prof.tools],
      other: [...prof.other].filter((p) => !isSkill(p)),
    },
    skillProficiencies: [...skillProf], expertise: [...expertise],
    carried: Math.round(carried * 100) / 100, capacity, modifiers, formula,
    classes: classes.map(({ ce, cv, level: lv, subclasses }) => ({ el: ce, name: cv.name, level: lv, subclasses })),
    warnings,
  };
}

function guessSpellAbility(active: { name: string; text: string }[]): Ability | null {
  const t = active.filter((f) => CASTING_FEATURE.test(f.name)).map((f) => f.text).join(' ');
  const m = /(Intelligence|Wisdom|Charisma) is your spellcasting ability/i.exec(t);
  return m ? (m[1].toLowerCase() as Ability) : null;
}

const splitLoose = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter((x) => x && !/^none$/i.test(x));

/** Average HP gained per level for a hit die. */
export const averageHp = (hd: number) => Math.floor(hd / 2) + 1;

export const spellNameOf = (s: XElement) => childText(s, 'name');
export type { ClassFeature };
