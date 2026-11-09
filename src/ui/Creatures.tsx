import { Fragment, useState } from 'react';
import { ABBR, ABILITIES, SIZES } from '../model/compendium';
import { Character } from '../model/character';
import {
  ABILITY_TAGS, BLOCK_LABEL, BLOCK_TAGS, BlockTag, CREATURE_ROLES, addBlockEntry, blockEntries,
  creatureFromMonster, creatureNotes, creatureRole, damageCreature, healCreature, hitDiceOf, hpCurrentOf, hpMaxOf,
  hpTempOf, parseBonusList, setField, setHp, setHpCurrent, setHpTemp, sumExpression, updateBlockEntry,
} from '../model/creature';
import { Sheet as SheetData, mod } from '../rules/derive';
import { isRollable, resolveFormula } from '../rules/dice';
import { XElement, childText, cloneEl, removeChild } from '../xml/xml';
import { Field, Modal, Mutate, NumberInput, RichText, RollChip, signed } from './common';
import { Picker } from './Picker';
import { CreateFlow } from './Creator';
import { ask } from './dialogs';

export function CreaturesTab({ c, sheet, mutate }: { c: Character; sheet: SheetData; mutate: Mutate }) {
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<XElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<XElement>>(new Set());
  const toggle = (e: XElement) => { const n = new Set(collapsed); if (n.has(e)) n.delete(e); else n.add(e); setCollapsed(n); };

  return (
    <div className="creatures">
      <section className="panel">
        <div className="row between">
          <p className="muted small">Pets, familiars, summons, mounts, hirelings and wild shapes. Start from a compendium creature or a blank stat block, then edit anything.</p>
          <div className="row">
            <button onClick={() => setPicking(true)}>Add from compendium…</button>
            <button onClick={() => setCreating(true)} title="Make your own creature from a preset, from scratch or from a copy">Create custom creature…</button>
          </div>
        </div>
        {c.creatures.length === 0 && <p className="muted">No creatures yet.</p>}
      </section>

      {c.creatures.map((cr, i) => (
        <CreatureCard key={i} cr={cr} sheet={sheet} mutate={mutate} collapsed={collapsed.has(cr)} onToggle={() => toggle(cr)}
          onEdit={() => setEditing(cr)}
          onDuplicate={() => mutate((ch) => {
            const copy = cloneEl(cr);
            setField(copy, 'name', `${childText(cr, 'name')} (copy)`);
            ch.addCreature(copy);
          })}
          onRemove={async () => { if (await ask(`Remove ${childText(cr, 'name')}?`, { ok: 'Remove', danger: true })) mutate((ch) => ch.remove(cr)); }} />
      ))}

      {picking && (
        <Picker kind="monster" onClose={() => setPicking(false)} has={() => false}
          onPick={(e) => mutate((ch) => { ch.addCreature(creatureFromMonster(e.el, 'Pet')); })} />
      )}
      {creating && (
        <CreateFlow kind="monster" addLabel="Add to this character" onClose={() => setCreating(false)}
          onCreated={(e) => mutate((ch) => { ch.addCreature(creatureFromMonster(e, 'Pet')); })} />
      )}
      {editing && <CreatureEditor cr={editing} mutate={mutate} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CreatureCard({ cr, sheet, mutate, collapsed, onToggle, onEdit, onDuplicate, onRemove }: {
  cr: XElement; sheet: SheetData; mutate: Mutate; collapsed: boolean;
  onToggle: () => void; onEdit: () => void; onDuplicate: () => void; onRemove: () => void;
}) {
  const [amount, setAmount] = useState('');
  const n = parseInt(amount, 10);
  const name = childText(cr, 'name');
  const max = hpMaxOf(cr), cur = hpCurrentOf(cr), temp = hpTempOf(cr);
  const t = (tag: string) => childText(cr, tag);
  const scores = ABILITY_TAGS.map((a) => parseInt(t(a), 10) || 10);
  const resolve = (s: string) => resolveFormula(s, sheet.formula);
  const facts: [string, string][] = ([
    ['Saving Throws', t('save')], ['Skills', t('skill')], ['Vulnerabilities', t('vulnerable')], ['Resistances', t('resist')],
    ['Immunities', t('immune')], ['Condition Immunities', t('conditionImmune')],
    ['Senses', [t('senses'), t('passive') && `passive Perception ${t('passive')}`].filter(Boolean).join(', ')],
    ['Languages', t('languages')], ['Challenge', t('cr')],
  ] as [string, string][]).filter(([, v]) => v);

  return (
    <section className="panel creature">
      <header className="row between">
        <div className="row">
          <button className="link" onClick={onToggle} aria-label={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▸' : '▾'}</button>
          <h2>{name}</h2>
          <select value={creatureRole(cr)} onChange={(e) => mutate(() => setField(cr, 'role', e.target.value))} aria-label="Role">
            {[...new Set([...CREATURE_ROLES, creatureRole(cr)])].map((r) => <option key={r}>{r}</option>)}
          </select>
          <span className="muted small">{[SIZES[t('size')] ?? t('size'), t('type'), t('alignment')].filter(Boolean).join(' ')}</span>
        </div>
        <div className="row">
          <button className="small" onClick={onEdit}>Edit</button>
          <button className="small" onClick={onDuplicate}>Duplicate</button>
          <button className="small danger" onClick={onRemove}>Remove</button>
        </div>
      </header>

      <div className="vitals compact">
        <div className="stat"><span className="label">AC</span><span className="value">{parseInt(t('ac'), 10) || '—'}</span><span className="muted small">{t('ac').replace(/^\d+\s*/, '')}</span></div>
        <div className="stat hp">
          <span className="label">Hit Points</span>
          <span className="value">
            <NumberInput className="hp-cur" value={cur} onChange={(v) => mutate(() => setHpCurrent(cr, v))} />
            <span className="muted"> / </span>{max}
            {temp > 0 && <span className="tag">+{temp} temp</span>}
          </span>
          <span className="row small">
            <input className="hp-amt" placeholder="±" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button disabled={!(n > 0)} onClick={() => mutate(() => damageCreature(cr, n))}>Damage</button>
            <button disabled={!(n > 0)} onClick={() => mutate(() => healCreature(cr, n))}>Heal</button>
            <button disabled={!(n > 0)} onClick={() => mutate(() => setHpTemp(cr, Math.max(temp, n)))}>Temp</button>
          </span>
          {cur <= 0 && <span className="danger small">Down</span>}
        </div>
        <div className="stat"><span className="label">Speed</span><span className="value small-value">{t('speed') || '—'}</span></div>
        {hitDiceOf(cr) && <div className="stat"><span className="label">Hit Dice</span><span className="value small-value">{hitDiceOf(cr)}</span></div>}
      </div>

      {!collapsed && (
        <>
          <div className="mscores">
            {ABILITIES.map((a, i) => (
              <div key={a}><b>{ABBR[a]}</b>
                <RollChip expr={`1d20${signed(mod(scores[i]))}`} label={`${name} ${ABBR[a]}`}>{scores[i]} ({signed(mod(scores[i]))})</RollChip>
              </div>
            ))}
          </div>
          {(t('save') || t('skill')) && (
            <p className="row wrap small">
              {parseBonusList(t('save')).map(([k, v]) => <RollChip key={`s${k}`} expr={`1d20${signed(v)}`} label={`${name} ${k} save`}>{k} save {signed(v)}</RollChip>)}
              {parseBonusList(t('skill')).map(([k, v]) => <RollChip key={`k${k}`} expr={`1d20${signed(v)}`} label={`${name} ${k}`}>{k} {signed(v)}</RollChip>)}
            </p>
          )}
          <dl className="facts">{facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          {BLOCK_TAGS.map((tag) => {
            const list = blockEntries(cr, tag);
            if (!list.length) return null;
            return (
              <section key={tag}>
                <h3>{BLOCK_LABEL[tag]}</h3>
                {list.map((b, j) => {
                  const bonus = b.attackBonus ? sumExpression(resolve(b.attackBonus)) : null;
                  const dmg = b.attackDamage ? resolve(b.attackDamage) : '';
                  return (
                    <div key={j} className="creature-block">
                      <h4>{b.name}{b.recharge && <span className="tag">{b.recharge}</span>}</h4>
                      <RichText text={b.text} label={`${name}: ${b.name}`} />
                      {(bonus !== null || (dmg && isRollable(dmg))) && (
                        <p className="small">
                          {bonus !== null && <RollChip expr={`1d20${signed(bonus)}`} label={`${name}: ${b.name} attack`}>{signed(bonus)} to hit</RollChip>}{' '}
                          {dmg && isRollable(dmg) && <RollChip expr={dmg} label={`${name}: ${b.name} damage`}>{dmg} damage</RollChip>}
                        </p>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
          <Field label="Notes">
            <textarea rows={3} value={creatureNotes(cr)} placeholder="Duration, commands, who controls it…" onChange={(e) => mutate(() => setField(cr, 'notes', e.target.value))} />
          </Field>
        </>
      )}
    </section>
  );
}

const TEXT_FIELDS: [string, string, string?][] = [
  ['type', 'Type', 'beast'], ['alignment', 'Alignment', 'unaligned'], ['ac', 'Armor Class', '13 (natural armor)'],
  ['speed', 'Speed', '40 ft., climb 30 ft.'], ['save', 'Saving throws', 'Dex +4, Con +3'], ['skill', 'Skills', 'Perception +3, Stealth +4'],
  ['senses', 'Senses', 'darkvision 60 ft.'], ['passive', 'Passive Perception', '13'], ['languages', 'Languages', 'understands Common'],
  ['cr', 'Challenge', '1/4'], ['resist', 'Resistances', ''], ['vulnerable', 'Vulnerabilities', ''], ['immune', 'Immunities', ''],
  ['conditionImmune', 'Condition immunities', ''],
];

function CreatureEditor({ cr, mutate, onClose }: { cr: XElement; mutate: Mutate; onClose: () => void }) {
  const t = (tag: string) => childText(cr, tag);
  const set = (tag: string) => (e: { target: { value: string } }) => mutate(() => setField(cr, tag, e.target.value));
  return (
    <Modal title={`Edit ${t('name')}`} onClose={onClose} wide>
      <div className="grid3">
        <Field label="Name"><input value={t('name')} onChange={set('name')} /></Field>
        <Field label="Role">
          <select value={creatureRole(cr)} onChange={set('role')}>{[...new Set([...CREATURE_ROLES, creatureRole(cr)])].map((r) => <option key={r}>{r}</option>)}</select>
        </Field>
        <Field label="Size">
          <select value={t('size')} onChange={set('size')}>{Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Hit point maximum"><NumberInput value={hpMaxOf(cr)} min={0} onChange={(v) => mutate(() => setHp(cr, v, hitDiceOf(cr)))} /></Field>
        <Field label="Hit dice"><input value={hitDiceOf(cr)} placeholder="2d8+2" onChange={(e) => mutate(() => setHp(cr, hpMaxOf(cr), e.target.value))} /></Field>
        {TEXT_FIELDS.map(([tag, label, ph]) => (
          <Field key={tag} label={label}><input value={t(tag)} placeholder={ph} onChange={set(tag)} /></Field>
        ))}
      </div>
      <h3>Ability scores</h3>
      <div className="score-grid">
        {ABILITY_TAGS.map((a, i) => (
          <div key={a} className="score-pick">
            <b>{ABBR[ABILITIES[i]]}</b>
            <NumberInput value={parseInt(t(a), 10) || 10} min={1} max={30} onChange={(v) => mutate(() => setField(cr, a, String(v)))} />
          </div>
        ))}
      </div>
      {BLOCK_TAGS.map((tag) => <BlockEditor key={tag} cr={cr} tag={tag} mutate={mutate} />)}
      <p className="muted small">Attack bonus and damage can use your character's numbers, which helps for summons that scale: PROF (proficiency bonus), SPELL (spellcasting modifier), STR, DEX, CON, INT, WIS, CHA, LVL. For example “SPELL+PROF” to hit and “1d8+3+SPELL” damage.</p>
      <footer className="modal-actions"><button className="primary" onClick={onClose}>Done</button></footer>
    </Modal>
  );
}

function BlockEditor({ cr, tag, mutate }: { cr: XElement; tag: BlockTag; mutate: Mutate }) {
  const list = blockEntries(cr, tag);
  return (
    <section>
      <div className="row between">
        <h3>{BLOCK_LABEL[tag]}</h3>
        <button className="small" onClick={() => mutate(() => { addBlockEntry(cr, tag, `New ${BLOCK_LABEL[tag].toLowerCase().replace(/s$/, '')}`); })}>Add</button>
      </div>
      {list.map((b, i) => (
        <div key={i} className="block-edit">
          <div className="row">
            <input className="grow" value={b.name} aria-label="Name" onChange={(e) => mutate(() => updateBlockEntry(b.el, { name: e.target.value }))} />
            {tag !== 'trait' && <>
              <input className="narrow" placeholder="to hit" value={b.attackBonus} aria-label="Attack bonus" onChange={(e) => mutate(() => updateBlockEntry(b.el, { attackBonus: e.target.value }))} />
              <input className="narrow" placeholder="damage" value={b.attackDamage} aria-label="Damage" onChange={(e) => mutate(() => updateBlockEntry(b.el, { attackDamage: e.target.value }))} />
            </>}
            <input className="narrow" placeholder="recharge" value={b.recharge} aria-label="Recharge" onChange={(e) => mutate(() => updateBlockEntry(b.el, { recharge: e.target.value }))} />
            <button className="link danger" onClick={() => mutate(() => removeChild(cr, b.el))}>remove</button>
          </div>
          <textarea rows={3} value={b.text} onChange={(e) => mutate(() => updateBlockEntry(b.el, { text: e.target.value }))} />
        </div>
      ))}
    </section>
  );
}
