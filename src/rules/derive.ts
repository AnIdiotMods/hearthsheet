// Rules engine: derives the character sheet from the character document.
// Pure functions of (character, app state, options); no UI or storage.

import {
  ABILITIES, Ability, ClassFeature, Counter, Modifier, SKILLS, backgroundView, canonicalSkill, classView,
  featView, isSkill, itemView, raceView,
} from '../model/compendium';
import {
  AppState, Character, classChoices, classLevel, classSubclass, isAttuned, isEquipped, itemQuantity,
} from '../model/character';
import { XElement, childText } from '../xml/xml';

export interface RulesOptions {
  /** 2024 rules round half-caster levels up when multiclassing; 2014 rounds down. */
  multiclassRounding: '2014' | '2024';
  /** Apply racial <ability> bonuses (otherwise only "ability score" modifiers are used). */
  applyRaceAbilityElement: boolean;
}
export const defaultOptions: RulesOptions = { multiclassRounding: '2014', applyRaceAbilityElement: true };

export const mod = (score: number) => Math.floor((score - 10) / 2);
export const profBonus = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
export const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export interface SourcedModifier extends Modifier { source: string }
export interface ActiveFeature { name: string; text: string; source: string; level?: number }

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
  hitDice: { className: string; die: number; total: number }[];
  spellcasting: Spellcasting[];
  slots: number[];               // combined (index 1..9)
  pact: { level: number; count: number } | null;
  attacks: Attack[];
  features: ActiveFeature[];
  counters: (Counter & { source: string })[];
  proficiencies: { armor: string[]; weapons: string[]; tools: string[]; other: string[] };
  carried: number;
  capacity: number;
  modifiers: SourcedModifier[];
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

type CV = ReturnType<typeof classView>;

/** Features of a class that apply at the character's level and choices. */
export function activeClassFeatures(cv: CV, level: number, subclass: string, choices: string[]): ClassFeature[] {
  const sub = subclass.trim().toLowerCase();
  return cv.features.filter((f) => {
    if (f.level > level) return false;
    if (!f.optional) return !f.subclass || f.subclass.toLowerCase() === sub;
    if (choices.includes(f.name)) return true;
    if (!sub) return false;
    if (f.subclass) return f.subclass.toLowerCase() === sub;
    return f.name.toLowerCase().includes(sub);
  });
}

/** Slot rows that apply: non-optional rows, or optional rows when the chosen subclass grants spellcasting. */
function slotRowAt(cv: CV, level: number, active: ClassFeature[]): number[] | null {
  const subclassCasts = active.some((f) => f.optional && /spellcasting|pact magic/i.test(f.name));
  const rows = cv.slots.filter((r) => r.level <= level && (!r.optional || subclassCasts));
  if (!rows.length) return null;
  return rows.reduce((a, b) => (b.level >= a.level ? b : a)).values;
}

