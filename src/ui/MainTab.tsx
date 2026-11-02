import { useState } from 'react';
import { ABBR, ABILITIES } from '../model/compendium';
import { AppState, Character, setHdCurrent } from '../model/character';
import {
  PROF_LABEL, ProfLevel, abilityOptions, newCustomAbility, newCustomSkill, removeCustomAbility, setSkillSetting,
  updateCustomAbility, updateCustomSkill,
} from '../model/custom';
import { CustomAbilityResult, Sheet as SheetData, SkillResult } from '../rules/derive';
import { Field, Modal, Mutate, NumberInput, RollChip, signed, useApp } from './common';
import { TrackersPanel } from './Trackers';

const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];
const PROF_MARK: Record<ProfLevel, string> = { 0: '○', 1: '●', 2: '◆' };

export function MainTab({ c, app, sheet: s, mutate }: { c: Character; app: AppState; sheet: SheetData; mutate: Mutate }) {
  const { roll } = useApp();
  const [abilityEdit, setAbilityEdit] = useState<CustomAbilityResult | 'new' | null>(null);
  const [skillEdit, setSkillEdit] = useState<SkillResult | 'new' | null>(null);
  const options = abilityOptions(c.ch);

  const setSkillAbility = (sk: SkillResult, key: string) => mutate((ch) => {
    if (sk.custom && sk.el) updateCustomSkill(sk.el, { ability: key });
    else setSkillSetting(ch.ch, sk.name, { ability: key === sk.defaultAbility ? null : key }, (e) => ch.insert(e));
  });
  const cycleProf = (sk: SkillResult) => mutate((ch) => {
    const next = ((sk.level + 1) % 3) as ProfLevel;
    if (sk.custom && sk.el) updateCustomSkill(sk.el, { prof: next });
    else setSkillSetting(ch.ch, sk.name, { prof: next === sk.sourceLevel ? null : next }, (e) => ch.insert(e));
  });

  return (
    <div className="main-cols">
      <div className="main-col">
        <section className="panel">
          <div className="row between">
            <h3>Abilities</h3>
            <button className="small" onClick={() => setAbilityEdit('new')}>Add ability…</button>
          </div>
          <div className="abilities">
            {ABILITIES.map((a) => {
              const save = s.saves.find((x) => x.ability === a)!;
              return (
                <div key={a} className="ability">
                  <b>{ABBR[a]}</b>
                  <RollChip expr={`1d20${signed(s.mods[a])}`} label={`${ABBR[a]} check`}><span className="big">{signed(s.mods[a])}</span></RollChip>
                  <span className="muted small">{s.scores[a]}</span>
                  <span className="small">Save <RollChip expr={`1d20${signed(save.bonus)}`} label={`${ABBR[a]} save`}>{signed(save.bonus)}</RollChip>{save.proficient && ' ●'}</span>
                  <NumberInput className="base" value={c.abilities[a]} min={1} max={30}
                    onChange={(n) => mutate((ch) => { ch.abilities = { ...ch.abilities, [a]: n }; })} />
                </div>
              );
            })}
            {s.customAbilities.map((ca) => (
              <div key={ca.key} className="ability custom" title={ca.name}>
                <b>{ca.abbr} <button className="link small" onClick={() => setAbilityEdit(ca)} aria-label={`Edit ${ca.name}`}>edit</button></b>
                <RollChip expr={`1d20${signed(ca.mod)}`} label={`${ca.name} check`}><span className="big">{signed(ca.mod)}</span></RollChip>
                <span className="muted small">{ca.name}</span>
                <span className="small">Save <RollChip expr={`1d20${signed(ca.save)}`} label={`${ca.name} save`}>{signed(ca.save)}</RollChip>{ca.saveProficient && ' ●'}</span>
                <NumberInput className="base" value={ca.score} min={1} max={30} onChange={(n) => mutate(() => updateCustomAbility(ca.el, { score: n }))} />
              </div>
            ))}
          </div>
          <p className="muted small">The small fields are base scores, before racial bonuses and modifiers.</p>
        </section>
        <TrackersPanel c={c} sheet={s} mutate={mutate} />
      </div>

      <div className="main-col">
        <section className="panel">
          <div className="row between">
            <h3>Skills</h3>
            <button className="small" onClick={() => setSkillEdit('new')}>Add skill…</button>
          </div>
          <table className="skills">
            <tbody>
              {s.skills.map((sk) => (
                <tr key={`${sk.custom ? 'c' : 's'}:${sk.name}`} className={sk.overridden ? 'overridden' : ''}>
                  <td>
                    <button className="prof-toggle" onClick={() => cycleProf(sk)}
                      title={`${PROF_LABEL[sk.level]}${sk.half ? ' (half proficiency)' : ''}. Click to change.${!sk.custom && sk.level !== sk.sourceLevel ? ` Normally: ${PROF_LABEL[sk.sourceLevel].toLowerCase()}.` : ''}`}>
                      {sk.level === 0 && sk.half ? '½' : PROF_MARK[sk.level]}
                    </button>
                  </td>
                  <td className="skill-name">
                    <button className="link plain" onClick={() => setSkillEdit(sk)} title="Skill settings">{sk.name}</button>
                    {sk.custom && <span className="tag">custom</span>}
                    {sk.misc !== 0 && <span className="muted small"> {signed(sk.misc)}</span>}
                  </td>
                  <td>
                    <select className={`ability-pick ${!sk.custom && sk.ability !== sk.defaultAbility ? 'changed' : ''}`} value={sk.ability}
                      aria-label={`${sk.name} ability`} title="Ability used for this skill" onChange={(e) => setSkillAbility(sk, e.target.value)}>
                      {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </td>
                  <td><RollChip expr={`1d20${signed(sk.bonus)}`} label={sk.name}>{signed(sk.bonus)}</RollChip></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">○ not proficient · ● proficient · ◆ expertise. Click the mark to change it, the ability to change what the skill uses, or the name for more settings. Passive Investigation {s.passiveInvestigation} · Passive Insight {s.passiveInsight}</p>
        </section>
      </div>

      <div className="main-col">
        <section className="panel">
          <h3>Attacks</h3>
          <table className="attacks">
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
          <label className="check small"><input type="checkbox" checked={c.unarmed} onChange={(e) => mutate((ch) => { ch.unarmed = e.target.checked; })} /> Show unarmed strike</label>
          <h3>Hit dice</h3>
          {s.hitDice.map((hd) => {
            const ce = s.classes.find((k) => k.name === hd.className)!.el;
            return (
              <div key={hd.className} className="row">
                <span>{hd.className}: {hd.current}/{hd.total} d{hd.die}</span>
                <button className="small" disabled={hd.current <= 0} onClick={() => {
                  const r = roll(`1d${hd.die}${signed(s.mods.constitution)}`, 'Hit die');
                  if (r) mutate((ch) => { setHdCurrent(ce, hd.current - 1); ch.hpCurrent = Math.min(s.hpMax, ch.hpCurrent + Math.max(0, r.total)); });
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
          </dl>
        </section>
        <section className="panel">
          <h3>Conditions</h3>
          <div className="checks compact">
            {CONDITIONS.map((cond) => (
              <label key={cond}>
                <input type="checkbox" checked={app.conditions.includes(cond)}
                  onChange={(e) => mutate((_, a) => { a.conditions = e.target.checked ? [...a.conditions, cond] : a.conditions.filter((x) => x !== cond); })} />
                {cond}
              </label>
            ))}
          </div>
          <div className="row small">
            <span>Exhaustion</span>
            <NumberInput className="narrow-num" value={app.exhaustion} min={0} max={6} onChange={(n) => mutate((_, a) => { a.exhaustion = Math.max(0, Math.min(6, n)); })} />
          </div>
          {c.hpCurrent <= 0 && (
            <>
              <h3>Death saves</h3>
              <div className="row">
                <RollChip expr="1d20" label="Death save" />
                {(['success', 'failure'] as const).map((k) => (
                  <span key={k}>{k === 'success' ? 'Successes' : 'Failures'}{' '}
                    {[1, 2, 3].map((n) => (
                      <input key={n} type="checkbox" checked={app.deathSaves[k] >= n}
                        onChange={(e) => mutate((_, a) => { a.deathSaves = { ...a.deathSaves, [k]: e.target.checked ? n : n - 1 }; })} />
                    ))}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {abilityEdit && (
        <AbilityEditor initial={abilityEdit === 'new' ? null : abilityEdit} onClose={() => setAbilityEdit(null)}
          onSave={(v) => { mutate((ch) => { if (abilityEdit === 'new') ch.insert(newCustomAbility(ch.ch, v)); else updateCustomAbility(abilityEdit.el, v); }); setAbilityEdit(null); }}
          onRemove={abilityEdit === 'new' ? undefined : () => {
            const ab = abilityEdit;
            mutate((ch) => removeCustomAbility(ch.ch, { id: ab.id, name: ab.name, abbr: ab.abbr, score: ab.score, saveProf: ab.saveProficient, el: ab.el }));
            setAbilityEdit(null);
          }} />
      )}
      {skillEdit && (
        <SkillEditor skill={skillEdit === 'new' ? null : skillEdit} options={options} onClose={() => setSkillEdit(null)}
          onSave={(v) => {
            mutate((ch) => {
              if (skillEdit === 'new') ch.insert(newCustomSkill(ch.ch, { name: v.name, ability: v.ability, prof: v.prof ?? 0, bonus: v.bonus }));
              else if (skillEdit.custom && skillEdit.el) updateCustomSkill(skillEdit.el, { name: v.name, ability: v.ability, prof: v.prof ?? 0, bonus: v.bonus });
              else setSkillSetting(ch.ch, skillEdit.name, {
                ability: v.ability === skillEdit.defaultAbility ? null : v.ability,
                prof: v.prof === null || v.prof === skillEdit.sourceLevel ? null : v.prof, bonus: v.bonus,
              }, (e) => ch.insert(e));
            });
            setSkillEdit(null);
          }}
          onRemove={skillEdit !== 'new' && skillEdit.custom && skillEdit.el ? () => { const e = skillEdit.el!; mutate((ch) => ch.remove(e)); setSkillEdit(null); } : undefined}
          onReset={skillEdit !== 'new' && !skillEdit.custom ? () => {
            const name = skillEdit.name;
            mutate((ch) => setSkillSetting(ch.ch, name, { ability: null, prof: null, bonus: 0 }, (e) => ch.insert(e)));
            setSkillEdit(null);
          } : undefined} />
      )}
    </div>
  );
}

function AbilityEditor({ initial, onClose, onSave, onRemove }: {
  initial: CustomAbilityResult | null; onClose: () => void;
  onSave: (v: { name: string; abbr: string; score: number; saveProf: boolean }) => void; onRemove?: () => void;
}) {
  const [v, setV] = useState({ name: initial?.name ?? '', abbr: initial?.abbr ?? '', score: initial?.score ?? 10, saveProf: initial?.saveProficient ?? false });
  const abbr = v.abbr.trim() || v.name.trim().slice(0, 3).toUpperCase();
  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'Add an ability score'} onClose={onClose}>
      <p className="muted small">For variant rules such as Sanity or Honor, or anything homebrew. Custom abilities can be used by any skill.</p>
      <div className="grid2">
        <Field label="Name"><input autoFocus value={v.name} placeholder="Sanity" onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Abbreviation"><input value={v.abbr} maxLength={5} placeholder={abbr || 'SAN'} onChange={(e) => setV({ ...v, abbr: e.target.value.toUpperCase() })} /></Field>
        <Field label="Score"><NumberInput value={v.score} min={1} max={30} onChange={(n) => setV({ ...v, score: n })} /></Field>
        <label className="check"><input type="checkbox" checked={v.saveProf} onChange={(e) => setV({ ...v, saveProf: e.target.checked })} /> Proficient in saving throws</label>
      </div>
      <footer className="modal-actions">
        {onRemove && <button className="danger" onClick={() => { if (confirm(`Remove ${initial!.name}? Skills that use it go back to their usual ability.`)) onRemove(); }}>Remove</button>}
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!v.name.trim()} onClick={() => onSave({ ...v, name: v.name.trim(), abbr })}>Save</button>
      </footer>
    </Modal>
  );
}

function SkillEditor({ skill, options, onClose, onSave, onRemove, onReset }: {
  skill: SkillResult | null; options: { key: string; label: string; name: string }[]; onClose: () => void;
  onSave: (v: { name: string; ability: string; prof: ProfLevel | null; bonus: number }) => void; onRemove?: () => void; onReset?: () => void;
}) {
  const standard = !!skill && !skill.custom;
  const [v, setV] = useState({
    name: skill?.name ?? '', ability: skill?.ability ?? 'intelligence',
    prof: (standard && skill!.level === skill!.sourceLevel ? null : skill?.level ?? 0) as ProfLevel | null, bonus: skill?.misc ?? 0,
  });
  return (
    <Modal title={skill ? skill.name : 'Add a skill'} onClose={onClose}>
      <div className="grid2">
        {!standard && <Field label="Name"><input autoFocus value={v.name} placeholder="Cooking" onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>}
        <Field label="Ability">
          <select value={v.ability} onChange={(e) => setV({ ...v, ability: e.target.value })}>
            {options.map((o) => <option key={o.key} value={o.key}>{o.name} ({o.label}){standard && o.key === skill!.defaultAbility ? ' — usual' : ''}</option>)}
          </select>
        </Field>
        <Field label="Proficiency">
          <select value={v.prof === null ? 'auto' : String(v.prof)} onChange={(e) => setV({ ...v, prof: e.target.value === 'auto' ? null : (+e.target.value as ProfLevel) })}>
            {standard && <option value="auto">From race, class and background ({PROF_LABEL[skill!.sourceLevel].toLowerCase()})</option>}
            {([0, 1, 2] as ProfLevel[]).map((p) => <option key={p} value={p}>{PROF_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Extra bonus"><NumberInput value={v.bonus} min={-20} max={20} onChange={(n) => setV({ ...v, bonus: n })} /></Field>
      </div>
      <footer className="modal-actions">
        {onRemove && <button className="danger" onClick={() => { if (confirm(`Remove the skill ${skill!.name}?`)) onRemove(); }}>Remove</button>}
        {onReset && skill!.overridden && <button onClick={onReset}>Reset to normal</button>}
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!standard && !v.name.trim()} onClick={() => onSave({ ...v, name: v.name.trim() })}>Save</button>
      </footer>
    </Modal>
  );
}
