// Creator: make homebrew classes, subclasses, races, spells, feats,
// backgrounds, items and creatures, from a preset framework, from scratch,
// or by copying an existing entry. Everything is saved in the "My homebrew"
// compendium file, so it shows up everywhere the compendium is used.

import { useReducer, useState } from 'react';
import {
  ABILITIES, DAMAGE_TYPES, ITEM_TYPES, Kind, SCHOOLS, SIZES, WEAPON_PROPERTIES, classView,
} from '../model/compendium';
import {
  CREATOR_KINDS, CREATOR_LABEL, CreatorKind, HomebrewEntry, TAG, TEMPLATES, blankEntry, buildSubclass, entryName, homebrewEntries,
  kindOf, ordinal, parentInfo, subclassParts, trait, validateEntry,
} from '../model/homebrew';
import { XElement, attr, child, childText, cloneEl, el, elements, parseXml, serializeXml, setAttr, setChildText, textOf } from '../xml/xml';
import { EntryDetail } from './CompendiumView';
import { Field, Modal, useApp } from './common';
import { ask } from './dialogs';

const pretty = (e: XElement) => serializeXml({ prolog: [], root: e, epilog: [] }, { pretty: true }).replace(/^<\?xml[^>]*>\s*/, '');
const LIB_KIND: Record<CreatorKind, Kind> = { class: 'class', subclass: 'class', race: 'race', spell: 'spell', feat: 'feat', background: 'background', item: 'item', monster: 'monster' };
const KIND_HINT: Record<CreatorKind, string> = {
  class: 'Hit die, proficiencies, and features, spell slots and Ability Score Improvements for levels 1 to 20.',
  subclass: 'Features for an existing class (yours or from a compendium), at the levels it grants subclass features.',
  race: 'Size, speed, ability score increases, proficiencies and racial traits.',
  spell: 'Level, school, casting details, description, classes and damage or healing rolls.',
  feat: 'Prerequisite, description and the bonuses the sheet should apply.',
  background: 'Skill proficiencies and background features.',
  item: 'Weapons, armor, magic items and gear, with damage, AC and bonuses.',
  monster: 'Stat blocks for monsters, companions and NPCs, with traits and actions.',
};

// ---------------------------------------------------------------- the Creator tab

