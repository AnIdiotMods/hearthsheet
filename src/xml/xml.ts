// Lossless, tolerant XML tree.
//
// Every imported file is kept as this tree; the app reads and edits values
// through accessors, so elements and attributes it does not understand are
// carried through untouched and re-emitted on export.

export type XNode = XElement | XText | XCData | XComment | XRaw;

export interface XElement {
  type: 'el';
  name: string;
  attrs: [string, string][]; // ordered
  children: XNode[];
}
export interface XText { type: 'text'; value: string }
export interface XCData { type: 'cdata'; value: string }
export interface XComment { type: 'comment'; value: string }
/** Declarations, processing instructions and DOCTYPE, kept verbatim. */
export interface XRaw { type: 'raw'; value: string }

export interface XDocument {
  prolog: XNode[];
  root: XElement;
  epilog: XNode[];
}

export interface ParseResult {
  doc: XDocument;
  warnings: string[];
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Entities that are common in hand-made homebrew files exported from HTML editors.
const HTML_EXTRA: Record<string, string> = {
  nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…', times: '×', deg: '°',
};

function decodeEntities(s: string, warn: (m: string) => void, line: () => number): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*)?(;?)/g, (whole, ent: string | undefined, semi: string) => {
    if (ent && semi) {
      if (ent[0] === '#') {
        const code = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
      } else if (ent in NAMED) {
        return NAMED[ent];
      } else if (ent in HTML_EXTRA) {
        warn(`line ${line()}: HTML entity &${ent}; is not valid XML; decoded anyway`);
        return HTML_EXTRA[ent];
      }
    }
    warn(`line ${line()}: unescaped '&' treated as a literal character`);
    return whole;
  });
}

const NAME_START = /[A-Za-z_:À-￿]/;

export function parseXml(input: string): ParseResult {
  const warnings: string[] = [];
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let pos = 0;
  const lineAt = () => {
    let n = 1;
    for (let i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
    return n;
  };
  const warn = (m: string) => { if (warnings.length < 500) warnings.push(m); };

  const prolog: XNode[] = [];
  const epilog: XNode[] = [];
  let root: XElement | null = null;
  const stack: XElement[] = [];

  const append = (node: XNode) => {
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (!root) {
      if (node.type === 'text' && !node.value.trim()) prolog.push(node);
      else if (node.type === 'text') warn(`line ${lineAt()}: text outside the root element ignored`);
      else prolog.push(node);
    } else {
      if (node.type === 'text' && node.value.trim()) warn(`line ${lineAt()}: text after the root element ignored`);
      else epilog.push(node);
    }
  };

  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    if (lt < 0) { append({ type: 'text', value: decodeEntities(src.slice(pos), warn, lineAt) }); break; }
    if (lt > pos) append({ type: 'text', value: decodeEntities(src.slice(pos, lt), warn, lineAt) });
    pos = lt;

    if (src.startsWith('<!--', pos)) {
      let end = src.indexOf('-->', pos + 4);
      if (end < 0) { warn(`line ${lineAt()}: unterminated comment`); end = src.length; }
      append({ type: 'comment', value: src.slice(pos + 4, end) });
      pos = end + 3;
    } else if (src.startsWith('<![CDATA[', pos)) {
      let end = src.indexOf(']]>', pos + 9);
      if (end < 0) { warn(`line ${lineAt()}: unterminated CDATA section`); end = src.length; }
      append({ type: 'cdata', value: src.slice(pos + 9, end) });
      pos = end + 3;
    } else if (src.startsWith('<?', pos)) {
      let end = src.indexOf('?>', pos + 2);
      if (end < 0) { warn(`line ${lineAt()}: unterminated processing instruction`); end = src.length; }
      append({ type: 'raw', value: src.slice(pos, end + 2) });
      pos = end + 2;
    } else if (src.startsWith('<!', pos)) {
      // DOCTYPE (internal subsets with nested '>' are rare in this format; handle brackets anyway)
      let depth = 0, i = pos + 2;
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      append({ type: 'raw', value: src.slice(pos, i + 1) });
      pos = i + 1;
    } else if (src[pos + 1] === '/') {
      const end = src.indexOf('>', pos);
      const name = src.slice(pos + 2, end < 0 ? src.length : end).trim();
      pos = end < 0 ? src.length : end + 1;
      const idx = findOpen(stack, name);
      if (idx < 0) {
        warn(`line ${lineAt()}: closing tag </${name}> has no matching open tag; ignored`);
      } else {
        if (idx < stack.length - 1) {
          warn(`line ${lineAt()}: </${name}> closes unclosed <${stack.slice(idx + 1).map((e) => e.name).join('>, <')}>`);
        }
        stack.length = idx;
      }
    } else if (NAME_START.test(src[pos + 1] ?? '')) {
      const r = parseTag(src, pos + 1, warn, lineAt);
      pos = r.end;
      if (!root && stack.length === 0) root = r.el;
      else if (stack.length === 0) {
        warn(`line ${lineAt()}: more than one root element; <${r.el.name}> moved inside <${root!.name}>`);
        root!.children.push(r.el);
        if (!r.selfClosing) stack.push(root!, r.el);
        continue;
      } else stack[stack.length - 1].children.push(r.el);
      if (!r.selfClosing) stack.push(r.el);
    } else {
      // A lone '<' in text (e.g. "AC < 15" typed by hand).
      warn(`line ${lineAt()}: unescaped '<' treated as a literal character`);
      append({ type: 'text', value: '<' });
      pos += 1;
    }
  }

  if (stack.length) warn(`end of file: unclosed element(s) <${stack.map((e) => e.name).join('>, <')}>`);
  if (!root) {
    warn('no root element found');
    root = { type: 'el', name: 'compendium', attrs: [], children: [] };
  }
  return { doc: { prolog, root, epilog }, warnings: mergeAdjacentText(root, warnings) };
}

