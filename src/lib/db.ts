import type { PeakState, StoredCurve } from '../types'

/**
 * IndexedDB 本地持久化：保存原始曲线与复核方法（积分区间、基线、平滑参数）。
 * 无任何服务端参与。数据库结构：
 *   chrom-review / curves : { id, name, points, state, savedAt }
 *   chrom-review / meta   : { key: 'lastOpenId', value }
 */

const DB_NAME = 'chrom-review'
const DB_VERSION = 1
const STORE = 'curves'
const META_STORE = 'meta'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode)
    const req = run(t.objectStore(storeName))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function listCurves(): Promise<StoredCurve[]> {
  const db = await openDB()
  try {
    const all = await tx<StoredCurve[]>(db, STORE, 'readonly', (s) => s.getAll() as IDBRequest<StoredCurve[]>)
    return all.sort((a, b) => b.savedAt - a.savedAt)
  } finally {
    db.close()
  }
}

export async function saveCurve(id: string, name: string, points: StoredCurve['points'], state: PeakState): Promise<void> {
  const db = await openDB()
  try {
    const record: StoredCurve = { id, name, points, state, savedAt: Date.now() }
    await tx(db, STORE, 'readwrite', (s) => s.put(record))
    await tx(db, META_STORE, 'readwrite', (s) => s.put({ key: 'lastOpenId', value: id }))
  } finally {
    db.close()
  }
}

export async function deleteCurve(id: string): Promise<void> {
  const db = await openDB()
  try {
    await tx(db, STORE, 'readwrite', (s) => s.delete(id))
  } finally {
    db.close()
  }
}

export async function getLastOpenId(): Promise<string | null> {
  const db = await openDB()
  try {
    const row = await tx<{ key: string; value: string } | undefined>(db, META_STORE, 'readonly', (s) =>
      s.get('lastOpenId') as IDBRequest<{ key: string; value: string } | undefined>
    )
    return row?.value ?? null
  } finally {
    db.close()
  }
}
