// The system Back button (Android), back gesture (iOS/Android) and the browser's Back button close
// the topmost window or leave the open screen, instead of leaving the app.
//
// Open windows and screens register a handler. While any handler is registered, one extra
// "guard" history entry exists; Back consumes it, the newest handler runs, and the guard is put
// back if handlers remain. Changes are applied once per tick, so closing one window and opening
// another in the same moment never leaves the history out of step.

import { useEffect, useRef } from 'react';

const handlers: { id: number; fn: () => void }[] = [];
let nextId = 1;
let guard = false;
let ignorePops = 0;
let scheduled = false;
let listening = false;

function sync() {
  scheduled = false;
  if (handlers.length && !guard) { window.history.pushState({ hearthsheet: true }, ''); guard = true; }
  else if (!handlers.length && guard) { guard = false; ignorePops++; window.history.back(); }
}
const schedule = () => { if (!scheduled) { scheduled = true; setTimeout(sync, 0); } };

function onPop() {
  if (ignorePops > 0) { ignorePops--; return; }
  guard = false;
  const top = handlers.pop();
  top?.fn();
  schedule();
}

/** While `active`, Back calls `onBack` (which should close whatever registered it). */
export function useBackHandler(active: boolean, onBack: () => void) {
  const fnRef = useRef(onBack);
  fnRef.current = onBack;
  useEffect(() => {
    if (!active || typeof window === 'undefined' || !window.history?.pushState) return;
    if (!listening) { window.addEventListener('popstate', onPop); listening = true; }
    const id = nextId++;
    handlers.push({ id, fn: () => fnRef.current() });
    schedule();
    return () => {
      const i = handlers.findIndex((h) => h.id === id);
      if (i >= 0) handlers.splice(i, 1);
      schedule();
    };
  }, [active]);
}
