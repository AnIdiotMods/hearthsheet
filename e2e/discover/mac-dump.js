// JXA: print the accessibility tree of Hearthsheet's front window (role, name, description, value, frame).
function run(argv) {
  const se = Application('System Events');
  const proc = se.processes.byName('Hearthsheet');
  const out = [];
  const max = Number(argv[0] || 60);
  function walk(el, depth) {
    if (depth > max || out.length > 3000) return;
    const g = (f) => { try { const v = f(); return v == null ? '' : v; } catch (e) { return ''; } };
    const role = g(() => el.role()), name = g(() => el.name()), desc = g(() => el.description());
    const val = String(g(() => el.value())).slice(0, 60), pos = g(() => el.position()), size = g(() => el.size());
    out.push(`${'  '.repeat(depth)}${role} name=${JSON.stringify(name)} desc=${JSON.stringify(desc)} value=${JSON.stringify(val)} @${pos} ${size}`);
    let kids = [];
    try { kids = el.uiElements(); } catch (e) { /* none */ }
    for (const k of kids) walk(k, depth + 1);
  }
  walk(proc.windows[0], 0);
  return out.join('\n');
}
