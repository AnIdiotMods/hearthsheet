import { useState } from 'react';
import { ClassFeature, Library, SKILLS, ownsFeature, sourceOf, sourceTag, stripLevelPrefix } from '../model/compendium';
import { Character, chosenSubclasses, classFeats } from '../model/character';
import { CV, Sheet as SheetData } from '../rules/derive';
import { OptionContext, OptionGroup, OptionItem } from '../rules/options';
import { subclassChoicesAt, subclassFeaturesAt } from '../rules/level';
import { XElement, childText, elements, setChildText } from '../xml/xml';
import { RichText, TextToggle, confirmOverLimit } from './common';
import { setSkillSetting } from '../model/custom';

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
  const remaining = g.max !== null ? g.max - g.known - chosenHere : null;
  const unavailable = g.options.filter((o) => o.prereqMet === false && !o.taken && !picked.includes(o.name)).length;
  const list = g.options.filter((o) => (!q || o.label.toLowerCase().includes(q.toLowerCase()))
    && (showUnavailable || o.prereqMet !== false || o.taken || picked.includes(o.name)));
  return (
    <details className="option-group" open={open}>
      <summary>
        <b>{familyTitle(g.family)}</b>
        <span className="muted small"> · from {g.grantedBy}{taken ? ` · ${taken} known` : ''}{g.max !== null ? ` · you can know ${g.max}` : ''}</span>
        {remaining !== null && remaining > 0 && <>{' '}<span className="tag">choose {remaining}</span></>}
        {remaining !== null && remaining < 0 && <>{' '}<span className="tag too-high">{-remaining} over</span></>}
        {chosenHere > 0 && <>{' '}<span className="tag">{chosenHere} chosen</span></>}
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
              <input type="checkbox" disabled={o.taken} checked={o.taken || picked.includes(o.name)} onChange={async (e) => {
                const on = e.target.checked;
                if (on && remaining !== null && remaining <= 0
                  && !(await confirmOverLimit(`${familyTitle(g.family)}: you can know ${g.max}, and this would make ${g.known + chosenHere + 1}.`))) return;
                onToggle(o, on);
              }} />
              <span>{o.label}</span>
            </label>
            {o.sourceTag && <>{' '}<span className="tag unofficial">{o.sourceTag}</span></>}
            {o.taken && <>{' '}<span className="tag">known</span></>}
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
            <input type="checkbox" checked={picked.includes(s.name)}
              onChange={async (e) => {
                const on = e.target.checked;
                if (on && picked.length >= count && !(await confirmOverLimit(`Expertise: you choose ${count} skills, and this would make ${picked.length + 1}.`))) return;
                onChange(on ? [...picked, s.name] : picked.filter((x) => x !== s.name));
              }} />
            {s.name}
          </label>
        ))}
      </div>
    </div>
  );
}

/** A subclass name for a dropdown, with a tag for unofficial content ("Order Domain (UA)" keeps its own). */
export function subclassOptionLabel(cv: CV, sub: string): string {
  const intro = cv.features.find((f) => f.optional && ownsFeature(cv, f, sub));
  const tag = intro ? sourceTag(sub, sourceOf(intro.el)) : '';
  return tag && !sub.includes(`(${tag})`) && !/\((UA|HB|TP)\)/i.test(sub) ? `${sub} [${tag}]` : sub;
}

/**
 * A subclass's features at one level: fixed ones ticked, and pick-one groups (Hunter's Prey,
 * Totem Spirit) where the player chooses.
 */
