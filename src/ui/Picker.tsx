import { useState } from 'react';
import { Entry, KIND_LABEL, Kind, spellClassMatches, spellView } from '../model/compendium';
import { EntryDetail } from './CompendiumView';
import { Modal, useApp } from './common';

/** Search the compendium and add entries one at a time. */
export function Picker({ kind, onClose, onPick, has, filterHint, subclasses = [] }: {
  kind: Kind; onClose: () => void; onPick: (e: Entry) => void; has: (name: string) => boolean; filterHint?: string[]; subclasses?: string[];
}) {
  const { lib, toast } = useApp();
  const [q, setQ] = useState('');
  const [onlyMine, setOnlyMine] = useState(!!filterHint?.length);
  const [sel, setSel] = useState<Entry | null>(null);
  const list = lib.byKind[kind].filter((e) => {
    if (q && !e.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (onlyMine && kind === 'spell' && filterHint?.length) {
      return spellView(e.el).classes.some((x) => filterHint.some((h) => spellClassMatches(x, h, subclasses)));
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

