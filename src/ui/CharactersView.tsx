import { useMemo, useState } from 'react';
import { ABBR, ABILITIES, Ability, SKILLS, backgroundView, classView, lookup, raceView } from '../model/compendium';
import { setSkillSetting } from '../model/custom';
import { OptionItem, grantsExpertise, optionGroups } from '../rules/options';
import { ExpertisePicker, OptionGroupsPicker, optionContext } from './Options';
import { Character, CharacterRecord, classLevel, emptyAppState } from '../model/character';
import { applyLevelUp, levelOptions, POINT_BUY_COST, pointBuyTotal, STANDARD_ARRAY, subclassFeaturesAt } from '../rules/level';
import { cryptoRng, roll } from '../rules/dice';
import { childText } from '../xml/xml';
import { Field, Modal, NumberInput, useApp } from './common';
import { mod } from '../rules/derive';

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
  const [creating, setCreating] = useState(false);
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
          const summary = summarize(r);
          return (
            <div key={r.id} className="card" onClick={() => onOpen(r)}>
              <h3>{summary.name}</h3>
              <p className="muted">{summary.line || 'No class yet'}</p>
              <div className="row card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="link" onClick={() => onExport(r)}>Export</button>
                <button className="link" onClick={() => onDuplicate(r)}>Duplicate</button>
                <button className="link danger" onClick={() => { if (confirm(`Delete ${summary.name}? This cannot be undone.`)) onDelete(r); }}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
      {creating && <NewCharacter onClose={() => setCreating(false)} onCreate={(c) => { setCreating(false); onCreate(c); }} />}
    </div>
  );
}

function summarize(r: CharacterRecord) {
  try {
    const c = Character.parse(r.xml);
    const race = c.race ? childText(c.race, 'name') : '';
    const classes = c.classes.map((ce) => `${childText(ce, 'name')} ${classLevel(ce)}`).join(' / ');
    return { name: c.name, line: [race, classes].filter(Boolean).join(' · ') };
  } catch {
    return { name: '(unreadable)', line: '' };
  }
}

type Method = 'standard' | 'pointbuy' | 'roll' | 'manual';

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
  const incoming = lo ? [...lo.gained, ...lo.cv.features.filter((f) => choices.includes(f.name))] : [];
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
    setChoices(sub ? [...base, ...subclassFeaturesAt(lo.cv, sub, 1).map((f) => f.name)] : base);
  };
  const needsExpertise = grantsExpertise(incoming);
  const proficientSkills = [...new Set([...skills, ...fixed])].filter((x) => SKILLS.some(([n]) => n === x));

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
  const valid = name.trim() && classEl && (method !== 'pointbuy' || pb <= 27) && skills.length <= (cv?.numSkills ?? 0);

  const create = () => {
    const c = Character.create(name.trim());
    if (raceEl) c.setRace(raceEl);
    if (bgEl) c.setBackground(bgEl);
    c.abilities = scores;
    if (classEl) applyLevelUp(c, { newClass: classEl, hp: { method: 'max' }, choices, skills }, cryptoRng, options);
    for (const o of optionFeats) if (o.feat) c.addFeat(o.feat.el);
    for (const name of needsExpertise ? expertise : []) setSkillSetting(c.ch, name, { prof: 2 }, (e) => c.insert(e));
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
          <select value={race} onChange={(e) => setRace(e.target.value)}>
            <option value="">(none)</option>
            {lib.byKind.race.map((r) => <option key={r.name}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Class">
          <select value={cls} onChange={(e) => { setCls(e.target.value); setSkills([]); setChoices([]); setSubclass(''); setOptionFeats([]); setExpertise([]); }}>
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
          const bonus = rv?.abilityBonuses[a] ?? 0;
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
              <span className="muted small">{bonus ? `${bonus > 0 ? '+' : ''}${bonus} race → ` : ''}{total} ({mod(total) >= 0 ? '+' : ''}{mod(total)})</span>
            </div>
          );
        })}
      </div>

      {cv && (
        <>
          <h3>Class skills <span className="muted small">choose {cv.numSkills}</span></h3>
          <div className="checks">
            {cv.skillChoices.map((s) => (
              <label key={s} className={fixed.has(s) ? 'muted' : ''}>
                <input type="checkbox" disabled={fixed.has(s) || (!skills.includes(s) && skills.length >= cv.numSkills)}
                  checked={skills.includes(s) || fixed.has(s)}
                  onChange={(e) => setSkills(e.target.checked ? [...skills, s] : skills.filter((x) => x !== s))} />
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
            {lo.subclassChoices.map((sub) => <option key={sub} value={sub}>{sub}</option>)}
          </select>
        </Field>
      )}
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
      <OptionGroupsPicker groups={groups} picked={[...choices, ...optionFeats.map((o) => o.name)]} onToggle={toggleOption} />
      {needsExpertise && (
        <ExpertisePicker skills={proficientSkills.map((n) => ({ name: n, proficient: true, expertise: false }))} picked={expertise} onChange={setExpertise} />
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
