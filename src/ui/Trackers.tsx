import { useState } from 'react';
import { Character } from '../model/character';
import {
  RESET_LABEL, TrackerDef, TrackerReset, newTracker, setTrackerValue, trackerDef, trackerMax, trackerValue,
  updateTracker,
} from '../model/tracker';
import { Sheet as SheetData } from '../rules/derive';
import { resolveFormula } from '../rules/dice';
import { XElement } from '../xml/xml';
import { Field, Modal, Mutate, NumberInput } from './common';
import { ask } from './dialogs';

const PIP_LIMIT = 12;

export function TrackersPanel({ c, sheet, mutate }: { c: Character; sheet: SheetData; mutate: Mutate }) {
  const [editing, setEditing] = useState<XElement | 'new' | null>(null);
  const ctx = sheet.formula;
  return (
    <section className="panel trackers">
      <div className="row between">
        <h3>Trackers</h3>
        <button className="small" onClick={() => setEditing('new')}>Add tracker…</button>
      </div>
      {c.trackers.length === 0 && <p className="muted small">Track anything with a count: luck points, ki, arrows, wand charges, rations. Trackers can refill on a rest.</p>}
      {c.trackers.map((t, i) => {
        const def = trackerDef(t);
        const max = trackerMax(t, ctx);
        const value = trackerValue(t, ctx);
        const set = (v: number) => mutate(() => setTrackerValue(t, v, ctx));
        return (
          <div key={i} className="tracker">
            <div className="row between">
              <span className="tracker-name" title={def.reset ? `Refills on: ${RESET_LABEL[def.reset].toLowerCase()}` : 'Refilled by hand'}>
                {def.name}{def.reset && <span className="tag">{def.reset === 'S' ? 'short rest' : 'long rest'}</span>}
              </span>
              <span className="row">
                <button className="small" aria-label={`Decrease ${def.name}`} disabled={value <= 0} onClick={() => set(value - 1)}>−</button>
                <NumberInput className="tracker-value" value={value} min={0} max={max ?? undefined} onChange={set} />
                <span className="muted">/ {max ?? '?'}</span>
                <button className="small" aria-label={`Increase ${def.name}`} disabled={max !== null && value >= max} onClick={() => set(value + 1)}>+</button>
                <button className="link small" onClick={() => setEditing(t)}>edit</button>
              </span>
            </div>
            {max !== null && max > 0 && max <= PIP_LIMIT && (
              <div className="pips" aria-hidden>
                {Array.from({ length: max }, (_, j) => (
                  <button key={j} className={`pip ${j < value ? 'on' : ''}`} tabIndex={-1} onClick={() => set(j < value ? j : j + 1)} />
                ))}
              </div>
            )}
            {max === null && <p className="danger small">The maximum “{def.max}” could not be worked out. Edit the tracker to fix it.</p>}
          </div>
        );
      })}
      {editing && (
        <TrackerEditor
          initial={editing === 'new' ? { name: '', max: '3', reset: 'L' } : trackerDef(editing)}
          preview={(m) => resolveFormula(m, ctx)}
          isNew={editing === 'new'}
          onClose={() => setEditing(null)}
          onRemove={editing === 'new' ? undefined : () => { const t = editing; mutate((ch) => ch.remove(t)); setEditing(null); }}
          onSave={(def) => {
            const t = editing;
            mutate((ch) => {
              if (t === 'new') ch.insert(newTracker(def));
              else { updateTracker(t, def); setTrackerValue(t, trackerValue(t, ctx), ctx); }
            });
            setEditing(null);
          }} />
      )}
    </section>
  );
}

function TrackerEditor({ initial, preview, isNew, onClose, onSave, onRemove }: {
  initial: TrackerDef; preview: (max: string) => string; isNew: boolean;
  onClose: () => void; onSave: (d: TrackerDef) => void; onRemove?: () => void;
}) {
  const [d, setD] = useState(initial);
  const resolved = preview(d.max);
  const ok = /^[+-]?\d+([+-]\d+)*$/.test(resolved.replace(/\s+/g, ''));
  return (
    <Modal title={isNew ? 'Add tracker' : `Edit ${initial.name}`} onClose={onClose}>
      <Field label="Name"><input autoFocus value={d.name} placeholder="Luck points" onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
      <Field label="Maximum">
        <input value={d.max} placeholder="3" onChange={(e) => setD({ ...d, max: e.target.value })} />
      </Field>
      <p className={`small ${ok ? 'muted' : 'danger'}`}>
        {ok ? `Currently ${resolved.replace(/\s+/g, '').match(/[+-]?\d+/g)!.reduce((a, b) => a + parseInt(b, 10), 0)}.` : 'Use a number or a formula.'}{' '}
        A formula can use your character's numbers: PROF (proficiency bonus), LVL (level), STR, DEX, CON, INT, WIS, CHA (modifiers), SPELL (spellcasting modifier). Examples: “PROF”, “1+CHA”, “LVL”, “2*PROF”.
      </p>
      <Field label="Refills on">
        <select value={d.reset} onChange={(e) => setD({ ...d, reset: e.target.value as TrackerReset })}>
          {(['S', 'L', ''] as TrackerReset[]).map((r) => <option key={r} value={r}>{RESET_LABEL[r]}</option>)}
        </select>
      </Field>
      <footer className="modal-actions">
        {onRemove && <button className="danger" onClick={async () => { if (await ask(`Remove the tracker “${initial.name}”?`, { ok: 'Remove', danger: true })) onRemove(); }}>Remove</button>}
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!d.name.trim() || !ok} onClick={() => onSave({ ...d, name: d.name.trim(), max: d.max.trim() })}>Save</button>
      </footer>
    </Modal>
  );
}


