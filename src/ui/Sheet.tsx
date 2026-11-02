import { useMemo, useReducer, useRef, useState } from 'react';
import { ABBR, ABILITIES, Ability, ClassFeature, featView, isPlaceholderFeature, itemView, spellView } from '../model/compendium';
import {
  AppState, COIN_KINDS, Character, CharacterRecord, CoinKind, emptyAppState, classLevel, classSpells, coinKind,
  containerCarried, hdCurrent, isAttuned, isEquipped, isPrepared, itemQuantity, setAttuned,
  setEquipped, setHdCurrent, setItemQuantity, setPrepared,
} from '../model/character';
import { hpMaxOf, setHpCurrent, setHpTemp } from '../model/creature';
import { restTrackers } from '../model/tracker';
import { Sheet as SheetData, deriveSheet } from '../rules/derive';
import { Movement, OTHER_SPEEDS, OtherSpeed, setMovement } from '../model/movement';
import { applyLevelUp, defaultSubclassPicks, levelOptions, removeLevel, subclassFeaturesAt, syncClassSlots, XP_TABLE } from '../rules/level';
import { cryptoRng, resolveFormula } from '../rules/dice';
import { OptionItem, grantsExpertise, optionGroups } from '../rules/options';
import { baseClassName } from '../rules/spellcount';
import { setSkillSetting } from '../model/custom';
import { XElement, childText, childTexts, elements, setChildText } from '../xml/xml';
import { EntryDetail } from './CompendiumView';
import { CreaturesTab } from './Creatures';
import { FeaturesTab } from './Features';
import { Picker } from './Picker';
import { MainTab } from './MainTab';
import {
  ExpertisePicker, ExtraChoicesPicker, ExtraValues, OptionGroupsPicker, SubclassFeatures, applyExtraChoices, emptyExtras, extraNeeds,
  optionContext, subclassOptionLabel,
} from './Options';
import { Field, Modal, Mutate, NumberInput, RollChip, TooHighTag, confirmOverLimit, signed, useApp } from './common';
import { CreateFlow } from './Creator';
import { AdjustedStat, adjustmentOf, setAdjustment } from '../model/adjustments';
import { castingSettings, setCastingSettings } from '../model/casting';


type Tab = 'main' | 'spells' | 'inventory' | 'features' | 'creatures' | 'notes' | 'xml';

