// Compares the character files exported by the session on each system. They should be identical: the
// same character built the same way. The only allowed difference is the order of a note's title and
// text, which depends on whether the title was cleared while typing.
//   node e2e/compare.mjs <system>=<exported file> ...
import { readFileSync } from 'node:fs';

const inputs = process.argv.slice(2).map((a) => { const i = a.indexOf('='); return { system: a.slice(0, i), file: a.slice(i + 1) }; });
const normalize = (xml) => xml
  .replace(/\r\n/g, '\n')
  .replace(/<note>([\s\S]*?)<\/note>/g, (_, body) => `<note>${body.split('\n').map((l) => l.trim()).filter(Boolean).sort().join('')}</note>`)
  .split('\n').map((l) => l.replace(/\s+$/, ''));

const base = inputs[0];
const baseLines = normalize(readFileSync(base.file, 'utf8'));
let differ = 0;
console.log(`${base.system}: ${baseLines.length} lines (reference)`);
for (const x of inputs.slice(1)) {
  const lines = normalize(readFileSync(x.file, 'utf8'));
  const diffs = [];
  for (let i = 0; i < Math.max(lines.length, baseLines.length); i++) {
    if (lines[i] !== baseLines[i]) diffs.push(`  line ${i + 1}: ${base.system} ${JSON.stringify(baseLines[i])} / ${x.system} ${JSON.stringify(lines[i])}`);
  }
  console.log(`${x.system}: ${diffs.length ? `${diffs.length} differing lines` : 'identical'}`);
  if (diffs.length) { differ++; console.log(diffs.slice(0, 20).join('\n')); }
}
process.exit(differ ? 1 : 0);
