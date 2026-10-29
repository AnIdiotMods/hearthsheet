import { Fragment, useMemo, useState } from 'react';
import {
  CompendiumFile, Entry, KINDS, KIND_LABEL, Kind, backgroundView, classView, exportLibrary, featView, fieldsOf,
  itemView, monsterView, raceView, spellView, ABBR, ABILITIES, WEAPON_PROPERTIES,
} from '../model/compendium';
import { downloadText } from '../store/db';
import { RichText, RollChip, signed, useApp } from './common';
import { mod } from '../rules/derive';

interface Props {
  files: CompendiumFile[];
  onImport: () => void;
  onLoadSample: () => void;
  onToggle: (f: CompendiumFile) => void;
  onRemove: (f: CompendiumFile) => void;
}

export function CompendiumView({ files, onImport, onLoadSample, onToggle, onRemove }: Props) {
  const { lib } = useApp();
  const [kind, setKind] = useState<Kind>('spell');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Entry | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return lib.byKind[kind].filter((e) => !t || e.name.toLowerCase().includes(t));
  }, [lib, kind, q]);

  return (
    <div className="compendium">
      <section className="panel files">
        <div className="row between">
          <h2>Compendium files</h2>
          <div className="row">
            <button onClick={onImport}>Import XML…</button>
            <button onClick={onLoadSample} title="Small CC-BY-4.0 sample from the SRD 5.1">Add SRD sample</button>
            <button disabled={!lib.entries.size} onClick={() => downloadText('compendium.xml', exportLibrary(lib))}>Export merged</button>
          </div>
        </div>
        {files.length === 0 && <p className="muted">No compendiums yet. Import your own compendium XML files, or add the SRD sample to try the app.</p>}
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.id}>
              <label><input type="checkbox" checked={f.enabled} onChange={() => onToggle(f)} /> {f.fileName}</label>
              <span className="muted">{new Date(f.importedAt).toLocaleDateString()}</span>
              <button className="link" onClick={() => downloadText(f.fileName, f.xml)}>Export</button>
              <button className="link danger" onClick={() => onRemove(f)}>Remove</button>
            </li>
          ))}
        </ul>
        {lib.warnings.length > 0 && (
          <p>
            <button className="link" onClick={() => setShowWarnings(!showWarnings)}>
              {lib.warnings.length} import warning{lib.warnings.length > 1 ? 's' : ''} {showWarnings ? '▲' : '▼'}
            </button>
          </p>
        )}
        {showWarnings && (
          <ul className="warnings">
            {lib.warnings.map((w, i) => <li key={i}><b>{files.find((f) => f.id === w.fileId)?.fileName}</b>: {w.message}</li>)}
          </ul>
        )}
      </section>

      <div className="browser">
        <nav className="kind-tabs">
          {KINDS.map((k) => (
            <button key={k} className={k === kind ? 'active' : ''} onClick={() => { setKind(k); setSel(null); }}>
              {KIND_LABEL[k]} <span className="count">{lib.byKind[k].length}</span>
            </button>
          ))}
        </nav>
        <div className="split">
          <div className="list-pane">
            <input type="search" placeholder={`Search ${KIND_LABEL[kind].toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="entry-list">
              {list.slice(0, 2000).map((e) => (
                <li key={e.name} className={sel?.el === e.el ? 'active' : ''} onClick={() => setSel(e)}>
                  <span>{e.name}</span><span className="muted small">{subtitle(e)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="detail-pane">{sel ? <EntryDetail entry={sel} /> : <p className="muted">Select an entry.</p>}</div>
        </div>
      </div>
    </div>
  );
}

function subtitle(e: Entry): string {
  switch (e.kind) {
    case 'spell': { const s = spellView(e.el); return s.level ? `Level ${s.level}` : 'Cantrip'; }
    case 'item': return itemView(e.el).typeLabel;
    case 'monster': return `CR ${monsterView(e.el).cr}`;
    case 'class': return `d${classView(e.el).hd}`;
    default: return '';
  }
}

export function EntryDetail({ entry }: { entry: Entry }) {
  const e = entry.el;
  switch (entry.kind) {
    case 'spell': {
      const s = spellView(e);
      return (
        <article>
          <h2>{s.name}</h2>
          <p className="muted">{s.level ? `Level ${s.level} ${s.school.toLowerCase()}` : `${s.school} cantrip`}{s.ritual ? ' (ritual)' : ''}</p>
          <dl className="facts">
            <dt>Casting time</dt><dd>{s.time}</dd><dt>Range</dt><dd>{s.range}</dd>
            <dt>Components</dt><dd>{s.components}</dd><dt>Duration</dt><dd>{s.duration}</dd>
            <dt>Classes</dt><dd>{s.classes.join(', ')}</dd>
          </dl>
          <RichText text={s.text} label={s.name} />
          {s.rolls.length > 0 && <p>{s.rolls.map((r, i) => <RollChip key={i} expr={r} label={s.name} />)}</p>}
        </article>
      );
    }
    case 'item': {
      const it = itemView(e);
      return (
        <article>
          <h2>{it.name}</h2>
          <p className="muted">{it.typeLabel}{it.magic ? ', magic' : ''}{it.detail ? ` (${it.detail})` : ''}</p>
          <dl className="facts">
            {it.ac ? <><dt>AC</dt><dd>{it.ac}</dd></> : null}
            {it.dmg1 ? <><dt>Damage</dt><dd><RollChip expr={it.dmg1} label={it.name} /> {it.dmg2 && <>/ <RollChip expr={it.dmg2} label={it.name} /></>} {it.dmgType}</dd></> : null}
            {it.properties.length ? <><dt>Properties</dt><dd>{it.properties.map((p) => WEAPON_PROPERTIES[p] ?? p).join(', ')}</dd></> : null}
            {it.range ? <><dt>Range</dt><dd>{it.range}</dd></> : null}
            {it.strength ? <><dt>Strength</dt><dd>{it.strength}</dd></> : null}
            {it.stealth ? <><dt>Stealth</dt><dd>Disadvantage</dd></> : null}
            {it.weight ? <><dt>Weight</dt><dd>{it.weight} lb</dd></> : null}
            {it.value ? <><dt>Value</dt><dd>{it.value}</dd></> : null}
            {it.modifiers.length ? <><dt>Modifiers</dt><dd>{it.modifiers.map((m) => m.raw).join('; ')}</dd></> : null}
          </dl>
          <RichText text={it.text} label={it.name} />
        </article>
      );
    }
    case 'monster': {
      const m = monsterView(e);
      return (
        <article className="statblock">
          <h2>{m.name}</h2>
          <p className="muted">{m.size} {m.type}, {m.alignment}</p>
          <dl className="facts">
            <dt>Armor Class</dt><dd>{m.ac}</dd><dt>Hit Points</dt><dd>{m.hp}</dd><dt>Speed</dt><dd>{m.speed}</dd>
          </dl>
          <div className="mscores">
            {ABILITIES.map((a, i) => <div key={a}><b>{ABBR[a]}</b><RollChip expr={`1d20${signed(mod(m.scores[i]))}`} label={`${m.name} ${ABBR[a]}`}>{m.scores[i]} ({signed(mod(m.scores[i]))})</RollChip></div>)}
          </div>
          <dl className="facts">
            {([['Saving Throws', m.save], ['Skills', m.skill], ['Vulnerabilities', m.vulnerable], ['Resistances', m.resist],
              ['Immunities', m.immune], ['Condition Immunities', m.conditionImmune], ['Senses', [m.senses, m.passive && `passive Perception ${m.passive}`].filter(Boolean).join(', ')],
              ['Languages', m.languages], ['Challenge', m.cr]] as [string, string][]).filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
          </dl>
          {[['Traits', m.traits], ['Actions', m.actions], ['Reactions', m.reactions], ['Legendary Actions', m.legendary]].map(([title, list]) =>
            (list as typeof m.traits).length ? (
              <section key={title as string}>
                <h3>{title as string}</h3>
                {(list as typeof m.traits).map((t, i) => <div key={i}><h4>{t.name}</h4><RichText text={t.text} label={`${m.name}: ${t.name}`} /></div>)}
              </section>
            ) : null)}
          {m.description && <RichText text={m.description} />}
        </article>
      );
    }
    case 'class': {
      const c = classView(e);
      const levels = [...new Set(c.features.map((f) => f.level))].sort((a, b) => a - b);
      return (
        <article>
          <h2>{c.name}</h2>
          <dl className="facts">
            <dt>Hit die</dt><dd>d{c.hd}</dd>
            <dt>Saving throws</dt><dd>{c.savingThrows.map((a) => ABBR[a]).join(', ')}</dd>
            <dt>Skills</dt><dd>Choose {c.numSkills}: {c.skillChoices.join(', ')}</dd>
            <dt>Armor</dt><dd>{c.armor}</dd><dt>Weapons</dt><dd>{c.weapons}</dd><dt>Tools</dt><dd>{c.tools}</dd>
            {c.spellAbility && <><dt>Spellcasting</dt><dd>{c.spellAbility[0].toUpperCase() + c.spellAbility.slice(1)}</dd></>}
            {c.subclasses.length > 0 && <><dt>Subclasses</dt><dd>{c.subclasses.join(', ')}</dd></>}
          </dl>
          {c.slots.length > 0 && (
            <table className="slots-table">
              <thead><tr><th>Level</th><th>Cantrips</th>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <th key={n}>{n}</th>)}</tr></thead>
              <tbody>{c.slots.map((r, i) => <tr key={i}><td>{r.level}{r.optional ? '*' : ''}</td>{Array.from({ length: 10 }, (_, j) => <td key={j}>{r.values[j] || ''}</td>)}</tr>)}</tbody>
            </table>
          )}
          {levels.map((lv) => (
            <section key={lv}>
              <h3>Level {lv}</h3>
              {c.features.filter((f) => f.level === lv).map((f, i) => (
                <div key={i}><h4>{f.name}{f.optional && <span className="tag">optional</span>}</h4><RichText text={f.text} label={f.name} /></div>
              ))}
            </section>
          ))}
        </article>
      );
    }
    case 'race': {
      const r = raceView(e);
      return (
        <article>
          <h2>{r.name}</h2>
          <dl className="facts">
            <dt>Size</dt><dd>{r.size}</dd><dt>Speed</dt><dd>{r.speed} ft.</dd>
            <dt>Ability scores</dt><dd>{Object.entries(r.abilityBonuses).map(([a, v]) => `${ABBR[a as keyof typeof ABBR]} ${signed(v!)}`).join(', ') || '—'}</dd>
            {r.proficiencies.length > 0 && <><dt>Proficiencies</dt><dd>{r.proficiencies.join(', ')}</dd></>}
          </dl>
          {r.traits.map((t, i) => <div key={i}><h4>{t.name}</h4><RichText text={t.text} /></div>)}
        </article>
      );
    }
    case 'background': {
      const b = backgroundView(e);
      return (
        <article>
          <h2>{b.name}</h2>
          <dl className="facts"><dt>Proficiencies</dt><dd>{b.proficiencies.join(', ')}</dd></dl>
          {b.traits.map((t, i) => <div key={i}><h4>{t.name}</h4><RichText text={t.text} /></div>)}
        </article>
      );
    }
    case 'feat': {
      const f = featView(e);
      return (
        <article>
          <h2>{f.name}</h2>
          {f.prerequisite && <p className="muted">Prerequisite: {f.prerequisite}</p>}
          <RichText text={f.text} />
          {f.modifiers.length > 0 && <p className="muted">Modifiers: {f.modifiers.map((m) => m.raw).join('; ')}</p>}
        </article>
      );
    }
    default:
      return <article><h2>{entry.name}</h2><dl className="facts">{fieldsOf(e).map(([k, v], i) => <Fragment key={i}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl></article>;
  }
}
