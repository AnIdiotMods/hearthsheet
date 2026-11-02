// Rules engine: derives the character sheet from the character document.
// Pure functions of (character, app state, options); no UI or storage.

import {
  ABBR, ABILITIES, Ability, ClassFeature, Counter, Modifier, SKILLS, Trait, backgroundView, canonicalSkill, classView,
  isOptionalRule, isSkill, itemView, proficiencyNames, raceView, stripLevelPrefix, traitsOf,
} from '../model/compendium';
import {
  AppState, Character, chosenSubclasses, classFeats, classHitDie, classLevel, classSlots,
  classSpellAbility, containerCarried, hasEmbeddedProgression, hdCurrent, isAttuned, isEquipped, itemQuantity,
} from '../model/character';
import { XElement, childText, elements } from '../xml/xml';
import { FormulaContext, resolveFormula } from './dice';
import { SpellLimit, spellLimit } from './spellcount';
import { ProfLevel, customAbilities, customSkills, isStandardAbility, skillSetting } from '../model/custom';
import { Movement, OTHER_SPEEDS, OtherSpeed, movementOf } from '../model/movement';
import { ClassInfo, builtinCounters, classBase, editionOf, martialArtsDie, plainFeature, thirdCasterRow, unarmoredMovement } from './builtin';
import { optionLimits } from './options';

export interface RulesOptions {
  /** 2024 rules round half-caster levels up when multiclassing; 2014 rounds down. */
  multiclassRounding: '2014' | '2024';
  /** Finds a compendium class by name, used when a character's embedded class lacks progression data. */
  classLookup?: (name: string) => XElement | undefined;
  /** Finds a compendium spell by name, used to add subclass spells (Oath Spells, Domain Spells). */
  spellLookup?: (name: string) => XElement | undefined;
}
export const defaultOptions: RulesOptions = { multiclassRounding: '2014' };

export const mod = (score: number) => Math.floor((score - 10) / 2);
export const profBonus = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
export const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export interface SourcedModifier extends Modifier { source: string; item?: boolean }
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
  /** How many spells may be prepared or known, and how many are. */
  limit: SpellLimit;
  el: XElement;
}

export interface Attack {
  name: string; bonus: number; damage: string; versatile?: string; damageType: string; range: string; notes: string;
}

export interface SkillResult {
  name: string;
  /** Ability key: one of the six abilities or "custom:<id>". */
  ability: string;
  abilityLabel: string;
  defaultAbility: string;
  bonus: number;
  proficient: boolean;
  expertise: boolean;
  half: boolean;
  level: ProfLevel;
  /** Proficiency from race, class, background and feats, before any per-skill setting. */
  sourceLevel: ProfLevel;
  misc: number;
  overridden: boolean;
  custom: boolean;
  el?: XElement;
}

export interface CustomAbilityResult {
  key: string; id: string; name: string; abbr: string; score: number; mod: number; save: number; saveProficient: boolean; el: XElement;
}

