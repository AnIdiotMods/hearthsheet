// Carries out session.mjs in the real desktop app on Linux or Windows, through tauri-driver (WebDriver).
// The system's Open and Save dialogs are answered with the system's own tools, the way a person types
// a path into them: xdotool on Linux, UI Automation on Windows.
//
//   node e2e/run-desktop.mjs --app <path to the app> --files <folder with the compendium> --out <folder>
import { Builder, Key } from 'selenium-webdriver';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import pageSource from './page.js';
import { steps, EXPORT_NAME } from './session.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const APP = resolve(arg('app'));
const FILES = resolve(arg('files', '.'));
const OUT = resolve(arg('out', 'e2e-out'));
const WIN = platform() === 'win32';
mkdirSync(OUT, { recursive: true });

// Start from a fresh install: no saved characters, compendiums or settings.
const dataDirs = WIN
  ? [join(process.env.LOCALAPPDATA || '', 'org.hearthsheet.app'), join(process.env.APPDATA || '', 'org.hearthsheet.app')]
  : [join(homedir(), '.local/share/org.hearthsheet.app'), join(homedir(), '.cache/org.hearthsheet.app'), join(homedir(), '.config/org.hearthsheet.app')];
for (const d of dataDirs) rmSync(d, { recursive: true, force: true });
const exported = join(OUT, EXPORT_NAME);
rmSync(exported, { force: true });

// Linux: tauri-driver starts the app and hands it to WebKitWebDriver. Windows: the app is started here
// with WebView2's debugging port on, and Microsoft Edge WebDriver attaches to it (Microsoft's documented
// way to automate a running WebView2 app), which also lets the session close and reopen the app itself.
const DEBUG_PORT = 9222;
let appProc = null;
async function startApp() {
  appProc = spawn(APP, [], {
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=${DEBUG_PORT}` },
  });
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok) return; } catch { /* not yet */ }
    await sleep(250);
  }
  throw new Error('the app did not open its WebView2 debugging port');
}
async function closeApp() {
  // Close the window the way a person does (its close button), then make sure it has exited.
  try { execFileSync('powershell', ['-NoProfile', '-Command', "Get-Process hearthsheet -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }"]); } catch { /* gone */ }
  for (let i = 0; i < 40 && appProc && appProc.exitCode === null; i++) await sleep(250);
  if (appProc && appProc.exitCode === null) appProc.kill();
  await sleep(1500);
}
const driverProc = WIN
  ? spawn(arg('native-driver', 'msedgedriver'), ['--port=4444'], { stdio: ['ignore', 'inherit', 'inherit'] })
  : spawn(arg('tauri-driver', 'tauri-driver'), [], { stdio: ['ignore', 'inherit', 'inherit'] });
await sleep(2000);

const newSession = async () => {
  if (WIN) await startApp();
  const caps = WIN
    ? { browserName: 'webview2', 'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${DEBUG_PORT}` } }
    : { browserName: 'wry', 'tauri:options': { application: APP } };
  const d = await new Builder().usingServer('http://127.0.0.1:4444/').withCapabilities(caps).build();
  // Wait for the app's first screen.
  for (let i = 0; i < 120; i++) {
    if (await d.executeScript("return !!document.querySelector('.topbar')").catch(() => false)) break;
    await sleep(250);
  }
  return d;
};
let d = await newSession();

const page = async (fn, ...args) => d.executeScript(`return (${pageSource})().${fn}(...arguments)`, ...args);
const until = async (what, seconds, check) => {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const r = await check().catch(() => null);
    if (r) return r;
    if (Date.now() > end) throw new Error(`${what}: not found after ${seconds} s`);
    await sleep(200);
  }
};
const shot = async (name) => writeFileSync(join(OUT, `${name}.png`), await d.takeScreenshot(), 'base64');

