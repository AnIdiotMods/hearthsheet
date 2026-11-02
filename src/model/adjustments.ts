// Hand edits to derived numbers, as a Hearthsheet extension element inside <character>:
//   <adjustments><acSet>17</acSet><acBonus>1</acBonus><initiativeSet/><initiativeBonus>2</initiativeBonus></adjustments>
// "Set" replaces the calculated value; "Bonus" is added on top of it (or of the set value).

import { XElement, child, childText, el, setChildText } from '../xml/xml';

export type AdjustedStat = 'ac' | 'initiative';
export interface Adjustment { set: number | null; bonus: number }

const int = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; };

export function adjustmentOf(ch: XElement, stat: AdjustedStat): Adjustment {
  const a = child(ch, 'adjustments');
  return { set: a ? int(childText(a, `${stat}Set`)) : null, bonus: a ? int(childText(a, `${stat}Bonus`)) ?? 0 : 0 };
}

export function setAdjustment(ch: XElement, stat: AdjustedStat, v: Adjustment, insert: (e: XElement) => void) {
  let a = child(ch, 'adjustments');
  if (!a) { a = el('adjustments'); insert(a); }
  setChildText(a, `${stat}Set`, v.set === null ? '' : String(v.set));
  setChildText(a, `${stat}Bonus`, v.bonus ? String(v.bonus) : '');
  if (!a.children.some((c) => c.type === 'el')) ch.children.splice(ch.children.indexOf(a), 1);
}

/** Apply an adjustment to a calculated value, with a note for the tooltip. */
export function applyAdjustment(calculated: number, adj: Adjustment): { value: number; notes: string[] } {
  const notes: string[] = [];
  let value = calculated;
  if (adj.set !== null) { value = adj.set; notes.push(`Set by hand to ${adj.set} (calculated ${calculated})`); }
  if (adj.bonus) { value += adj.bonus; notes.push(`Your bonus ${adj.bonus > 0 ? '+' : ''}${adj.bonus}`); }
  return { value, notes };
}
