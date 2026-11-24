// Carries out session.mjs in the macOS app through the accessibility layer (e2e/mac/axdrive.swift):
// buttons are pressed by name, fields typed into with the keyboard, menus picked from, and the
// system's Open and Save panels answered with ⌘⇧G and a typed location, as a Mac user would.
//
//   node e2e/run-mac.mjs --app /Applications/Hearthsheet.app --files <folder> --out <folder> --ax <axdrive binary>
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { steps, EXPORT_NAME } from './session.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const APP = resolve(arg('app', '/Applications/Hearthsheet.app'));
const FILES = resolve(arg('files', '.'));
const OUT = resolve(arg('out', 'e2e-out'));
const BUNDLE = 'org.hearthsheet.app';
mkdirSync(OUT, { recursive: true });
const exported = join(OUT, EXPORT_NAME);
rmSync(exported, { force: true });

// A fresh install: no saved data.
for (const d of ['Library/WebKit', 'Library/Application Support', 'Library/Caches', 'Library/HTTPStorages'])
  rmSync(join(homedir(), d, BUNDLE), { recursive: true, force: true });
rmSync(join(homedir(), 'Library/Saved Application State', `${BUNDLE}.savedState`), { recursive: true, force: true });

const ax = spawn(arg('ax', 'axdrive'), [BUNDLE], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: ax.stdout });
const queue = [];
lines.on('line', (l) => queue.shift()?.(l));
const send = (cmd) => new Promise((res) => { queue.push((l) => res(JSON.parse(l))); ax.stdin.write(`${JSON.stringify(cmd)}\n`); });
const ready = await new Promise((res) => lines.once('line', (l) => res(JSON.parse(l))));
console.log('axdrive', JSON.stringify(ready));

const launch = async () => {
  execFileSync('open', [APP]);
  for (let i = 0; i < 120; i++) {
    if ((await send({ cmd: 'seen', text: 'Characters' })).ok) break;
    await sleep(250);
  }
  await send({ cmd: 'frontmost' });
  await sleep(500);
};
const quit = async () => {
  try { execFileSync('osascript', ['-e', `quit app id "${BUNDLE}"`]); } catch { /* not running */ }
  for (let i = 0; i < 40; i++) {
    try { execFileSync('pgrep', ['-x', 'hearthsheet']); } catch { return; }
    await sleep(250);
  }
};
const shot = (name) => execFileSync('screencapture', ['-x', join(OUT, `${name}.png`)]);
// Keystrokes go through System Events, as AppleScript users and UI tests do.
const osa = (script) => execFileSync('osascript', ['-e', `tell application "System Events" to ${script}`]);
const keystroke = (text) => osa(`keystroke ${JSON.stringify(text)}`);
const KEY = { return: 36, delete: 51, escape: 53 };
const press = (combo) => {
  const parts = combo.split('+');
  const k = parts.pop();
  const using = parts.map((m) => ({ cmd: 'command down', shift: 'shift down', alt: 'option down', ctrl: 'control down' })[m]);
  const mods = using.length ? ` using {${using.join(', ')}}` : '';
  osa(k in KEY ? `key code ${KEY[k]}${mods}` : `keystroke ${JSON.stringify(k)}${mods}`);
};
const until = async (what, seconds, check) => {
  const end = Date.now() + seconds * 1000;
  let last;
  for (;;) {
    last = await check();
    if (last.ok) return last;
    if (Date.now() > end) throw new Error(`${what}: ${last.error || 'not found'} after ${seconds} s`);
    await sleep(250);
  }
};

/** The system's Open or Save panel: go to the location with ⌘⇧G, then confirm. */
async function answerPanel(kind, path) {
  await sleep(1500);
  await send({ cmd: 'frontmost' });
  press('cmd+shift+g');
  await sleep(1000);
  press('cmd+a');
  keystroke(kind === 'save' ? dirname(path) : path);
  await sleep(700);
  press('return');
  await sleep(1200);
  press('return');
  await sleep(1500);
}

async function run(step) {
  if (step.shot) return shot(step.shot);
  if (step.tap) {
    try { return await until(`"${step.tap}"`, step.seconds ?? 15, () => send({ cmd: 'press', name: step.tap })); } catch (e) {
      // Nothing pressable: click its spot through System Events, as a mouse would.
      const r = await send({ cmd: 'press', name: step.tap });
      if (r.ok) return r;
      if (r.x === undefined) throw e;
      osa(`click at {${Math.round(r.x)}, ${Math.round(r.y)}}`);
      return r;
    }
  }
  if (step.fill) {
    await until(`field "${step.fill}"`, 15, () => send({ cmd: 'fill', name: step.fill, focusOnly: true }));
    press('cmd+a'); press('delete');
    keystroke(step.text);
    return;
  }
  if (step.choose) return until(`"${step.option}" in "${step.choose}"`, 15, () => send({ cmd: 'choose', name: step.choose, option: step.option }));
  if (step.tick) return until(`checkbox "${step.tick}"`, 15, () => send({ cmd: 'tick', name: step.tick }));
  if (step.see) return until(`text "${step.see}"`, step.seconds ?? 15, () => send({ cmd: 'seen', text: step.see }));
  if (step.value) {
    let got;
    try {
      await until(step.value, 5, async () => { got = (await send({ cmd: 'read', name: step.value })).value; return { ok: got === step.is }; });
    } catch { throw new Error(`${step.value}: expected ${step.is}, the sheet shows ${got}`); }
    return got;
  }
  if (step.pick) return answerPanel('open', join(FILES, step.pick));
  if (step.save) return answerPanel('save', exported);
  if (step.restart) { await quit(); await sleep(1000); return launch(); }
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

await launch();
const results = [];
const t0 = Date.now();
for (const [i, step] of steps.entries()) {
  const t = Date.now();
  try {
    await run(step);
    results.push({ i, step, ok: true, ms: Date.now() - t });
  } catch (e) {
    results.push({ i, step, ok: false, ms: Date.now() - t, error: String(e?.message || e).split('\n')[0] });
    try { shot(`fail-${String(i).padStart(3, '0')}`); } catch { /* ignore */ }
    if (results.filter((r) => !r.ok).length === 1) writeFileSync(join(OUT, 'first-failure-tree.txt'), (await send({ cmd: 'dump' })).tree ?? '');
  }
}
await quit();
ax.stdin.end();
const failed = results.filter((r) => !r.ok);
const report = {
  system: 'macOS', app: APP, seconds: Math.round((Date.now() - t0) / 1000), passed: results.length - failed.length, failed: failed.length,
  exported: existsSync(exported) ? readFileSync(exported, 'utf8').length : 0, results,
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${String(r.i).padStart(3)} ${JSON.stringify(r.step)}${r.error ? `  -> ${r.error}` : ''}`);
console.log(`macOS: ${report.passed}/${results.length} steps passed in ${report.seconds} s`);
process.exit(failed.length ? 1 : 0);
