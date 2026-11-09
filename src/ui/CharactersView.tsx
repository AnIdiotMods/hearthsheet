import { useMemo, useState } from 'react';
import {
  ABBR, ABILITIES, Ability, SKILLS, backgroundView, classView, featView, lookup, raceView, sourceOf, sourceTag, spellClassMatches, spellView,
} from '../model/compendium';
import { setSkillSetting } from '../model/custom';
import { OptionItem, grantsExpertise, optionGroups } from '../rules/options';
import {
  ExpertisePicker, ExtraChoicesPicker, ExtraValues, OptionGroupsPicker, SubclassFeatures, applyExtraChoices, emptyExtras, extraNeeds,
  optionContext, subclassOptionLabel,
} from './Options';
import { Character, CharacterRecord, classLevel, emptyAppState } from '../model/character';
import { applyLevelUp, defaultSubclassPicks, levelOptions, POINT_BUY_COST, pointBuyTotal, STANDARD_ARRAY, subclassFeaturesAt } from '../rules/level';
import { cryptoRng, roll } from '../rules/dice';
import { XElement, childText } from '../xml/xml';
import { Field, Modal, NumberInput, TooHighTag, confirmOverLimit, useApp } from './common';
import { ask } from './dialogs';
import { RulesOptions, deriveSheet, mod } from '../rules/derive';

interface Props {
  records: CharacterRecord[];
  onOpen: (r: CharacterRecord) => void;
  onCreate: (c: Character) => void;
  onImport: () => void;
  onExport: (r: CharacterRecord) => void;
  onDelete: (r: CharacterRecord) => void;
  onDuplicate: (r: CharacterRecord) => void;
}