// ---- the system's file dialogs
function answerDialog(kind, path) {
  if (WIN) {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(import.meta.dirname, 'windows-dialog.ps1'), '-Path', path], { stdio: 'inherit', timeout: 60000 });
    return;
  }
  // GTK: wait for the dialog, type the path into its location field (Ctrl+L) and press Enter.
  const title = kind === 'save' ? '^Save File$' : '^Open File(s)?$';
  let id = '';
  for (let i = 0; i < 120 && !id; i++) {
    try { id = execFileSync('xdotool', ['search', '--onlyvisible', '--name', title]).toString().trim().split('\n')[0]; } catch { /* not yet */ }
    if (!id) execFileSync('sleep', ['0.25']);
  }
  if (!id) throw new Error(`the system ${kind} dialog did not open`);
  execFileSync('sleep', ['0.6']);
  execFileSync('xdotool', ['windowfocus', '--sync', id]);
  execFileSync('xdotool', ['key', '--clearmodifiers', 'ctrl+l']);
  execFileSync('sleep', ['0.3']);
  if (kind === 'save') execFileSync('xdotool', ['key', 'ctrl+a']);
  execFileSync('xdotool', ['type', '--delay', '12', path]);
  execFileSync('sleep', ['0.3']);
  execFileSync('xdotool', ['key', 'Return']);
}

// ---- one step
async function run(step) {
  if (step.shot) return shot(step.shot);
  if (step.tap) {
    const el = await until(`"${step.tap}"`, step.seconds ?? 15, () => page('tapTarget', step.tap));
    await el.click();
    return;
  }
  if (step.fill) {
    const el = await until(`field "${step.fill}"`, 15, () => page('field', step.fill));
    await el.click();
    await el.sendKeys(Key.chord(WIN ? Key.CONTROL : Key.CONTROL, 'a'), Key.BACK_SPACE);
    await el.sendKeys(step.text);
    return;
  }
  if (step.choose) {
    const sel = await until(`dropdown "${step.choose}"`, 15, () => page('field', step.choose, 'select'));
    const opt = await until(`"${step.option}" in "${step.choose}"`, 15, () => d.executeScript(`return (${pageSource})().option(arguments[0], arguments[1])`, sel, step.option));
    await opt.click();
    return;
  }
  if (step.tick) {
    const box = await until(`checkbox "${step.tick}"`, 15, () => page('checkbox', step.tick));
    if (!(await box.isSelected())) await box.click();
    return;
  }
  if (step.see) {
    await until(`text "${step.see}"`, step.seconds ?? 15, () => page('seen', step.see));
    return;
  }
  if (step.value) {
    let got = null;
    await until(`${step.value} = ${step.is}`, 5, async () => { got = await page('value', step.value); return got === step.is; })
      .catch(() => { throw new Error(`${step.value}: expected ${step.is}, the sheet shows ${got}`); });
    return got;
  }
  if (step.pick) {
    answerDialog('open', join(FILES, step.pick));
    return;
  }
  if (step.save) {
    answerDialog('save', exported);
    return;
  }
  if (step.restart) {
    await d.quit();
    if (WIN) await closeApp();
    await sleep(1500);
    d = await newSession();
    return;
  }
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

const results = [];
const t0 = Date.now();
for (const [i, step] of steps.entries()) {
  const t = Date.now();
  try {
    const detail = await run(step);
    results.push({ i, step, ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) });
  } catch (e) {
    results.push({ i, step, ok: false, ms: Date.now() - t, error: String(e?.message || e).split('\n')[0] });
    await shot(`fail-${String(i).padStart(3, '0')}`).catch(() => {});
  }
}
const snapshot = await page('snapshot').catch(() => null);
await d.quit().catch(() => {});
if (WIN) await closeApp();
driverProc.kill();
const failed = results.filter((r) => !r.ok);
const report = {
  system: WIN ? 'Windows' : 'Linux', app: APP, seconds: Math.round((Date.now() - t0) / 1000),
  passed: results.length - failed.length, failed: failed.length, snapshot,
  exported: existsSync(exported) ? readFileSync(exported, 'utf8').length : 0,
  results,
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${String(r.i).padStart(3)} ${JSON.stringify(r.step)}${r.error ? `  -> ${r.error}` : ''}`);
console.log(`${report.system}: ${report.passed}/${results.length} steps passed in ${report.seconds} s`);
process.exit(failed.length ? 1 : 0);
