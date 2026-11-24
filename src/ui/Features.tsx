import { useState } from 'react';
import { ClassFeature, Trait, isOptionalRule, isPlaceholderFeature } from '../model/compendium';
import {
  AppState, Character, ModifierInput, addClassFeat, addCustomClassFeat, classFeats, classLevel, featModifiers,
  hasEmbeddedProgression, updateFeat,
} from '../model/character';
import { CV, Sheet as SheetData, progressionOf } from '../rules/derive';
import { resolveFormula } from '../rules/dice';
import { XElement, childText, removeChild } from '../xml/xml';
import { Field, Modal, Mutate, NumberInput, RichText, useApp } from './common';
import { OptionGroupsPicker, familyTitle, optionContext } from './Options';
import { Picker } from './Picker';
import { ask } from './dialogs';
import { OptionGroup, OptionItem, optionGroups } from '../rules/options';

type RollF = (f: string, l?: string) => unknown;

export function FeaturesTab({ c, sheet, app, mutate, rollF }: { c: Character; sheet: SheetData; app: AppState; mutate: Mutate; rollF: RollF }) {
  const { options, lib, toast } = useApp();
  const [pickingFeat, setPickingFeat] = useState(false);
  const [editing, setEditing] = useState<{ fe: XElement } | { classEl: XElement } | { characterFeat: true } | null>(null);
  const [adding, setAdding] = useState<XElement | null>(null);
  const classNames = new Set(c.classes.map((ce) => childText(ce, 'name')));
  const others = new Map<string, typeof sheet.features>();
  for (const f of sheet.features) {
    if (classNames.has(f.source) || f.source === 'Feat') continue;
    others.set(f.source, [...(others.get(f.source) ?? []), f]);
  }
  const rolls = (list: { formula: string; description: string }[], label: string) => list.length > 0 && (
    <p>{list.map((r, j) => <button key={j} className="roll" title={r.description} onClick={() => rollF(r.formula, label)}>{r.description ? `${r.description}: ` : ''}{resolveFormula(r.formula, sheet.formula)}</button>)}</p>
  );

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
                {ct.unlimited ? <b>Unlimited</b> : ct.value <= 12 ? Array.from({ length: ct.value }, (_, j) => (
                  <input key={j} type="checkbox" checked={j < used} aria-label={`${ct.name} used ${j + 1}`}
                    onChange={(e) => mutate((_, a) => { a.countersUsed = { ...a.countersUsed, [ct.name]: e.target.checked ? j + 1 : j }; })} />
                )) : (
                  <label className="small">Used <NumberInput className="qty" value={used} min={0} max={ct.value}
                    onChange={(n) => mutate((_, a) => { a.countersUsed = { ...a.countersUsed, [ct.name]: Math.max(0, Math.min(ct.value, n)) }; })} /></label>
                )}
                <span className="muted small">{ct.unlimited ? '' : `${ct.value - used}/${ct.value} · `}{/^s/i.test(ct.reset) ? 'short rest' : /^l/i.test(ct.reset) ? 'long rest' : ct.reset}{ct.builtin ? ' · built-in rule' : ''}</span>
              </div>
            );
          })}
        </section>
      )}

      {c.classes.map((ce, ci) => {
        const cv = progressionOf(ce, options);
        const level = classLevel(ce);
        const feats = classFeats(ce);
        const known = new Map([...cv.features].reverse().map((f) => [f.name, f] as const)); // first occurrence wins
        const missing = cv.features.filter((f) => !f.optional && !isOptionalRule(f) && !isPlaceholderFeature(f) && f.level <= level && !feats.some((x) => x.name === f.name));
        const fallback = !feats.length && !hasEmbeddedProgression(ce);
        return (
          <section key={ci} className="panel">
            <div className="row between">
              <h3>{cv.name} {level} features</h3>
              <div className="row">
                {missing.length > 0 && !fallback && (
                  <button className="small" title={missing.map((f) => f.name).join(', ')}
                    onClick={() => mutate(() => missing.forEach((f) => addClassFeat(ce, f)))}>Restore missing ({missing.length})</button>
                )}
                <button className="small" onClick={() => setAdding(ce)}>Add feature…</button>
              </div>
            </div>
            {fallback && <p className="muted small">This class has no feature list of its own, so its features are shown from the compendium. Adding a feature creates the list.</p>}
            {fallback && sheet.features.filter((f) => f.source === cv.name).map((f, i) => (
              <details key={i}><summary>{f.name}{f.level ? <span className="muted small"> · level {f.level}</span> : null}</summary><RichText text={f.text} label={f.name} /></details>
            ))}
            {!fallback && feats.length === 0 && <p className="muted small">No features. Use “Add feature…” or “Restore missing”.</p>}
            {feats.filter((f) => !isPlaceholderFeature(f)).map((f, i) => {
              const src = known.get(f.name);
              return (
                <details key={i}>
                  <summary>
                    {f.name}
                    {src ? <span className="muted small"> · level {src.level}</span> : <>{' '}<span className="tag">custom</span></>}
                    {src?.optional && <>{' '}<span className="tag">option</span></>}
                    {f.modifiers.length > 0 && <>{' '}<span className="tag" title={f.modifiers.map((m) => m.raw).join('; ')}>modifiers</span></>}
                    <span className="feature-actions">
                      <button className="link small" onClick={(e) => { e.preventDefault(); setEditing({ fe: f.el }); }}>edit</button>
                      <button className="link danger small" onClick={(e) => {
                        e.preventDefault();
                        void ask(`Remove “${f.name}” from ${cv.name}?`, { ok: 'Remove', danger: true }).then((ok) => { if (ok) mutate(() => removeChild(ce, f.el)); });
                      }}>remove</button>
                    </span>
                  </summary>
                  <RichText text={f.text} label={f.name} />
                  {rolls(f.rolls, f.name)}
                </details>
              );
            })}
          </section>
        );
      })}

      <section className="panel">
        <div className="row between">
          <h3>Feats</h3>
          <div className="row">
            <button className="small" onClick={() => setPickingFeat(true)}>Add from compendium…</button>
            <button className="small" onClick={() => setEditing({ characterFeat: true })}>Add custom feat…</button>
          </div>
        </div>
        {c.feats.length === 0 && <p className="muted small">No feats. Feats and class options such as invocations, maneuvers or metamagic appear here.</p>}
        {c.feats.map((fe, i) => (
          <details key={i}>
            <summary>
              {childText(fe, 'name').includes(':') ? childText(fe, 'name').slice(childText(fe, 'name').indexOf(':') + 1).trim() : childText(fe, 'name')}
              {childText(fe, 'name').includes(':') && <>{' '}<span className="tag">{familyTitle(childText(fe, 'name').split(':')[0].trim())}</span></>}
              <span className="feature-actions">
                <button className="link small" onClick={(e) => { e.preventDefault(); setEditing({ fe }); }}>edit</button>
                <button className="link danger small" onClick={(e) => { e.preventDefault(); void ask(`Remove the feat “${childText(fe, 'name')}”?`, { ok: 'Remove', danger: true }).then((ok) => { if (ok) mutate((ch) => ch.remove(fe)); }); }}>remove</button>
              </span>
            </summary>
            <RichText text={sheet.features.find((f) => f.source === 'Feat' && f.name === childText(fe, 'name'))?.text ?? ''} />
          </details>
        ))}
      </section>

      {[...others].map(([source, list]) => (
        <section key={source} className="panel">
          <h3>{source}</h3>
          {list.map((f, i) => (
            <details key={i}><summary>{f.name}</summary><RichText text={f.text} label={f.name} />{rolls(f.rolls, f.name)}</details>
          ))}
        </section>
      ))}

      {sheet.modifiers.length > 0 && (
        <section className="panel">
          <h3>Active modifiers</h3>
          <ul className="small">{sheet.modifiers.map((m, i) => <li key={i}>{m.source}: <code>{m.category}</code> {m.raw}</li>)}</ul>
        </section>
      )}

      {editing && 'fe' in editing && (
        <FeatureEditor title="Edit feature" initial={{ name: childText(editing.fe, 'name'), text: (classFeatText(editing.fe)), modifiers: featModifiers(editing.fe) }}
          onClose={() => setEditing(null)}
          onSave={(v) => { mutate(() => updateFeat(editing.fe, v)); setEditing(null); }} />
      )}
      {editing && 'characterFeat' in editing && (
        <FeatureEditor title="Add custom feat" initial={{ name: '', text: '', modifiers: [] }} onClose={() => setEditing(null)}
          onSave={(v) => { mutate((ch) => { const fe = ch.insert({ type: 'el', name: 'feat', attrs: [], children: [] }); updateFeat(fe, v); fe.children.push({ type: 'el', name: 'expanded', attrs: [], children: [{ type: 'text', value: '0' }] }); }); setEditing(null); }} />
      )}
      {pickingFeat && (
        <Picker kind="feat" onClose={() => setPickingFeat(false)} has={(n) => c.feats.some((f) => childText(f, 'name').toLowerCase() === n.toLowerCase())}
          onPick={(e) => mutate((ch) => { ch.addFeat(e.el); })} />
      )}
      {adding && (
        <AddClassFeature classEl={adding} cv={progressionOf(adding, options)} onClose={() => setAdding(null)}
          groups={optionGroups(optionContext({ lib, cv: progressionOf(adding, options), level: classLevel(adding), c, classEl: adding, sheet, incoming: [] }))}
          onAddOption={(o) => { mutate((ch) => { if (o.feature) addClassFeat(adding, o.feature); else if (o.feat) ch.addFeat(o.feat.el); }); toast(`Added ${o.label}`); }}
          onAddFromClass={(f) => mutate(() => addClassFeat(adding, f))}
          onAddCustom={(v) => { mutate(() => addCustomClassFeat(adding, v.name, v.text, v.modifiers)); setAdding(null); }} />
      )}
    </div>
  );
}