function findOpen(stack: XElement[], name: string): number {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) return i;
  // Case-insensitive fallback for hand-written files (<Name>...</name>).
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name.toLowerCase() === name.toLowerCase()) return i;
  return -1;
}

function parseTag(src: string, start: number, warn: (m: string) => void, line: () => number) {
  let i = start;
  while (i < src.length && !/[\s/>]/.test(src[i])) i++;
  const el: XElement = { type: 'el', name: src.slice(start, i), attrs: [], children: [] };
  let selfClosing = false;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) { warn(`line ${line()}: unterminated tag <${el.name}>`); break; }
    if (src[i] === '>') { i++; break; }
    if (src[i] === '/' && src[i + 1] === '>') { selfClosing = true; i += 2; break; }
    if (src[i] === '/') { i++; continue; }
    const ns = i;
    while (i < src.length && !/[\s=/>]/.test(src[i])) i++;
    const aname = src.slice(ns, i);
    while (i < src.length && /\s/.test(src[i])) i++;
    let value = '';
    if (src[i] === '=') {
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;
      const q = src[i];
      if (q === '"' || q === "'") {
        const end = src.indexOf(q, i + 1);
        value = src.slice(i + 1, end < 0 ? src.length : end);
        i = end < 0 ? src.length : end + 1;
      } else {
        const vs = i;
        while (i < src.length && !/[\s>]/.test(src[i])) i++;
        value = src.slice(vs, i);
        warn(`line ${line()}: unquoted attribute value ${aname}=${value}`);
      }
    } else {
      warn(`line ${line()}: attribute ${aname} has no value`);
    }
    if (aname) el.attrs.push([aname, decodeEntities(value, warn, line)]);
  }
  return { el, end: i, selfClosing };
}

function mergeAdjacentText(el: XElement, warnings: string[]): string[] {
  const out: XNode[] = [];
  for (const c of el.children) {
    const last = out[out.length - 1];
    if (c.type === 'text' && last?.type === 'text') last.value += c.value;
    else out.push(c);
    if (c.type === 'el') mergeAdjacentText(c, warnings);
  }
  el.children = out;
  return warnings;
}

// ---------------------------------------------------------------- writing

