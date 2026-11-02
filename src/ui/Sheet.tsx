import { useMemo, useReducer, useRef, useState } from 'react';
import { ABBR, ABILITIES, Ability, ClassFeature, featView, itemView, spellView } from '../model/compendium';
import {
  AppState, COIN_KINDS, Character, CharacterRecord, CoinKind, emptyAppState, classLevel, classSpells, coinKind,
  containerCarried, customItem, hdCurrent, isAttuned, isEquipped, isPrepared, itemQuantity, setAttuned,
  setEquipped, setHdCurrent, setItemQuantity, setPrepared,
} from '../model/character';
import { hpMaxOf, setHpCurrent, setHpTemp } from '../model/creature';
import { restTrackers } from '../model/tracker';
import { Sheet as SheetData, deriveSheet, mod } from '../rules/derive';
import { applyLevelUp, levelOptions, removeLevel, subclassFeaturesAt, syncClassSlots, XP_TABLE } from '../rules/level';
import { cryptoRng, resolveFormula } from '../rules/dice';
import { OptionItem, grantsExpertise, optionGroups } from '../rules/options';
import { setSkillSetting } from '../model/custom';
import { XElement, childText, childTexts, elements, setChildText } from '../xml/xml';
import { EntryDetail } from './CompendiumView';
import { CreaturesTab } from './Creatures';
import { FeaturesTab } from './Features';
import { Picker } from './Picker';
import { MainTab } from './MainTab';
import { ExpertisePicker, OptionGroupsPicker, optionContext } from './Options';
import { Field, Modal, Mutate, NumberInput, RollChip, signed, useApp } from './common';


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
        <Stat label="Armor Class" value={s.ac} title={s.acNotes.join('\n')} />
        <HitPoints c={c} app={app.current} max={s.hpMax} mutate={mutate} />
        <Stat label="Initiative" value={<RollChip expr={`1d20${signed(s.initiative)}`} label="Initiative">{signed(s.initiative)}</RollChip>} />
        <Stat label="Speed" value={`${s.speed} ft`} />
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
          <p className="muted small">The character file exactly as it will be exported. Elements this app does not recognise are kept as they are.</p>
          <pre className="xml">{c.serialize()}</pre>
        </section>
      )}

      {levelUp && <LevelUpModal c={c} onClose={() => setLevelUp(false)} mutate={mutate} />}
    </div>
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
  const [open, setOpen] = useState<XElement | null>(null);
  const groups = c.classes.map((ce) => ({
    ce, name: childText(ce, 'name'),
    spells: classSpells(ce).map((el) => ({ el, v: spellView(el), prepared: isPrepared(el) }))
      .sort((a, b) => a.v.level - b.v.level || a.v.name.localeCompare(b.v.name)),
  }));
  const maxSlot = sheet.slots.reduce((m, v, i) => (v > 0 ? i : m), 0);
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
              {sc.cantrips > 0 && <span className="muted">Cantrips known {sc.cantrips}</span>}
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
        <div className="row">
          {c.classes.map((ce) => <button key={childText(ce, 'name')} onClick={() => setAdding(ce)}>Add {childText(ce, 'name')} spells…</button>)}
        </div>
      </section>
      {groups.filter((g) => g.spells.length).map((g) => (
        <section key={g.name} className="panel">
          <h3>{g.name} spells</h3>
          <table className="spell-table">
            <tbody>
              {g.spells.map(({ el, v, prepared }) => (
                <tr key={v.name}>
                  <td>{v.level > 0 && <input type="checkbox" title="Prepared" checked={prepared} onChange={(e) => mutate(() => setPrepared(el, e.target.checked))} />}</td>
                  <td><button className="link" onClick={() => setOpen(el)}>{v.name}</button>
                    <div className="muted small">{[v.level ? ordinal(v.level) : 'Cantrip', v.time, v.range, v.duration, v.ritual && 'ritual'].filter(Boolean).join(' · ')}</div></td>
                  <td>{v.rolls.slice(0, 2).map((r, i) => <button key={i} className="roll" title={r.description} onClick={() => rollF(r.formula, v.name)}>{resolveFormula(r.formula, sheet.formula)}</button>)}</td>
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
      {adding && (
        <Picker kind="spell" onClose={() => setAdding(null)}
          filterHint={[childText(adding, 'name')]} subclasses={sheet.classes.find((k) => k.el === adding)?.subclasses ?? []}
          has={(n) => classSpells(adding).some((sp) => childText(sp, 'name').toLowerCase() === n.toLowerCase())}
          onPick={(e) => mutate((ch) => { ch.addSpell(adding, e.el); })} />
      )}
    </div>
  );
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

// ---------------------------------------------------------------- inventory

function InventoryTab({ c, sheet, mutate, rollF }: { c: Character; sheet: SheetData; mutate: Mutate; rollF: (f: string, l?: string) => unknown }) {
  const [adding, setAdding] = useState(false);
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
                <td>{(v.magic || v.attunement) && <input type="checkbox" checked={att} onChange={(e) => mutate(() => setAttuned(el, e.target.checked))} />}</td>
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
          <button onClick={() => { const name = prompt('Custom item name'); if (name) mutate((ch) => { ch.insert(customItem(name)); }); }}>Custom item…</button>
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
  const { lib, options } = useApp();
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
  const sheet = deriveSheet(c, emptyAppState(), options);

  const existingEl = target.startsWith('existing:') ? existing[+target.split(':')[1]] : undefined;
  const newEl = target.startsWith('new:') ? lib.byKind.class.find((e) => e.name === target.slice(4))?.el : undefined;
  const classEl = existingEl ?? newEl;
  const nextLevel = existingEl ? classLevel(existingEl) + 1 : 1;
  const lo = classEl ? levelOptions(classEl, nextLevel, options) : null;
  const picked = choices ?? lo?.subclassFeatures.map((f) => f.name) ?? [];
  const toggle = (name: string, on: boolean) => setChoices(on ? [...picked, name] : picked.filter((x) => x !== name));
  const incoming = lo ? [...lo.gained, ...lo.cv.features.filter((f) => picked.includes(f.name))] : [];
  const groups = lo && classEl ? optionGroups(optionContext({
    lib, cv: lo.cv, level: nextLevel, c, classEl: existingEl, sheet, incoming, subclass: subclass || undefined,
  })) : [];
  const pickedOptions = [...picked, ...optionFeats.map((o) => o.name)];
  const toggleOption = (o: OptionItem, on: boolean) => {
    if (o.feature) toggle(o.name, on);
    else setOptionFeats(on ? [...optionFeats, o] : optionFeats.filter((x) => x.name !== o.name));
  };
  const needsExpertise = grantsExpertise(incoming);
  const subclassPick = (sub: string) => {
    setSubclass(sub);
    const dropped = new Set(lo ? lo.subclassChoices.flatMap((x) => subclassFeaturesAt(lo.cv, x, nextLevel).map((f) => f.name)) : []);
    const base = picked.filter((n) => !dropped.has(n));
    if (!sub || !lo) { setChoices(base); return; }
    setChoices([...base, ...subclassFeaturesAt(lo.cv, sub, nextLevel).map((f) => f.name)]);
  };

  const apply = () => {
    if (!classEl || c.totalLevel >= 20 || !lo) return;
    const asi: Partial<Record<Ability, number>> | undefined = lo.asi && asiMode !== 'feat'
      ? (asiMode === 'two' ? { [asiA]: 2 } : { [asiA]: 1, [asiB]: 1 }) : undefined;
    const featEl = lo.asi && asiMode === 'feat' && feat ? lib.byKind.feat.find((f) => f.name === feat)?.el : undefined;
    mutate((ch) => {
      applyLevelUp(ch, {
        existing: existingEl, newClass: newEl,
        hp: hp === 'manual' ? { method: 'manual', value: manualHp } : { method: hp },
        choices: picked, asi, feat: featEl,
      }, cryptoRng, options);
      for (const o of optionFeats) if (o.feat) ch.addFeat(o.feat.el);
      for (const name of needsExpertise ? expertise : []) setSkillSetting(ch.ch, name, { prof: 2 }, (e) => ch.insert(e));
    });
    onClose();
  };

  const FeatureCheck = ({ f }: { f: ClassFeature }) => (
    <label title={f.text.slice(0, 400)}>
      <input type="checkbox" checked={picked.includes(f.name)} onChange={(e) => toggle(f.name, e.target.checked)} /> {f.name}
    </label>
  );

  return (
    <Modal title="Level up" onClose={onClose} wide>
      {c.totalLevel >= 20 && <p className="danger">This character is already level 20.</p>}
      <Field label="Class">
        <select value={target} onChange={(e) => { setTarget(e.target.value); setSubclass(''); setChoices(null); setOptionFeats([]); setExpertise([]); }}>
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
              <span>Hit points (d{lo.cv.hd} {signed(mod(c.abilities.constitution))} Con):</span>
              {(['average', 'roll', 'manual'] as const).map((m) => (
                <label key={m} className="radio"><input type="radio" checked={hp === m} onChange={() => setHp(m)} />{m === 'average' ? `Average (${Math.floor(lo.cv.hd / 2) + 1})` : m === 'roll' ? 'Roll' : 'Enter roll'}</label>
              ))}
              {hp === 'manual' && <NumberInput value={manualHp} min={1} max={lo.cv.hd} onChange={setManualHp} />}
            </div>
          )}
          {lo.gained.length > 0 && <><h3>New features</h3><ul>{lo.gained.map((f) => <li key={f.name} title={f.text.slice(0, 400)}>{f.name}</li>)}</ul></>}
          {lo.subclassChoices.length > 0 && (
            <Field label={lo.subclassLabel}>
              <select value={subclass} onChange={(e) => subclassPick(e.target.value)}>
                <option value="">(choose)</option>
                {lo.subclassChoices.map((sub) => <option key={sub} value={sub}>{sub}</option>)}
              </select>
            </Field>
          )}
          {subclass && lo && subclassFeaturesAt(lo.cv, subclass, nextLevel).length > 0 && (
            <><h3>{subclass} features</h3><div className="checks">{subclassFeaturesAt(lo.cv, subclass, nextLevel).map((f) => <FeatureCheck key={f.name} f={f} />)}</div></>
          )}
          {lo.subclassFeatures.length > 0 && (
            <><h3>{lo.chosenSubclasses.join(', ')} features</h3><div className="checks">{lo.subclassFeatures.map((f) => <FeatureCheck key={f.name} f={f} />)}</div></>
          )}
          {lo.other.filter((f) => !f.name.includes(':')).length > 0 && (
            <><h3>Options</h3><div className="checks">{lo.other.filter((f) => !f.name.includes(':')).map((f) => <FeatureCheck key={f.name} f={f} />)}</div></>
          )}
          <OptionGroupsPicker groups={groups} picked={pickedOptions} onToggle={toggleOption}
            intro={groups.some((g) => g.now) ? 'Your class lets you choose from these lists at this level. Already known options are ticked.' : undefined} />
          {needsExpertise && <ExpertisePicker skills={sheet.skills} picked={expertise} onChange={setExpertise} />}
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
                  <select value={asiA} onChange={(e) => setAsiA(e.target.value as Ability)}>{ABILITIES.map((a) => <option key={a} value={a}>{ABBR[a]} ({c.abilities[a]})</option>)}</select>
                  {asiMode === 'split' && <select value={asiB} onChange={(e) => setAsiB(e.target.value as Ability)}>{ABILITIES.filter((a) => a !== asiA).map((a) => <option key={a} value={a}>{ABBR[a]} ({c.abilities[a]})</option>)}</select>}
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