export interface Sheet {
  level: number;
  prof: number;
  scores: Record<Ability, number>;
  /** Scores from base, race, feats and features, without magic items: what the usual maximum of 20 applies to. */
  naturalScores: Record<Ability, number>;
  mods: Record<Ability, number>;
  saves: { ability: Ability; bonus: number; proficient: boolean }[];
  skills: SkillResult[];
  customAbilities: CustomAbilityResult[];
  ac: number;
  acNotes: string[];
  initiative: number;
  speed: number;
  /** Other movement modes in feet (fly, swim, climb, burrow), when the character has them. */
  speeds: Partial<Record<OtherSpeed, number>>;
  hover: boolean;
  speedNotes: string[];
  movement: Movement;
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
  counters: (Counter & { source: string; builtin?: boolean; unlimited?: boolean })[];
  proficiencies: { armor: string[]; weapons: string[]; tools: string[]; other: string[] };
  skillProficiencies: string[];
  expertise: string[];
  carried: number;
  capacity: number;
  modifiers: SourcedModifier[];
  formula: FormulaContext;
  classes: { el: XElement; name: string; level: number; subclasses: string[] }[];
  warnings: string[];
  /** Limits the character goes past (ability over 20, too many spells prepared, ...); shown as a "too high" tag. */
  overLimits: string[];
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
  activeNames.map(stripLevelPrefix).some((n) => CASTING_FEATURE.test(n) && !/^(spellcasting|pact magic)$/i.test(n.trim()));

/**
 * The slot row that applies at `level`: the highest non-optional row at or
 * below it, or the highest optional row when subclass casting is active.
 */
export function classSlotRow(cv: CV, level: number, activeNames: string[]): number[] | null {
  const optionalOk = subclassCastingActive(activeNames);
  // Eldritch Knight / Arcane Trickster in files without a slot table for them.
  if (optionalOk && !cv.slots.some((r) => r.values.slice(1).some((v) => v > 0))) return thirdCasterRow(level, activeNames);
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
  if (activeNames.some((n) => /pact magic/i.test(n)) || cv.features.some((f) => /^pact magic$/i.test(stripLevelPrefix(f.name)))) return 'pact';
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
  return cv.features.filter((f) => !f.optional && !isOptionalRule(f) && f.level <= level).map((f) => ({
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
    const levelOf = new Map([...cv.features].reverse().map((f) => [f.name, f.level] as const)); // first occurrence wins
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
    // A resource granted by a later feature (Sorcery Points come with Font of Magic at 2nd level).
    const grantedLater = (ct: Counter) => /sorcery points/i.test(ct.name)
      && cv.features.some((f) => !f.optional && /font of magic/i.test(f.name) && f.level > lv);
    for (const ct of cv.counters) {
      if (ct.level > lv || grantedLater(ct)) continue;
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
    it.v.modifiers.forEach((m) => modifiers.push({ ...m, source: it.v.name, item: true }));
  }
  const attunedCount = items.filter((i) => i.attuned).length;
  if (attunedCount > 3) warnings.push(`${attunedCount} items attuned (limit is normally 3)`);

  // ---- ability scores (static modifiers first; placeholders are resolved afterwards)
  const base = c.abilities;
  const scores = { ...base };
  if (race && race.modifiers.every((m) => m.category !== 'ability score')) {
    for (const [a, v] of Object.entries(race.abilityBonuses)) scores[a as Ability] += v!;
  }
  // Scores before items and other "set" effects, for the usual maximum of 20.
  const natural = { ...scores };
  for (const m of modifiers) {
    if (m.category !== 'ability score' || m.value === null) continue;
    const a = ABILITIES.find((x) => x === m.target);
    if (!a) continue;
    if (m.mode === 'add') { scores[a] += m.value; if (!m.item) natural[a] += m.value; }
    else scores[a] = Math.max(scores[a], m.value);
  }
  const classInfo: ClassInfo[] = classes.map(({ cv, level: lv, names }) => ({
    name: cv.name, base: classBase(cv.name), level: lv, edition: editionOf(cv.name, cv.features.map((f) => f.name)), names,
  }));
  const classOf = (f: ActiveFeature) => classInfo.find((k) => k.name === f.source);
  const scoreMax: Record<Ability, number> = Object.fromEntries(ABILITIES.map((a) => [a, 20])) as Record<Ability, number>;
  // Primal Champion: Strength and Constitution +4, maximum 24.
  const primal = plainFeature(features, /^primal champion$/);
  if (primal) {
    for (const a of ['strength', 'constitution'] as const) {
      scores[a] = Math.max(scores[a], Math.min(24, scores[a] + 4));
      natural[a] = Math.min(24, natural[a] + 4);
      scoreMax[a] = 24;
    }
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
  for (const bc of builtinCounters(classInfo, counters.map((x) => x.name), mods)) {
    counters.push({ name: bc.name, value: bc.value, reset: bc.reset, level: 0, subclass: '', source: bc.source, builtin: true, unlimited: bc.unlimited });
  }

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
  // Diamond Soul: proficiency in every saving throw. Slippery Mind: Wisdom (2024: and Charisma).
  if (plainFeature(features, /^diamond soul$/)) ABILITIES.forEach((a) => saveProf.add(a));
  const slippery = plainFeature(features, /^slippery mind$/);
  if (slippery) { saveProf.add('wisdom'); if (/charisma/i.test(slippery.text)) saveProf.add('charisma'); }
  // Aura of Protection: Charisma modifier (minimum +1) to every saving throw.
  const aura = plainFeature(features, /^aura of protection$/);
  const auraBonus = aura ? Math.max(1, mods.charisma) : 0;
  const saves = ABILITIES.map((a) => ({
    ability: a,
    proficient: saveProf.has(a),
    bonus: mods[a] + (saveProf.has(a) ? pb : 0) + bonus('saving throws') + auraBonus
      + sumMods((m) => m.category === 'saving throw' && m.target === a),
  }));

  // ---- custom ability scores
  const customAbilityList: CustomAbilityResult[] = customAbilities(c.ch).map((ca) => {
    const m = mod(ca.score);
    return {
      key: `custom:${ca.id}`, id: ca.id, name: ca.name, abbr: ca.abbr, score: ca.score, mod: m, saveProficient: ca.saveProf,
      save: m + (ca.saveProf ? pb : 0) + bonus('saving throws') + auraBonus, el: ca.el,
    };
  });
  const abilityMod = (key: string) => (isStandardAbility(key) ? mods[key] : customAbilityList.find((x) => x.key === key)?.mod ?? 0);
  const abilityLabel = (key: string) => (isStandardAbility(key) ? ABBR[key] : customAbilityList.find((x) => x.key === key)?.abbr ?? '?');
  const skillBonus = (name: string, ab: string, level: ProfLevel, misc: number) => {
    const half = level === 0 && joat;
    return {
      half,
      bonus: abilityMod(ab) + (level === 2 ? pb * 2 : level === 1 ? pb : half ? Math.floor(pb / 2) : 0) + misc
        + bonus('ability checks') + sumMods((m) => m.category === 'skill' && m.target === name.toLowerCase()),
    };
  };

  // ---- skills (standard, with per-skill settings, then custom)
  const skills: SkillResult[] = SKILLS.map(([name, defaultAbility]) => {
    const setting = skillSetting(c.ch, name);
    const ab = setting?.ability && (isStandardAbility(setting.ability) || customAbilityList.some((x) => x.key === setting.ability))
      ? setting.ability : defaultAbility;
    const sourceLevel: ProfLevel = expertise.has(name) ? 2 : skillProf.has(name) ? 1 : 0;
    const level = setting?.prof ?? sourceLevel;
    const { bonus: b, half } = skillBonus(name, ab, level, setting?.bonus ?? 0);
    return {
      name, ability: ab, abilityLabel: abilityLabel(ab), defaultAbility, bonus: b, proficient: level >= 1, expertise: level === 2, half,
      level, sourceLevel, misc: setting?.bonus ?? 0, overridden: !!setting, custom: false,
    };
  });
  for (const cs of customSkills(c.ch)) {
    const ab = isStandardAbility(cs.ability) || customAbilityList.some((x) => x.key === cs.ability) ? cs.ability : 'intelligence';
    const { bonus: b, half } = skillBonus(cs.name, ab, cs.prof, cs.bonus);
    skills.push({
      name: cs.name, ability: ab, abilityLabel: abilityLabel(ab), defaultAbility: ab, bonus: b, proficient: cs.prof >= 1,
      expertise: cs.prof === 2, half, level: cs.prof, sourceLevel: 0, misc: cs.bonus, overridden: false, custom: true, el: cs.el,
    });
  }
  const skill = (n: string) => skills.find((s) => s.name === n && !s.custom)!.bonus;

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
    // Draconic Resilience: 13 + Dexterity modifier when not wearing armor.
    const dr = plainFeature(features, /^draconic resilience$/);
    if (dr && 13 + mods.dexterity > ac) { ac = 13 + mods.dexterity; acNotes.length = 0; acNotes.push(`${dr.name} 13 ${fmt(mods.dexterity)} Dex`); }
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
  const movement = movementOf(c.ch);
  const speedNotes: string[] = [];
  let speed = (movement.walk ?? race?.speed ?? 30) + bonus('speed');
  if (movement.walk !== null) speedNotes.push(`Walking speed set to ${movement.walk} ft`);
  if (armor && armor.v.type === 'HA' && armor.v.strength && scores.strength < armor.v.strength) { speed -= 10; speedNotes.push('Heavy armor without the Strength: -10'); }
  const fast = plainFeature(features, /^fast movement$/);
  if (fast && !(armor && armor.v.type === 'HA')) { speed += 10; speedNotes.push(`${fast.name} +10`); }
  const um = plainFeature(features, /^unarmored movement$/);
  const umLevel = um ? classOf(um)?.level ?? 0 : 0;
  if (um && !armor && !shields.length && unarmoredMovement(umLevel)) { speed += unarmoredMovement(umLevel); speedNotes.push(`${um.name} +${unarmoredMovement(umLevel)}`); }
  const mobile = plainFeature(features.filter((f) => f.source === 'Feat'), /^mobile$/);
  if (mobile) { speed += 10; speedNotes.push('Mobile +10'); }
  if (movement.bonus) { speed += movement.bonus; speedNotes.push(`Your bonus ${fmt(movement.bonus)}`); }
  speed = Math.max(0, speed);
  const speeds: Partial<Record<OtherSpeed, number>> = {};
  for (const k of OTHER_SPEEDS) {
    const v = movement.other[k];
    const fromRace = raceEl ? parseInt(childText(raceEl, `${k}Speed`) || childText(raceEl, k), 10) : NaN;
    const feet = v === 'walk' ? speed : v ?? (Number.isFinite(fromRace) && fromRace > 0 ? fromRace : null);
    if (feet !== null && feet > 0) speeds[k] = feet;
  }
  // Alert: +5 initiative (2014); the 2024 feat adds the proficiency bonus.
  const alert = plainFeature(features.filter((f) => f.source === 'Feat'), /^alert$/);
  const alertBonus = alert ? (/\+\s*5\b|bonus of 5|\b5 to initiative/i.test(alert.text) || !/proficiency bonus/i.test(alert.text) ? 5 : pb) : 0;
  const initiative = mods.dexterity + bonus('initiative') + (joat ? Math.floor(pb / 2) : 0) + alertBonus;
  // Built-in hit point bonuses: Tough (feat), Dwarven Toughness (race), Draconic Resilience (sorcerer levels).
  const tough = has(/^toughness\||, toughness|^toughness$/) ? null : plainFeature(features.filter((f) => f.source === 'Feat'), /^tough$/);
  const dwarven = plainFeature(features, /^dwarven toughness$/);
  const resilience = plainFeature(features, /^draconic resilience$/);
  const hpMax = c.hpMax + bonus('hp') + (has(/^toughness\||, toughness|^toughness$/) ? 2 * level : 0)
    + (tough ? 2 * level : 0) + (dwarven ? level : 0) + (resilience ? classOf(resilience)?.level ?? 0 : 0);

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
    const kind = !cv.slots.some((r) => r.values.slice(1).some((v) => v > 0)) && thirdCasterRow(lv, names) ? 'third' : cv.slots.length ? casterKind(cv, names) : 'full';
    const slots = [0, ...Array.from({ length: 9 }, (_, i) => row![i + 1] ?? 0)];
    const ab = ability ?? 'intelligence';
    if (!ability) warnings.push(`${cv.name}: spellcasting ability unknown, assuming Intelligence`);
    spellcasting.push({
      className: cv.name, ability: ab, kind, cantrips: row[0] ?? 0, slots,
      dc: 8 + pb + mods[ab] + bonus('spell dc'),
      attack: pb + mods[ab] + bonus('spell attack'),
      limit: spellLimit({ ce, className: cv.name, level: lv, features: cv.features, activeNames: names, mods, casterKind: kind, ability: ab }),
      el: ce,
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
  const martialArts = !!plainFeature(features, /^martial arts$/);
  const equippedWeapons = items.filter((it) => it.equipped && ['M', 'R'].includes(it.v.type) && it.v.dmg1);
  // A weapon's own attack/damage modifiers ("+1 longsword") apply to that weapon only.
  const weaponOwned = (t: string) => sum(equippedWeapons.flatMap((w) => w.v.modifiers.filter((m) => m.category === 'bonus' && m.target === t).map(valueOf)));
  const general = (t: string) => bonus(t) - weaponOwned(t);
  for (const it of equippedWeapons) {
    const ranged = it.v.type === 'R';
    const finesse = it.v.properties.includes('F');
    const thrown = it.v.properties.includes('T');
    const monkWeapon = martialArts && !ranged && !it.v.properties.includes('2H') && !it.v.properties.includes('H')
      && (!it.v.properties.includes('M') || /shortsword/i.test(it.v.name));
    const ab: Ability = ranged ? 'dexterity' : (finesse || monkWeapon) && mods.dexterity > mods.strength ? 'dexterity' : 'strength';
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
    // Martial Arts: Dexterity instead of Strength if higher, and the Martial Arts die.
    const ma = plainFeature(features, /^martial arts$/);
    const maInfo = ma ? classOf(ma) : undefined;
    const die = ma ? martialArtsDie(maInfo?.level ?? 1, maInfo?.edition ?? '2014') : 0;
    const ab: Ability = die && mods.dexterity > mods.strength ? 'dexterity' : 'strength';
    const dmg = mods[ab] + general('melee damage') + general('weapon damage');
    attacks.push({
      name: 'Unarmed Strike', bonus: mods[ab] + pb + general('melee attacks') + general('weapon attacks'),
      damage: die ? `1d${die}${dmg ? fmt(dmg) : ''}` : `${Math.max(1, 1 + dmg)}`, damageType: 'bludgeoning', range: '',
      notes: die ? `Martial Arts d${die}` : '',
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

  // Observant (2014): +5 to passive Perception and Investigation.
  const observant = plainFeature(features.filter((f) => f.source === 'Feat'), /^observant$/);
  const obs = observant && /\+\s*5|bonus to your passive/i.test(observant.text) ? 5 : 0;

  // ---- limits the character goes past
  const overLimits: string[] = [];
  for (const a of ABILITIES) if (natural[a] > scoreMax[a]) overLimits.push(`${ABBR[a]} ${natural[a]} (maximum ${scoreMax[a]})`);
  for (const sc of spellcasting) {
    if (sc.limit.max !== null && sc.limit.count > sc.limit.max) overLimits.push(`${sc.className}: ${sc.limit.mode === 'prepared' || sc.limit.edition === '2024' ? 'prepared' : 'known'} spells ${sc.limit.count} / ${sc.limit.max}`);
    if (sc.cantrips > 0 && sc.limit.cantrips > sc.cantrips) overLimits.push(`${sc.className}: cantrips ${sc.limit.cantrips} / ${sc.cantrips}`);
    const castable = sc.kind === 'pact' ? (pact?.level ?? 0) : sc.slots.reduce((m, v, i) => (i > 0 && v > 0 ? i : m), 0);
    const tooHigh = elements(sc.el, 'spell').filter((sp) => !childText(sp, 'grantedBy') && (parseInt(childText(sp, 'level'), 10) || 0) > Math.max(castable, sc.kind === 'pact' && sc.el ? mysticArcanumLevel(classOfName(classInfo, sc.className)) : 0));
    if (tooHigh.length) overLimits.push(`${sc.className}: ${tooHigh.length} spell${tooHigh.length > 1 ? 's' : ''} above the highest level you can cast`);
  }
  const first = classes[0];
  if (first) {
    const chosenSkills = proficiencyNames(first.ce).filter((p) => !!canonicalSkill(p));
    if (chosenSkills.length > first.cv.numSkills) overLimits.push(`${first.cv.name}: ${chosenSkills.length} class skills (${first.cv.numSkills} allowed)`);
  }
  if (attunedCount > 3) overLimits.push(`${attunedCount} attuned items (maximum 3)`);
  const optionNames = [...traitsOf(c.ch, 'feat').map((f) => f.name), ...classes.flatMap((k) => k.names)];
  for (const o of optionLimits(optionNames, classInfo)) if (o.have > o.max) overLimits.push(`${o.title} ${o.have} / ${o.max}`);

  return {
    level, prof: pb, scores, naturalScores: natural, mods, saves, skills, ac, acNotes, initiative, speed, speeds, hover: movement.hover, speedNotes, movement,
    overLimits,
    passivePerception: 10 + skill('Perception') + bonus('passive perception') + obs,
    passiveInvestigation: 10 + skill('Investigation') + bonus('passive investigation') + obs,
    passiveInsight: 10 + skill('Insight') + bonus('passive insight'),
    hpMax, hitDice, spellcasting, slots, slotsUsed, pact, attacks, features, counters,
    proficiencies: {
      armor: [...prof.armor], weapons: [...prof.weapons], tools: [...prof.tools],
      other: [...prof.other].filter((p) => !isSkill(p)),
    },
    skillProficiencies: [...skillProf], expertise: [...expertise], customAbilities: customAbilityList,
    carried: Math.round(carried * 100) / 100, capacity, modifiers, formula,
    classes: classes.map(({ ce, cv, level: lv, subclasses }) => ({ el: ce, name: cv.name, level: lv, subclasses })),
    warnings,
  };
}

const classOfName = (cs: ClassInfo[], name: string) => cs.find((k) => k.name === name);
/** Warlocks cast one spell of 6th-9th level each day through Mystic Arcanum (11th, 13th, 15th, 17th level). */
const mysticArcanumLevel = (k: ClassInfo | undefined) =>
  !k || k.base !== 'warlock' ? 0 : k.level >= 17 ? 9 : k.level >= 15 ? 8 : k.level >= 13 ? 7 : k.level >= 11 ? 6 : 0;

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
