import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Character, emptyAppState } from '../src/model/character';
import { newTracker, restTrackers, setTrackerValue, trackerDef, trackerMax, trackerValue, updateTracker } from '../src/model/tracker';
import { deriveSheet } from '../src/rules/derive';
import { canonical, childText, elements, parseXml } from '../src/xml/xml';

const sample = readFileSync(new URL('./fixtures/sample-character.xml', import.meta.url), 'utf8');
const ctx = { abilityMods: [3, 2, 2, 1, 0, -1], spellMod: 0, prof: 2, level: 1, hpCurrent: 12 };

describe('custom trackers', () => {
  it('start full, clamp to the maximum and to zero', () => {
    const t = newTracker({ name: 'Luck', max: '3', reset: 'L' });
    expect(trackerValue(t, ctx)).toBe(3);
    setTrackerValue(t, 1, ctx);
    expect(trackerValue(t, ctx)).toBe(1);
    setTrackerValue(t, 9, ctx);
    expect(trackerValue(t, ctx)).toBe(3);
    expect(childText(t, 'value')).toBe(''); // full trackers follow their maximum
    setTrackerValue(t, -4, ctx);
    expect(trackerValue(t, ctx)).toBe(0);
  });

  it('maximums can be formulas over the character\'s numbers', () => {
    expect(trackerMax(newTracker({ name: 'A', max: 'PROF', reset: '' }), ctx)).toBe(2);
    expect(trackerMax(newTracker({ name: 'B', max: '1+STR', reset: '' }), ctx)).toBe(4);
    expect(trackerMax(newTracker({ name: 'C', max: '2*PROF', reset: '' }), ctx)).toBe(4);
    expect(trackerMax(newTracker({ name: 'E', max: 'lots', reset: '' }), ctx)).toBeNull();
    expect(trackerMax(newTracker({ name: 'D', max: 'CHA', reset: '' }), ctx)).toBe(0); // never negative
    const full = newTracker({ name: 'Ki', max: 'LVL', reset: 'S' });
    expect(trackerValue(full, { ...ctx, level: 5 })).toBe(5); // grows with the character
  });

  it('refill on the right rests', () => {
    const s = newTracker({ name: 'Short', max: '2', reset: 'S' });
    const l = newTracker({ name: 'Long', max: '2', reset: 'L' });
    const m = newTracker({ name: 'Manual', max: '2', reset: '' });
    for (const t of [s, l, m]) setTrackerValue(t, 0, ctx);
    restTrackers([s, l, m], 'short');
    expect([s, l, m].map((t) => trackerValue(t, ctx))).toEqual([2, 0, 0]);
    restTrackers([s, l, m], 'long');
    expect([s, l, m].map((t) => trackerValue(t, ctx))).toEqual([2, 2, 0]);
  });

  it('can be edited, are stored in the file and leave the sheet unchanged', () => {
    const c = Character.parse(sample);
    const before = deriveSheet(c, emptyAppState());
    const t = c.insert(newTracker({ name: 'Arrows', max: '20', reset: '' }));
    setTrackerValue(t, 14, ctx);
    updateTracker(t, { name: 'Arrows (quiver)', max: '30', reset: '' });
    expect(trackerDef(t)).toEqual({ name: 'Arrows (quiver)', max: '30', reset: '' });
    const again = Character.parse(c.serialize());
    expect(again.trackers.length).toBe(1);
    expect(trackerValue(again.trackers[0], ctx)).toBe(14);
    const tags = elements(again.ch).map((e) => e.name);
    expect(tags.indexOf('tracker')).toBeGreaterThan(tags.indexOf('hpCurrent'));
    expect(deriveSheet(again, emptyAppState()).ac).toBe(before.ac);
    expect(canonical(parseXml(again.serialize()).doc.root)).toEqual(canonical(parseXml(c.serialize()).doc.root));
  });
});