// XML 1.0 forbids most C0 control characters; strict writing drops them.
const INVALID_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function escapeText(s: string): string {
  return s.replace(INVALID_CHARS, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');
}

export interface SerializeOptions {
  /** Re-indent element-only content. Text content is never altered. */
  pretty?: boolean;
  indent?: string;
}

export function serializeXml(doc: XDocument, opts: SerializeOptions = {}): string {
  const parts: string[] = [];
  const pretty = !!opts.pretty;
  const ind = opts.indent ?? '  ';
  const hasDecl = doc.prolog.some((n) => n.type === 'raw' && n.value.startsWith('<?xml'));
  if (!hasDecl) parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  for (const n of doc.prolog) {
    if (pretty && n.type === 'text') continue;
    writeNode(n, parts, pretty, ind, 0);
    if (pretty) parts.push('\n');
  }
  writeNode(doc.root, parts, pretty, ind, 0);
  for (const n of doc.epilog) {
    if (pretty && n.type === 'text') continue;
    if (pretty) parts.push('\n');
    writeNode(n, parts, pretty, ind, 0);
  }
  if (pretty) parts.push('\n');
  return parts.join('');
}

function isWs(n: XNode) { return n.type === 'text' && !n.value.trim(); }

function writeNode(n: XNode, out: string[], pretty: boolean, ind: string, depth: number) {
  switch (n.type) {
    case 'text': out.push(escapeText(n.value)); return;
    case 'cdata': out.push(`<![CDATA[${n.value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`); return;
    case 'comment': out.push(`<!--${n.value.replace(/--/g, '- -')}-->`); return;
    case 'raw': out.push(n.value); return;
    case 'el': {
      out.push('<', n.name);
      for (const [k, v] of n.attrs) out.push(' ', k, '="', escapeAttr(v), '"');
      if (!n.children.length) { out.push('/>'); return; }
      out.push('>');
      const elementOnly = n.children.every((c) => c.type !== 'text' && c.type !== 'cdata' || isWs(c));
      if (pretty && elementOnly) {
        for (const c of n.children) {
          if (isWs(c)) continue;
          out.push('\n', ind.repeat(depth + 1));
          writeNode(c, out, pretty, ind, depth + 1);
        }
        out.push('\n', ind.repeat(depth));
      } else {
        for (const c of n.children) writeNode(c, out, pretty, ind, depth + 1);
      }
      out.push('</', n.name, '>');
    }
  }
}

// ---------------------------------------------------------------- helpers

export function el(name: string, text?: string | number, attrs: [string, string][] = []): XElement {
  return { type: 'el', name, attrs, children: text === undefined || text === '' ? [] : [{ type: 'text', value: String(text) }] };
}

export function elements(e: XElement, name?: string): XElement[] {
  const out: XElement[] = [];
  for (const c of e.children) if (c.type === 'el' && (name === undefined || c.name === name)) out.push(c);
  return out;
}

export function child(e: XElement, name: string): XElement | undefined {
  for (const c of e.children) if (c.type === 'el' && c.name === name) return c;
  return undefined;
}

/** Concatenated text content (text + CDATA), recursively. */
export function textOf(e: XElement | undefined): string {
  if (!e) return '';
  let s = '';
  for (const c of e.children) {
    if (c.type === 'text' || c.type === 'cdata') s += c.value;
    else if (c.type === 'el') s += textOf(c);
  }
  return s;
}

export function childText(e: XElement, name: string): string {
  return textOf(child(e, name)).trim();
}

export function childTexts(e: XElement, name: string): string[] {
  return elements(e, name).map(textOf);
}

export function attr(e: XElement, name: string): string | undefined {
  return e.attrs.find(([k]) => k === name)?.[1];
}

export function setAttr(e: XElement, name: string, value: string | undefined) {
  const i = e.attrs.findIndex(([k]) => k === name);
  if (value === undefined) { if (i >= 0) e.attrs.splice(i, 1); }
  else if (i >= 0) e.attrs[i] = [name, value];
  else e.attrs.push([name, value]);
}

/** Set the text of the first child `name`, creating it (appended) if missing. Empty string removes it. */
export function setChildText(e: XElement, name: string, value: string | number | undefined) {
  const existing = child(e, name);
  const v = value === undefined ? '' : String(value);
  if (!v) {
    if (existing) removeChild(e, existing);
    return;
  }
  if (existing) existing.children = [{ type: 'text', value: v }];
  else appendChild(e, el(name, v));
}

export function appendChild(parent: XElement, c: XElement) {
  parent.children.push(c);
}

export function removeChild(parent: XElement, c: XNode) {
  const i = parent.children.indexOf(c);
  if (i >= 0) parent.children.splice(i, 1);
}

export function cloneEl(e: XElement): XElement {
  return {
    type: 'el', name: e.name, attrs: e.attrs.map(([k, v]) => [k, v]),
    children: e.children.map((c) => (c.type === 'el' ? cloneEl(c) : { ...c })),
  };
}

/** Strip formatting-only whitespace text nodes (used before inserting copied subtrees). */
export function stripWhitespace(e: XElement): XElement {
  e.children = e.children.filter((c) => !isWs(c) || e.children.every((x) => x.type === 'text'));
  for (const c of e.children) if (c.type === 'el') stripWhitespace(c);
  return e;
}

// ---------------------------------------------------------------- semantic comparison

/**
 * Canonical form used by the round-trip tests: element names, attribute sets
 * (order-insensitive, as in XML), child order, and text. Whitespace-only text
 * between elements is formatting and is ignored; other text is compared exactly.
 */
export function canonical(e: XElement): unknown {
  const attrs = [...e.attrs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const kids: unknown[] = [];
  let buf = '';
  const flush = () => { if (buf.trim()) kids.push(buf); buf = ''; };
  for (const c of e.children) {
    if (c.type === 'text' || c.type === 'cdata') buf += c.value;
    else if (c.type === 'el') { flush(); kids.push(canonical(c)); }
  }
  flush();
  return [e.name, attrs, kids];
}
