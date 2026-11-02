// Movement speeds the player sets by hand: a walking speed that replaces the
// race's, a bonus on top, and other movement modes. Stored as a Hearthsheet
// extension element inside <character>:
//   <movement><walk>35</walk><bonus>10</bonus><fly>walk</fly><swim>30</swim><hover>1</hover></movement>
// "walk" as a value means "equal to your walking speed".

import { XElement, child, childText, el, setChildText } from '../xml/xml';

export const OTHER_SPEEDS = ['fly', 'swim', 'climb', 'burrow'] as const;
export type OtherSpeed = (typeof OTHER_SPEEDS)[number];

export interface Movement {
  /** Replaces the race's walking speed; null keeps it. */
  walk: number | null;
  /** Added to the walking speed after everything else. */
  bonus: number;
  /** A number of feet, "walk" (equal to the walking speed), or null (none). */
  other: Record<OtherSpeed, number | 'walk' | null>;
  hover: boolean;
}

const int = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; };

export function movementOf(ch: XElement): Movement {
  const m = child(ch, 'movement');
  const other = Object.fromEntries(OTHER_SPEEDS.map((k) => {
    const v = m ? childText(m, k).trim() : '';
    return [k, /^walk/i.test(v) ? 'walk' : int(v)];
  })) as Movement['other'];
  return {
    walk: m ? int(childText(m, 'walk')) : null,
    bonus: m ? int(childText(m, 'bonus')) ?? 0 : 0,
    other,
    hover: !!m && /^(1|yes|true)$/i.test(childText(m, 'hover')),
  };
}

/** Write the movement settings; an all-default value removes the element. */
export function setMovement(ch: XElement, mv: Movement, insert: (e: XElement) => void) {
  let m = child(ch, 'movement');
  if (!m) { m = el('movement'); insert(m); }
  setChildText(m, 'walk', mv.walk === null ? '' : String(mv.walk));
  setChildText(m, 'bonus', mv.bonus ? String(mv.bonus) : '');
  for (const k of OTHER_SPEEDS) {
    const v = mv.other[k];
    setChildText(m, k, v === null ? '' : String(v));
  }
  setChildText(m, 'hover', mv.hover ? '1' : '');
  if (!m.children.some((c) => c.type === 'el')) ch.children.splice(ch.children.indexOf(m), 1);
}
