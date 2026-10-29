import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildLibrary, CompendiumFile } from '../model/compendium';
import { Character, CharacterRecord } from '../model/character';
import { defaultOptions, RulesOptions } from '../rules/derive';
import { naturalD20, roll as rollDice, RollResult } from '../rules/dice';
import * as db from '../store/db';
import srdSample from '../srd/srd-sample.xml?raw';
import { AppContext, Field, RollChip, useApp } from './common';
import { CompendiumView } from './CompendiumView';
import { CharactersView, newRecord } from './CharactersView';
import { Sheet } from './Sheet';

type View = 'characters' | 'compendium' | 'dice' | 'settings';

export function App() {
  const [view, setView] = useState<View>('characters');
  const [files, setFiles] = useState<CompendiumFile[]>([]);
  const [records, setRecords] = useState<CharacterRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [options, setOptions] = useState<RulesOptions>(() => db.loadSetting('rules', defaultOptions));
  const [log, setLog] = useState<RollResult[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([db.listFiles(), db.listCharacters()])
      .then(([f, c]) => { setFiles(f); setRecords(c); })
      .catch((e) => setError(`Could not open local storage: ${e}`));
  }, []);

  const lib = useMemo(() => buildLibrary(files), [files]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3500);
  }, []);

  const roll = useCallback((expr: string, label?: string) => {
    try {
      const r = rollDice(expr, undefined, label);
      setLog((l) => [r, ...l].slice(0, 200));
      const nat = naturalD20(r);
      toast(`${label ? `${label}: ` : ''}${r.total}${nat === 20 ? ' (natural 20!)' : nat === 1 ? ' (natural 1)' : ''}  —  ${r.expression} = ${r.text}`);
      return r;
    } catch (e) {
      toast(String((e as Error).message));
      return null;
    }
  }, [toast]);

  const importCompendiums = async () => {
    const picked = await db.readFiles('.xml,text/xml');
    const added: CompendiumFile[] = [];
    for (const p of picked) {
      const f: CompendiumFile = { id: db.newId(), fileName: p.name, xml: p.text, importedAt: Date.now() + added.length, enabled: true };
      await db.putFile(f);
      added.push(f);
    }
    if (added.length) {
      setFiles((fs) => [...fs, ...added]);
      toast(`Imported ${added.length} file${added.length > 1 ? 's' : ''}`);
    }
  };
  const loadSample = async () => {
    const f: CompendiumFile = { id: db.newId(), fileName: 'SRD 5.1 sample.xml', xml: srdSample, importedAt: Date.now(), enabled: true };
    await db.putFile(f);
    setFiles((fs) => [...fs, f]);
  };
  const toggleFile = async (f: CompendiumFile) => {
    const n = { ...f, enabled: !f.enabled };
    await db.putFile(n);
    setFiles((fs) => fs.map((x) => (x.id === f.id ? n : x)));
  };
  const removeFile = async (f: CompendiumFile) => {
    if (!confirm(`Remove ${f.fileName} from the compendium? Characters keep their own copies of anything they use.`)) return;
    await db.deleteFile(f.id);
    setFiles((fs) => fs.filter((x) => x.id !== f.id));
  };

  const saveRecord = useCallback((r: CharacterRecord) => {
    setRecords((rs) => [r, ...rs.filter((x) => x.id !== r.id)]);
    db.putCharacter(r).catch((e) => setError(`Saving failed: ${e}`));
  }, []);
  const createCharacter = (c: Character) => {
    const r = newRecord(c, db.newId());
    saveRecord(r);
    setOpenId(r.id);
  };
  const importCharacters = async () => {
    const picked = await db.readFiles('.xml,text/xml');
    let count = 0;
    const warnings: string[] = [];
    for (const p of picked) {
      try {
        const res = Character.parseAll(p.text);
        warnings.push(...res.warnings.map((w) => `${p.name}: ${w}`));
        for (const c of res.characters) { saveRecord(newRecord(c, db.newId())); count++; }
        if (!res.characters.length) warnings.push(`${p.name}: no characters found`);
      } catch (e) {
        warnings.push(`${p.name}: ${(e as Error).message}`);
      }
    }
    toast(`Imported ${count} character${count === 1 ? '' : 's'}${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`);
    if (warnings.length) setError(warnings.slice(0, 20).join('\n'));
  };
  const exportCharacter = (r: CharacterRecord) => {
    const c = Character.parse(r.xml);
    db.downloadText(`${db.safeFileName(c.name)}.xml`, c.serialize());
  };
  const deleteCharacter = async (r: CharacterRecord) => {
    await db.deleteCharacter(r.id);
    setRecords((rs) => rs.filter((x) => x.id !== r.id));
  };
  const duplicate = (r: CharacterRecord) => {
    const c = Character.parse(r.xml);
    c.name = `${c.name} (copy)`;
    saveRecord({ ...newRecord(c, db.newId()), app: r.app });
  };

  const openRecord = records.find((r) => r.id === openId);
  const setOpt = (o: RulesOptions) => { setOptions(o); db.saveSetting('rules', o); };

  return (
    <AppContext.Provider value={{ lib, options, roll, log, toast }}>
      <div className="app">
        <nav className="topbar">
          <span className="brand">Hearthsheet</span>
          {(['characters', 'compendium', 'dice', 'settings'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => { setView(v); if (v !== 'characters') setOpenId(null); }}>
              {{ characters: 'Characters', compendium: 'Compendium', dice: 'Dice', settings: 'Settings' }[v]}
            </button>
          ))}
        </nav>
        <main>
          {error && <div className="error-bar"><pre>{error}</pre><button className="icon" onClick={() => setError(null)}>×</button></div>}
          {view === 'characters' && (openRecord
            ? <Sheet key={openRecord.id} record={openRecord} onSave={saveRecord} onBack={() => setOpenId(null)} onExport={exportCharacter} />
            : <CharactersView records={records} onOpen={(r) => setOpenId(r.id)} onCreate={createCharacter} onImport={importCharacters}
                onExport={exportCharacter} onDelete={deleteCharacter} onDuplicate={duplicate} />)}
          {view === 'compendium' && <CompendiumView files={files} onImport={importCompendiums} onLoadSample={loadSample} onToggle={toggleFile} onRemove={removeFile} />}
          {view === 'dice' && <DiceView />}
          {view === 'settings' && <SettingsView options={options} setOptions={setOpt} />}
        </main>
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </div>
    </AppContext.Provider>
  );
}

