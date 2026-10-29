// Dice expressions: "1d20+5", "2d6 + 1d4 - 1", "4d6kh3", "2d20kl1", "d%", "1d20+3 adv".

export interface DieTerm { sign: 1 | -1; count: number; sides: number; keep?: { hi: boolean; n: number }; rolls: number[]; kept: number[] }
export interface ConstTerm { sign: 1 | -1; value: number }
export interface RollResult { expression: string; total: number; terms: (DieTerm | ConstTerm)[]; text: string; label?: string; at: number }

export type Rng = (sides: number) => number;

export const cryptoRng: Rng = (sides) => {
  // Rejection sampling for an unbiased result.
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / sides) * sides;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return (buf[0] % sides) + 1;
  }
};

const TERM = /([+-])?\s*(?:(\d*)d(\d+|%)(?:(kh|kl|k)(\d+))?|(\d+))/gi;

export function isRollable(expr: string): boolean {
  return /^\s*([+-]?\s*(\d*d(\d+|%)((kh|kl|k)\d+)?|\d+)\s*)+(adv|dis|advantage|disadvantage)?\s*$/i.test(expr);
}

export function roll(expression: string, rng: Rng = cryptoRng, label?: string): RollResult {
  let expr = expression.trim();
  let adv: 'adv' | 'dis' | null = null;
  const advm = /\s+(adv|advantage|dis|disadvantage)$/i.exec(expr);
  if (advm) { adv = advm[1].toLowerCase().startsWith('adv') ? 'adv' : 'dis'; expr = expr.slice(0, advm.index); }
  if (!isRollable(expr)) throw new Error(`Cannot roll "${expression}"`);
  const terms: (DieTerm | ConstTerm)[] = [];
  let first = true;
  for (const m of expr.matchAll(TERM)) {
    const sign = m[1] === '-' ? -1 : 1;
    if (!first && !m[1]) throw new Error(`Missing operator in "${expression}"`);
    first = false;
    if (m[6] !== undefined) { terms.push({ sign, value: +m[6] }); continue; }
    let count = m[2] ? +m[2] : 1;
    const sides = m[3] === '%' ? 100 : +m[3];
    if (count > 1000 || sides < 1 || sides > 1000) throw new Error('Too many dice');
    let keep = m[4] ? { hi: m[4].toLowerCase() !== 'kl', n: +m[5] } : undefined;
    if (adv && sides === 20 && count === 1 && !keep) { count = 2; keep = { hi: adv === 'adv', n: 1 }; adv = null; }
    const rolls = Array.from({ length: count }, () => rng(sides));
    let kept = rolls;
    if (keep) {
      const order = rolls.map((v, i) => [v, i]).sort((a, b) => (keep!.hi ? b[0] - a[0] : a[0] - b[0]));
      const keepIdx = new Set(order.slice(0, keep.n).map(([, i]) => i));
      kept = rolls.filter((_, i) => keepIdx.has(i));
    }
    terms.push({ sign, count, sides, keep, rolls, kept });
  }
  const total = terms.reduce((s, t) => s + t.sign * ('value' in t ? t.value : t.kept.reduce((a, b) => a + b, 0)), 0);
  const text = terms.map((t, i) => {
    const op = t.sign < 0 ? '- ' : i ? '+ ' : '';
    return op + ('value' in t ? String(t.value) : `[${t.rolls.join(', ')}]${t.keep ? (t.keep.hi ? ' high' : ' low') : ''}`);
  }).join(' ');
  return { expression: expression.trim(), total, terms, text, label, at: Date.now() };
}

/** "1d20" natural result if the roll is a single d20 check (for crit highlighting). */
export function naturalD20(r: RollResult): number | null {
  const d = r.terms.filter((t): t is DieTerm => 'sides' in t && t.sides === 20);
  if (d.length !== 1 || d[0].kept.length !== 1) return null;
  return d[0].kept[0];
}