export function CreatorView() {
  const { homebrew, toast } = useApp();
  const [creating, setCreating] = useState<CreatorKind | null>(null);
  const [editing, setEditing] = useState<HomebrewEntry | null>(null);
  const entries = homebrewEntries(homebrew.xml);
  return (
    <div className="creator">
      <div className="row between">
        <h1>Creator</h1>
        <div className="row">
          <button disabled={!entries.length} onClick={() => homebrew.exportFile()}>Export my homebrew…</button>
        </div>
      </div>
      <p className="muted">Make your own content. Start from a preset framework, from scratch, or from a copy of an existing entry.
        Everything you make is saved in the compendium file “My homebrew”, so it appears in character creation, level-ups and every picker,
        and you can export it to share.</p>
      <div className="creator-kinds">
        {CREATOR_KINDS.map((k) => (
          <button key={k} className="creator-kind" onClick={() => setCreating(k)}>
            <b>New {CREATOR_LABEL[k].toLowerCase()}</b>
            <span className="muted small">{KIND_HINT[k]}</span>
          </button>
        ))}
      </div>
      <section className="panel">
        <h3>My homebrew</h3>
        {!entries.length && <p className="muted small">Nothing yet. Pick something to make above.</p>}
        {CREATOR_KINDS.filter((k) => entries.some((e) => e.kind === k)).map((k) => (
          <div key={k} className="homebrew-group">
            <h4>{{ class: 'Classes', subclass: 'Subclasses', race: 'Races', spell: 'Spells', feat: 'Feats', background: 'Backgrounds', item: 'Items', monster: 'Creatures' }[k]}</h4>
            <ul className="homebrew-list">
              {entries.filter((e) => e.kind === k).map((e) => (
                <li key={`${k}:${e.name}`}>
                  <span>{e.name}{k === 'subclass' && <span className="muted small"> · {childText(e.el, 'name')}</span>}</span>
                  <span className="row">
                    <button className="link small" onClick={() => setEditing(e)}>edit</button>
                    <button className="link small" onClick={async () => {
                      const copy = cloneEl(e.el);
                      renameEntry(copy, `${e.name} (copy)`);
                      await homebrew.save(copy);
                      toast(`Made a copy of ${e.name}`);
                    }}>duplicate</button>
                    <button className="link danger small" onClick={async () => {
                      if (!(await ask(`Delete “${e.name}” from your homebrew? Characters keep their own copies of anything they already use.`, { ok: 'Delete', danger: true }))) return;
                      await homebrew.remove(e.kind, e.name);
                    }}>delete</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      {creating && <CreateFlow kind={creating} onClose={() => setCreating(null)} />}
      {editing && (
        <Modal title={`Edit ${CREATOR_LABEL[editing.kind].toLowerCase()}: ${editing.name}`} onClose={() => setEditing(null)} wide>
          <EntryEditor kind={editing.kind} initial={editing.el} saveLabel="Save changes" onCancel={() => setEditing(null)}
            onSave={async (e) => { await homebrew.save(e, editing.name); toast(`Saved ${entryName(e)}`); setEditing(null); }} />
        </Modal>
      )}
    </div>
  );
}

/** Rename an entry (for a subclass, its introduction and feature prefixes). */
function renameEntry(e: XElement, name: string) {
  if (kindOf(e) !== 'subclass') { setChildText(e, 'name', name); return; }
  const p = subclassParts(e);
  const rebuilt = buildSubclass(p.parent, p.label, name, p.features, p.intro, p.introLevel);
  e.children = rebuilt.children;
}

// ---------------------------------------------------------------- new entry: pick a starting point

type Start = { type: 'template'; id: string } | { type: 'scratch' } | { type: 'copy' };

/**
 * Create something: choose a name and a starting point (a preset, from scratch, or a copy), then edit it.
 * `onCreated` also hands the result to the caller (e.g. to add a custom item to a character).
 */
export function CreateFlow({ kind, onClose, onCreated, addLabel }: {
  kind: CreatorKind; onClose: () => void; onCreated?: (e: XElement) => void | Promise<void>; addLabel?: string;
}) {
  const { lib, homebrew, toast } = useApp();
  const [name, setName] = useState('');
  const templates = TEMPLATES[kind];
  const [start, setStart] = useState<Start>(templates.length ? { type: 'template', id: templates[0].id } : { type: 'scratch' });
  const classes = lib.byKind.class.filter((e) => child(e.el, 'hd'));
  const [parent, setParent] = useState(classes[0]?.name ?? '');
  const [copyOf, setCopyOf] = useState('');
  const [draft, setDraft] = useState<XElement | null>(null);
  const [keep, setKeep] = useState(true);
  const copyList = kind === 'subclass' ? [] : lib.byKind[LIB_KIND[kind]].filter((e) => kind !== 'class' || child(e.el, 'hd'));

  const begin = () => {
    const parentEl = classes.find((c) => c.name === parent)?.el;
    let e: XElement;
    if (start.type === 'template') e = templates.find((tp) => tp.id === start.id)!.make({ name: name.trim(), parent: parentEl });
    else if (start.type === 'scratch') e = blankEntry(kind, { name: name.trim(), parent: parentEl });
    else {
      const src = copyList.find((x) => x.name === copyOf);
      if (!src) return;
      e = cloneEl(src.el);
      setChildText(e, 'name', name.trim() || `${src.name} (copy)`);
    }
    setDraft(e);
  };

  const finish = async (e: XElement) => {
    if (!onCreated || keep) await homebrew.save(e);
    await onCreated?.(e);
    toast(`${onCreated && !keep ? 'Created' : 'Saved to My homebrew'}: ${entryName(e)}`);
    onClose();
  };

  return (
    <Modal title={`New ${CREATOR_LABEL[kind].toLowerCase()}`} onClose={onClose} wide>
      {!draft && (
        <>
          <div className="grid2">
            <Field label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Name of your ${CREATOR_LABEL[kind].toLowerCase()}`} /></Field>
            {kind === 'subclass' && (
              <Field label="For the class">
                <select value={parent} onChange={(e) => setParent(e.target.value)}>
                  {classes.map((c) => <option key={c.name}>{c.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <h3>Start from</h3>
          <div className="start-options">
            {templates.map((tp) => (
              <label key={tp.id} className="start-option">
                <input type="radio" name="start" checked={start.type === 'template' && start.id === tp.id} onChange={() => setStart({ type: 'template', id: tp.id })} />
                <span><b>{tp.label}</b> <span className="tag">preset</span><br /><span className="muted small">{tp.description}</span></span>
              </label>
            ))}
            <label className="start-option">
              <input type="radio" name="start" checked={start.type === 'scratch'} onChange={() => setStart({ type: 'scratch' })} />
              <span><b>From scratch</b><br /><span className="muted small">An empty {CREATOR_LABEL[kind].toLowerCase()}: you fill in everything.</span></span>
            </label>
            {copyList.length > 0 && (
              <label className="start-option">
                <input type="radio" name="start" checked={start.type === 'copy'} onChange={() => setStart({ type: 'copy' })} />
                <span><b>Copy an existing {CREATOR_LABEL[kind].toLowerCase()}</b><br />
                  <select value={copyOf} onChange={(e) => { setCopyOf(e.target.value); setStart({ type: 'copy' }); }} aria-label="Entry to copy">
                    <option value="">(choose)</option>
                    {copyList.map((x) => <option key={x.name}>{x.name}</option>)}
                  </select>
                </span>
              </label>
            )}
          </div>
          {kind === 'subclass' && !classes.length && <p className="danger small">There are no classes yet. Import a compendium or make a class first.</p>}
          <footer className="modal-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={(!name.trim() && start.type !== 'copy') || (start.type === 'copy' && !copyOf) || (kind === 'subclass' && !parent)}
              onClick={begin}>Continue</button>
          </footer>
        </>
      )}
      {draft && (
        <EntryEditor kind={kind} initial={draft} onCancel={onClose} onSave={finish}
          saveLabel={onCreated ? (addLabel ?? 'Create') : 'Save to My homebrew'}
          footerExtra={onCreated && <label className="check small"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Also keep it in My homebrew</label>} />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- the editor

export function EntryEditor({ kind, initial, onSave, onCancel, saveLabel = 'Save', footerExtra }: {
  kind: CreatorKind; initial: XElement; onSave: (e: XElement) => void | Promise<void>; onCancel: () => void; saveLabel?: string; footerExtra?: React.ReactNode;
}) {
  const [work] = useState(() => cloneEl(initial));
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [mode, setMode] = useState<'form' | 'xml' | 'preview'>('form');
  const [xmlText, setXmlText] = useState('');
  const [error, setError] = useState('');
  const change = (fn: () => void) => { fn(); bump(); setError(''); };

  const toXml = () => { setXmlText(pretty(work)); setMode('xml'); };
  const applyXml = () => {
    const { doc, warnings } = parseXml(xmlText);
    if (warnings.length) { setError(`The XML has problems: ${warnings.slice(0, 3).join('; ')}`); return false; }
    if (doc.root.name !== TAG[kind]) { setError(`The XML must be one <${TAG[kind]}> element.`); return false; }
    work.attrs = doc.root.attrs;
    work.children = doc.root.children;
    bump();
    setError('');
    return true;
  };
  const save = async () => {
    if (mode === 'xml' && !applyXml()) return;
    const problems = validateEntry(work);
    if (problems.length) { setError(problems.join(' ')); return; }
    await onSave(cloneEl(work));
  };

  return (
    <div className="entry-editor">
      <nav className="tabs small-tabs">
        <button className={mode === 'form' ? 'active' : ''} onClick={() => { if (mode !== 'xml' || applyXml()) setMode('form'); }}>Form</button>
        <button className={mode === 'preview' ? 'active' : ''} onClick={() => { if (mode !== 'xml' || applyXml()) setMode('preview'); }}>Preview</button>
        <button className={mode === 'xml' ? 'active' : ''} onClick={toXml}>XML</button>
      </nav>
      {mode === 'form' && <KindForm kind={kind} e={work} change={change} />}
      {mode === 'preview' && <div className="detail-pane"><EntryDetail entry={{ kind: LIB_KIND[kind], name: entryName(work), el: work, fileId: '' }} /></div>}
      {mode === 'xml' && (
        <>
          <p className="muted small">The entry in the community compendium format. Edit freely; it is checked when you leave this tab or save.</p>
          <textarea className="xml-edit" rows={22} value={xmlText} onChange={(e) => setXmlText(e.target.value)} spellCheck={false} aria-label="Entry XML" />
        </>
      )}
      {error && <p className="danger">{error}</p>}
      <footer className="modal-actions">
        {footerExtra}
        <span className="spacer" />
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={save}>{saveLabel}</button>
      </footer>
    </div>
  );
}

type Change = (fn: () => void) => void;
type FieldDef = { k: string; label: string; type?: 'text' | 'number' | 'select' | 'check'; options?: Record<string, string>; hint?: string };

const LEVELS: Record<string, string> = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), i ? `${ordinal(i)} level` : 'Cantrip']));
const CR = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const ABILITY_NAMES: Record<string, string> = { '': '(none)', ...Object.fromEntries(ABILITIES.map((a) => [a[0].toUpperCase() + a.slice(1), a[0].toUpperCase() + a.slice(1)])) };

const FIELDS: Partial<Record<CreatorKind, FieldDef[]>> = {
  spell: [
    { k: 'name', label: 'Name' }, { k: 'level', label: 'Level', type: 'select', options: LEVELS }, { k: 'school', label: 'School', type: 'select', options: SCHOOLS },
    { k: 'ritual', label: 'Ritual', type: 'check' }, { k: 'time', label: 'Casting time' }, { k: 'range', label: 'Range' },
    { k: 'components', label: 'Components', hint: 'e.g. V, S, M (a feather)' }, { k: 'duration', label: 'Duration' },
    { k: 'classes', label: 'Classes', hint: 'Comma-separated, e.g. Wizard, Sorcerer' },
  ],
  feat: [{ k: 'name', label: 'Name' }, { k: 'prerequisite', label: 'Prerequisite' }, { k: 'proficiency', label: 'Proficiencies gained', hint: 'Comma-separated skills or saving throws' }],
  background: [{ k: 'name', label: 'Name' }, { k: 'proficiency', label: 'Skill proficiencies', hint: 'Comma-separated, e.g. Insight, Religion' }],
  race: [
    { k: 'name', label: 'Name' }, { k: 'size', label: 'Size', type: 'select', options: SIZES }, { k: 'speed', label: 'Speed (ft)', type: 'number' },
    { k: 'ability', label: 'Ability score increases', hint: 'e.g. Str 2, Con 1 (leave empty for "of your choice" in a trait)' },
    { k: 'proficiency', label: 'Skill proficiencies', hint: 'Comma-separated' }, { k: 'spellAbility', label: 'Spellcasting ability', type: 'select', options: ABILITY_NAMES },
  ],
  item: [
    { k: 'name', label: 'Name' }, { k: 'type', label: 'Type', type: 'select', options: ITEM_TYPES }, { k: 'magic', label: 'Magic item', type: 'check' },
    { k: 'detail', label: 'Rarity / detail', hint: 'e.g. rare (requires attunement)' }, { k: 'weight', label: 'Weight (lb)', type: 'number' },
    { k: 'value', label: 'Value (gp)', type: 'number' }, { k: 'ac', label: 'AC (armor and shields)', type: 'number' },
    { k: 'strength', label: 'Strength needed (heavy armor)', type: 'number' }, { k: 'stealth', label: 'Disadvantage on Stealth', type: 'check' },
    { k: 'dmg1', label: 'Damage', hint: 'e.g. 1d8' }, { k: 'dmg2', label: 'Two-handed damage (versatile)' },
    { k: 'dmgType', label: 'Damage type', type: 'select', options: { '': '(none)', ...DAMAGE_TYPES } }, { k: 'range', label: 'Range', hint: 'e.g. 80/320' },
  ],
  monster: [
    { k: 'name', label: 'Name' }, { k: 'size', label: 'Size', type: 'select', options: SIZES }, { k: 'type', label: 'Type', hint: 'e.g. beast, humanoid (elf)' },
    { k: 'alignment', label: 'Alignment' }, { k: 'ac', label: 'Armor class', hint: 'e.g. 15 (natural armor)' }, { k: 'hp', label: 'Hit points', hint: 'e.g. 22 (4d8+4)' },
    { k: 'speed', label: 'Speed', hint: 'e.g. walk 30 ft., fly 60 ft.' },
    ...ABILITIES.map((a) => ({ k: a.slice(0, 3), label: a.slice(0, 3).toUpperCase(), type: 'number' as const })),
    { k: 'save', label: 'Saving throws', hint: 'e.g. Dex +4, Wis +2' }, { k: 'skill', label: 'Skills', hint: 'e.g. Perception +3' },
    { k: 'resist', label: 'Damage resistances' }, { k: 'vulnerable', label: 'Damage vulnerabilities' }, { k: 'immune', label: 'Damage immunities' },
    { k: 'conditionImmune', label: 'Condition immunities' }, { k: 'senses', label: 'Senses' }, { k: 'passive', label: 'Passive Perception', type: 'number' },
    { k: 'languages', label: 'Languages' }, { k: 'cr', label: 'Challenge rating', type: 'select', options: Object.fromEntries(CR.map((c) => [c, c])) },
  ],
  class: [
    { k: 'name', label: 'Name' }, { k: 'hd', label: 'Hit die', type: 'select', options: { 6: 'd6', 8: 'd8', 10: 'd10', 12: 'd12' } },
    { k: 'proficiency', label: 'Saving throws and skill choices', hint: 'Comma-separated: two saving throws, then the skills to choose from' },
    { k: 'numSkills', label: 'Number of skills to choose', type: 'number' }, { k: 'armor', label: 'Armor' }, { k: 'weapons', label: 'Weapons' },
    { k: 'tools', label: 'Tools' }, { k: 'wealth', label: 'Starting gold', hint: 'e.g. 5d4x10' },
    { k: 'spellAbility', label: 'Spellcasting ability', type: 'select', options: ABILITY_NAMES },
  ],
};
const BLOCKS: Partial<Record<CreatorKind, { tag: string; label: string; attack?: boolean }[]>> = {
  race: [{ tag: 'trait', label: 'Traits' }],
  background: [{ tag: 'trait', label: 'Features and traits' }],
  monster: [{ tag: 'trait', label: 'Traits' }, { tag: 'action', label: 'Actions', attack: true }, { tag: 'reaction', label: 'Reactions' }, { tag: 'legendary', label: 'Legendary actions', attack: true }],
};
const HAS_TEXT: CreatorKind[] = ['spell', 'feat', 'item'];
const HAS_MODIFIERS: CreatorKind[] = ['feat', 'item', 'race', 'background'];
const HAS_ROLLS: CreatorKind[] = ['spell', 'item', 'feat'];

function KindForm({ kind, e, change }: { kind: CreatorKind; e: XElement; change: Change }) {
  if (kind === 'subclass') return <SubclassForm e={e} change={change} />;
  return (
    <div className="kind-form">
      <div className="grid2">{(FIELDS[kind] ?? []).map((f) => <SimpleField key={f.k} f={f} e={e} change={change} />)}</div>
      {kind === 'item' && <PropertyChecks e={e} change={change} />}
      {HAS_TEXT.includes(kind) && <TextsField e={e} change={change} />}
      {(BLOCKS[kind] ?? []).map((b) => <BlockList key={b.tag} e={e} tag={b.tag} label={b.label} attack={b.attack} change={change} />)}
      {HAS_MODIFIERS.includes(kind) && <ModifierList e={e} change={change} />}
      {HAS_ROLLS.includes(kind) && <RollList e={e} change={change} spell={kind === 'spell'} />}
      {kind === 'class' && <ClassLevels e={e} change={change} />}
    </div>
  );
}

function SimpleField({ f, e, change }: { f: FieldDef; e: XElement; change: Change }) {
  const v = childText(e, f.k);
  const set = (x: string) => change(() => setChildText(e, f.k, x));
  if (f.type === 'check') {
    return <label className="check field-check"><input type="checkbox" checked={/^(yes|1|true)$/i.test(v)} onChange={(x) => set(x.target.checked ? 'YES' : '')} /> {f.label}</label>;
  }
  if (f.type === 'select') {
    const opts = f.options ?? {};
    const value = opts[v] !== undefined ? v : Object.keys(opts).find((k) => opts[k].toLowerCase() === v.toLowerCase()) ?? v;
    return (
      <Field label={f.label}>
        <select value={value} onChange={(x) => set(x.target.value)}>
          {value && opts[value] === undefined && <option value={value}>{value}</option>}
          {Object.entries(opts).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <Field label={f.label}>
      <input type={f.type === 'number' ? 'number' : 'text'} value={v} placeholder={f.hint} title={f.hint} onChange={(x) => set(x.target.value)} />
    </Field>
  );
}

/** All <text> children of an element as one textarea (one paragraph per line). */
function TextsField({ e, change, label = 'Description' }: { e: XElement; change: Change; label?: string }) {
  const value = elements(e, 'text').map(textOf).join('\n');
  return (
    <label className="field wide">
      <span>{label}</span>
      <textarea rows={6} value={value} onChange={(x) => change(() => setTexts(e, x.target.value))} />
    </label>
  );
}
function setTexts(e: XElement, text: string) {
  const first = e.children.findIndex((c) => c.type === 'el' && c.name === 'text');
  e.children = e.children.filter((c) => !(c.type === 'el' && c.name === 'text'));
  const lines = text.split('\n').map((line) => el('text', line));
  e.children.splice(first >= 0 ? Math.min(first, e.children.length) : e.children.length, 0, ...lines);
}

function PropertyChecks({ e, change }: { e: XElement; change: Change }) {
  const current = childText(e, 'property').split(/[,\s]+/).filter(Boolean);
  const toggle = (k: string, on: boolean) => change(() => setChildText(e, 'property', (on ? [...current, k] : current.filter((x) => x !== k)).join(',')));
  return (
    <div className="field wide"><span>Weapon properties</span>
      <div className="checks">
        {Object.entries(WEAPON_PROPERTIES).map(([k, label]) => (
          <label key={k}><input type="checkbox" checked={current.includes(k)} onChange={(x) => toggle(k, x.target.checked)} /> {label}</label>
        ))}
      </div>
    </div>
  );
}

/** Named blocks such as traits or actions: <trait><name/><text/>…</trait>. */
function BlockList({ e, tag, label, attack, change }: { e: XElement; tag: string; label: string; attack?: boolean; change: Change }) {
  const blocks = elements(e, tag);
  return (
    <div className="block-list">
      <h4>{label}</h4>
      {blocks.map((b, i) => (
        <div key={i} className="block-item">
          <div className="row">
            <input value={childText(b, 'name')} placeholder="Name" aria-label={`${label} name`} onChange={(x) => change(() => setChildText(b, 'name', x.target.value))} />
            <button className="link danger small" onClick={() => change(() => { e.children.splice(e.children.indexOf(b), 1); })}>remove</button>
          </div>
          <TextsField e={b} change={change} label="Text" />
          {attack && (
            <Field label="Attack roll (name|to hit|damage), optional">
              <input value={childText(b, 'attack')} placeholder="Bite|+4|1d6+2" onChange={(x) => change(() => setChildText(b, 'attack', x.target.value))} />
            </Field>
          )}
        </div>
      ))}
      <button className="small" onClick={() => change(() => { e.children.push(trait('', '', tag)); })}>Add {label.toLowerCase().replace(/s$/, '')}</button>
    </div>
  );
}

const MOD_CATEGORIES = ['bonus', 'ability score', 'ability modifier', 'saving throw', 'skill'];
function ModifierList({ e, change }: { e: XElement; change: Change }) {
  const mods = elements(e, 'modifier');
  return (
    <div className="block-list">
      <h4>Bonuses the sheet applies <span className="muted small">e.g. “ac +1”, “speed +10”, “strength +1”, “stealth +2”, “initiative +5”</span></h4>
      {mods.map((m, i) => (
        <div key={i} className="row">
          <select value={attr(m, 'category') ?? 'bonus'} onChange={(x) => change(() => setAttr(m, 'category', x.target.value))} aria-label="Bonus category">
            {MOD_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input value={textOf(m)} placeholder="ac +1" aria-label="Bonus"
            onChange={(x) => change(() => { m.children = [{ type: 'text', value: x.target.value }]; })} />
          <button className="link danger small" onClick={() => change(() => { e.children.splice(e.children.indexOf(m), 1); })}>remove</button>
        </div>
      ))}
      <button className="small" onClick={() => change(() => { e.children.push(el('modifier', '', [['category', 'bonus']])); })}>Add bonus</button>
    </div>
  );
}

function RollList({ e, change, spell }: { e: XElement; change: Change; spell: boolean }) {
  const rolls = elements(e, 'roll');
  return (
    <div className="block-list">
      <h4>Rolls <span className="muted small">dice buttons on the sheet; SPELL = spellcasting modifier{spell ? '; level = slot level, or character level for cantrips' : ''}</span></h4>
      {rolls.map((r, i) => (
        <div key={i} className="row">
          <input value={textOf(r)} placeholder="1d8+SPELL" aria-label="Roll formula"
            onChange={(x) => change(() => { r.children = [{ type: 'text', value: x.target.value }]; })} />
          <input value={attr(r, 'description') ?? ''} placeholder="Description (e.g. Damage)" aria-label="Roll description"
            onChange={(x) => change(() => setAttr(r, 'description', x.target.value || undefined))} />
          {spell && <input type="number" className="qty" value={attr(r, 'level') ?? ''} placeholder="level" aria-label="Roll level"
            onChange={(x) => change(() => setAttr(r, 'level', x.target.value || undefined))} />}
          <button className="link danger small" onClick={() => change(() => { e.children.splice(e.children.indexOf(r), 1); })}>remove</button>
        </div>
      ))}
      <button className="small" onClick={() => change(() => { e.children.push(el('roll', '1d6')); })}>Add roll</button>
    </div>
  );
}

// ---------------------------------------------------------------- classes: levels 1-20

const levelOf = (al: XElement) => parseInt(attr(al, 'level') ?? childText(al, 'level') ?? '1', 10) || 1;

function ClassLevels({ e, change }: { e: XElement; change: Change }) {
  const autolevels = elements(e, 'autolevel');
  const atLevel = (L: number) => autolevels.filter((al) => levelOf(al) === L);
  const ensure = (L: number) => {
    const found = atLevel(L)[0];
    if (found) return found;
    const al = el('autolevel', undefined, [['level', String(L)]]);
    const after = [...e.children].reverse().find((c) => c.type === 'el' && c.name === 'autolevel' && levelOf(c) < L);
    e.children.splice(after ? e.children.indexOf(after) + 1 : e.children.length, 0, al);
    return al;
  };
  return (
    <div className="class-levels">
      <h4>Levels <span className="muted small">features, Ability Score Improvements and spell slots (cantrips first, then 1st to 9th level, e.g. 3,2,0,0)</span></h4>
      {Array.from({ length: 20 }, (_, i) => i + 1).map((L) => {
        const als = atLevel(L);
        const feats = als.flatMap((al) => [...elements(al, 'feature'), ...elements(al, 'feat')].map((f) => ({ al, f })));
        const asi = als.some((al) => /^(yes|1|true)$/i.test(attr(al, 'scoreImprovement') ?? childText(al, 'scoreImprovement')));
        const slotsHolder = als.find((al) => child(al, 'slots'));
        const slotsText = slotsHolder ? childText(slotsHolder, 'slots') : '';
        return (
          <details key={L} className="level-row">
            <summary><b>Level {L}</b> <span className="muted small">{[...feats.map(({ f }) => childText(f, 'name') || '(unnamed)'), asi && 'ASI', slotsText && `slots ${slotsText}`].filter(Boolean).join(' · ') || 'nothing'}</span></summary>
            <div className="row">
              <label className="check small"><input type="checkbox" checked={asi} onChange={(x) => change(() => {
                for (const al of als) setAttr(al, 'scoreImprovement', undefined);
                if (x.target.checked) setAttr(ensure(L), 'scoreImprovement', 'YES');
              })} /> Ability Score Improvement</label>
              <Field label="Spell slots">
                <input value={slotsText} placeholder="e.g. 3,2" aria-label={`Level ${L} spell slots`} onChange={(x) => change(() => setChildText(slotsHolder ?? ensure(L), 'slots', x.target.value))} />
              </Field>
            </div>
            {feats.map(({ al, f }, i) => (
              <div key={i} className="block-item">
                <div className="row">
                  <input value={childText(f, 'name')} placeholder="Feature name" aria-label={`Level ${L} feature name`} onChange={(x) => change(() => setChildText(f, 'name', x.target.value))} />
                  <label className="check small" title="Optional features are choices: subclass features and options such as fighting styles">
                    <input type="checkbox" checked={/^(yes|1|true)$/i.test(attr(f, 'optional') ?? childText(f, 'optional'))}
                      onChange={(x) => change(() => setAttr(f, 'optional', x.target.checked ? 'YES' : undefined))} /> optional
                  </label>
                  <button className="link danger small" onClick={() => change(() => { al.children.splice(al.children.indexOf(f), 1); })}>remove</button>
                </div>
                <TextsField e={f} change={change} label="Text" />
              </div>
            ))}
            <button className="small" onClick={() => change(() => {
              const fe = el('feature');
              fe.children.push(el('name', 'New feature'), el('text', ''));
              ensure(L).children.push(fe);
            })}>Add feature at level {L}</button>
          </details>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- subclasses

function SubclassForm({ e, change }: { e: XElement; change: Change }) {
  const { lib } = useApp();
  const p = subclassParts(e);
  const rebuild = (patch: Partial<typeof p>) => change(() => {
    const n = { ...p, ...patch };
    e.children = buildSubclass(n.parent, n.label, n.name, n.features, n.intro, n.introLevel).children;
  });
  const parents = lib.byKind.class.filter((x) => child(x.el, 'hd'));
  const parentEl = parents.find((x) => x.name === p.parent)?.el;
  const info = parentEl ? parentInfo(parentEl) : null;
  const existing = parentEl ? classView(parentEl).subclasses.filter((s) => s.toLowerCase() !== p.name.toLowerCase()) : [];
  const setFeature = (i: number, patch: Partial<(typeof p.features)[number]>) => rebuild({ features: p.features.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <div className="kind-form">
      <div className="grid2">
        <Field label="Subclass name"><input value={p.name} onChange={(x) => rebuild({ name: x.target.value })} /></Field>
        <Field label="Class">
          <select value={p.parent} onChange={(x) => {
            const pi = parentInfo(parents.find((c) => c.name === x.target.value)!.el);
            rebuild({ parent: x.target.value, label: pi.label, introLevel: pi.levels[0] });
          }}>
            {!parents.some((c) => c.name === p.parent) && <option>{p.parent}</option>}
            {parents.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Introduced by the class feature">
          <input value={p.label} title="The class feature where the subclass is chosen, e.g. Martial Archetype" onChange={(x) => rebuild({ label: x.target.value })} />
        </Field>
        <Field label="Chosen at level"><input type="number" min={1} max={20} value={p.introLevel} onChange={(x) => rebuild({ introLevel: Math.max(1, Math.min(20, +x.target.value || 1)) })} /></Field>
      </div>
      {info && <p className="muted small">{info.name}'s subclasses are chosen through “{info.label}” and gain features at {info.levels.map(ordinal).join(', ')} level.{existing.length ? ` Existing: ${existing.slice(0, 8).join(', ')}${existing.length > 8 ? '…' : ''}.` : ''}</p>}
      <label className="field wide"><span>Introduction</span>
        <textarea rows={3} value={p.intro} onChange={(x) => rebuild({ intro: x.target.value })} />
      </label>
      <div className="block-list">
        <h4>Features</h4>
        {p.features.map((f, i) => (
          <div key={i} className="block-item">
            <div className="row">
              <label className="small">Level <input type="number" className="qty" min={1} max={20} value={f.level} onChange={(x) => setFeature(i, { level: Math.max(1, Math.min(20, +x.target.value || 1)) })} /></label>
              <input value={f.name} placeholder="Feature name" aria-label="Subclass feature name" onChange={(x) => setFeature(i, { name: x.target.value })} />
              <button className="link danger small" onClick={() => rebuild({ features: p.features.filter((_, j) => j !== i) })}>remove</button>
            </div>
            <label className="field wide"><span>Text</span><textarea rows={3} value={f.text} onChange={(x) => setFeature(i, { text: x.target.value })} /></label>
          </div>
        ))}
        <button className="small" onClick={() => rebuild({ features: [...p.features, { level: info?.levels.find((L) => !p.features.some((f) => f.level === L)) ?? p.introLevel, name: 'New feature', text: '' }] })}>Add feature</button>
      </div>
    </div>
  );
}
