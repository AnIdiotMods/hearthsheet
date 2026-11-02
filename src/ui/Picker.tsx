import { useState } from 'react';
import { Entry, KIND_LABEL, Kind, sourceOf, sourceTag, spellClassMatches, spellView } from '../model/compendium';
import { EntryDetail } from './CompendiumView';
import { Modal, useApp } from './common';

const levelLabel = (n: number) => (n === 0 ? 'Cantrip' : `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`);

/** Search the compendium and add entries one at a time. */
export function Picker({ kind, onClose, onPick, has, filterHint, subclasses = [], maxSpellLevel, beforePick }: {
  kind: Kind; onClose: () => void; onPick: (e: Entry) => void; has: (name: string) => boolean; filterHint?: string[]; subclasses?: string[];
  /** Spells: the highest level the class can cast now; higher spells are hidden unless asked for. */
  maxSpellLevel?: number;
  /** Return false to cancel adding (after a warning). */
  beforePick?: (e: Entry) => boolean;
}) {
  const { lib, toast } = useApp();
  const [q, setQ] = useState('');
  const [onlyMine, setOnlyMine] = useState(!!filterHint?.length);
  const [castableOnly, setCastableOnly] = useState(maxSpellLevel !== undefined);
  const [sel, setSel] = useState<Entry | null>(null);
  const isSpell = kind === 'spell';
  const list = lib.byKind[kind].filter((e) => {
    if (q && !e.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (!isSpell) return true;
    const v = spellView(e.el);
    if (castableOnly && maxSpellLevel !== undefined && v.level > maxSpellLevel) return false;
    if (onlyMine && filterHint?.length) return v.classes.some((x) => filterHint.some((h) => spellClassMatches(x, h, subclasses)));
    return true;
  }).map((e) => ({ e, level: isSpell ? spellView(e.el).level : -1, tag: sourceTag(e.name, sourceOf(e.el)) }));
  if (isSpell) list.sort((a, b) => a.level - b.level || a.e.name.localeCompare(b.e.name));
  return (
    <Modal title={`Add ${KIND_LABEL[kind].toLowerCase()}`} onClose={onClose} wide>
      <div className="row wrap">
        <input type="search" autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        {filterHint && filterHint.length > 0 && <label><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only {filterHint.join(' / ')} spells</label>}
        {maxSpellLevel !== undefined && (
          <label><input type="checkbox" checked={castableOnly} onChange={(e) => setCastableOnly(e.target.checked)} /> Only levels you can cast ({maxSpellLevel ? `up to ${levelLabel(maxSpellLevel)}` : 'cantrips'})</label>
        )}
      </div>
      <div className="split picker">
        <ul className="entry-list">
          {list.slice(0, 1000).map(({ e, level, tag }) => (
            <li key={e.name} className={sel === e ? 'active' : ''} onClick={() => setSel(e)}>
              <span>
                {e.name}
                {isSpell && <span className={`muted small ${maxSpellLevel !== undefined && level > maxSpellLevel ? 'danger' : ''}`}> · {levelLabel(level)}</span>}
                {tag && <>{' '}<span className="tag unofficial">{tag}</span></>}
              </span>
              <button className="small" disabled={isSpell && has(e.name)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (beforePick && !beforePick(e)) return;
                  onPick(e);
                  toast(`Added ${e.name}`);
                }}>{isSpell && has(e.name) ? 'Added' : 'Add'}</button>
            </li>
          ))}
          {list.length === 0 && <li className="muted small">Nothing matches.{castableOnly ? ' Untick “Only levels you can cast” to see higher-level spells.' : ''}</li>}
        </ul>
        <div className="detail-pane">{sel ? <EntryDetail entry={sel} /> : <p className="muted">Select an entry to preview.</p>}</div>
      </div>
    </Modal>
  );
}
