// Local persistence in IndexedDB: imported compendium files (stored as the
// original XML text) and characters (XML plus app-only state).

import type { CompendiumFile } from '../model/compendium';
import { CharacterRecord, emptyAppState } from '../model/character';
import { decodeText, pickFiles, saveTextFile } from '../platform';

const DB_NAME = 'hearthsheet';
const VERSION = 2;

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' });
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
/** A font file the user imported (TTF, OTF, WOFF or WOFF2). */
export interface StoredFont { id: string; name: string; fileName: string; data: ArrayBuffer; addedAt: number }
export async function listFonts(): Promise<StoredFont[]> {
  const all = await tx<StoredFont[]>('fonts', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.addedAt - b.addedAt);
}
export const putFont = (f: StoredFont) => tx('fonts', 'readwrite', (s) => s.put(f));
export const deleteFont = (id: string) => tx('fonts', 'readwrite', (s) => s.delete(id));

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

// ---- file helpers (native dialogs in the app, file inputs and downloads in a browser)
const extensionsOf = (accept: string) => [...new Set(accept.split(',').map((x) => x.trim()).filter((x) => x.startsWith('.')).map((x) => x.slice(1).toLowerCase()))];

export async function readFiles(accept: string, multiple = true): Promise<{ name: string; text: string }[]> {
  const files = await pickFiles('XML files', extensionsOf(accept), multiple);
  return files.map((f) => ({ name: f.name, text: decodeText(f.data) }));
}

export async function readBinaryFiles(accept: string, multiple = true): Promise<{ name: string; data: ArrayBuffer }[]> {
  const files = await pickFiles('Fonts', extensionsOf(accept), multiple);
  return files.map((f) => ({ name: f.name, data: f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer }));
}

/** Save text to a file; returns false when the player cancels the save dialog. */
export const downloadText = (fileName: string, text: string): Promise<boolean> => saveTextFile(fileName, text);

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';