const classFeatText = (fe: XElement) => fe.children.filter((x) => x.type === 'el' && x.name === 'text')
  .map((x) => (x.type === 'el' ? x.children.map((t) => (t.type === 'text' || t.type === 'cdata' ? t.value : '')).join('') : '')).join('\n');

interface FeatureValue { name: string; text: string; modifiers: ModifierInput[] }

const CATEGORIES = ['bonus', 'ability score', 'ability modifier', 'saving throw', 'skill'];

function FeatureForm({ value, onChange }: { value: FeatureValue; onChange: (v: FeatureValue) => void }) {
  const setMod = (i: number, patch: Partial<ModifierInput>) =>
    onChange({ ...value, modifiers: value.modifiers.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  return (
    <>
      <Field label="Name"><input autoFocus value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></Field>
      <Field label="Description"><textarea rows={8} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} /></Field>
      <h3>Modifiers</h3>
      <p className="muted small">Optional. Modifiers change the sheet while the feature is present, for example “ac +1” (bonus), “strength +2” (ability score), “wisdom save +1” (saving throw), “stealth +2” (skill), “speed +10” or “initiative +5” (bonus). Use PROF or %8 for your proficiency bonus.</p>
      {value.modifiers.map((m, i) => (
        <div key={i} className="row">
          <select value={m.category} onChange={(e) => setMod(i, { category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input placeholder="ac +1" value={m.text} onChange={(e) => setMod(i, { text: e.target.value })} />
          <button className="link danger" onClick={() => onChange({ ...value, modifiers: value.modifiers.filter((_, j) => j !== i) })}>remove</button>
        </div>
      ))}
      <button className="small" onClick={() => onChange({ ...value, modifiers: [...value.modifiers, { category: 'bonus', text: '' }] })}>Add modifier</button>
    </>
  );
}

function FeatureEditor({ title, initial, onClose, onSave }: { title: string; initial: FeatureValue; onClose: () => void; onSave: (v: FeatureValue) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <FeatureForm value={v} onChange={setV} />
      <footer className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!v.name.trim()} onClick={() => onSave({ ...v, name: v.name.trim() })}>Save</button>
      </footer>
    </Modal>
  );
}

function AddClassFeature({ classEl, cv, groups, onClose, onAddFromClass, onAddOption, onAddCustom }: {
  classEl: XElement; cv: CV; groups: OptionGroup[]; onClose: () => void; onAddFromClass: (f: ClassFeature) => void;
  onAddOption: (o: OptionItem) => void; onAddCustom: (v: FeatureValue) => void;
}) {
  const level = classLevel(classEl);
  const [mode, setMode] = useState<'class' | 'options' | 'custom'>(groups.length ? 'options' : cv.features.length ? 'class' : 'custom');
  const [q, setQ] = useState('');
  const [allLevels, setAllLevels] = useState(false);
  const [custom, setCustom] = useState<FeatureValue>({ name: '', text: '', modifiers: [] });
  const [open, setOpen] = useState<string | null>(null);
  const have = new Set(classFeats(classEl).map((f: Trait) => f.name));
  const list = cv.features.filter((f) => !have.has(f.name) && (allLevels || f.level <= level)
    && (!q || f.name.toLowerCase().includes(q.toLowerCase())) && !/^(starting|multiclass) /i.test(f.name));
  return (
    <Modal title={`Add a ${cv.name} feature`} onClose={onClose} wide>
      <nav className="tabs">
        <button className={mode === 'options' ? 'active' : ''} disabled={!groups.length} onClick={() => setMode('options')}>Class options{groups.length ? ` (${groups.map((g) => familyTitle(g.family)).join(', ')})` : ''}</button>
        <button className={mode === 'class' ? 'active' : ''} disabled={!cv.features.length} onClick={() => setMode('class')}>From the class</button>
        <button className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>Write your own</button>
      </nav>
      {mode === 'options' && (
        <OptionGroupsPicker groups={groups.map((g) => ({ ...g, now: true }))} picked={[]} onToggle={(o, on) => { if (on) onAddOption(o); }}
          intro="Tick an option to add it. Options the character already has are ticked and greyed out." />
      )}
      {mode === 'class' && (
        <>
          <div className="row">
            <input type="search" placeholder="Search features…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="check"><input type="checkbox" checked={allLevels} onChange={(e) => setAllLevels(e.target.checked)} /> Include features above level {level}</label>
          </div>
          {list.length === 0 && <p className="muted">Nothing to add: the character already has every matching feature.</p>}
          <ul className="entry-list feature-pick">
            {list.map((f) => (
              <li key={`${f.level}:${f.name}`} onClick={() => setOpen(open === f.name ? null : f.name)}>
                <div>
                  <span>{f.name}</span> <span className="muted small">level {f.level}{f.optional ? ' · option' : ''}</span>
                  {open === f.name && <RichText text={f.text} />}
                </div>
                <button className="small" aria-label={`Add ${f.name}`} onClick={(e) => { e.stopPropagation(); onAddFromClass(f); }}>Add</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {mode === 'custom' && (
        <>
          <FeatureForm value={custom} onChange={setCustom} />
          <footer className="modal-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!custom.name.trim()} onClick={() => onAddCustom({ ...custom, name: custom.name.trim() })}>Add feature</button>
          </footer>
        </>
      )}
    </Modal>
  );
}