/** Classify how a class casts from the shape of its slot table. */
export function casterKind(cv: CV, active: ClassFeature[] = []): CasterKind {
  const subclassCasts = active.some((f) => f.optional && /spellcasting|pact magic/i.test(f.name));
  const rows = cv.slots.filter((r) => !r.optional || subclassCasts);
  if (!rows.length) return 'none';
  if (/pact magic/i.test(cv.features.map((f) => f.name).join('|'))) return 'pact';
  // Compendiums are often partial (e.g. levels 1-5 only), so compare every
  // row's highest slot level against the standard full/half/third curves.
  const highestOf = (v: number[]) => v.slice(1).reduce((h, n, i) => (n > 0 ? i + 1 : h), 0);
  const casting = rows.filter((r) => highestOf(r.values) > 0);
  if (!casting.length) return 'none';
  if (casting.some((r) => r.values.slice(1).filter((n) => n > 0).length === 1 && highestOf(r.values) > 1)) return 'pact';
  const score = (kind: 'full' | 'half' | 'third') =>
    casting.filter((r) => Math.abs(highestOf(r.values) - expectedHighest(kind, r.level)) === 0).length;
  const kinds = (['full', 'half', 'third'] as const).map((k) => [k, score(k)] as const);
  return kinds.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/** Highest spell slot level of the standard progressions at a class level. */
function expectedHighest(kind: 'full' | 'half' | 'third', L: number): number {
  if (kind === 'full') return Math.min(9, Math.ceil(L / 2));
  if (kind === 'half') return L < 2 ? 1 : Math.min(5, Math.floor((L - 1) / 4) + 1);
  return L < 3 ? 0 : L < 7 ? 1 : L < 13 ? 2 : L < 19 ? 3 : 4;
}

const sumMods = (mods: SourcedModifier[], pred: (m: SourcedModifier) => boolean) =>
  mods.filter((m) => m.mode === 'add' && pred(m)).reduce((s, m) => s + m.value, 0);

export function deriveSheet(c: Character, app: AppState, opts: RulesOptions = defaultOptions): Sheet {
  const warnings: string[] = [];
  const modifiers: SourcedModifier[] = [];
  const features: ActiveFeature[] = [];
  const counters: Sheet['counters'] = [];
  const addMods = (ms: Modifier[], source: string) => ms.forEach((m) => modifiers.push({ ...m, source }));
  const prof = { armor: new Set<string>(), weapons: new Set<string>(), tools: new Set<string>(), other: new Set<string>() };
  const skillProf = new Set<string>(c.skills.map((s) => canonicalSkill(s) ?? s));
  const addProfList = (list: string[]) => list.forEach((p) => {
    const sk = canonicalSkill(p);
    if (sk) skillProf.add(sk);
    else if (!ABILITIES.some((a) => a === p.toLowerCase())) prof.other.add(p);
  });

  // ---- race
  const raceEl = c.race;
  const race = raceEl ? raceView(raceEl) : null;
  if (race) {
    addMods(race.modifiers, race.name);
    race.traits.forEach((t) => { addMods(t.modifiers, race.name); features.push({ name: t.name, text: t.text, source: race.name }); });
    addProfList(race.proficiencies);
  } else warnings.push('No race selected');

  // ---- background
  const bgEl = c.background;
  if (bgEl) {
    const bg = backgroundView(bgEl);
    addMods(bg.modifiers, bg.name);
    bg.traits.forEach((t) => { addMods(t.modifiers, bg.name); features.push({ name: t.name, text: t.text, source: bg.name }); });
    addProfList(bg.proficiencies);
  }

  // ---- feats
  for (const fe of c.feats) {
    const f = featView(fe);
    addMods(f.modifiers, f.name);
    addProfList(f.proficiencies);
    features.push({ name: f.name, text: f.text, source: 'Feat' });
  }

  // ---- classes
  const classes = c.classes.map((ce) => {
    const cv = classView(ce);
    const level = classLevel(ce);
    const active = activeClassFeatures(cv, level, classSubclass(ce), classChoices(ce));
    return { ce, cv, level, active };
  });
  const level = classes.reduce((s, x) => s + x.level, 0);
  if (!classes.length) warnings.push('No class selected');
  classes.forEach(({ ce, cv, level: lv, active }, i) => {
    const source = `${cv.name} ${lv}`;
    for (const f of active) {
      addMods(f.modifiers, `${cv.name}: ${f.name}`);
      features.push({ name: f.name, text: f.text, source: cv.name, level: f.level });
    }
    const sub = classSubclass(ce).toLowerCase();
    const latest = new Map<string, Counter>();
    for (const ct of cv.counters) {
      if (ct.level > lv || (ct.subclass && ct.subclass.toLowerCase() !== sub)) continue;
      const prev = latest.get(ct.name);
      if (!prev || ct.level >= prev.level) latest.set(ct.name, ct);
    }
    latest.forEach((ct) => counters.push({ ...ct, source }));
    // Armor, weapon and tool proficiency: the first class grants all; later
    // classes use the multiclass subset, which this format does not encode,
    // so they are listed but flagged.
    splitListLoose(cv.armor).forEach((a) => prof.armor.add(a));
    splitListLoose(cv.weapons).forEach((w) => prof.weapons.add(w));
    splitListLoose(cv.tools).forEach((t) => prof.tools.add(t));
    if (i > 0 && (cv.armor || cv.weapons)) {
      warnings.push(`${cv.name}: multiclass proficiencies are a subset of the class list; review manually`);
    }
  });

  // ---- equipment
  const items = c.items.map((ie) => ({ ie, v: itemView(ie), equipped: isEquipped(ie), attuned: isAttuned(ie), qty: itemQuantity(ie) }));
  for (const it of items) {
    if (!it.equipped && !it.attuned) continue;
    const needsAttune = /requires attunement/i.test(it.v.detail);
    if (needsAttune && !it.attuned) continue;
    addMods(it.v.modifiers, it.v.name);
  }
  const attunedCount = items.filter((i) => i.attuned).length;
  if (attunedCount > 3) warnings.push(`${attunedCount} items attuned (limit is normally 3)`);

  // ---- ability scores
  const base = c.abilities;
  const scores = { ...base };
  if (race && opts.applyRaceAbilityElement && Object.keys(race.abilityBonuses).length) {
    for (const [a, v] of Object.entries(race.abilityBonuses)) scores[a as Ability] += v!;
  }
  const raceHasAbilityElement = !!race && Object.keys(race.abilityBonuses).length > 0 && opts.applyRaceAbilityElement;
  for (const m of modifiers) {
    if (m.category !== 'ability score') continue;
    const a = ABILITIES.find((x) => x === m.target || x.slice(0, 3) === m.target.slice(0, 3));
    if (!a) continue;
    if (raceHasAbilityElement && race && m.source === race.name && m.mode === 'add') continue; // avoid double counting
    if (m.mode === 'add') scores[a] += m.value;
    else scores[a] = Math.max(scores[a], m.value);
  }
  const mods = {} as Record<Ability, number>;
  ABILITIES.forEach((a) => { mods[a] = mod(scores[a]) + sumMods(modifiers, (m) => m.category === 'ability modifier' && m.target === a); });

  const pb = profBonus(level) + sumMods(modifiers, (m) => m.category === 'bonus' && m.target === 'proficiency bonus');
  const bonus = (target: string) => sumMods(modifiers, (m) => m.category === 'bonus' && m.target === target);

  // ---- saves (the first class grants saving throw proficiencies)
  const saveProf = new Set<Ability>(classes[0]?.cv.savingThrows ?? []);
  for (const m of modifiers) {
    if (m.category === 'saving throw' && m.mode === 'set') {
      const a = ABILITIES.find((x) => x === m.target);
      if (a) saveProf.add(a);
    }
  }
  const saves = ABILITIES.map((a) => ({
    ability: a,
    proficient: saveProf.has(a),
    bonus: mods[a] + (saveProf.has(a) ? pb : 0) + bonus('saving throws')
      + sumMods(modifiers, (m) => m.category === 'saving throw' && (m.target === a || m.target === a.slice(0, 3))),
  }));

  // ---- skills
  const expertise = new Set(c.expertise.map((s) => canonicalSkill(s) ?? s));
  const joat = features.some((f) => /jack of all trades/i.test(f.name));
  const skills = SKILLS.map(([name, ab]) => {
    const proficient = skillProf.has(name) || expertise.has(name);
    const exp = expertise.has(name);
    const half = !proficient && joat;
    const b = mods[ab] + (exp ? pb * 2 : proficient ? pb : half ? Math.floor(pb / 2) : 0)
      + bonus('ability checks') + sumMods(modifiers, (m) => m.category === 'skill' && m.target === name.toLowerCase());
    return { name, ability: ab, bonus: b, proficient, expertise: exp, half };
  });
  const skill = (n: string) => skills.find((s) => s.name === n)!.bonus;

  // ---- armor class
  const acNotes: string[] = [];
  const armor = items.filter((i) => i.equipped && ['LA', 'MA', 'HA'].includes(i.v.type))
    .sort((a, b) => b.v.ac - a.v.ac)[0];
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
  } else {
    ac = 10 + mods.dexterity;
    acNotes.push(`Unarmored 10 ${fmt(mods.dexterity)} Dex`);
    const ud = features.find((f) => /unarmored defense/i.test(f.name));
    if (ud) {
      const extra = /constitution/i.test(ud.text) ? 'constitution' : /wisdom/i.test(ud.text) ? 'wisdom' : null;
      const monkStyle = extra === 'wisdom';
      if (extra && !(monkStyle && shields.length)) {
        ac += mods[extra];
        acNotes.push(`${ud.name} ${fmt(mods[extra])} ${extra.slice(0, 3).replace(/^./, (x) => x.toUpperCase())}`);
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

  // ---- speed, initiative, passives
  let speed = (race?.speed ?? 30) + bonus('speed');
  if (armor && armor.v.type === 'HA' && armor.v.strength && scores.strength < armor.v.strength) speed -= 10;
  const initiative = mods.dexterity + bonus('initiative') + (joat ? Math.floor(pb / 2) : 0);

  // ---- hit points
  const hpMax = c.hpMax + bonus('hp');

  // ---- spellcasting
  const spellcasting: Spellcasting[] = [];
  let casterLevel = 0;
  let pact: Sheet['pact'] = null;
  const ownSlots: number[][] = [];
  for (const { cv, level: lv, active } of classes) {
    const ability = cv.spellAbility ?? (active.some((f) => /spellcasting/i.test(f.name)) ? guessSpellAbility(active) : null);
    const row = slotRowAt(cv, lv, active);
    if (!ability || !row) continue;
    const kind = casterKind(cv, active);
    const slots = [0, ...Array.from({ length: 9 }, (_, i) => row[i + 1] ?? 0)];
    spellcasting.push({
      className: cv.name, ability, kind, cantrips: row[0] ?? 0, slots,
      dc: 8 + pb + mods[ability] + bonus('spell dc'),
      attack: pb + mods[ability] + bonus('spell attack'),
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

  // ---- attacks
  const isProficient = (name: string, props: string[]) => {
    const w = [...prof.weapons].join(', ').toLowerCase();
    const martial = props.includes('M');
    return (martial ? /martial/.test(w) : /simple/.test(w)) || w.includes(name.toLowerCase().replace(/^\+\d\s*/, ''));
  };
  const attacks: Attack[] = [];
  for (const it of items) {
    if (!it.equipped || !['M', 'R'].includes(it.v.type) || !it.v.dmg1) continue;
    const ranged = it.v.type === 'R';
    const finesse = it.v.properties.includes('F');
    const ab: Ability = ranged ? 'dexterity' : finesse && mods.dexterity > mods.strength ? 'dexterity' : 'strength';
    const kind = ranged ? 'ranged' : 'melee';
    const itemMods = it.v.modifiers;
    const own = (t: string) => itemMods.filter((m) => m.category === 'bonus' && m.target === t).reduce((s, m) => s + m.value, 0);
    // Item modifiers are already in `modifiers` (when equipped); keep a weapon's
    // own attack/damage bonus from applying to every other weapon.
    const globalAtk = bonus(`${kind} attacks`) - own(`${kind} attacks`) + bonus('weapon attacks') - own('weapon attacks');
    const globalDmg = bonus(`${kind} damage`) - own(`${kind} damage`) + bonus('weapon damage') - own('weapon damage');
    const atk = mods[ab] + (isProficient(it.v.name, it.v.properties) ? pb : 0) + globalAtk
      + own(`${kind} attacks`) + own('weapon attacks');
    const dmgBonus = mods[ab] + globalDmg + own(`${kind} damage`) + own('weapon damage');
    const d = (dice: string) => (dmgBonus ? `${dice}${fmt(dmgBonus)}` : dice);
    attacks.push({
      name: it.v.name, bonus: atk, damage: d(it.v.dmg1), versatile: it.v.dmg2 ? d(it.v.dmg2) : undefined,
      damageType: it.v.dmgType, range: it.v.range,
      notes: it.v.properties.map((p) => p).join(', '),
    });
  }
  attacks.push({
    name: 'Unarmed Strike', bonus: mods.strength + pb, damage: `${Math.max(1, 1 + mods.strength)}`,
    damageType: 'bludgeoning', range: '', notes: '',
  });

  // ---- carrying
  const carried = items.reduce((s, i) => s + i.v.weight * i.qty, 0);
  const capacity = scores.strength * 15;

  const hitDice = classes.map(({ cv, level: lv }) => ({ className: cv.name, die: cv.hd, total: lv }));

  if (app.exhaustion > 0) warnings.push(`Exhaustion level ${app.exhaustion}`);

  return {
    level, prof: pb, scores, mods, saves, skills, ac, acNotes, initiative, speed,
    passivePerception: 10 + skill('Perception') + bonus('passive perception'),
    passiveInvestigation: 10 + skill('Investigation') + bonus('passive investigation'),
    passiveInsight: 10 + skill('Insight') + bonus('passive insight'),
    hpMax, hitDice, spellcasting, slots, pact, attacks, features, counters,
    proficiencies: {
      armor: [...prof.armor], weapons: [...prof.weapons], tools: [...prof.tools],
      other: [...prof.other].filter((p) => !isSkill(p)),
    },
    carried, capacity, modifiers, warnings,
  };
}

function guessSpellAbility(active: ClassFeature[]): Ability | null {
  const t = active.filter((f) => /spellcasting/i.test(f.name)).map((f) => f.text).join(' ');
  const m = /(Intelligence|Wisdom|Charisma) is your spellcasting ability/i.exec(t);
  return m ? (m[1].toLowerCase() as Ability) : null;
}

const splitListLoose = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter((x) => x && !/^none$/i.test(x));

/** Average HP gained per level for a hit die. */
export const averageHp = (hd: number) => Math.floor(hd / 2) + 1;

export const spellNameOf = (s: XElement) => childText(s, 'name');
