// Custom trackers: counters the user defines on the sheet (ki points, luck,
// arrows, charges, ...). Stored as <tracker> elements inside <character> so
// they travel with the file:
//
//   <tracker><name>Luck</name><max>3</max><value>2</value><reset>L</reset></tracker>
//
// <max> may be a formula using the character's numbers (PROF, LVL, STR..CHA,
// SPELL, %0-%10). <reset> is S (short rest), L (long rest) or empty (manual).
// This is a Hearthsheet extension; other apps are expected to ignore it.

import { XElement, childText, el, setChildText } from '../xml/xml';
import { FormulaContext, resolveFormula } from '../rules/dice';
import { sumExpression } from './creature';

export const TRACKER_TAG = 'tracker';
export type TrackerReset = 'S' | 'L' | '';
export const RESET_LABEL: Record<TrackerReset, string> = { S: 'Short or long rest', L: 'Long rest', '': 'Manual' };

export interface TrackerDef { name: string; max: string; reset: TrackerReset }

export function newTracker(def: TrackerDef): XElement {
  const t = el(TRACKER_TAG);
  t.children.push(el('name', def.name), el('max', def.max));
  if (def.reset) t.children.push(el('reset', def.reset));
  return t;
}

/** The maximum, resolved against the character; null when the formula cannot be read. */
export function trackerMax(t: XElement, ctx: FormulaContext): number | null {
  const raw = childText(t, 'max');
  const n = sumExpression(resolveFormula(raw, ctx));
  return n === null ? null : Math.max(0, n);
}

export function trackerValue(t: XElement, ctx: FormulaContext): number {
  const max = trackerMax(t, ctx);
  const v = parseInt(childText(t, 'value'), 10);
  const value = Number.isFinite(v) ? v : (max ?? 0);
  return max === null ? Math.max(0, value) : Math.max(0, Math.min(max, value));
}

export function setTrackerValue(t: XElement, v: number, ctx: FormulaContext) {
  const max = trackerMax(t, ctx);
  const clamped = Math.max(0, max === null ? v : Math.min(max, v));
  // A full tracker needs no stored value: it follows its maximum as that changes.
  setChildText(t, 'value', max !== null && clamped === max ? '' : String(clamped));
}

export function updateTracker(t: XElement, def: TrackerDef) {
  setChildText(t, 'name', def.name);
  setChildText(t, 'max', def.max);
  setChildText(t, 'reset', def.reset);
}

export const trackerDef = (t: XElement): TrackerDef => ({
  name: childText(t, 'name'), max: childText(t, 'max'), reset: (childText(t, 'reset').toUpperCase().slice(0, 1) as TrackerReset) || '',
});

/** Refill trackers on a rest: a short rest refills S trackers, a long rest refills S and L. */
export function restTrackers(trackers: XElement[], rest: 'short' | 'long') {
  for (const t of trackers) {
    const r = trackerDef(t).reset;
    if (r === 'S' || (r === 'L' && rest === 'long')) setChildText(t, 'value', '');
  }
}