export function CharactersView({ records, onOpen, onCreate, onImport, onExport, onDelete, onDuplicate }: Props) {
  const { options } = useApp();
  const [creating, setCreating] = useState(false);
  const summaries = useMemo(() => new Map(records.map((r) => [r.id, summarize(r, options)])), [records, options]);
  return (
    <div className="characters">
      <div className="row between">
        <h1>Characters</h1>
        <div className="row">
          <button className="primary" onClick={() => setCreating(true)}>New character</button>
          <button onClick={onImport}>Import XML…</button>
        </div>
      </div>
      {records.length === 0 && <p className="muted">No characters yet. Create one, or import a character XML file.</p>}
      <div className="cards">
        {records.map((r) => {
          const summary = summaries.get(r.id) ?? summarize(r, options);
          return (
            <div key={r.id} className="card" onClick={() => onOpen(r)}>
              <h3>{summary.name} <TooHighTag items={summary.over} /></h3>
              <p className="muted">{summary.line || 'No class yet'}</p>
              <div className="row card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="link" onClick={() => onExport(r)}>Export</button>
                <button className="link" onClick={() => onDuplicate(r)}>Duplicate</button>
                <button className="link danger" onClick={async () => { if (await ask(`Delete ${summary.name}? This cannot be undone.`, { ok: 'Delete', danger: true })) onDelete(r); }}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
      {creating && <NewCharacter onClose={() => setCreating(false)} onCreate={(c) => { setCreating(false); onCreate(c); }} />}
    </div>
  );
}

function summarize(r: CharacterRecord, options: RulesOptions) {
  try {
    const c = Character.parse(r.xml);
    const race = c.race ? childText(c.race, 'name') : '';
    const classes = c.classes.map((ce) => `${childText(ce, 'name')} ${classLevel(ce)}`).join(' / ');
    let over: string[] = [];
    try { over = deriveSheet(c, r.app ?? emptyAppState(), options).overLimits; } catch { over = []; }
    return { name: c.name, line: [race, classes].filter(Boolean).join(' · '), over };
  } catch {
    return { name: '(unreadable)', line: '', over: [] as string[] };
  }
}

type Method = 'standard' | 'pointbuy' | 'roll' | 'manual';

/** Racial ability choices the file does not encode (Variant Human, Half-Elf, Custom Lineage), from the name or trait text. */
function raceAbilityChoice(name: string, traits: { name: string; text: string }[], fixed: Partial<Record<Ability, number>>): { plusOne: number; plusTwo: number; exclude: Ability[] } | null {
  const text = traits.map((t) => t.text).join('\n');
  const n = name.toLowerCase();
  if (/two (different |other )?ability scores of your choice (each )?increase by 1|increase (two|2) (different )?ability scores of your choice by 1/i.test(text)) {
    return { plusOne: 2, plusTwo: 0, exclude: /other ability scores/i.test(text) ? (Object.keys(fixed) as Ability[]) : [] };
  }
  if (/one ability score of your choice increases by 2/i.test(text)) return { plusOne: 0, plusTwo: 1, exclude: [] };
  if (Object.keys(fixed).length) {
    // Half-Elf: Charisma +2 in the file, and two other scores +1 by choice (only in the book's text).
    if (/^half-elf\b/.test(n) && Object.values(fixed).reduce((t, v) => t + (v ?? 0), 0) <= 2) return { plusOne: 2, plusTwo: 0, exclude: ['charisma'] };
    return null;
  }
  if (/^(human \(variant\)|variant human|human, variant)/.test(n)) return { plusOne: 2, plusTwo: 0, exclude: [] };
  if (/^custom lineage/.test(n)) return { plusOne: 0, plusTwo: 1, exclude: [] };
  return null;
}

function NewCharacter({ onClose, onCreate }: { onClose: () => void; onCreate: (c: Character) => void }) {
  const { lib, options } = useApp();
  const [name, setName] = useState('');
  const [race, setRace] = useState(lib.byKind.race[0]?.name ?? '');
  const [cls, setCls] = useState(lib.byKind.class[0]?.name ?? '');
  const [bg, setBg] = useState(lib.byKind.background[0]?.name ?? '');
  const [method, setMethod] = useState<Method>('standard');
  const [scores, setScores] = useState<Record<Ability, number>>(fromList(STANDARD_ARRAY));
  const [skills, setSkills] = useState<string[]>([]);
  const [choices, setChoices] = useState<string[]>([]);
  const [raceBonus, setRaceBonus] = useState<Ability[]>([]);
  const [raceFeat, setRaceFeat] = useState('');
  const [raceCantrip, setRaceCantrip] = useState('');
  const [extras, setExtras] = useState<ExtraValues>(emptyExtras());
  const [gold, setGold] = useState(false);

  const raceEl = lookup(lib, 'race', race)?.el;
  const classEl = lookup(lib, 'class', cls)?.el;
  const bgEl = lookup(lib, 'background', bg)?.el;
  const cv = classEl ? classView(classEl) : null;
  const rv = raceEl ? raceView(raceEl) : null;
  const fixed = useMemo(() => new Set([...(rv?.proficiencies ?? []), ...(bgEl ? backgroundView(bgEl).proficiencies : [])]), [rv, bgEl]);
  const [subclass, setSubclass] = useState('');
  const [optionFeats, setOptionFeats] = useState<OptionItem[]>([]);
  const [expertise, setExpertise] = useState<string[]>([]);
  const lo = classEl ? levelOptions(classEl, 1, options) : null;
  const level1Plain = lo ? lo.other.filter((f) => !f.name.includes(':')) : [];
  const incoming = lo ? [...lo.gained, ...lo.cv.features.filter((f) => f.level === 1 && choices.includes(f.name))] : [];
  const groups = lo ? optionGroups(optionContext({ lib, cv: lo.cv, level: 1, c: null, incoming, subclass: subclass || undefined })) : [];
  const toggleOption = (o: OptionItem, on: boolean) => {
    if (o.feature) setChoices(on ? [...choices, o.name] : choices.filter((x) => x !== o.name));
    else setOptionFeats(on ? [...optionFeats, o] : optionFeats.filter((x) => x.name !== o.name));
  };
  const pickSubclass = (sub: string) => {
    if (!lo) return;
    const dropped = new Set(lo.subclassChoices.flatMap((x) => subclassFeaturesAt(lo.cv, x, 1).map((f) => f.name)));
    const base = choices.filter((n) => !dropped.has(n));
    setSubclass(sub);
    setChoices(sub ? [...base, ...defaultSubclassPicks(lo.cv, sub, 1).map((f) => f.name)] : base);
  };
  const needsExpertise = grantsExpertise(incoming);
  // Choices in racial traits and level-1 features: skills, a feat, a cantrip, the dragon ancestor.
  const traits = rv?.traits ?? [];
  const abilityChoice = rv ? raceAbilityChoice(rv.name, traits, rv.abilityBonuses) : null;
  const needs = extraNeeds([...traits, ...incoming], cv?.skillChoices);
  const featTrait = traits.find((t) => /\b(one|a) feat of your choice/i.test(t.text));
  const cantripMatch = traits.map((t) => /one cantrip of your choice from the (\w+) spell list/i.exec(t.text)).find(Boolean);
  const cantrips = cantripMatch ? lib.byKind.spell.filter((e) => { const v = spellView(e.el); return v.level === 0 && v.classes.some((x) => spellClassMatches(x, cantripMatch[1])); }) : [];
  const chosenBonus = (a: Ability) => !abilityChoice ? 0 : raceBonus.includes(a) ? (abilityChoice.plusTwo ? 2 : 1) : 0;
  const bonusCount = abilityChoice ? abilityChoice.plusOne + abilityChoice.plusTwo : 0;
  const proficientSkills = [...new Set([...skills, ...fixed, ...extras.skills])].filter((x) => SKILLS.some(([n]) => n === x));
  const wealth = cv ? /(\d+d\d+)\s*[x×*]\s*(\d+)/i.exec(cv.wealth) ?? /^(\d+d\d+)$/.exec(cv.wealth.trim()) : null;

  const setMethodAndReset = (m: Method) => {
    setMethod(m);
    if (m === 'standard') setScores(fromList(STANDARD_ARRAY));
    if (m === 'pointbuy') setScores(fromList([8, 8, 8, 8, 8, 8]));
    if (m === 'roll') setScores(fromList(ABILITIES.map(() => roll('4d6kh3', cryptoRng).total)));
  };
  const pb = pointBuyTotal(scores);
  const swap = (a: Ability, value: number) => {
    const other = ABILITIES.find((x) => x !== a && scores[x] === value);
    setScores({ ...scores, [a]: value, ...(other ? { [other]: scores[a] } : {}) });
  };
  const pool = method === 'standard' ? STANDARD_ARRAY : [...ABILITIES.map((a) => scores[a])].sort((x, y) => y - x);
  const valid = name.trim() && classEl && (method !== 'pointbuy' || pb <= 27);

  const create = async () => {
    const over = ABILITIES.filter((a) => scores[a] + (rv?.abilityBonuses[a] ?? 0) + chosenBonus(a) > 20)
      .map((a) => `${ABBR[a]} ${scores[a] + (rv?.abilityBonuses[a] ?? 0) + chosenBonus(a)}`);
    if (over.length && !(await confirmOverLimit(`Starting scores above 20: ${over.join(', ')}.`))) return;
    const c = Character.create(name.trim());
    if (raceEl) c.setRace(raceEl);
    for (const a of raceBonus) if (abilityChoice) c.addRaceAbilityBonus(a, abilityChoice.plusTwo ? 2 : 1);
    if (bgEl) c.setBackground(bgEl);
    c.abilities = scores;
    let ce: XElement | null = null;
    if (classEl) ce = applyLevelUp(c, { newClass: classEl, hp: { method: 'max' }, choices, skills, subclass: subclass || undefined }, cryptoRng, options);
    for (const o of optionFeats) if (o.feat) c.addFeat(o.feat.el);
    for (const name of needsExpertise ? expertise : []) setSkillSetting(c.ch, name, { prof: 2 }, (e) => c.insert(e));
    applyExtraChoices(c, ce, needs, extras);
    const featEl = raceFeat ? lib.byKind.feat.find((f) => f.name === raceFeat)?.el : undefined;
    if (featEl) c.addFeat(featEl);
    const cantripEl = raceCantrip ? lookup(lib, 'spell', raceCantrip)?.el : undefined;
    if (cantripEl && ce) c.addSpell(ce, cantripEl, rv?.name ?? 'Race');
    if (gold && wealth) {
      const total = roll(wealth[1], cryptoRng).total * (wealth[2] ? +wealth[2] : 1);
      c.setCoin('gp', c.coin('gp') + total);
    }
    onCreate(c);
  };

  if (!lib.byKind.class.length) {
    return (
      <Modal title="New character" onClose={onClose}>
        <p>There are no classes in your compendium. Import a compendium file (or add the SRD sample) on the Compendium tab first.</p>
      </Modal>
    );
  }

  return (
    <Modal title="New character" onClose={onClose} wide>
      <div className="grid2">
        <Field label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Race">
          <select value={race} onChange={(e) => { setRace(e.target.value); setRaceBonus([]); setRaceFeat(''); setRaceCantrip(''); setExtras(emptyExtras()); }}>
            <option value="">(none)</option>
            {lib.byKind.race.map((r) => <option key={r.name} value={r.name}>{r.name}{sourceTag(r.name, sourceOf(r.el)) && !/\((UA|HB)\)/.test(r.name) ? ` [${sourceTag(r.name, sourceOf(r.el))}]` : ''}</option>)}
          </select>
        </Field>
        <Field label="Class">
          <select value={cls} onChange={(e) => { setCls(e.target.value); setSkills([]); setChoices([]); setSubclass(''); setOptionFeats([]); setExpertise([]); setExtras(emptyExtras()); }}>
            {lib.byKind.class.map((r) => <option key={r.name}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Background">
          <select value={bg} onChange={(e) => setBg(e.target.value)}>
            <option value="">(none)</option>
            {lib.byKind.background.map((r) => <option key={r.name}>{r.name}</option>)}
          </select>
        </Field>
      </div>

      <h3>Ability scores</h3>
      <div className="row">
        {(['standard', 'pointbuy', 'roll', 'manual'] as Method[]).map((m) => (
          <label key={m} className="radio"><input type="radio" checked={method === m} onChange={() => setMethodAndReset(m)} />
            {{ standard: 'Standard array', pointbuy: 'Point buy', roll: 'Roll 4d6', manual: 'Manual' }[m]}</label>
        ))}
        {method === 'roll' && <button onClick={() => setMethodAndReset('roll')}>Reroll</button>}
        {method === 'pointbuy' && <span className={pb > 27 ? 'danger' : 'muted'}>{pb} / 27 points</span>}
      </div>
      <div className="score-grid">
        {ABILITIES.map((a) => {
          const bonus = (rv?.abilityBonuses[a] ?? 0) + chosenBonus(a);
          const total = scores[a] + bonus;
          return (
            <div key={a} className="score-pick">
              <b>{ABBR[a]}</b>
              {method === 'manual' && <NumberInput value={scores[a]} min={1} max={30} onChange={(n) => setScores({ ...scores, [a]: n })} />}
              {method === 'pointbuy' && (
                <select value={scores[a]} onChange={(e) => setScores({ ...scores, [a]: +e.target.value })}>
                  {Object.keys(POINT_BUY_COST).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
              {(method === 'standard' || method === 'roll') && (
                <select value={scores[a]} onChange={(e) => swap(a, +e.target.value)}>
                  {[...new Set(pool)].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
              <span className={`small ${total > 20 ? 'danger' : 'muted'}`}>{bonus ? `${bonus > 0 ? '+' : ''}${bonus} race → ` : ''}{total} ({mod(total) >= 0 ? '+' : ''}{mod(total)})</span>
            </div>
          );
        })}
      </div>
      {abilityChoice && (
        <div>
          <h3>Racial ability increase <span className="muted small">{abilityChoice.plusTwo ? 'choose one score to increase by 2' : `choose ${abilityChoice.plusOne} different scores to increase by 1`}{abilityChoice.exclude.length ? ` (not ${abilityChoice.exclude.map((a) => ABBR[a]).join(', ')})` : ''}</span></h3>
          <div className="checks">
            {ABILITIES.filter((a) => !abilityChoice.exclude.includes(a)).map((a) => (
              <label key={a}>
                <input type="checkbox" checked={raceBonus.includes(a)} onChange={async (e) => {
                  const on = e.target.checked;
                  if (on && raceBonus.length >= bonusCount && !(await confirmOverLimit(`${rv?.name} lets you choose ${bonusCount}, and this would make ${raceBonus.length + 1}.`))) return;
                  setRaceBonus(on ? [...raceBonus, a] : raceBonus.filter((x) => x !== a));
                }} /> {ABBR[a]}
              </label>
            ))}
          </div>
        </div>
      )}
      {featTrait && lib.byKind.feat.length > 0 && (
        <Field label={`${rv?.name}: feat (${featTrait.name})`}>
          <select value={raceFeat} onChange={(e) => setRaceFeat(e.target.value)}>
            <option value="">(choose a feat)</option>
            {lib.byKind.feat.filter((f) => !/:/.test(f.name)).map((f) => <option key={f.name} title={featView(f.el).prerequisite}>{f.name}</option>)}
          </select>
        </Field>
      )}
      {cantripMatch && cantrips.length > 0 && (
        <Field label={`${rv?.name}: cantrip from the ${cantripMatch[1].toLowerCase()} spell list`}>
          <select value={raceCantrip} onChange={(e) => setRaceCantrip(e.target.value)}>
            <option value="">(choose a cantrip)</option>
            {cantrips.map((e) => <option key={e.name}>{e.name}</option>)}
          </select>
        </Field>
      )}

      {cv && (
        <>
          <h3>Class skills <span className="muted small">choose {cv.numSkills}</span></h3>
          <div className="checks">
            {cv.skillChoices.map((s) => (
              <label key={s} className={fixed.has(s) ? 'muted' : ''}>
                <input type="checkbox" disabled={fixed.has(s)}
                  checked={skills.includes(s) || fixed.has(s)}
                  onChange={async (e) => {
                    const on = e.target.checked;
                    if (on && skills.length >= cv.numSkills && !(await confirmOverLimit(`${cv.name} chooses ${cv.numSkills} skills, and this would make ${skills.length + 1}.`))) return;
                    setSkills(on ? [...skills, s] : skills.filter((x) => x !== s));
                  }} />
                {s}{fixed.has(s) && ' (granted)'}
              </label>
            ))}
          </div>
        </>
      )}
      {lo && lo.subclassChoices.length > 0 && (
        <Field label={lo.subclassLabel}>
          <select value={subclass} onChange={(e) => pickSubclass(e.target.value)}>
            <option value="">(choose)</option>
            {lo.subclassChoices.map((sub) => <option key={sub} value={sub}>{subclassOptionLabel(lo.cv, sub)}</option>)}
          </select>
        </Field>
      )}
      {lo && subclass && <SubclassFeatures cv={lo.cv} subclass={subclass} level={1} picked={choices} setPicked={setChoices} />}
      {level1Plain.length > 0 && (
        <>
          <h3>Level 1 options</h3>
          <div className="checks">
            {level1Plain.map((f) => (
              <label key={f.name} title={f.text}>
                <input type="checkbox" checked={choices.includes(f.name)}
                  onChange={(e) => setChoices(e.target.checked ? [...choices, f.name] : choices.filter((x) => x !== f.name))} />
                {f.name}
              </label>
            ))}
          </div>
        </>
      )}
      {lo && lo.optionalRules.length > 0 && (
        <>
          <h3>Optional class features <span className="muted small">Tasha's Cauldron of Everything · ask your DM</span></h3>
          <div className="checks">
            {lo.optionalRules.map((f) => (
              <label key={f.name} title={f.text.slice(0, 600)}>
                <input type="checkbox" checked={choices.includes(f.name)} onChange={(e) => setChoices(e.target.checked ? [...choices, f.name] : choices.filter((x) => x !== f.name))} /> {f.name}
              </label>
            ))}
          </div>
        </>
      )}
      <OptionGroupsPicker groups={groups} picked={[...choices, ...optionFeats.map((o) => o.name)]} onToggle={toggleOption} />
      {needsExpertise && (
        <ExpertisePicker skills={proficientSkills.map((n) => ({ name: n, proficient: true, expertise: false }))} picked={expertise} onChange={setExpertise} />
      )}
      <ExtraChoicesPicker needs={needs} value={extras} onChange={setExtras} proficient={[...new Set([...skills, ...fixed])]} />
      {wealth && (
        <label className="check">
          <input type="checkbox" checked={gold} onChange={(e) => setGold(e.target.checked)} />
          {' '}Roll starting gold ({cv!.wealth.replace(/x/i, '×')} gp) instead of taking starting equipment
        </label>
      )}
      <footer className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!valid} onClick={create}>Create</button>
      </footer>
    </Modal>
  );
}

const fromList = (v: number[]) => Object.fromEntries(ABILITIES.map((a, i) => [a, v[i]])) as Record<Ability, number>;

export const newRecord = (c: Character, id: string): CharacterRecord => ({ id, xml: c.serialize(), app: emptyAppState(), updatedAt: Date.now() });
