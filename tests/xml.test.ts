import { describe, expect, it } from 'vitest';
import { canonical, childText, parseXml, serializeXml } from '../src/xml/xml';

const roundTrip = (s: string, pretty = false) => {
  const a = parseXml(s);
  const out = serializeXml(a.doc, { pretty });
  const b = parseXml(out);
  expect(b.warnings).toEqual([]);
  expect(canonical(b.doc.root)).toEqual(canonical(a.doc.root));
  return { a, out };
};

describe('xml parser/serializer', () => {
  it('round-trips a well-formed file byte-for-byte when not pretty-printing', () => {
    const src = '<?xml version="1.0" encoding="UTF-8"?>\n<compendium version="5" auto_indent="NO">\n  <spell>\n    <name>A &amp; B</name>\n    <text>line one\nline two</text>\n    <x-unknown foo="1"><deep/></x-unknown>\n  </spell>\n</compendium>';
    const { a, out } = roundTrip(src);
    expect(a.warnings).toEqual([]);
    expect(out).toBe(src);
  });

  it('preserves unknown elements, attributes, comments and CDATA', () => {
    const src = '<compendium><!-- note --><homebrew a="1" b="2"><![CDATA[<b>bold</b>]]></homebrew></compendium>';
    const { out } = roundTrip(src);
    expect(out).toContain('<!-- note -->');
    expect(out).toContain('<![CDATA[<b>bold</b>]]>');
    expect(out).toContain('a="1" b="2"');
  });

  it('tolerates bare ampersands and HTML entities with warnings', () => {
    const r = parseXml('<c><name>Salt & Pepper&nbsp;x</name></c>');
    expect(childText(r.doc.root, 'name')).toBe('Salt & Pepper x');
    expect(r.warnings.length).toBe(2);
    expect(serializeXml(r.doc)).toContain('Salt &amp; Pepper');
  });

  it('recovers from mismatched and unclosed tags', () => {
    const r = parseXml('<c><item><name>Rope</item><item><name>Torch</name>');
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.doc.root.children.filter((c) => c.type === 'el').length).toBe(2);
  });

  it('handles a BOM and stray < in text', () => {
    const r = parseXml('﻿<c><text>AC < 15</text></c>');
    expect(childText(r.doc.root, 'text')).toBe('AC < 15');
    roundTrip(serializeXml(r.doc));
  });

  it('pretty printing never changes text content', () => {
    const src = '<c><a><b>  keep  spaces\n</b></a><t>mixed <i>inline</i> text</t></c>';
    const { out } = roundTrip(src, true);
    expect(out).toContain('<b>  keep  spaces\n</b>');
    expect(out).toContain('<t>mixed <i>inline</i> text</t>');
  });

  it('escapes attribute newlines and drops invalid control characters on write', () => {
    const r = parseXml('<c a="x"/>');
    r.doc.root.attrs[0][1] = 'one\ntwo"\u0001';
    const out = serializeXml(r.doc);
    expect(out).toContain('a="one&#10;two&quot;"');
  });
});
