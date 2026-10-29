import { useMemo, useReducer, useRef, useState } from 'react';
import {
  ABBR, ABILITIES, Ability, Entry, KIND_LABEL, Kind, classView, featView, itemView, lookup, spellView,
} from '../model/compendium';
import {
  AppState, Character, CharacterRecord, CHARACTER_TAGS, classLevel, classSubclass, hdCurrent, isAttuned,
  isEquipped, isPrepared, itemQuantity, setAttuned, setEquipped, setHdCurrent, setItemQuantity, setPrepared,
} from '../model/character';
import { deriveSheet, mod } from '../rules/derive';
import { applyLevelUp, levelOptions, removeLevel, XP_TABLE } from '../rules/level';
import { cryptoRng } from '../rules/dice';
import { XElement, childText, childTexts, setChildText } from '../xml/xml';
import { EntryDetail } from './CompendiumView';
import { Field, Modal, NumberInput, RichText, RollChip, signed, useApp } from './common';

const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];

type Tab = 'main' | 'spells' | 'inventory' | 'features' | 'notes' | 'xml';

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

  const mutate = (fn: (c: Character, a: AppState) => void) => {
    fn(c, app.current);
    app.current = { ...app.current };
    onSave({ ...record, xml: c.serialize(), app: app.current, updatedAt: Date.now() });
    bump();
  };

  const classesLine = c.classes.map((ce) => {
    const sub = classSubclass(ce);
    return `${childText(ce, 'name')} ${classLevel(ce)}${sub ? ` (${sub})` : ''}`;
  }).join(' / ');
  const nextXp = XP_TABLE[Math.min(19, s.level)];

  const shortRest = () => mutate((_, a) => {
    for (const ct of s.counters) if (/^s/i.test(ct.reset)) delete a.countersUsed[ct.name];
    a.pactUsed = 0;
    toast('Short rest: short-rest resources restored. Spend hit dice from the Hit Dice panel.');
  });
  const longRest = () => mutate((ch, a) => {
    ch.hpCurrent = s.hpMax;
    ch.hpTemp = 0;
    a.slotsUsed = Array(10).fill(0);
    a.pactUsed = 0;
    a.countersUsed = {};
    a.deathSaves = { success: 0, failure: 0 };
    a.exhaustion = Math.max(0, a.exhaustion - 1);
    // Regain spent hit dice up to half the character's total (minimum 1).
    let regain = Math.max(1, Math.floor(s.level / 2));
    for (const ce of ch.classes) {
      const missing = classLevel(ce) - hdCurrent(ce);
      const r = Math.min(missing, regain);
      setHdCurrent(ce, hdCurrent(ce) + r);
      regain -= r;
    }
    toast('Long rest: hit points, spell slots and resources restored.');
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
          {s.level < 20 && c.xp >= nextXp && <span className="tag">level up!</span>}
          <button className="primary" onClick={() => setLevelUp(true)}>Level up</button>
          <button onClick={shortRest}>Short rest</button>
          <button onClick={longRest}>Long rest</button>
          <button onClick={() => onExport({ ...record, xml: c.serialize() })}>Export</button>
        </div>
      </header>

      <div className="vitals">
        <Stat label="Armor Class" value={s.ac} title={s.acNotes.join('\n')} />
        <HitPoints c={c} max={s.hpMax} mutate={mutate} />
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
        {(['main', 'spells', 'inventory', 'features', 'notes', 'xml'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {{ main: 'Abilities & Skills', spells: 'Spells', inventory: 'Inventory', features: 'Features', notes: 'Notes', xml: 'XML' }[t]}
          </button>
        ))}
      </nav>

      {tab === 'main' && (
        <div className="main-grid">
          <section className="panel">
            <h3>Abilities</h3>
            <div className="abilities">
              {ABILITIES.map((a) => {
                const save = s.saves.find((x) => x.ability === a)!;
                return (
                  <div key={a} className="ability">
                    <b>{ABBR[a]}</b>
                    <RollChip expr={`1d20${signed(s.mods[a])}`} label={`${ABBR[a]} check`}><span className="big">{signed(s.mods[a])}</span></RollChip>
                    <span className="muted">{s.scores[a]}</span>
                    <span className="small">Save <RollChip expr={`1d20${signed(save.bonus)}`} label={`${ABBR[a]} save`}>{signed(save.bonus)}</RollChip>{save.proficient && ' ●'}</span>
                    <NumberInput className="base" value={c.abilities[a]} min={1} max={30}
                      onChange={(n) => mutate((ch) => { ch.abilities = { ...ch.abilities, [a]: n }; })} />
                  </div>
                );
              })}
            </div>
            <p className="muted small">Small number fields are base scores (before racial bonuses and modifiers).</p>
          </section>
          <section className="panel">
            <h3>Skills</h3>
            <table className="skills">
              <tbody>
                {s.skills.map((sk) => {
                  const state = sk.expertise ? 'E' : sk.proficient ? 'P' : sk.half ? '½' : '';
                  return (
                    <tr key={sk.name}>
                      <td>
                        <button className="prof-toggle" title="Cycle: none → proficient → expertise"
                          onClick={() => mutate((ch) => cycleSkill(ch, sk.name))}>{state || '○'}</button>
                      </td>
                      <td>{sk.name} <span className="muted small">{ABBR[sk.ability]}</span></td>
                      <td><RollChip expr={`1d20${signed(sk.bonus)}`} label={sk.name}>{signed(sk.bonus)}</RollChip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">Passive Investigation {s.passiveInvestigation} · Passive Insight {s.passiveInsight}</p>
          </section>
          <section className="panel">
            <h3>Attacks</h3>
            <table className="attacks">
              <thead><tr><th>Name</th><th>Hit</th><th>Damage</th></tr></thead>
              <tbody>
                {s.attacks.map((at, i) => (
                  <tr key={i}>
                    <td>{at.name}<div className="muted small">{[at.range, at.notes].filter(Boolean).join(' · ')}</div></td>
                    <td><RollChip expr={`1d20${signed(at.bonus)}`} label={`${at.name} attack`}>{signed(at.bonus)}</RollChip></td>
                    <td>
                      <RollChip expr={at.damage} label={`${at.name} damage`} /> {at.versatile && <>/ <RollChip expr={at.versatile} label={`${at.name} (two-handed)`} /></>}
                      <span className="muted small"> {at.damageType}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Hit dice</h3>
            {c.classes.map((ce) => {
              const cv = classView(ce);
              const left = hdCurrent(ce);
              return (
                <div key={cv.name} className="row">
                  <span>{cv.name}: {left}/{classLevel(ce)} d{cv.hd}</span>
                  <button disabled={left <= 0} onClick={() => {
                    const r = roll(`1d${cv.hd}${signed(s.mods.constitution)}`, 'Hit die');
                    if (r) mutate((ch) => { setHdCurrent(ce, left - 1); ch.hpCurrent = Math.min(s.hpMax, ch.hpCurrent + Math.max(0, r.total)); });
                  }}>Spend</button>
                </div>
              );
            })}
            <h3>Proficiencies</h3>
            <dl className="facts small">
              <dt>Armor</dt><dd>{s.proficiencies.armor.join(', ') || '—'}</dd>
              <dt>Weapons</dt><dd>{s.proficiencies.weapons.join(', ') || '—'}</dd>
              <dt>Tools</dt><dd>{s.proficiencies.tools.join(', ') || '—'}</dd>
              {s.proficiencies.other.length > 0 && <><dt>Other</dt><dd>{s.proficiencies.other.join(', ')}</dd></>}
              <dt>Languages</dt><dd><input value={c.languages} onChange={(e) => mutate((ch) => { ch.languages = e.target.value; })} /></dd>
            </dl>
          </section>
          <section className="panel">
            <h3>Conditions</h3>
            <div className="checks">
              {CONDITIONS.map((cond) => (
                <label key={cond}>
                  <input type="checkbox" checked={app.current.conditions.includes(cond)}
                    onChange={(e) => mutate((_, a) => { a.conditions = e.target.checked ? [...a.conditions, cond] : a.conditions.filter((x) => x !== cond); })} />
                  {cond}
                </label>
              ))}
            </div>
            <Field label="Exhaustion">
              <NumberInput value={app.current.exhaustion} min={0} max={6} onChange={(n) => mutate((_, a) => { a.exhaustion = Math.max(0, Math.min(6, n)); })} />
            </Field>
            {c.hpCurrent <= 0 && (
              <>
                <h3>Death saves</h3>
                <div className="row">
                  <RollChip expr="1d20" label="Death save" />
                  {(['success', 'failure'] as const).map((k) => (
                    <span key={k}>{k === 'success' ? 'Successes' : 'Failures'}{' '}
                      {[1, 2, 3].map((n) => (
                        <input key={n} type="checkbox" checked={app.current.deathSaves[k] >= n}
                          onChange={(e) => mutate((_, a) => { a.deathSaves = { ...a.deathSaves, [k]: e.target.checked ? n : n - 1 }; })} />
                      ))}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {tab === 'spells' && <SpellsTab c={c} app={app.current} sheet={s} mutate={mutate} />}
      {tab === 'inventory' && <InventoryTab c={c} sheet={s} mutate={mutate} />}
      {tab === 'features' && <FeaturesTab sheet={s} app={app.current} mutate={mutate} />}
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

type Mutate = (fn: (c: Character, a: AppState) => void) => void;
type SheetT = ReturnType<typeof deriveSheet>;

function cycleSkill(ch: Character, name: string) {
  const p = ch.skills, e = ch.expertise;
  if (e.includes(name)) { ch.expertise = e.filter((x) => x !== name); ch.skills = p.filter((x) => x !== name); }
  else if (p.includes(name)) ch.expertise = [...e, name];
  else ch.skills = [...p, name];
}

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return <div className="stat" title={title}><span className="label">{label}</span><span className="value">{value}</span></div>;
}

function HitPoints({ c, max, mutate }: { c: Character; max: number; mutate: Mutate }) {
  const [amount, setAmount] = useState('');
  const n = parseInt(amount, 10);
  const damage = () => mutate((ch) => {
    let d = n;
    const t = Math.min(ch.hpTemp, d);
    ch.hpTemp = ch.hpTemp - t;
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
        {c.hpTemp > 0 && <span className="tag">+{c.hpTemp} temp</span>}
      </span>
      <span className="row small">
        <input className="hp-amt" placeholder="±" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button disabled={!(n > 0)} onClick={damage}>Damage</button>
        <button disabled={!(n > 0)} onClick={heal}>Heal</button>
        <button disabled={!(n > 0)} onClick={() => mutate((ch) => { ch.hpTemp = Math.max(ch.hpTemp, n); })}>Temp</button>
      </span>
      <span className="row small muted">Max <NumberInput className="hp-max" value={c.hpMax} min={0} onChange={(v) => mutate((ch) => { ch.hpMax = v; })} /></span>
    </div>
  );
}

// ---------------------------------------------------------------- spells

function SpellsTab({ c, app, sheet, mutate }: { c: Character; app: AppState; sheet: SheetT; mutate: Mutate }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<XElement | null>(null);
  const spells = c.spells.map((el) => ({ el, v: spellView(el), prepared: isPrepared(el) }))
    .sort((a, b) => a.v.level - b.v.level || a.v.name.localeCompare(b.v.name));
  const levels = [...new Set(spells.map((x) => x.v.level))];
  const maxSlot = sheet.slots.reduce((m, v, i) => (v > 0 ? i : m), 0);
  const cast = (level: number) => {
    if (level === 0) return;
    // Use the lowest available slot of at least this level, preferring pact slots at their level.
    if (sheet.pact && sheet.pact.level >= level && app.pactUsed < sheet.pact.count) {
      mutate((_, a) => { a.pactUsed += 1; });
      return;
    }
    for (let l = level; l <= 9; l++) {
      if ((app.slotsUsed[l] ?? 0) < sheet.slots[l]) { mutate((_, a) => { a.slotsUsed[l] = (a.slotsUsed[l] ?? 0) + 1; }); return; }
    }
    alert('No spell slots of that level or higher remain.');
  };

  return (
    <div className="spells">
      <section className="panel">
        {sheet.spellcasting.length === 0 && <p className="muted">No spellcasting classes. You can still track spells (for example from racial traits or feats).</p>}
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
                  <input key={j} type="checkbox" checked={j < (app.slotsUsed[l] ?? 0)} title="Used"
                    onChange={(e) => mutate((_, a) => { a.slotsUsed[l] = e.target.checked ? j + 1 : j; })} />
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
        <div className="row"><button onClick={() => setAdding(true)}>Add spells…</button></div>
      </section>
      {levels.map((lv) => (
        <section key={lv} className="panel">
          <h3>{lv === 0 ? 'Cantrips' : `${ordinal(lv)} level`}</h3>
          <table className="spell-table">
            <tbody>
              {spells.filter((x) => x.v.level === lv).map(({ el, v, prepared }) => (
                <tr key={v.name}>
                  <td>{lv > 0 && <input type="checkbox" title="Prepared" checked={prepared} onChange={(e) => mutate(() => setPrepared(el, e.target.checked))} />}</td>
                  <td><button className="link" onClick={() => setOpen(el)}>{v.name}</button>
                    <div className="muted small">{[v.time, v.range, v.duration, v.ritual && 'ritual'].filter(Boolean).join(' · ')}</div></td>
                  <td>{v.rolls.slice(0, 1).map((r) => <RollChip key={r} expr={r} label={v.name} />)}</td>
                  <td>{lv > 0 && <button onClick={() => cast(lv)}>Cast</button>}</td>
                  <td><button className="link danger" onClick={() => mutate((ch) => ch.remove(el))}>Remove</button></td>
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
        <Picker kind="spell" onClose={() => setAdding(false)}
          filterHint={c.classes.map((ce) => childText(ce, 'name'))}
          has={(n) => c.spells.some((s) => childText(s, 'name').toLowerCase() === n.toLowerCase())}
          onPick={(e) => mutate((ch) => { ch.addSpell(e.el); })} />
      )}
    </div>
  );
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

// ---------------------------------------------------------------- inventory

function InventoryTab({ c, sheet, mutate }: { c: Character; sheet: SheetT; mutate: Mutate }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<XElement | null>(null);
  const items = c.items.map((el) => ({ el, v: itemView(el), qty: itemQuantity(el), eq: isEquipped(el), att: isAttuned(el) }));
  return (
    <div className="inventory">
      <section className="panel">
        <div className="row between">
          <div className="row currency">
            {CHARACTER_TAGS.currency.map((k) => (
              <Field key={k} label={k.toUpperCase()}>
                <NumberInput value={c.currency(k)} min={0} onChange={(n) => mutate((ch) => ch.setCurrency(k, n))} />
              </Field>
            ))}
          </div>
          <div className={sheet.carried > sheet.capacity ? 'danger' : 'muted'}>Carrying {round(sheet.carried)} / {sheet.capacity} lb</div>
        </div>
        <table className="items">
          <thead><tr><th title="Equipped">Eq</th><th title="Attuned">At</th><th>Item</th><th>Qty</th><th>Weight</th><th /></tr></thead>
          <tbody>
            {items.map(({ el, v, qty, eq, att }, i) => (
              <tr key={i}>
                <td><input type="checkbox" checked={eq} onChange={(e) => mutate(() => setEquipped(el, e.target.checked))} /></td>
                <td>{(v.magic || /attunement/i.test(v.detail)) && <input type="checkbox" checked={att} onChange={(e) => mutate(() => setAttuned(el, e.target.checked))} />}</td>
                <td><button className="link" onClick={() => setOpen(el)}>{v.name}</button> <span className="muted small">{v.typeLabel}</span></td>
                <td><NumberInput className="qty" value={qty} min={0} onChange={(n) => mutate(() => setItemQuantity(el, n))} /></td>
                <td>{v.weight ? round(v.weight * qty) : ''}</td>
                <td>
                  {v.rolls[0] && <RollChip expr={v.rolls[0]} label={v.name} />}
                  <button className="link danger" onClick={() => mutate((ch) => ch.remove(el))}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button onClick={() => setAdding(true)}>Add items…</button>
          <button onClick={() => {
            const name = prompt('Custom item name');
            if (name) mutate((ch) => {
              const it = ch.addItem({ type: 'el', name: 'item', attrs: [], children: [] });
              setChildText(it, 'name', name);
              setChildText(it, 'type', 'G');
            });
          }}>Custom item…</button>
        </div>
      </section>
      {open && <ItemEditor el={open} onClose={() => setOpen(null)} mutate={mutate} />}
      {adding && (
        <Picker kind="item" onClose={() => setAdding(false)} has={() => false}
          onPick={(e) => mutate((ch) => { ch.addItem(e.el); })} />
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

function ItemEditor({ el, onClose, mutate }: { el: XElement; onClose: () => void; mutate: Mutate }) {
  const [edit, setEdit] = useState(false);
  const fields: [string, string][] = [['name', 'Name'], ['type', 'Type code'], ['detail', 'Detail'], ['weight', 'Weight'],
    ['value', 'Value'], ['ac', 'AC'], ['dmg1', 'Damage'], ['dmg2', 'Versatile damage'], ['dmgType', 'Damage type code'],
    ['property', 'Properties'], ['range', 'Range']];
  return (
    <Modal title={childText(el, 'name')} onClose={onClose}>
      {!edit && <EntryDetail entry={{ kind: 'item', name: childText(el, 'name'), el, fileId: '' }} />}
      {edit && (
        <div className="grid2">
          {fields.map(([k, label]) => (
            <Field key={k} label={label}><input defaultValue={childText(el, k)} onBlur={(e) => mutate(() => setChildText(el, k, e.target.value))} /></Field>
          ))}
          <Field label="Description"><textarea defaultValue={childTexts(el, 'text').join('\n')} rows={5}
            onBlur={(e) => mutate(() => {
              el.children = el.children.filter((x) => !(x.type === 'el' && x.name === 'text'));
              for (const line of e.target.value.split('\n')) el.children.push({ type: 'el', name: 'text', attrs: [], children: line ? [{ type: 'text', value: line }] : [] });
            })} /></Field>
        </div>
      )}
      <footer className="modal-actions"><button onClick={() => setEdit(!edit)}>{edit ? 'Done editing' : 'Edit this copy'}</button></footer>
    </Modal>
  );
}

// ---------------------------------------------------------------- features

function FeaturesTab({ sheet, app, mutate }: { sheet: SheetT; app: AppState; mutate: Mutate }) {
  const groups = new Map<string, typeof sheet.features>();
  for (const f of sheet.features) groups.set(f.source, [...(groups.get(f.source) ?? []), f]);
  return (
    <div className="features">
      {sheet.counters.length > 0 && (
        <section className="panel">
          <h3>Resources</h3>
          {sheet.counters.map((ct) => {
            const used = app.countersUsed[ct.name] ?? 0;
            return (
              <div key={ct.name} className="row">
                <span className="counter-name">{ct.name}</span>
                {Array.from({ length: Math.min(ct.value, 30) }, (_, j) => (
                  <input key={j} type="checkbox" checked={j < used}
                    onChange={(e) => mutate((_, a) => { a.countersUsed = { ...a.countersUsed, [ct.name]: e.target.checked ? j + 1 : j }; })} />
                ))}
                <span className="muted small">{ct.value - used}/{ct.value} · {/^s/i.test(ct.reset) ? 'short rest' : /^l/i.test(ct.reset) ? 'long rest' : ct.reset}</span>
              </div>
            );
          })}
        </section>
      )}
      {[...groups].map(([source, list]) => (
        <section key={source} className="panel">
          <h3>{source}</h3>
          {list.map((f, i) => (
            <details key={i}>
              <summary>{f.name}{f.level ? <span className="muted small"> · level {f.level}</span> : null}</summary>
              <RichText text={f.text} label={f.name} />
            </details>
          ))}
        </section>
      ))}
      {sheet.modifiers.length > 0 && (
        <section className="panel">
          <h3>Active modifiers</h3>
          <ul className="small">{sheet.modifiers.map((m, i) => <li key={i}>{m.source}: <code>{m.category}</code> {m.raw}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- notes

function NotesTab({ c, mutate }: { c: Character; mutate: Mutate }) {
  return (
    <div className="notes">
      <section className="panel">
        <Field label="Alignment"><input value={c.alignment} onChange={(e) => mutate((ch) => { ch.alignment = e.target.value; })} /></Field>
      </section>
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
    </div>
  );
}

// ---------------------------------------------------------------- level up

function LevelUpModal({ c, onClose, mutate }: { c: Character; onClose: () => void; mutate: Mutate }) {
  const { lib } = useApp();
  const existing = c.classes;
  const [target, setTarget] = useState<string>(existing[0] ? `existing:0` : lib.byKind.class[0] ? `new:${lib.byKind.class[0].name}` : '');
  const [hp, setHp] = useState<'average' | 'roll' | 'manual'>('average');
  const [manualHp, setManualHp] = useState(1);
  const [subclass, setSubclass] = useState('');
  const [choices, setChoices] = useState<string[]>([]);
  const [asiMode, setAsiMode] = useState<'two' | 'split' | 'feat'>('two');
  const [asiA, setAsiA] = useState<Ability>('strength');
  const [asiB, setAsiB] = useState<Ability>('dexterity');
  const [feat, setFeat] = useState('');

  const existingEl = target.startsWith('existing:') ? existing[+target.split(':')[1]] : undefined;
  const newEl = target.startsWith('new:') ? lookup(lib, 'class', target.slice(4))?.el : undefined;
  const classEl = existingEl ?? newEl;
  const nextLevel = existingEl ? classLevel(existingEl) + 1 : 1;
  const opts = classEl ? levelOptions(classEl, nextLevel, existingEl ? classSubclass(existingEl) : '') : null;
  const multiclassNotes = newEl && existing.length ? 'Multiclassing: check ability score prerequisites. Only the first class grants saving throw proficiencies.' : '';

  const apply = () => {
    if (!classEl || c.totalLevel >= 20) return;
    const asi: Partial<Record<Ability, number>> | undefined = opts?.asi && asiMode !== 'feat'
      ? (asiMode === 'two' ? { [asiA]: 2 } : { [asiA]: 1, [asiB]: 1 }) : undefined;
    const featEl = opts?.asi && asiMode === 'feat' && feat ? lookup(lib, 'feat', feat)?.el : undefined;
    mutate((ch) => {
      applyLevelUp(ch, {
        existing: existingEl, newClass: newEl,
        hp: hp === 'manual' ? { method: 'manual', value: manualHp } : { method: hp },
        subclass: subclass || undefined, choices, asi, feat: featEl,
      }, cryptoRng);
    });
    onClose();
  };

  return (
    <Modal title="Level up" onClose={onClose} wide>
      {c.totalLevel >= 20 && <p className="danger">This character is already level 20.</p>}
      <Field label="Class">
        <select value={target} onChange={(e) => { setTarget(e.target.value); setSubclass(''); setChoices([]); }}>
          {existing.map((ce, i) => <option key={i} value={`existing:${i}`}>{childText(ce, 'name')} → {classLevel(ce) + 1}</option>)}
          {lib.byKind.class.filter((e) => !existing.some((ce) => childText(ce, 'name').toLowerCase() === e.name.toLowerCase()))
            .map((e) => <option key={e.name} value={`new:${e.name}`}>{e.name} (new class, multiclass)</option>)}
        </select>
      </Field>
      {multiclassNotes && <p className="muted small">{multiclassNotes}</p>}
      {opts && (
        <>
          {c.totalLevel > 0 && (
            <div className="row">
              <span>Hit points (d{opts.cv.hd} {signed(mod(c.abilities.constitution))} Con):</span>
              {(['average', 'roll', 'manual'] as const).map((m) => (
                <label key={m} className="radio"><input type="radio" checked={hp === m} onChange={() => setHp(m)} />{m === 'average' ? `Average (${Math.floor(opts.cv.hd / 2) + 1})` : m === 'roll' ? 'Roll' : 'Enter roll'}</label>
              ))}
              {hp === 'manual' && <NumberInput value={manualHp} min={1} max={opts.cv.hd} onChange={setManualHp} />}
            </div>
          )}
          {opts.gained.length > 0 && <><h3>New features</h3><ul>{opts.gained.map((f) => <li key={f.name}>{f.name}</li>)}</ul></>}
          {opts.subclassIntro && (
            <Field label="Subclass">
              <select value={subclass} onChange={(e) => setSubclass(e.target.value)}>
                <option value="">(choose later)</option>
                {opts.subclasses.map((sname) => <option key={sname}>{sname}</option>)}
              </select>
            </Field>
          )}
          {opts.optional.length > 0 && (
            <>
              <h3>Options</h3>
              <div className="checks">
                {opts.optional.map((f) => (
                  <label key={f.name} title={f.text}>
                    <input type="checkbox" checked={choices.includes(f.name)}
                      onChange={(e) => setChoices(e.target.checked ? [...choices, f.name] : choices.filter((x) => x !== f.name))} />
                    {f.name}
                  </label>
                ))}
              </div>
            </>
          )}
          {opts.asi && (
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
            if (confirm(`Remove one ${childText(ce, 'name')} level?`)) { mutate((ch) => removeLevel(ch, ce)); onClose(); }
          }}>Remove a level</button>
        )}
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!classEl || c.totalLevel >= 20 || (asiMode === 'split' && asiA === asiB)} onClick={apply}>Apply</button>
      </footer>
    </Modal>
  );
}

// ---------------------------------------------------------------- picker

function Picker({ kind, onClose, onPick, has, filterHint }: {
  kind: Kind; onClose: () => void; onPick: (e: Entry) => void; has: (name: string) => boolean; filterHint?: string[];
}) {
  const { lib, toast } = useApp();
  const [q, setQ] = useState('');
  const [onlyMine, setOnlyMine] = useState(!!filterHint?.length);
  const [sel, setSel] = useState<Entry | null>(null);
  const hint = (filterHint ?? []).map((x) => x.toLowerCase());
  const list = lib.byKind[kind].filter((e) => {
    if (q && !e.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (onlyMine && kind === 'spell' && hint.length) {
      const cls = spellView(e.el).classes.map((x) => x.toLowerCase());
      return cls.some((x) => hint.some((h) => x.startsWith(h)));
    }
    return true;
  });
  return (
    <Modal title={`Add ${KIND_LABEL[kind].toLowerCase()}`} onClose={onClose} wide>
      <div className="row">
        <input type="search" autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        {filterHint && filterHint.length > 0 && <label><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only {filterHint.join(' / ')} spells</label>}
      </div>
      <div className="split picker">
        <ul className="entry-list">
          {list.slice(0, 1000).map((e) => (
            <li key={e.name} className={sel === e ? 'active' : ''} onClick={() => setSel(e)}>
              <span>{e.name}</span>
              <button className="small" disabled={kind === 'spell' && has(e.name)}
                onClick={(ev) => { ev.stopPropagation(); onPick(e); toast(`Added ${e.name}`); }}>{kind === 'spell' && has(e.name) ? 'Added' : 'Add'}</button>
            </li>
          ))}
        </ul>
        <div className="detail-pane">{sel ? <EntryDetail entry={sel} /> : <p className="muted">Select an entry to preview.</p>}</div>
      </div>
    </Modal>
  );
}
