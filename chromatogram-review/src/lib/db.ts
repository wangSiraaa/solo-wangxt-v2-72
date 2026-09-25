import { openDB, type IDBPDatabase } from 'idb';
import type { CurveData, SavedMethod } from '../types';

const DB_NAME = 'chromatogram-review';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('curves')) {
          d.createObjectStore('curves', { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains('methods')) {
          d.createObjectStore('methods', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function putCurve(curve: CurveData): Promise<void> {
  const d = await db();
  if (d) await d.put('curves', curve);
}

export async function getCurve(id: string): Promise<CurveData | undefined> {
  const d = await db();
  return d ? d.get('curves', id) : undefined;
}

export async function listCurves(): Promise<CurveData[]> {
  const d = await db();
  return d ? d.getAll('curves') : [];
}

export async function removeCurve(id: string): Promise<void> {
  const d = await db();
  if (d) await d.delete('curves', id);
}

export async function putMethod(method: SavedMethod): Promise<void> {
  const d = await db();
  if (d) await d.put('methods', method);
}

export async function listMethods(): Promise<SavedMethod[]> {
  const d = await db();
  return d ? d.getAll('methods') : [];
}

export async function removeMethod(id: string): Promise<void> {
  const d = await db();
  if (d) await d.delete('methods', id);
}
