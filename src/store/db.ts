// Local persistence in IndexedDB: imported compendium files (stored as the
// original XML text) and characters (XML plus app-only state).

import type { CompendiumFile } from '../model/compendium';
import { CharacterRecord, emptyAppState } from '../model/character';

const DB_NAME = 'hearthsheet';
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const newId = () => crypto.randomUUID();

export async function listFiles(): Promise<CompendiumFile[]> {
  const all = await tx<CompendiumFile[]>('files', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.importedAt - b.importedAt);
}
export const putFile = (f: CompendiumFile) => tx('files', 'readwrite', (s) => s.put(f));
export const deleteFile = (id: string) => tx('files', 'readwrite', (s) => s.delete(id));

export async function listCharacters(): Promise<CharacterRecord[]> {
  const all = await tx<CharacterRecord[]>('characters', 'readonly', (s) => s.getAll());
  return all.map((r) => ({ ...r, app: { ...emptyAppState(), ...r.app } })).sort((a, b) => b.updatedAt - a.updatedAt);
}
export const putCharacter = (r: CharacterRecord) => tx('characters', 'readwrite', (s) => s.put(r));
export const deleteCharacter = (id: string) => tx('characters', 'readwrite', (s) => s.delete(id));

// ---- small settings in localStorage (may be unavailable; never required)
export function loadSetting<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`hearthsheet.${key}`);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch { return fallback; }
}
export function saveSetting(key: string, value: unknown) {
  try { localStorage.setItem(`hearthsheet.${key}`, JSON.stringify(value)); } catch { /* ignore */ }
}

// ---- file helpers
export async function readFiles(accept: string, multiple = true): Promise<{ name: string; text: string }[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
    };
    input.click();
  });
}

export function downloadText(fileName: string, text: string, type = 'application/xml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';
