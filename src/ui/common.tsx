import { createContext, ReactNode, useContext, useEffect } from 'react';
import type { Library } from '../model/compendium';
import type { AppState, Character } from '../model/character';
import type { RulesOptions } from '../rules/derive';
import { isRollable, RollResult } from '../rules/dice';

export interface Ctx {
  lib: Library;
  options: RulesOptions;
  roll: (expr: string, label?: string) => RollResult | null;
  log: RollResult[];
  toast: (msg: string) => void;
}
export const AppContext = createContext<Ctx>(null!);

/** Apply an edit to the open character and save it. */
export type Mutate = (fn: (c: Character, a: AppState) => void) => void;
export const useApp = () => useContext(AppContext);

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="Close">×</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Renders entry text: paragraphs from newlines, inline dice expressions clickable. */
export function RichText({ text, label }: { text: string; label?: string }) {
  const { roll } = useApp();
  const paras = text.split(/\n+/).filter((p) => p.trim());
  return (
    <div className="rich">
      {paras.map((p, i) => (
        <p key={i}>
          {p.split(/(\b\d+d\d+(?:\s*[+-]\s*\d+)?\b)/g).map((part, j) =>
            j % 2 === 1 && isRollable(part)
              ? <button key={j} className="inline-roll" onClick={() => roll(part.replace(/\s+/g, ''), label)}>{part}</button>
              : <span key={j}>{part}</span>)}
        </p>
      ))}
    </div>
  );
}

export function RollChip({ expr, label, children }: { expr: string; label?: string; children?: ReactNode }) {
  const { roll } = useApp();
  return <button className="roll" title={`Roll ${expr}`} onClick={() => roll(expr, label)}>{children ?? expr}</button>;
}

export const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Ask before going past a rules limit (an ability above 20, more spells prepared than allowed, ...).
 * Going ahead is allowed, for house rules or a DM's permission; the character is then tagged "too high".
 */
export const confirmOverLimit = (what: string) =>
  window.confirm(`${what}\n\nThis goes past the usual rules limit. You can do it anyway (house rules, or with your DM's permission); the character will be tagged "too high" in the character list.\n\nContinue?`);

/** Red "too high" tag listing the limits a character goes past. */
export function TooHighTag({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <span className="tag too-high" title={`Past the usual limits:\n${items.join('\n')}`}>too high</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function NumberInput({ value, onChange, min, max, className }: { value: number; onChange: (n: number) => void; min?: number; max?: number; className?: string }) {
  return (
    <input type="number" className={className} value={Number.isFinite(value) ? value : 0} min={min} max={max}
      onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) onChange(n); }} />
  );
}