export function SubclassFeatures({ cv, subclass, level, picked, setPicked }: {
  cv: CV; subclass: string; level: number; picked: string[]; setPicked: (v: string[]) => void;
}) {
  const all = subclassFeaturesAt(cv, subclass, level);
  if (!all.length) return null;
  const groups = subclassChoicesAt(cv, subclass, level);
  const inGroup = new Set(groups.flatMap((g) => g.options.map((f) => f.name)));
  const toggle = (name: string, on: boolean) => setPicked(on ? [...picked, name] : picked.filter((x) => x !== name));
  return (
    <>
      <h3>{subclass} features</h3>
      <div className="checks">
        {all.filter((f) => !inGroup.has(f.name)).map((f) => (
          <label key={f.name}>
            <input type="checkbox" checked={picked.includes(f.name)} onChange={(e) => toggle(f.name, e.target.checked)} /> {f.name}
            <TextToggle text={f.text} label={f.name} />
          </label>
        ))}
      </div>
      {groups.map((g) => {
        const n = g.options.filter((f) => picked.includes(f.name)).length;
        return (
          <div key={g.parent.name} className="choice-group">
            <p><b>{stripLevelPrefix(g.parent.name).replace(/^[^:]+:\s*/, '')}</b>{' '}<span className={`tag ${n > g.count ? 'too-high' : ''}`}>choose {g.count}{n ? ` · ${n} chosen` : ''}</span></p>
            <div className="checks">
              {g.options.map((f) => (
                <label key={f.name}>
                  <input type="checkbox" checked={picked.includes(f.name)} onChange={async (e) => {
                    const on = e.target.checked;
                    if (on && n >= g.count && !(await confirmOverLimit(`${g.parent.name} lets you choose ${g.count}, and this would make ${n + 1}.`))) return;
                    toggle(f.name, on);
                  }} /> {stripLevelPrefix(f.name).replace(/^[^:]+:\s*/, '')}
                  <TextToggle text={f.text} label={f.name} />
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- choices inside features

const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };

export interface ExtraNeeds {
  /** "You gain proficiency in two skills of your choice" (race or class feature). */
  skills: { count: number; from: string[] | null; source: string }[];
  /** Draconic Bloodline's Dragon Ancestor. */
  dragon: string | null;
}
export interface ExtraValues { skills: string[]; dragon: string }
export const emptyExtras = (): ExtraValues => ({ skills: [], dragon: '' });

const SKILL_CHOICE = /proficiency (?:with|in) (a|an|one|two|three|four) (?:other )?skills? of your choice/i;

/** Choices a feature asks for that the file does not record: skill picks and the dragon ancestor. */
export function extraNeeds(features: { name: string; text: string }[], classSkills: string[] = []): ExtraNeeds {
  const skills: ExtraNeeds['skills'] = [];
  let dragon: string | null = null;
  for (const f of features) {
    const m = SKILL_CHOICE.exec(f.text);
    if (m) skills.push({ count: COUNT[m[1].toLowerCase()] ?? 1, from: /from the list of skills available|from the following list/i.test(f.text.slice(m.index, m.index + 200)) && classSkills.length ? classSkills : null, source: stripLevelPrefix(f.name) });
    if (/dragon ancestor/i.test(f.name)) dragon = f.name;
  }
  return { skills, dragon };
}

export const DRAGONS: [string, string][] = [
  ['Black', 'acid'], ['Blue', 'lightning'], ['Brass', 'fire'], ['Bronze', 'lightning'], ['Copper', 'acid'],
  ['Gold', 'fire'], ['Green', 'poison'], ['Red', 'fire'], ['Silver', 'cold'], ['White', 'cold'],
];

export function ExtraChoicesPicker({ needs, value, onChange, proficient }: {
  needs: ExtraNeeds; value: ExtraValues; onChange: (v: ExtraValues) => void; proficient: string[];
}) {
  const total = needs.skills.reduce((t, s) => t + s.count, 0);
  const from = needs.skills.every((s) => s.from) ? [...new Set(needs.skills.flatMap((s) => s.from!))] : SKILLS.map(([n]) => n);
  return (
    <>
      {total > 0 && (
        <div>
          <h3>Skill proficiencies <span className="muted small">choose {total} · from {needs.skills.map((s) => s.source).join(', ')}</span></h3>
          <div className="checks">
            {from.filter((n) => !proficient.includes(n)).map((n) => (
              <label key={n}>
                <input type="checkbox" checked={value.skills.includes(n)} onChange={async (e) => {
                  const on = e.target.checked;
                  if (on && value.skills.length >= total && !(await confirmOverLimit(`You choose ${total} skill${total > 1 ? 's' : ''} here, and this would make ${value.skills.length + 1}.`))) return;
                  onChange({ ...value, skills: on ? [...value.skills, n] : value.skills.filter((x) => x !== n) });
                }} /> {n}
              </label>
            ))}
          </div>
        </div>
      )}
      {needs.dragon && (
        <label className="field"><span>Dragon ancestor</span>
          <select value={value.dragon} onChange={(e) => onChange({ ...value, dragon: e.target.value })}>
            <option value="">(choose)</option>
            {DRAGONS.map(([d, t]) => <option key={d} value={`${d} (${t})`}>{d} — {t} damage</option>)}
          </select>
        </label>
      )}
    </>
  );
}

/** Store the extra choices: skills as per-skill proficiency, the dragon on the feature itself. */
export function applyExtraChoices(ch: Character, ce: XElement | null, needs: ExtraNeeds, value: ExtraValues) {
  for (const n of value.skills) setSkillSetting(ch.ch, n, { prof: 1 }, (e) => ch.insert(e));
  if (needs.dragon && value.dragon && ce) {
    const fe = classFeats(ce).find((f) => f.name === needs.dragon);
    if (fe) {
      setChildText(fe.el, 'choice', value.dragon);
      const t = childText(fe.el, 'text');
      const [, color, type] = /^(\w+) \((\w+)\)$/.exec(value.dragon) ?? [, value.dragon, ''];
      if (!t.includes('Chosen ancestor:')) setChildText(fe.el, 'text', `${t}\n\nChosen ancestor: ${color} dragon${type ? ` (${type} damage)` : ''}.`);
    }
  }
}

export type { ClassFeature };
