// Runs inside the app's page (through WebDriver). Finds controls the way a person reads the screen: by
// the name shown on them or announced for them, only among what is visible, and inside an open
// window (dialog) when there is one. Exported as a string so the driver can send it to the page.
module.exports = String(function hearthsheetPage() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const scope = () => {
    const open = [...document.querySelectorAll('.dialog, .modal')].filter(visible);
    return open.length ? open[open.length - 1] : document.body;
  };
  const labelText = (lab) => {
    // A label's own words, without the text of the control inside it.
    const c = lab.cloneNode(true);
    c.querySelectorAll('input, select, textarea, .feature-text, .details-link, .tag').forEach((x) => x.remove());
    return norm(c.textContent);
  };
  const names = (el) => {
    const out = [];
    if (el.getAttribute('aria-label')) out.push(norm(el.getAttribute('aria-label')));
    if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => out.push(labelText(l)));
    const lab = el.closest('label');
    if (lab) {
      out.push(labelText(lab));
      const first = lab.querySelector('span, b');
      if (first && !first.contains(el)) out.push(norm(first.textContent));
    }
    if (el.placeholder) out.push(norm(el.placeholder));
    return out;
  };
  const W = {
    /** The visible element named `name` that a person would press. */
    tapTarget(name) {
      const root = scope();
      const clickable = 'button, a, [role=button], [role=tab], summary, label, li, .card, input[type=checkbox], input[type=radio]';
      const all = [...root.querySelectorAll(clickable)].filter(visible);
      const exact = all.find((el) => norm(el.getAttribute('aria-label')) === name)
        || all.find((el) => (el.matches('label') ? labelText(el) : norm(el.innerText)) === name);
      if (exact) return exact;
      // Text inside something pressable, such as a list entry ("Fireball" + "Level 3") or a card's heading.
      const inner = [...root.querySelectorAll('span, b, h3, h4, div')].filter((el) => visible(el) && norm(el.textContent) === name && el.closest(clickable));
      return inner.length ? inner[0] : null;
    },
    /** The field (input, textarea or dropdown) named `name`. */
    field(name, tags = 'input, textarea, select') {
      const all = [...scope().querySelectorAll(tags)].filter(visible);
      return all.find((el) => names(el).includes(name)) || null;
    },
    checkbox(name) {
      return W.field(name, 'input[type=checkbox], input[type=radio]');
    },
    option(select, text) {
      const opts = [...select.options];
      return opts.find((o) => norm(o.text) === text) || opts.find((o) => norm(o.text).startsWith(`${text} [`)) || null;
    },
    seen(text) {
      return document.body.innerText.replace(/\s+/g, ' ').includes(text);
    },
    /** Numbers as the sheet shows them, for comparing systems. */
    value(name) {
      const stat = (label) => {
        const s = [...document.querySelectorAll('.stat')].find((x) => norm(x.querySelector('.label')?.textContent).toLowerCase() === label.toLowerCase());
        return s ? norm(s.querySelector('.value')?.textContent) : null;
      };
      if (name === 'Hit points') {
        const hp = document.querySelector('.stat.hp');
        if (!hp) return null;
        const cur = hp.querySelector('input.hp-cur, .hp-cur input, input')?.value;
        const max = norm(hp.querySelector('.value > span[title]')?.textContent);
        return `${cur} / ${max}`;
      }
      if (name === 'Spell save DC') {
        const m = /Save DC (\d+)/.exec(norm(document.querySelector('.caster')?.textContent));
        return m ? m[1] : null;
      }
      const slots = /^(\d+\w\w)-level slots used$/.exec(name);
      if (slots) {
        const boxes = [...document.querySelectorAll('input[type=checkbox]')].filter((b) => (b.getAttribute('aria-label') || '').startsWith(`${slots[1]}-level slot`));
        return `${boxes.filter((b) => b.checked).length} of ${boxes.length}`;
      }
      return stat(name);
    },
    /** Everything a player would read off the sheet, for side-by-side comparison. */
    snapshot() {
      const out = {};
      out.header = norm(document.querySelector('.sheet-head .title .muted, .sheet-head .muted')?.textContent);
      for (const s of document.querySelectorAll('.stat')) {
        const l = norm(s.querySelector('.label')?.textContent);
        if (l) out[l] = l === 'Hit Points' ? W.value('Hit points') : norm(s.querySelector('.value')?.textContent);
      }
      out.platform = navigator.userAgent;
      return out;
    },
  };
  return W;
});
