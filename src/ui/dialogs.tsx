// In-app confirmation and message dialogs. The browser's own confirm() and alert() behave
// differently (or not at all) in the Android, iOS, macOS, Windows and Linux webviews, so every
// question the app asks goes through these instead and looks the same everywhere.

import { useEffect, useRef, useState } from 'react';
import { useBackHandler } from './back';

interface Request {
  kind: 'confirm' | 'alert';
  message: string;
  title?: string;
  ok?: string;
  cancel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let enqueue: ((r: Request) => void) | null = null;

export interface AskOptions { title?: string; ok?: string; cancel?: string; danger?: boolean }

/** Ask a yes/no question. Resolves true when the player confirms. */
export function ask(message: string, opts: AskOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!enqueue) { resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : false); return; }
    enqueue({ kind: 'confirm', message, ...opts, resolve });
  });
}

/** Show a message with an OK button. */
export function tell(message: string, opts: { title?: string } = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!enqueue) { if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(message); resolve(); return; }
    enqueue({ kind: 'alert', message, ...opts, resolve: () => resolve() });
  });
}

/** Renders queued dialogs; mount once at the root of the app. */
export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    enqueue = (r) => setQueue((q) => [...q, r]);
    return () => { enqueue = null; };
  }, []);
  const current = queue[0];
  useBackHandler(!!current, () => close(current?.kind === 'alert'));
  const close = (ok: boolean) => {
    if (!current) return;
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  };
  useEffect(() => {
    if (!current) return;
    okRef.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(current.kind === 'alert'); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });
  if (!current) return null;
  const paragraphs = current.message.split(/\n{2,}/);
  return (
    <div className="modal-backdrop dialog-backdrop">
      <div className="modal dialog" role="alertdialog" aria-modal="true" aria-label={current.title ?? (current.kind === 'confirm' ? 'Confirm' : 'Message')}>
        {current.title && <header><h2>{current.title}</h2></header>}
        <div className="modal-body">
          {paragraphs.map((p, i) => <p key={i} className="dialog-text">{p}</p>)}
        </div>
        <footer className="modal-actions">
          <span className="spacer" />
          {current.kind === 'confirm' && <button onClick={() => close(false)}>{current.cancel ?? 'Cancel'}</button>}
          <button ref={okRef} className={current.danger ? 'primary danger-fill' : 'primary'} onClick={() => close(true)}>{current.ok ?? 'OK'}</button>
        </footer>
      </div>
    </div>
  );
}
