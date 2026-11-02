import { useState } from 'react';
import { ClassFeature, Library } from '../model/compendium';
import { Character, chosenSubclasses, classFeats } from '../model/character';
import { CV, Sheet as SheetData } from '../rules/derive';
import { OptionContext, OptionGroup, OptionItem } from '../rules/options';
import { XElement, childText, elements } from '../xml/xml';
import { RichText } from './common';

/** Build the context for option lists of one class at the level being taken. */
export function optionContext(p: {
  lib: Library; cv: CV; level: number; c: Character | null; classEl?: XElement; sheet?: SheetData;
  /** Features gained or picked in this step (they can unlock options, e.g. "Combat Superiority"). */
  incoming: { name: string; text: string }[]; subclass?: string;
}): OptionContext {
  const levelOf = new Map([...p.cv.features].reverse().map((f) => [f.name, f.level] as const)); // first occurrence wins
  const own = p.classEl && p.c ? classFeats(p.classEl).map((f) => ({ name: f.name, text: f.text, level: levelOf.get(f.name) })) : [];
  const known = new Set<string>([
    ...(p.sheet?.features.map((f) => f.name) ?? []),
    ...(p.c ? p.c.feats.map((f) => childText(f, 'name')) : []),
    ...own.map((f) => f.name),
  ]);
  const spells = new Set<string>();
  for (const ce of p.c?.classes ?? []) for (const s of elements(ce, 'spell')) spells.add(childText(s, 'name').toLowerCase());
  return {
    lib: p.lib, cv: p.cv, level: p.level,
    classFeatures: [...own, ...p.incoming.map((f) => ({ ...f, level: p.level }))],
    known, spells,
    characterLevel: (p.c?.totalLevel ?? 0) + 1,
    subclasses: [...(p.classEl && p.c ? chosenSubclasses(p.classEl) : []), ...(p.subclass ? [p.subclass] : [])],
  };
}

const FAMILY_TITLE: Record<string, string> = {
  invocation: 'Eldritch Invocations', maneuver: 'Maneuvers', infusion: 'Artificer Infusions', metamagic: 'Metamagic',
  'elemental discipline': 'Elemental Disciplines', 'arcane shot': 'Arcane Shots', rune: 'Runes', 'pact boon': 'Pact Boon',
  'fighting style': 'Fighting Styles',
};
export const familyTitle = (f: string) => FAMILY_TITLE[f.toLowerCase()] ?? f;

/** Lists of class options to tick, grouped by family. Groups the class grants at this level start open. */
export function OptionGroupsPicker({ groups, picked, onToggle, intro }: {
  groups: OptionGroup[]; picked: string[]; onToggle: (o: OptionItem, on: boolean) => void; intro?: string;
}) {
  if (!groups.length) return null;
  const now = groups.filter((g) => g.now);
  const later = groups.filter((g) => !g.now);
  return (
    <div className="option-groups">
      {intro && <p className="muted small">{intro}</p>}
      {now.map((g) => <Group key={g.family} g={g} picked={picked} onToggle={onToggle} open />)}
      {later.length > 0 && (
        <details className="more-options">
          <summary className="muted">{now.length ? 'Other class options' : 'Class options'} ({later.map((g) => familyTitle(g.family)).join(', ')})</summary>
          {later.map((g) => <Group key={g.family} g={g} picked={picked} onToggle={onToggle} />)}
        </details>
      )}
    </div>
  );
}

function Group({ g, picked, onToggle, open }: { g: OptionGroup; picked: string[]; onToggle: (o: OptionItem, on: boolean) => void; open?: boolean }) {
  const [q, setQ] = useState('');
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const chosenHere = g.options.filter((o) => picked.includes(o.name)).length;
  const taken = g.options.filter((o) => o.taken).length;
  const unavailable = g.options.filter((o) => o.prereqMet === false && !o.taken && !picked.includes(o.name)).length;
  const list = g.options.filter((o) => (!q || o.label.toLowerCase().includes(q.toLowerCase()))
    && (showUnavailable || o.prereqMet !== false || o.taken || picked.includes(o.name)));
  return (
    <details className="option-group" open={open}>
      <summary>
        <b>{familyTitle(g.family)}</b>
        <span className="muted small"> · from {g.grantedBy}{taken ? ` · ${taken} known` : ''}</span>
        {chosenHere > 0 && <span className="tag">{chosenHere} chosen</span>}
      </summary>
      <div className="row">
        {g.options.length > 10 && <input type="search" placeholder={`Search ${familyTitle(g.family).toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />}
        {unavailable > 0 && (
          <label className="check small"><input type="checkbox" checked={showUnavailable} onChange={(e) => setShowUnavailable(e.target.checked)} /> Show {unavailable} with unmet prerequisites</label>
        )}
      </div>
      <ul className="option-list">
        {list.map((o) => (
          <li key={o.name} className={o.prereqMet === false ? 'unmet' : ''}>
            <label>
              <input type="checkbox" disabled={o.taken} checked={o.taken || picked.includes(o.name)} onChange={(e) => onToggle(o, e.target.checked)} />
              <span>{o.label}</span>
            </label>
            {o.taken && <span className="tag">known</span>}
            {o.prerequisite && <span className={`small ${o.prereqMet === false ? 'danger' : 'muted'}`}> · {o.prereqMet === false ? o.prereqNote : o.prerequisite}</span>}
            <button className="link small" onClick={() => setExpanded(expanded === o.name ? null : o.name)}>{expanded === o.name ? 'hide' : 'details'}</button>
            {expanded === o.name && <RichText text={o.text} label={o.label} />}
          </li>
        ))}
        {!list.length && <li className="muted small">No matching options.</li>}
      </ul>
    </details>
  );
}

/** Pick skills to gain expertise in. */
export function ExpertisePicker({ skills, picked, onChange, count = 2 }: {
  skills: { name: string; proficient: boolean; expertise: boolean }[]; picked: string[]; onChange: (v: string[]) => void; count?: number;
}) {
  const eligible = skills.filter((s) => s.proficient && !s.expertise);
  return (
    <div>
      <h3>Expertise <span className="muted small">choose {count} skills you are proficient in</span></h3>
      {!eligible.length && <p className="muted small">No proficient skills without expertise yet. You can set expertise later by clicking a skill's mark.</p>}
      <div className="checks">
        {eligible.map((s) => (
          <label key={s.name}>
            <input type="checkbox" checked={picked.includes(s.name)} disabled={!picked.includes(s.name) && picked.length >= count}
              onChange={(e) => onChange(e.target.checked ? [...picked, s.name] : picked.filter((x) => x !== s.name))} />
            {s.name}
          </label>
        ))}
      </div>
    </div>
  );
}

export type { ClassFeature };