function DiceView() {
  const { roll, log } = useApp();
  const [expr, setExpr] = useState('1d20');
  return (
    <div className="dice">
      <h1>Dice</h1>
      <form className="row" onSubmit={(e) => { e.preventDefault(); roll(expr); }}>
        <input value={expr} onChange={(e) => setExpr(e.target.value)} aria-label="Dice expression" />
        <button className="primary">Roll</button>
      </form>
      <p className="muted small">Examples: 2d6+3, 1d20+5 adv, 1d20 dis, 4d6kh3, d%</p>
      <div className="row wrap">
        {['1d4', '1d6', '1d8', '1d10', '1d12', '1d20', '1d100', '1d20 adv', '1d20 dis'].map((d) => <RollChip key={d} expr={d} />)}
      </div>
      <ul className="roll-log">
        {log.map((r, i) => (
          <li key={i}>
            <b className="total">{r.total}</b>
            <span>{r.label && <b>{r.label}: </b>}{r.expression}</span>
            <span className="muted small">{r.text}</span>
            <span className="muted small">{new Date(r.at).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettingsView({ options, setOptions }: { options: RulesOptions; setOptions: (o: RulesOptions) => void }) {
  return (
    <div className="settings">
      <h1>Settings</h1>
      <section className="panel">
        <h3>Rules</h3>
        <Field label="Multiclass spell slot rounding for half casters">
          <select value={options.multiclassRounding} onChange={(e) => setOptions({ ...options, multiclassRounding: e.target.value as RulesOptions['multiclassRounding'] })}>
            <option value="2014">Round down (2014 rules)</option>
            <option value="2024">Round up (2024 rules)</option>
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={options.applyRaceAbilityElement} onChange={(e) => setOptions({ ...options, applyRaceAbilityElement: e.target.checked })} />
          Apply racial ability score bonuses from the race's &lt;ability&gt; field
        </label>
        <p className="muted small">If a compendium lists racial bonuses both in &lt;ability&gt; and as "ability score" modifiers, only the &lt;ability&gt; field is used, so bonuses are not counted twice.</p>
      </section>
      <section className="panel">
        <h3>About</h3>
        <p>Hearthsheet is an independent, open-source 5e character manager. It reads and writes the community compendium XML format, so you can use compendium files you already own. It is not affiliated with or endorsed by any other app or publisher.</p>
        <p>The app comes with no game content. The optional sample compendium includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.</p>
        <p className="muted small">Your data is stored only on this computer. Export characters and compendiums to back them up.</p>
      </section>
    </div>
  );
}
