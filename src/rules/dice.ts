// Dice expressions: "1d20+5", "2d6 + 1d4 - 1", "4d6kh3", "2d20kl1", "d%", "1d20+3 adv".
// Compendium formulas may also carry placeholders, resolved by `resolveFormula`:
//   %0 spellcasting modifier, %1-%6 ability modifiers, %7 level, %8 proficiency bonus,
//   %9 current hit points, %10 half level; STR DEX CON INT WIS CHA SPELL PROF LVL.

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

export interface FormulaContext {
  abilityMods: number[];      // STR..CHA
  spellMod: number;
  prof: number;
  level: number;
  hpCurrent: number;
  weaponDamage?: string;      // for "1w"/"1o" (main/off hand weapon damage dice)
}

/** Replace placeholders with numbers; leaves unknown tokens so `isRollable` can reject them. */
export function resolveFormula(expr: string, ctx: FormulaContext): string {
  const names = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  let s = expr.trim().replace(/\s+/g, '').replace(/[×x]/g, '*');
  s = s.replace(/%(\d+)/g, (_, n: string) => {
    const i = +n;
    if (i === 0) return String(ctx.spellMod);
    if (i >= 1 && i <= 6) return String(ctx.abilityMods[i - 1] ?? 0);
    if (i === 7) return String(ctx.level);
    if (i === 8) return String(ctx.prof);
    if (i === 9) return String(ctx.hpCurrent);
    if (i === 10) return String(Math.floor(ctx.level / 2));
    return `%${n}`;
  });
  s = s.replace(/\b(STR|DEX|CON|INT|WIS|CHA|SPELL|PROF|LVL)\b/gi, (t) => {
    const u = t.toUpperCase();
    if (u === 'SPELL') return String(ctx.spellMod);
    if (u === 'PROF') return String(ctx.prof);
    if (u === 'LVL') return String(ctx.level);
    return String(ctx.abilityMods[names.indexOf(u)] ?? 0);
  });
  if (ctx.weaponDamage) s = s.replace(/\b1[wo]\b/gi, ctx.weaponDamage);
  // "(1d4+1)+(1d4+1)" → drop the parentheses; "+-3" → "-3".
  s = s.replace(/[()]/g, '').replace(/\+-/g, '-').replace(/--/g, '+');
  // "2*3" style multiplication of constants only.
  s = s.replace(/(\d+)\*(\d+)/g, (_, a, b) => String(+a * +b));
  return s;
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
