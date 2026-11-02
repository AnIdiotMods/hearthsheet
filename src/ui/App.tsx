import { useCallback, useEffect, useMemo, useState } from 'react';
import { PRESET_ACCENTS, Theme, ThemeMode, applyTheme, defaultTheme, effectiveMode, textContrast } from './theme';
import { buildLibrary, CompendiumFile, lookup } from '../model/compendium';
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
  const [options, setOptions] = useState<RulesOptions>(() => ({ multiclassRounding: db.loadSetting('rules', defaultOptions).multiclassRounding }));
  const [log, setLog] = useState<RollResult[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([db.listFiles(), db.listCharacters()])
      .then(([f, c]) => { setFiles(f); setRecords(c); })
      .catch((e) => setError(`Could not open local storage: ${e}`));
  }, []);

  const [theme, setThemeState] = useState<Theme>(() => db.loadSetting('theme', defaultTheme));
  const setTheme = (t: Theme) => { setThemeState(t); db.saveSetting('theme', t); };
  useEffect(() => {
    applyTheme(theme);
    if (theme.mode !== 'system' || typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(theme);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const lib = useMemo(() => buildLibrary(files), [files]);
  const rules = useMemo<RulesOptions>(() => ({ ...options, classLookup: (n: string) => lookup(lib, 'class', n)?.el }), [options, lib]);

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
  const setOpt = (o: RulesOptions) => { const { classLookup: _unused, ...plain } = o; void _unused; setOptions(plain); db.saveSetting('rules', plain); };

  return (
    <AppContext.Provider value={{ lib, options: rules, roll, log, toast }}>
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
          {view === 'settings' && <SettingsView options={options} setOptions={setOpt} theme={theme} setTheme={setTheme} />}
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

function ColorSetting({ label, hint, value, fallback, onChange, presets, mode }: {
  label: string; hint: string; value: string | null; fallback: string; onChange: (v: string | null) => void; presets?: string[]; mode: ThemeMode;
}) {
  const ratio = value ? textContrast(value, mode) : null;
  return (
    <div className="setting-row">
      <div><b>{label}</b><div className="muted small">{hint}</div></div>
      <div>
        <div className="swatches">
          {presets?.map((p) => <button key={p} className={`swatch ${value === p ? 'active' : ''}`} style={{ background: p }} title={p} aria-label={`Use ${p}`} onClick={() => onChange(p)} />)}
          <input type="color" value={value ?? fallback} onChange={(e) => onChange(e.target.value)} aria-label={`Pick ${label.toLowerCase()}`} />
          <button className="small" disabled={!value} onClick={() => onChange(null)}>Default</button>
        </div>
        {ratio !== null && ratio < 4.5 && !presets && (
          <p className="danger small">This color may be hard to read on the current background (contrast {ratio.toFixed(1)}:1; 4.5:1 or more is recommended).</p>
        )}
      </div>
    </div>
  );
}

function AppearanceSettings({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const dark = effectiveMode(theme.mode) === 'dark';
  return (
    <section className="panel">
      <h3>Appearance</h3>
      <div className="setting-row">
        <div><b>Mode</b><div className="muted small">“System” follows your Windows setting.</div></div>
        <div className="row">
          {(['system', 'light', 'dark'] as ThemeMode[]).map((m) => (
            <label key={m} className="radio"><input type="radio" checked={theme.mode === m} onChange={() => setTheme({ ...theme, mode: m })} />{{ system: 'System', light: 'Light', dark: 'Dark' }[m]}</label>
          ))}
        </div>
      </div>
      <ColorSetting label="Primary color" hint="Buttons, active tabs and highlights." value={theme.accent} fallback={dark ? '#d9765c' : '#8a3b2a'}
        presets={PRESET_ACCENTS} mode={theme.mode} onChange={(v) => setTheme({ ...theme, accent: v })} />
      <ColorSetting label="Text color" hint="The main lettering." value={theme.text} fallback={dark ? '#ece6dd' : '#23201c'}
        mode={theme.mode} onChange={(v) => setTheme({ ...theme, text: v })} />
      <ColorSetting label="Secondary text color" hint="Labels, headings and hints." value={theme.secondary} fallback={dark ? '#a39a8e' : '#6f675d'}
        mode={theme.mode} onChange={(v) => setTheme({ ...theme, secondary: v })} />
      <div className="setting-row">
        <div><b>Font</b><div className="muted small">OpenDyslexic is designed to be easier to read for people with dyslexia.</div></div>
        <div className="row">
          <label className="radio"><input type="radio" checked={theme.font === 'default'} onChange={() => setTheme({ ...theme, font: 'default' })} />Standard</label>
          <label className="radio" style={{ fontFamily: 'OpenDyslexic' }}><input type="radio" checked={theme.font === 'dyslexic'} onChange={() => setTheme({ ...theme, font: 'dyslexic' })} />OpenDyslexic</label>
        </div>
      </div>
      <div className="setting-row">
        <div><b>Text size</b><div className="muted small">Scales the whole window.</div></div>
        <div className="row">
          <input type="range" min={80} max={140} step={5} value={theme.scale} onChange={(e) => setTheme({ ...theme, scale: +e.target.value })} aria-label="Text size" />
          <span>{theme.scale}%</span>
        </div>
      </div>
      <div className="setting-row">
        <div><b>Preview</b></div>
        <div className="theme-preview">
          <button className="primary">Primary button</button>
          <button>Button</button>
          <span>Text <span className="muted">secondary text</span></span>
          <span className="tag">tag</span>
        </div>
      </div>
      <p><button className="small" onClick={() => setTheme(defaultTheme)}>Reset appearance</button></p>
    </section>
  );
}

function SettingsView({ options, setOptions, theme, setTheme }: { options: RulesOptions; setOptions: (o: RulesOptions) => void; theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <div className="settings">
      <h1>Settings</h1>
      <AppearanceSettings theme={theme} setTheme={setTheme} />
      <section className="panel">
        <h3>Rules</h3>
        <Field label="Multiclass spell slot rounding for half casters">
          <select value={options.multiclassRounding} onChange={(e) => setOptions({ ...options, multiclassRounding: e.target.value as RulesOptions['multiclassRounding'] })}>
            <option value="2014">Round down (2014 rules)</option>
            <option value="2024">Round up (2024 rules)</option>
          </select>
        </Field>
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
