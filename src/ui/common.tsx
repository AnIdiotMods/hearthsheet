import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import type { Library } from '../model/compendium';
import type { CreatorKind } from '../model/homebrew';
import type { XElement } from '../xml/xml';
import type { AppState, Character } from '../model/character';
import type { RulesOptions } from '../rules/derive';
import { isRollable, RollResult } from '../rules/dice';
import { ask, tell } from './dialogs';
import { useBackHandler } from './back';

export interface Ctx {
  lib: Library;
  options: RulesOptions;
  roll: (expr: string, label?: string) => RollResult | null;
  log: RollResult[];
  toast: (msg: string) => void;
  /** Save text to a file the player picks, reporting the result. */
  exportText: (fileName: string, text: string) => void;
  /** The "My homebrew" compendium file the Creator writes to. */
  homebrew: {
    xml: string;
    /** Add an entry, or replace the one named `previousName`. */
    save: (e: XElement, previousName?: string) => Promise<void>;
    remove: (kind: CreatorKind, name: string) => Promise<void>;
    exportFile: () => void;
  };
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
  useBackHandler(true, onClose);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
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

/** A "details" link that shows a feature's full text in place (tooltips do not work on touch screens). */
export function TextToggle({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <>
      <button type="button" className="link small details-link" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}>{open ? 'hide' : 'details'}</button>
      {open && <div className="feature-text"><RichText text={text} label={label} /></div>}
    </>
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
export const confirmOverLimit = (what: string): Promise<boolean> =>
  ask(`${what}\n\nThis goes past the usual rules limit. You can do it anyway (house rules, or with your DM's permission); the character will be tagged "too high" in the character list.`,
    { title: 'Past the usual limit', ok: 'Do it anyway', cancel: 'Cancel' });

/** Red "too high" tag listing the limits a character goes past. */
export function TooHighTag({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <button type="button" className="tag too-high" title={`Past the usual limits:\n${items.join('\n')}`}
      onClick={(e) => { e.stopPropagation(); void tell(items.join('\n'), { title: 'Past the usual limits' }); }}>too high</button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

/**
 * A text field for stored text that is tidied when read back (trimmed, or "Unnamed" when empty). While
 * the player types, it shows exactly what they typed, so a space before the next word is not removed.
 */
export function TextInput({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void }
  & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input {...rest} value={draft ?? value}
      onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }}
      onBlur={(e) => { setDraft(null); rest.onBlur?.(e); }} />
  );
}

export function NumberInput({ value, onChange, min, max, className, ariaLabel }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; className?: string; ariaLabel?: string;
}) {
  // While typing, keep the text as typed (it may be empty or just "-"); a valid number is applied as
  // soon as it is typed, and anything else goes back to the current value when the field loses focus.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Number.isFinite(value) ? value : 0);
  return (
    <input type="number" inputMode={min !== undefined && min >= 0 ? 'numeric' : undefined} className={className} value={shown}
      min={min} max={max} aria-label={ariaLabel}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(max !== undefined ? Math.min(max, min !== undefined ? Math.max(min, n) : n) : min !== undefined ? Math.max(min, n) : n);
      }}
      onBlur={() => setDraft(null)} />
  );
}