export function Sheet({ record, onSave, onBack, onExport }: {
  record: CharacterRecord; onSave: (r: CharacterRecord) => void; onBack: () => void; onExport: (r: CharacterRecord) => void;
}) {
  const { options, roll, toast } = useApp();
  const c = useMemo(() => Character.parse(record.xml), [record.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const app = useRef<AppState>(record.app);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [tab, setTab] = useState<Tab>('main');
  const [levelUp, setLevelUp] = useState(false);
  const [speedEdit, setSpeedEdit] = useState(false);
  const [adjust, setAdjust] = useState<AdjustedStat | null>(null);
  const [xmlEdit, setXmlEdit] = useState<string | null>(null);
  const s = deriveSheet(c, app.current, options);

  const mutate: Mutate = (fn) => {
    fn(c, app.current);
    // Keep the stored combined slot rows and wealth in step with the derived sheet,
    // as the original app does.
    const sheet = deriveSheet(c, app.current, options);
    c.setSlots(sheet.slots, sheet.slots.map((t, i) => (i === 0 ? t : Math.max(0, t - sheet.slotsUsed[i]))));
    c.syncMoney();
    app.current = { ...app.current };
    onSave({ ...record, xml: c.serialize(), app: app.current, updatedAt: Date.now() });
    bump();
  };

  /** Replace the whole character with edited XML, after checking it parses. */
  const applyXml = (xml: string) => {
    let parsed: Character;
    try {
      const res = Character.parseAll(xml);
      if (!res.characters.length) throw new Error('No <character> element found.');
      if (res.warnings.length && !confirm(`The XML has problems that were repaired:\n${res.warnings.slice(0, 8).join('\n')}\n\nApply anyway?`)) return;
      parsed = res.characters[0];
    } catch (e) {
      alert(`These changes cannot be applied: ${(e as Error).message}`);
      return;
    }
    if (!confirm('Are you sure? This replaces the character with the edited XML.')) return;
    c.doc = parsed.doc;
    c.ch = parsed.ch;
    setXmlEdit(null);
    mutate(() => {});
    toast('XML applied');
  };

  const rollF = (formula: string, label?: string) => roll(resolveFormula(formula, s.formula), label);
  const classesLine = s.classes.map((k) => `${k.name} ${k.level}${k.subclasses.length ? ` (${k.subclasses.join(', ')})` : ''}`).join(' / ');
  const nextXp = XP_TABLE[Math.min(19, s.level)];

  const shortRest = () => mutate((_, a) => {
    for (const ct of s.counters) if (/^s/i.test(ct.reset)) delete a.countersUsed[ct.name];
    a.pactUsed = 0;
    restTrackers(c.trackers, 'short');
    toast('Short rest: short-rest resources restored. Spend hit dice from the Hit Dice panel.');
  });
  const longRest = () => mutate((ch, a) => {
    ch.hpCurrent = s.hpMax;
    a.hpTemp = 0;
    ch.setSlots(s.slots, s.slots);
    for (const k of ch.classes) syncClassSlots(k);
    a.pactUsed = 0;
    a.countersUsed = {};
    a.deathSaves = { success: 0, failure: 0 };
    a.exhaustion = Math.max(0, a.exhaustion - 1);
    for (const cr of ch.creatures) { setHpCurrent(cr, hpMaxOf(cr)); setHpTemp(cr, 0); }
    restTrackers(ch.trackers, 'long');
    let regain = Math.max(1, Math.floor(s.level / 2));
    for (const ce of ch.classes) {
      const missing = classLevel(ce) - hdCurrent(ce);
      const r = Math.min(missing, regain);
      if (r > 0) setHdCurrent(ce, hdCurrent(ce) + r);
      regain -= r;
    }
    toast(`Long rest: hit points, spell slots and resources restored${ch.creatures.length ? ', creatures healed' : ''}.`);
  });

  return (
    <div className="sheet">
      <header className="sheet-head">
        <button className="link" onClick={onBack}>← Characters</button>
        <div className="title">
          <input className="name-input" value={c.name} onChange={(e) => mutate((ch) => { ch.name = e.target.value; })} aria-label="Character name" />
          <TooHighTag items={s.overLimits} />
          <div className="muted">{[c.race && childText(c.race, 'name'), classesLine, c.background && childText(c.background, 'name')].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="row">
          <span className="muted small">XP</span>
          <NumberInput className="xp" value={c.xp} min={0} onChange={(n) => mutate((ch) => { ch.xp = n; })} />
          {s.level < 20 && c.xp >= nextXp && c.xp > 0 && <span className="tag">level up!</span>}
          <button className="primary" onClick={() => setLevelUp(true)}>Level up</button>
          <button onClick={shortRest}>Short rest</button>
          <button onClick={longRest}>Long rest</button>
          <button onClick={() => onExport({ ...record, xml: c.serialize() })}>Export</button>
        </div>
      </header>

      <div className="vitals">
        <button className="stat stat-button" onClick={() => setAdjust('ac')} title={[...s.acNotes, 'Click to edit'].join('\n')}>
          <span className="label">Armor Class</span><span className="value">{s.ac}</span>
          {adjustmentOf(c.ch, 'ac').set !== null || adjustmentOf(c.ch, 'ac').bonus ? <span className="small muted">edited</span> : null}
        </button>
        <HitPoints c={c} app={app.current} max={s.hpMax} mutate={mutate} />
        <div className="stat" title={s.initiativeNotes.join('\n')}>
          <span className="label">Initiative</span>
          <span className="value"><RollChip expr={`1d20${signed(s.initiative)}`} label="Initiative">{signed(s.initiative)}</RollChip></span>
          <button className="link small" onClick={() => setAdjust('initiative')}>edit</button>
        </div>
        <button className="stat stat-button" onClick={() => setSpeedEdit(true)} title={[...s.speedNotes, 'Click to edit movement'].join('\n')}>
          <span className="label">Speed</span>
          <span className="value">{s.speed} ft</span>
          {(Object.keys(s.speeds) as OtherSpeed[]).length > 0 && (
            <span className="small muted">{(Object.entries(s.speeds) as [OtherSpeed, number][]).map(([k, v]) => `${k} ${v}${k === 'fly' && s.hover ? ' (hover)' : ''}`).join(' · ')}</span>
          )}
        </button>
        <Stat label="Proficiency" value={signed(s.prof)} />
        <Stat label="Passive Perception" value={s.passivePerception} />
        <div className="stat">
          <span className="label">Inspiration</span>
          <input type="checkbox" checked={app.current.inspiration} onChange={(e) => mutate((_, a) => { a.inspiration = e.target.checked; })} />
        </div>
      </div>

      {s.warnings.length > 0 && <ul className="warnings compact">{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}

      <nav className="tabs">
        {(['main', 'spells', 'inventory', 'features', 'creatures', 'notes', 'xml'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {{ main: 'Abilities & Skills', spells: 'Spells', inventory: 'Inventory', features: 'Features', creatures: `Creatures${c.creatures.length ? ` (${c.creatures.length})` : ''}`, notes: 'Notes', xml: 'XML' }[t]}
          </button>
        ))}
      </nav>

      {tab === 'main' && <MainTab c={c} app={app.current} sheet={s} mutate={mutate} />}

      {tab === 'spells' && <SpellsTab c={c} app={app.current} sheet={s} mutate={mutate} rollF={rollF} />}
      {tab === 'inventory' && <InventoryTab c={c} sheet={s} mutate={mutate} rollF={rollF} />}
      {tab === 'features' && <FeaturesTab c={c} sheet={s} app={app.current} mutate={mutate} rollF={rollF} />}
      {tab === 'creatures' && <CreaturesTab c={c} sheet={s} mutate={mutate} />}
      {tab === 'notes' && <NotesTab c={c} mutate={mutate} />}
      {tab === 'xml' && (
        <section className="panel">
          <div className="row between">
            <p className="muted small">The character file exactly as it will be exported. Elements this app does not recognise are kept as they are.</p>
            {xmlEdit === null
              ? <button onClick={() => {
                if (confirm('Are you sure you want to edit the XML directly?\n\nA mistake here can break the character or lose information. Consider exporting a backup first. Changes only take effect when you click “Apply changes”.')) setXmlEdit(c.serialize());
              }}>Edit XML…</button>
              : <span className="row">
                <button onClick={() => setXmlEdit(null)}>Cancel</button>
                <button className="primary" onClick={() => applyXml(xmlEdit)}>Apply changes</button>
              </span>}
          </div>
          {xmlEdit === null
            ? <pre className="xml">{c.serialize()}</pre>
            : <textarea className="xml-edit" rows={30} spellCheck={false} value={xmlEdit} onChange={(e) => setXmlEdit(e.target.value)} aria-label="Character XML" />}
        </section>
      )}

      {levelUp && <LevelUpModal c={c} onClose={() => setLevelUp(false)} mutate={mutate} />}
      {speedEdit && <SpeedEditor c={c} sheet={s} onClose={() => setSpeedEdit(false)} mutate={mutate} />}
      {adjust && <AdjustEditor c={c} sheet={s} stat={adjust} onClose={() => setAdjust(null)} mutate={mutate} />}
    </div>
  );
}

function SpeedEditor({ c, sheet, onClose, mutate }: { c: Character; sheet: SheetData; onClose: () => void; mutate: Mutate }) {
  const mv = sheet.movement;
  const raceSpeed = c.race ? parseInt(childText(c.race, 'speed'), 10) || 30 : 30;
  const save = (patch: Partial<Movement>) => mutate((ch) => setMovement(ch.ch, { ...mv, ...patch, other: { ...mv.other, ...(patch.other ?? {}) } }, (e) => { ch.insert(e); }));
  const num = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  return (
    <Modal title="Movement" onClose={onClose}>
      <div className="grid2">
        <Field label={`Walking speed (race: ${raceSpeed} ft; empty uses it)`}>
          <input type="number" min={0} value={mv.walk ?? ''} placeholder={String(raceSpeed)} onChange={(e) => save({ walk: num(e.target.value) })} />
        </Field>
        <Field label="Extra bonus (+ or −)">
          <input type="number" value={mv.bonus || ''} placeholder="0" onChange={(e) => save({ bonus: num(e.target.value) ?? 0 })} />
        </Field>
        {OTHER_SPEEDS.map((k) => (
          <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} speed`}>
            <div className="row">
              <input type="number" min={0} disabled={mv.other[k] === 'walk'} value={typeof mv.other[k] === 'number' ? (mv.other[k] as number) : ''}
                placeholder="none" onChange={(e) => save({ other: { [k]: num(e.target.value) } as Movement['other'] })} />
              <label className="check small"><input type="checkbox" checked={mv.other[k] === 'walk'}
                onChange={(e) => save({ other: { [k]: e.target.checked ? 'walk' : null } as Movement['other'] })} /> same as walking</label>
            </div>
          </Field>
        ))}
        <label className="check"><input type="checkbox" checked={mv.hover} onChange={(e) => save({ hover: e.target.checked })} /> Can hover</label>
      </div>
      <p>Walking speed now: <b>{sheet.speed} ft</b>{Object.keys(sheet.speeds).length > 0 && <> · {Object.entries(sheet.speeds).map(([k, v]) => `${k} ${v} ft`).join(' · ')}</>}</p>
      {sheet.speedNotes.length > 0 && <ul className="small muted">{sheet.speedNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <p className="muted small">Feature, feat and item bonuses (e.g. Mobile, Unarmored Movement, boots) still apply on top. Stored in the character file under a &lt;movement&gt; element, which other apps ignore.</p>
      <footer className="modal-actions">
        <button onClick={() => mutate((ch) => setMovement(ch.ch, { walk: null, bonus: 0, other: { fly: null, swim: null, climb: null, burrow: null }, hover: false }, (e) => { ch.insert(e); }))}>Reset</button>
        <span className="spacer" />
        <button className="primary" onClick={onClose}>Done</button>
      </footer>
    </Modal>
  );
}

/** Spellcasting ability, bonuses and limits for one class. */
function SpellcastingEditor({ ce, sheet, onClose, mutate }: { ce: XElement; sheet: SheetData; onClose: () => void; mutate: Mutate }) {
  const cur = castingSettings(ce);
  const sc = sheet.spellcasting.find((x) => x.el === ce);
  const save = (patch: Partial<typeof cur>) => mutate(() => setCastingSettings(ce, { ...cur, ...patch }));
  const num = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const name = childText(ce, 'name');
  return (
    <Modal title={`${name} spellcasting`} onClose={onClose}>
      <div className="grid2">
        <Field label="Spellcasting ability">
          <select value={cur.ability ?? ''} onChange={(e) => save({ ability: (e.target.value || null) as Ability | null })} aria-label="Spellcasting ability">
            <option value="">(class default)</option>
            {ABILITIES.map((a) => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)} ({signed(sheet.mods[a])})</option>)}
          </select>
        </Field>
        <Field label="Bonus to spell save DC">
          <input type="number" value={cur.dcBonus || ''} placeholder="0" onChange={(e) => save({ dcBonus: num(e.target.value) ?? 0 })} aria-label="Spell save DC bonus" />
        </Field>
        <Field label="Bonus to spell attacks">
          <input type="number" value={cur.attackBonus || ''} placeholder="0" onChange={(e) => save({ attackBonus: num(e.target.value) ?? 0 })} aria-label="Spell attack bonus" />
        </Field>
        <Field label={`Spells ${sc?.limit.mode === 'prepared' ? 'prepared' : 'known'} (empty: ${sc && sc.limit.max !== null && sc.limit.source !== 'custom' ? `rules say ${sc.limit.max}` : 'class rule'})`}>
          <input type="number" min={0} value={cur.spellsMax ?? ''} placeholder={sc && sc.limit.source !== 'custom' && sc.limit.max !== null ? String(sc.limit.max) : ''}
            onChange={(e) => save({ spellsMax: num(e.target.value) })} aria-label="Spells known or prepared" />
        </Field>
        <Field label="Cantrips known (empty: class table)">
          <input type="number" min={0} value={cur.cantripsMax ?? ''} placeholder={sc && cur.cantripsMax === null ? String(sc.cantrips) : ''}
            onChange={(e) => save({ cantripsMax: num(e.target.value) })} aria-label="Cantrips known" />
        </Field>
        <label className="check"><input type="checkbox" checked={cur.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Show as a spellcaster even without spell slots</label>
      </div>
      {sc
        ? <p>Now: <b>{ABBR[sc.ability]}</b> · save DC <b>{sc.dc}</b> · spell attack <b>{signed(sc.attack)}</b> · {sc.limit.mode === 'prepared' ? 'prepared' : 'known'} <b>{sc.limit.count}{sc.limit.max !== null ? ` / ${sc.limit.max}` : ''}</b> · cantrips <b>{sc.limit.cantrips} / {sc.cantrips}</b></p>
        : <p className="muted">{name} has no spell slots, so it is not shown as a spellcaster. Tick the box above, or set cantrips known, to show it.</p>}
      <p className="muted small">Stored on the class in the character file. The ability uses the standard field; the bonuses and limits are Hearthsheet additions that other apps ignore.</p>
      <footer className="modal-actions">
        <button onClick={() => mutate(() => setCastingSettings(ce, { ability: cur.ability, dcBonus: 0, attackBonus: 0, spellsMax: null, cantripsMax: null, enabled: false }))}>Reset bonuses and limits</button>
        <span className="spacer" />
        <button className="primary" onClick={onClose}>Done</button>
      </footer>
    </Modal>
  );
}

/** Set Armor Class or Initiative by hand, or add a bonus to the calculated value. */
function AdjustEditor({ c, sheet, stat, onClose, mutate }: { c: Character; sheet: SheetData; stat: AdjustedStat; onClose: () => void; mutate: Mutate }) {
  const adj = adjustmentOf(c.ch, stat);
  const label = stat === 'ac' ? 'Armor Class' : 'Initiative';
  const save = (patch: Partial<typeof adj>) => mutate((ch) => setAdjustment(ch.ch, stat, { ...adj, ...patch }, (e) => { ch.insert(e); }));
  const num = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const value = stat === 'ac' ? sheet.ac : sheet.initiative;
  const notes = stat === 'ac' ? sheet.acNotes : sheet.initiativeNotes;
  return (
    <Modal title={label} onClose={onClose}>
      <div className="grid2">
        <Field label={`Set ${label} to (empty: calculated)`}>
          <input type="number" value={adj.set ?? ''} placeholder="calculated" onChange={(e) => save({ set: num(e.target.value) })} aria-label={`Set ${label}`} />
        </Field>
        <Field label="Extra bonus (+ or −)">
          <input type="number" value={adj.bonus || ''} placeholder="0" onChange={(e) => save({ bonus: num(e.target.value) ?? 0 })} aria-label={`${label} bonus`} />
        </Field>
      </div>
      <p>{label} now: <b>{stat === 'ac' ? value : signed(value)}</b></p>
      <ul className="small muted">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      <p className="muted small">Stored in the character file under an &lt;adjustments&gt; element, which other apps ignore.</p>
      <footer className="modal-actions">
        <button onClick={() => mutate((ch) => setAdjustment(ch.ch, stat, { set: null, bonus: 0 }, (e) => { ch.insert(e); }))}>Use the calculated value</button>
        <span className="spacer" />
        <button className="primary" onClick={onClose}>Done</button>
      </footer>
    </Modal>
  );
}

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return <div className="stat" title={title}><span className="label">{label}</span><span className="value">{value}</span></div>;
}

function HitPoints({ c, app, max, mutate }: { c: Character; app: AppState; max: number; mutate: Mutate }) {
  const [amount, setAmount] = useState('');
  const n = parseInt(amount, 10);
  const damage = () => mutate((ch, a) => {
    let d = n;
    const t = Math.min(a.hpTemp, d);
    a.hpTemp -= t;
    d -= t;
    ch.hpCurrent = Math.max(0, ch.hpCurrent - d);
  });
  const heal = () => mutate((ch) => { ch.hpCurrent = Math.min(max, Math.max(0, ch.hpCurrent) + n); });
  return (
    <div className="stat hp">
      <span className="label">Hit Points</span>
      <span className="value">
        <NumberInput className="hp-cur" value={c.hpCurrent} onChange={(v) => mutate((ch) => { ch.hpCurrent = v; })} />
        <span className="muted"> / </span>
        <span title="Edit stored maximum below">{max}</span>
        {app.hpTemp > 0 && <span className="tag">+{app.hpTemp} temp</span>}
      </span>
      <span className="row small">
        <input className="hp-amt" placeholder="±" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button disabled={!(n > 0)} onClick={damage}>Damage</button>
        <button disabled={!(n > 0)} onClick={heal}>Heal</button>
        <button disabled={!(n > 0)} onClick={() => mutate((_, a) => { a.hpTemp = Math.max(a.hpTemp, n); })}>Temp</button>
      </span>
      <span className="row small muted">Max <NumberInput className="hp-max" value={c.hpMax} min={0} onChange={(v) => mutate((ch) => { ch.hpMax = v; })} /></span>
    </div>
  );
}

// ---------------------------------------------------------------- spells

function SpellsTab({ c, app, sheet, mutate, rollF }: { c: Character; app: AppState; sheet: SheetData; mutate: Mutate; rollF: (f: string, l?: string) => unknown }) {
  const [adding, setAdding] = useState<XElement | null>(null);
  const [creating, setCreating] = useState<XElement | null>(null);
  const [castingEdit, setCastingEdit] = useState<XElement | null>(null);
  const [open, setOpen] = useState<XElement | null>(null);
  const groups = c.classes.map((ce) => ({
    ce, name: childText(ce, 'name'),
    spells: classSpells(ce).map((el) => ({ el, v: spellView(el), prepared: isPrepared(el) }))
      .sort((a, b) => a.v.level - b.v.level || a.v.name.localeCompare(b.v.name)),
  }));
  const maxSlot = sheet.slots.reduce((m, v, i) => (v > 0 ? i : m), 0);
  const modeOf = (ce: XElement) => sheet.spellcasting.find((sc) => sc.el === ce)?.limit.mode ?? 'prepared';
  /** Highest spell level a class can cast: its own slots, pact slots, or Mystic Arcanum. */
  const castableOf = (ce: XElement) => {
    const sc = sheet.spellcasting.find((x) => x.el === ce);
    if (!sc) return 9;
    const own = sc.kind === 'pact' ? sheet.pact?.level ?? 0 : sc.slots.reduce((m, v, i) => (i > 0 && v > 0 ? i : m), 0);
    const arcanum = sheet.counters.filter((ct) => /mystic arcanum \((\d)/i.test(ct.name)).map((ct) => +/\((\d)/.exec(ct.name)![1]);
    return Math.max(own, ...arcanum);
  };
  const togglePrepared = (ce: XElement, el: XElement, on: boolean) => {
    const sc = sheet.spellcasting.find((x) => x.el === ce);
    if (on && sc && sc.limit.max !== null && sc.limit.count >= sc.limit.max
      && !confirmOverLimit(`${sc.className} can have ${sc.limit.max} spells prepared (${sc.limit.basis}), and this would make ${sc.limit.count + 1}.`)) return;
    mutate(() => setPrepared(el, on));
  };
  /** Before adding a spell from the picker: warn about levels above what can be cast and about full lists. */
  const allowAdd = (ce: XElement, src: XElement) => {
    const v = spellView(src);
    const sc = sheet.spellcasting.find((x) => x.el === ce);
    const castable = castableOf(ce);
    if (v.level > castable && !confirmOverLimit(`${v.name} is a ${ordinal(v.level)}-level spell; ${childText(ce, 'name')} can cast up to ${castable ? `${ordinal(castable)} level` : 'cantrips only'} right now.`)) return false;
    if (!sc) return true;
    if (v.level === 0 && sc.cantrips > 0 && sc.limit.cantrips >= sc.cantrips && !confirmOverLimit(`${sc.className} knows ${sc.cantrips} cantrips, and this would make ${sc.limit.cantrips + 1}.`)) return false;
    if (v.level > 0 && sc.limit.mode === 'known' && sc.limit.max !== null && sc.limit.count >= sc.limit.max
      && !confirmOverLimit(`${sc.className} can know ${sc.limit.max} spells (${sc.limit.basis}), and this would make ${sc.limit.count + 1}.`)) return false;
    return true;
  };
  const setUsed = (l: number, n: number) => mutate((ch) => {
    const cur = sheet.slots.map((t, i) => (i === 0 ? t : Math.max(0, t - (i === l ? n : sheet.slotsUsed[i]))));
    ch.setSlots(sheet.slots, cur);
  });
  const cast = (level: number) => {
    if (level === 0) return;
    if (sheet.pact && sheet.pact.level >= level && app.pactUsed < sheet.pact.count) { mutate((_, a) => { a.pactUsed += 1; }); return; }
    for (let l = level; l <= 9; l++) {
      if (sheet.slotsUsed[l] < sheet.slots[l]) { setUsed(l, sheet.slotsUsed[l] + 1); return; }
    }
    alert('No spell slots of that level or higher remain.');
  };

  return (
    <div className="spells">
      <section className="panel">
        {sheet.spellcasting.length === 0 && <p className="muted">No spellcasting classes. You can still add spells to a class (for example from racial traits or feats).</p>}
        <div className="row wrap">
          {sheet.spellcasting.map((sc) => (
            <div key={sc.className} className="caster">
              <b>{sc.className}</b> <span className="muted">({ABBR[sc.ability]})</span>
              <span>Save DC <b>{sc.dc}</b></span>
              <span>Attack <RollChip expr={`1d20${signed(sc.attack)}`} label={`${sc.className} spell attack`}>{signed(sc.attack)}</RollChip></span>
              {sc.cantrips > 0 && <Count label="Cantrips" have={sc.limit.cantrips} max={sc.cantrips} title="Cantrips known, from the class table" />}
              <Count label={sc.limit.mode === 'prepared' || sc.limit.edition === '2024' ? 'Prepared' : 'Spells known'} have={sc.limit.count} max={sc.limit.max}
                title={sc.limit.max === null ? 'No limit found for this class. Click edit to set one.' : `Limit: ${sc.limit.basis}`} />
              <button className="link small" title="Spellcasting ability, bonuses, and how many spells and cantrips" onClick={() => setCastingEdit(sc.el)}>edit</button>
            </div>
          ))}
        </div>
        {(maxSlot > 0 || sheet.pact) && (
          <div className="slots">
            {Array.from({ length: maxSlot }, (_, i) => i + 1).map((l) => (
              <div key={l} className="slot-level">
                <span className="small">{ordinal(l)}</span>
                {Array.from({ length: sheet.slots[l] }, (_, j) => (
                  <input key={j} type="checkbox" checked={j < sheet.slotsUsed[l]} title="Used"
                    onChange={(e) => setUsed(l, e.target.checked ? j + 1 : j)} />
                ))}
              </div>
            ))}
            {sheet.pact && (
              <div className="slot-level pact">
                <span className="small">Pact ({ordinal(sheet.pact.level)})</span>
                {Array.from({ length: sheet.pact.count }, (_, j) => (
                  <input key={j} type="checkbox" checked={j < app.pactUsed}
                    onChange={(e) => mutate((_, a) => { a.pactUsed = e.target.checked ? j + 1 : j; })} />
                ))}
              </div>
            )}
          </div>
        )}
        <div className="row wrap">
          {c.classes.map((ce) => (
            <span key={childText(ce, 'name')} className="row">
              <button onClick={() => setAdding(ce)}>Add {childText(ce, 'name')} spells…</button>
              <button onClick={() => setCreating(ce)} title="Make your own spell (it is also kept in My homebrew)">Create custom spell…</button>
              {!sheet.spellcasting.some((sc) => sc.el === ce) && <button className="link small" onClick={() => setCastingEdit(ce)}>{childText(ce, 'name')} spellcasting settings…</button>}
            </span>
          ))}
        </div>
      </section>
      {groups.filter((g) => g.spells.length).map((g) => (
        <section key={g.name} className="panel">
          <h3>{baseClassName(g.name) === 'wizard' ? `${g.name} spellbook` : `${g.name} spells`}{(() => { const sc = sheet.spellcasting.find((x) => x.el === g.ce); return sc ? <span className="muted small"> · {sc.limit.mode === 'prepared' ? (baseClassName(g.name) === 'wizard' ? 'the spells you have copied; tick the ones you have prepared' : 'tick the spells you have prepared') : `every spell here counts as ${sc.limit.edition === '2024' ? 'prepared' : 'known'}`}</span> : null; })()}</h3>
          <table className="spell-table">
            <tbody>
              {g.spells.map(({ el, v, prepared }) => (
                <tr key={v.name} className={v.level > castableOf(g.ce) && !childText(el, 'grantedBy') ? 'too-high-row' : ''}>
                  <td>{v.level > 0 && modeOf(g.ce) === 'prepared' && !childText(el, 'grantedBy') && <input type="checkbox" title="Prepared" checked={prepared} onChange={(e) => togglePrepared(g.ce, el, e.target.checked)} />}</td>
                  <td><button className="link" onClick={() => setOpen(el)}>{v.name}</button>
                    {childText(el, 'grantedBy') && <>{' '}<span className="tag" title="Does not count against your limits">always prepared · {childText(el, 'grantedBy')}</span></>}
                    {v.level > castableOf(g.ce) && !childText(el, 'grantedBy') && <>{' '}<span className="tag too-high" title="Above the highest level you can cast">too high</span></>}
                    <div className="muted small">{[v.level ? ordinal(v.level) : 'Cantrip', v.time, v.range, v.duration, v.ritual && 'ritual'].filter(Boolean).join(' · ')}</div></td>
                  <td>{spellRolls(v, sheet.level).map((r, i) => <button key={i} className="roll" title={r.title} onClick={() => rollF(r.formula, v.name)}>{resolveFormula(r.formula, sheet.formula)}</button>)}</td>
                  <td>{v.level > 0 && <button onClick={() => cast(v.level)}>Cast</button>}</td>
                  <td><button className="link danger" onClick={() => mutate(() => { const i = g.ce.children.indexOf(el); if (i >= 0) g.ce.children.splice(i, 1); })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {open && (
        <Modal title={childText(open, 'name')} onClose={() => setOpen(null)}>
          <EntryDetail entry={{ kind: 'spell', name: childText(open, 'name'), el: open, fileId: '' }} />
        </Modal>
      )}
      {creating && (
        <CreateFlow kind="spell" addLabel={`Add to ${childText(creating, 'name')}`} onClose={() => setCreating(null)}
          onCreated={(e) => { if (allowAdd(creating, e)) mutate((ch) => { ch.addSpell(creating, e); }); }} />
      )}
      {castingEdit && <SpellcastingEditor ce={castingEdit} sheet={sheet} onClose={() => setCastingEdit(null)} mutate={mutate} />}
      {adding && (
        <Picker kind="spell" onClose={() => setAdding(null)}
          filterHint={[childText(adding, 'name')]} subclasses={sheet.classes.find((k) => k.el === adding)?.subclasses ?? []}
          maxSpellLevel={castableOf(adding)}
          has={(n) => classSpells(adding).some((sp) => childText(sp, 'name').toLowerCase() === n.toLowerCase())}
          beforePick={(e) => allowAdd(adding, e.el)}
          onPick={(e) => mutate((ch) => { ch.addSpell(adding, e.el); })} />
      )}
    </div>
  );
}

function Count({ label, have, max, title }: { label: string; have: number; max: number | null; title: string }) {
  const over = max !== null && have > max;
  return (
    <span className={`count-pill ${over ? 'over' : max !== null && have === max ? 'full' : ''}`} title={title}>
      {label} <b>{have}</b>{max !== null ? <> / {max}</> : null}
    </span>
  );
}

/**
 * The damage or healing rolls worth showing for a spell. Cantrips list one roll per tier (1d8, 2d8, 3d8,
 * 4d8, or pairs like Toll the Dead's 1d8/1d12): show the tier for the character's level (5th, 11th, 17th).
 * Leveled spells with one roll per slot level show the base roll, with the upcast rolls in the tooltip.
 */
export function spellRolls(v: { level: number; rolls: { formula: string; description: string; level: number | null }[] }, characterLevel: number) {
  const out = (rs: typeof v.rolls, title?: (r: typeof v.rolls[number]) => string) => rs.map((r) => ({ formula: r.formula, title: title ? title(r) : r.description }));
  const rolls = v.rolls;
  if (!rolls.length) return [];
  const tier = characterLevel >= 17 ? 3 : characterLevel >= 11 ? 2 : characterLevel >= 5 ? 1 : 0;
  if (v.level === 0) {
    if (rolls.some((r) => r.level !== null)) {
      const byDesc = new Map<string, typeof rolls>();
      for (const r of rolls) byDesc.set(r.description, [...(byDesc.get(r.description) ?? []), r]);
      return out([...byDesc.values()].map((rs) => rs.filter((r) => (r.level ?? 0) <= characterLevel).pop() ?? rs[0]));
    }
    if (rolls.length >= 4 && rolls.length % 4 === 0) {
      const per = rolls.length / 4;
      return out(rolls.slice(tier * per, tier * per + per), (r) => `${r.description ? `${r.description} · ` : ''}damage at character level ${characterLevel}`);
    }
    return out(rolls.slice(0, 2));
  }
  if (rolls.every((r) => r.level !== null)) {
    const base = rolls.filter((r) => r.level === Math.min(...rolls.map((x) => x.level!)));
    return out(base, (r) => `${r.description ? `${r.description} · ` : ''}at higher levels: ${rolls.filter((x) => x.level! > r.level!).map((x) => `${ordinal(x.level!)} ${x.formula}`).join(', ')}`);
  }
  if (rolls.length === 10 - v.level) {
    return out(rolls.slice(0, 1), () => `at higher levels: ${rolls.slice(1).map((x, i) => `${ordinal(v.level + i + 1)} ${x.formula}`).join(', ')}`);
  }
  return out(rolls.slice(0, 2));
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

// ---------------------------------------------------------------- inventory

function InventoryTab({ c, sheet, mutate, rollF }: { c: Character; sheet: SheetData; mutate: Mutate; rollF: (f: string, l?: string) => unknown }) {
  const [adding, setAdding] = useState(false);
  const [creatingItem, setCreatingItem] = useState(false);
  const [open, setOpen] = useState<XElement | null>(null);
  const items = c.items.filter((el) => !coinKind(el)).map((el) => ({ el, v: itemView(el), qty: itemQuantity(el), eq: isEquipped(el), att: isAttuned(el) }));
  return (
    <div className="inventory">
      <section className="panel">
        <div className="row between">
          <div className="row currency">
            {COIN_KINDS.map((k: CoinKind) => (
              <Field key={k} label={k.toUpperCase()}>
                <NumberInput value={c.coin(k)} min={0} onChange={(n) => mutate((ch) => ch.setCoin(k, n))} />
              </Field>
            ))}
            <span className="muted small">= {c.coinTotal()} gp</span>
          </div>
          <div className={sheet.carried > sheet.capacity ? 'danger' : 'muted'}>Carrying {sheet.carried} / {sheet.capacity} lb</div>
        </div>
        <table className="items">
          <thead><tr><th title="Equipped">Eq</th><th title="Attuned">At</th><th>Item</th><th>Qty</th><th>Weight</th><th /></tr></thead>
          <tbody>
            {items.map(({ el, v, qty, eq, att }, i) => (
              <tr key={i}>
                <td><input type="checkbox" checked={eq} onChange={(e) => mutate(() => setEquipped(el, e.target.checked))} /></td>
                <td>{(v.magic || v.attunement) && <input type="checkbox" checked={att} onChange={(e) => {
                  const n = items.filter((x) => x.att).length;
                  if (e.target.checked && n >= 3 && !confirmOverLimit(`You can normally be attuned to 3 items at once, and this would make ${n + 1}.`)) return;
                  mutate(() => setAttuned(el, e.target.checked));
                }} />}</td>
                <td><button className="link" onClick={() => setOpen(el)}>{v.name}</button> <span className="muted small">{v.typeLabel}</span></td>
                <td><NumberInput className="qty" value={qty} min={0} onChange={(n) => mutate(() => setItemQuantity(el, n))} /></td>
                <td>{v.weight ? Math.round(v.weight * qty * 100) / 100 : ''}</td>
                <td>
                  {v.rolls[0] && <button className="roll" onClick={() => rollF(v.rolls[0].formula, v.name)}>{v.rolls[0].formula}</button>}
                  <button className="link danger" onClick={() => mutate((ch) => ch.remove(el))}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button onClick={() => setAdding(true)}>Add items…</button>
          <button onClick={() => setCreatingItem(true)} title="Make your own item (it is also kept in My homebrew)">Create custom item…</button>
        </div>
      </section>
      {c.containers.map((ct, i) => (
        <section key={i} className="panel">
          <div className="row between">
            <h3>{childText(ct, 'label') || childText(ct, 'name')} <span className="muted small">{childText(ct, 'name')} · {containerCarried(ct) ? 'carried' : 'not carried'}</span></h3>
            <button className="link danger" onClick={() => { if (confirm('Remove this container and its contents?')) mutate((ch) => ch.remove(ct)); }}>Remove</button>
          </div>
          <ul className="small">
            {elements(ct, 'item').map((it, j) => <li key={j}>{childText(it, 'name')}{itemQuantity(it) !== 1 ? ` ×${itemQuantity(it)}` : ''} <span className="muted">{childText(it, 'weight') && `${childText(it, 'weight')} lb`}</span></li>)}
          </ul>
        </section>
      ))}
      {open && <ItemEditor el={open} onClose={() => setOpen(null)} mutate={mutate} />}
      {creatingItem && (
        <CreateFlow kind="item" addLabel="Add to inventory" onClose={() => setCreatingItem(false)}
          onCreated={(e) => mutate((ch) => { ch.addItem(e); })} />
      )}
      {adding && (
        <Picker kind="item" onClose={() => setAdding(false)} has={() => false}
          onPick={(e) => mutate((ch) => { ch.addItem(e.el); })} />
      )}
    </div>
  );
}

function ItemEditor({ el, onClose, mutate }: { el: XElement; onClose: () => void; mutate: Mutate }) {
  const [edit, setEdit] = useState(false);
  const fields: [string, string][] = [['name', 'Name'], ['detail', 'Detail'], ['value', 'Value (gp)'], ['weight', 'Weight'],
    ['ac', 'AC'], ['damage1H', 'Damage'], ['damage2H', 'Versatile damage'], ['range', 'Range']];
  return (
    <Modal title={childText(el, 'name')} onClose={onClose}>
      {!edit && <EntryDetail entry={{ kind: 'item', name: childText(el, 'name'), el, fileId: '' }} />}
      {edit && (
        <div className="grid2">
          {fields.map(([k, label]) => (
            <Field key={k} label={label}><input defaultValue={childText(el, k)} onBlur={(e) => mutate(() => setChildText(el, k, e.target.value))} /></Field>
          ))}
          <Field label="Description"><textarea defaultValue={childTexts(el, 'text').join('\n')} rows={5}
            onBlur={(e) => mutate(() => setChildText(el, 'text', e.target.value))} /></Field>
        </div>
      )}
      <footer className="modal-actions"><button onClick={() => setEdit(!edit)}>{edit ? 'Done editing' : 'Edit this copy'}</button></footer>
    </Modal>
  );
}

// ---------------------------------------------------------------- notes

function NotesTab({ c, mutate }: { c: Character; mutate: Mutate }) {
  return (
    <div className="notes">
      {c.notes.map((n, i) => (
        <section key={i} className="panel">
          <div className="row between">
            <input className="note-title" value={childText(n, 'name')} onChange={(e) => mutate(() => setChildText(n, 'name', e.target.value))} />
            <button className="link danger" onClick={() => mutate((ch) => ch.remove(n))}>Delete</button>
          </div>
          <textarea rows={6} value={childTexts(n, 'text').join('\n')} onChange={(e) => mutate(() => setChildText(n, 'text', e.target.value))} />
        </section>
      ))}
      <button onClick={() => mutate((ch) => { ch.addNote('New note', ''); })}>Add note</button>
      <p className="muted small">Notes are stored in the character file under a &lt;note&gt; element, which other apps ignore.</p>
    </div>
  );
}

// ---------------------------------------------------------------- level up

function LevelUpModal({ c, onClose, mutate }: { c: Character; onClose: () => void; mutate: Mutate }) {
  const { lib, options, toast } = useApp();
  const existing = c.classes;
  const [target, setTarget] = useState<string>(existing[0] ? 'existing:0' : lib.byKind.class[0] ? `new:${lib.byKind.class[0].name}` : '');
  const [hp, setHp] = useState<'average' | 'roll' | 'manual'>('average');
  const [manualHp, setManualHp] = useState(1);
  const [subclass, setSubclass] = useState('');
  const [choices, setChoices] = useState<string[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [asiMode, setAsiMode] = useState<'two' | 'split' | 'feat'>('two');
  const [asiA, setAsiA] = useState<Ability>('strength');
  const [asiB, setAsiB] = useState<Ability>('dexterity');
  const [feat, setFeat] = useState('');
  const [optionFeats, setOptionFeats] = useState<OptionItem[]>([]);
  const [expertise, setExpertise] = useState<string[]>([]);
  const [extras, setExtras] = useState<ExtraValues>(emptyExtras());
  const sheet = deriveSheet(c, emptyAppState(), options);

  const existingEl = target.startsWith('existing:') ? existing[+target.split(':')[1]] : undefined;
  const newEl = target.startsWith('new:') ? lib.byKind.class.find((e) => e.name === target.slice(4))?.el : undefined;
  const classEl = existingEl ?? newEl;
  const nextLevel = existingEl ? classLevel(existingEl) + 1 : 1;
  const lo = classEl ? levelOptions(classEl, nextLevel, options) : null;
  const picked = choices ?? (lo ? lo.chosenSubclasses.flatMap((sub) => defaultSubclassPicks(lo.cv, sub, nextLevel)).map((f) => f.name) : []);
  const setPicked = (v: string[]) => setChoices(v);
  const toggle = (name: string, on: boolean) => setChoices(on ? [...picked, name] : picked.filter((x) => x !== name));
  const incoming = lo ? [...lo.gained, ...lo.cv.features.filter((f) => f.level === nextLevel && picked.includes(f.name))] : [];
  const groups = lo && classEl ? optionGroups(optionContext({
    lib, cv: lo.cv, level: nextLevel, c, classEl: existingEl, sheet, incoming, subclass: subclass || undefined,
  })) : [];
  const pickedOptions = [...picked, ...optionFeats.map((o) => o.name)];
  const toggleOption = (o: OptionItem, on: boolean) => {
    if (o.feature) toggle(o.name, on);
    else setOptionFeats(on ? [...optionFeats, o] : optionFeats.filter((x) => x.name !== o.name));
  };
  const needsExpertise = grantsExpertise(incoming);
  const needs = extraNeeds(incoming, lo?.cv.skillChoices);
  const subclassPick = (sub: string) => {
    setSubclass(sub);
    const dropped = new Set(lo ? lo.subclassChoices.flatMap((x) => subclassFeaturesAt(lo.cv, x, nextLevel).map((f) => f.name)) : []);
    const base = picked.filter((n) => !dropped.has(n));
    if (!sub || !lo) { setChoices(base); return; }
    setChoices([...base, ...defaultSubclassPicks(lo.cv, sub, nextLevel).map((f) => f.name)]);
  };
  const asiIncrease: Partial<Record<Ability, number>> | undefined = lo?.asi && asiMode !== 'feat'
    ? (asiMode === 'two' ? { [asiA]: 2 } : { [asiA]: 1, [asiB]: 1 }) : undefined;
  const natural = sheet.naturalScores;
  const asiOver = Object.entries(asiIncrease ?? {}).filter(([a, v]) => natural[a as Ability] + (v ?? 0) > 20)
    .map(([a, v]) => `${ABBR[a as Ability]} ${natural[a as Ability]} → ${natural[a as Ability] + (v ?? 0)}`);

  const apply = () => {
    if (!classEl || c.totalLevel >= 20 || !lo) return;
    let allowOverMax = false;
    if (asiOver.length) {
      allowOverMax = confirmOverLimit(`This Ability Score Improvement raises ${asiOver.join(', ')}, above the usual maximum of 20.`);
      if (!allowOverMax && !window.confirm('Apply the level anyway, with the increase stopped at 20?')) return;
    }
    const featEl = lo.asi && asiMode === 'feat' && feat ? lib.byKind.feat.find((f) => f.name === feat)?.el : undefined;
    let granted: string[] = [];
    mutate((ch) => {
      const before = new Set(ch.classes.flatMap((k) => classSpells(k).map((sp) => childText(sp, 'name'))));
      const ce = applyLevelUp(ch, {
        existing: existingEl, newClass: newEl,
        hp: hp === 'manual' ? { method: 'manual', value: manualHp } : { method: hp },
        choices: picked, asi: asiIncrease, feat: featEl, subclass: subclass || undefined, allowOverMax,
      }, cryptoRng, options);
      granted = classSpells(ce).map((sp) => childText(sp, 'name')).filter((n) => !before.has(n));
      for (const o of optionFeats) if (o.feat) ch.addFeat(o.feat.el);
      for (const name of needsExpertise ? expertise : []) setSkillSetting(ch.ch, name, { prof: 2 }, (e) => ch.insert(e));
      applyExtraChoices(ch, ce, needs, extras);
    });
    if (granted.length) toast(`Always prepared: ${granted.join(', ')}`);
    onClose();
  };

  const FeatureCheck = ({ f }: { f: ClassFeature }) => (
    <label title={f.text.slice(0, 400)}>
      <input type="checkbox" checked={picked.includes(f.name)} onChange={(e) => toggle(f.name, e.target.checked)} /> {f.name}
    </label>
  );
  const shownGained = lo ? lo.gained.filter((f) => !isPlaceholderFeature(f)) : [];
  const plainOptions = lo ? lo.other.filter((f) => !f.name.includes(':')) : [];

  return (
    <Modal title="Level up" onClose={onClose} wide>
      {c.totalLevel >= 20 && <p className="danger">This character is already level 20.</p>}
      <Field label="Class">
        <select value={target} onChange={(e) => { setTarget(e.target.value); setSubclass(''); setChoices(null); setOptionFeats([]); setExpertise([]); setExtras(emptyExtras()); }}>
          {existing.map((ce, i) => <option key={i} value={`existing:${i}`}>{childText(ce, 'name')} → {classLevel(ce) + 1}</option>)}
          {lib.byKind.class.filter((e) => !existing.some((ce) => childText(ce, 'name').toLowerCase() === e.name.toLowerCase()))
            .map((e) => <option key={e.name} value={`new:${e.name}`}>{e.name} (new class, multiclass)</option>)}
        </select>
      </Field>
      {newEl && existing.length > 0 && <p className="muted small">Multiclassing: check ability score prerequisites. Only the first class grants saving throw proficiencies.</p>}
      {lo && (
        <>
          {c.totalLevel > 0 && (
            <div className="row">
              <span>Hit points (d{lo.cv.hd} {signed(sheet.mods.constitution)} Con):</span>
              {(['average', 'roll', 'manual'] as const).map((m) => (
                <label key={m} className="radio"><input type="radio" checked={hp === m} onChange={() => setHp(m)} />{m === 'average' ? `Average (${Math.floor(lo.cv.hd / 2) + 1})` : m === 'roll' ? 'Roll' : 'Enter roll'}</label>
              ))}
              {hp === 'manual' && <NumberInput value={manualHp} min={1} max={lo.cv.hd} onChange={setManualHp} />}
            </div>
          )}
          {shownGained.length > 0 && <><h3>New features</h3><ul>{shownGained.map((f) => <li key={f.name} title={f.text.slice(0, 400)}>{f.name}</li>)}</ul></>}
          {lo.subclassChoices.length > 0 && (
            <Field label={lo.subclassLabel}>
              <select value={subclass} onChange={(e) => subclassPick(e.target.value)}>
                <option value="">(choose)</option>
                {lo.subclassChoices.map((sub) => <option key={sub} value={sub}>{subclassOptionLabel(lo.cv, sub)}</option>)}
              </select>
            </Field>
          )}
          {subclass && <SubclassFeatures cv={lo.cv} subclass={subclass} level={nextLevel} picked={picked} setPicked={setPicked} />}
          {lo.chosenSubclasses.map((sub) => <SubclassFeatures key={sub} cv={lo.cv} subclass={sub} level={nextLevel} picked={picked} setPicked={setPicked} />)}
          {plainOptions.length > 0 && (
            <><h3>Options</h3><div className="checks">{plainOptions.map((f) => <FeatureCheck key={f.name} f={f} />)}</div></>
          )}
          {lo.optionalRules.length > 0 && (
            <>
              <h3>Optional class features <span className="muted small">Tasha's Cauldron of Everything · ask your DM</span></h3>
              <div className="checks">
                {lo.optionalRules.map((f) => (
                  <label key={f.name} title={f.text.slice(0, 600)}>
                    <input type="checkbox" checked={picked.includes(f.name)} onChange={(e) => toggle(f.name, e.target.checked)} /> {f.name}
                    {/replaces? the ([\w' ]+?) feature/i.exec(f.text) && <span className="muted small"> · replaces {/replaces? the ([\w' ]+?) feature/i.exec(f.text)![1]}</span>}
                  </label>
                ))}
              </div>
            </>
          )}
          <OptionGroupsPicker groups={groups} picked={pickedOptions} onToggle={toggleOption}
            intro={groups.some((g) => g.now) ? 'Your class lets you choose from these lists at this level. Already known options are ticked.' : undefined} />
          {needsExpertise && <ExpertisePicker skills={sheet.skills} picked={expertise} onChange={setExpertise} />}
          <ExtraChoicesPicker needs={needs} value={extras} onChange={setExtras} proficient={sheet.skills.filter((sk) => sk.proficient).map((sk) => sk.name)} />
          {lo.otherSubclassFeatures.length > 0 && (
            <p><button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide' : 'Show'} features of other subclasses ({lo.otherSubclassFeatures.length})</button></p>
          )}
          {showAll && <div className="checks">{lo.otherSubclassFeatures.map((f) => <FeatureCheck key={f.name} f={f} />)}</div>}
          {lo.asi && (
            <>
              <h3>Ability Score Improvement</h3>
              <div className="row">
                <label className="radio"><input type="radio" checked={asiMode === 'two'} onChange={() => setAsiMode('two')} />+2 to one</label>
                <label className="radio"><input type="radio" checked={asiMode === 'split'} onChange={() => setAsiMode('split')} />+1 to two</label>
                <label className="radio"><input type="radio" checked={asiMode === 'feat'} onChange={() => setAsiMode('feat')} disabled={!lib.byKind.feat.length} />Feat</label>
              </div>
              {asiMode !== 'feat' && (
                <div className="row">
                  <select value={asiA} onChange={(e) => setAsiA(e.target.value as Ability)}>{ABILITIES.map((a) => <option key={a} value={a}>{ABBR[a]} ({sheet.scores[a]})</option>)}</select>
                  {asiMode === 'split' && <select value={asiB} onChange={(e) => setAsiB(e.target.value as Ability)}>{ABILITIES.filter((a) => a !== asiA).map((a) => <option key={a} value={a}>{ABBR[a]} ({sheet.scores[a]})</option>)}</select>}
                  {asiOver.length > 0 && <span className="danger small">Above 20: {asiOver.join(', ')} (you will be asked to confirm)</span>}
                </div>
              )}
              {asiMode === 'feat' && (
                <select value={feat} onChange={(e) => setFeat(e.target.value)}>
                  <option value="">(choose a feat)</option>
                  {lib.byKind.feat.map((f) => <option key={f.name} title={featView(f.el).prerequisite}>{f.name}</option>)}
                </select>
              )}
            </>
          )}
        </>
      )}
      {!classEl && <p>No class available. Import a compendium with classes first.</p>}
      <footer className="modal-actions">
        {existing.length > 0 && (
          <button className="danger" onClick={() => {
            const ce = existingEl ?? existing[existing.length - 1];
            if (confirm(`Remove one ${childText(ce, 'name')} level?`)) { mutate((ch) => removeLevel(ch, ce, options)); onClose(); }
          }}>Remove a level</button>
        )}
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!classEl || c.totalLevel >= 20 || (asiMode === 'split' && asiA === asiB)} onClick={apply}>Apply</button>
      </footer>
    </Modal>
  );
}
