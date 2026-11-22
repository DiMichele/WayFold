import { planInboxInsert, type InboxMeta } from "./inbox.ts";
import { normalizePolicy, type DiodePolicy } from "./policy.ts";

const DB_NAME = "wayfold-diode";
const DB_VERSION = 1;
const LOG_LIMIT = 500;

export interface QueueItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  data: Blob;
  addedAt: number;
}

export interface InboxItem extends InboxMeta {
  name: string;
  mime: string;
  data: Blob;
}

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id?: number;
  ts: number;
  level: LogLevel;
  key: string;
  params: Record<string, string | number>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
      if (!db.objectStoreNames.contains("inbox")) db.createObjectStore("inbox", { keyPath: "sha" });
      if (!db.objectStoreNames.contains("log")) {
        db.createObjectStore("log", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

export async function listQueue(): Promise<QueueItem[]> {
  const db = await open();
  const items = await promisify(db.transaction("queue").objectStore("queue").getAll() as IDBRequest<QueueItem[]>);
  return items.sort((a, b) => a.addedAt - b.addedAt);
}

export async function addQueueItem(item: QueueItem): Promise<void> {
  const db = await open();
  const tx = db.transaction("queue", "readwrite");
  tx.objectStore("queue").put(item);
  await done(tx);
}

export async function removeQueueItem(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction("queue", "readwrite");
  tx.objectStore("queue").delete(id);
  await done(tx);
}

export async function loadPolicy(): Promise<DiodePolicy> {
  const db = await open();
  const raw = await promisify(
    db.transaction("settings").objectStore("settings").get("policy") as IDBRequest<Partial<DiodePolicy> | undefined>,
  );
  return normalizePolicy(raw);
}

export async function savePolicy(policy: DiodePolicy): Promise<DiodePolicy> {
  const clean = normalizePolicy(policy);
  const db = await open();
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put(clean, "policy");
  await done(tx);
  return clean;
}

export async function appendLog(entry: Omit<LogEntry, "id">): Promise<void> {
  const db = await open();
  const tx = db.transaction("log", "readwrite");
  const store = tx.objectStore("log");
  store.add(entry);
  const countReq = store.count();
  countReq.onsuccess = () => {
    let excess = countReq.result - LOG_LIMIT;
    if (excess <= 0) return;
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || excess <= 0) return;
      cursor.delete();
      excess--;
      cursor.continue();
    };
  };
  await done(tx);
}

export async function listLog(): Promise<LogEntry[]> {
  const db = await open();
  const items = await promisify(db.transaction("log").objectStore("log").getAll() as IDBRequest<LogEntry[]>);
  return items.reverse();
}

export async function clearLog(): Promise<void> {
  const db = await open();
  const tx = db.transaction("log", "readwrite");
  tx.objectStore("log").clear();
  await done(tx);
}

export async function listInbox(): Promise<InboxItem[]> {
  const db = await open();
  const items = await promisify(db.transaction("inbox").objectStore("inbox").getAll() as IDBRequest<InboxItem[]>);
  return items.sort((a, b) => b.receivedAt - a.receivedAt);
}

/** Returns false when the same content is already in the inbox. */
export async function putInbox(item: InboxItem): Promise<boolean> {
  const db = await open();
  const tx = db.transaction("inbox", "readwrite");
  const finished = done(tx);
  const store = tx.objectStore("inbox");
  const existing = await promisify(store.getAll() as IDBRequest<InboxItem[]>);
  const plan = planInboxInsert(existing, item);
  if (!plan.duplicate) {
    for (const sha of plan.evict) store.delete(sha);
    store.put(item);
  }
  await finished;
  return !plan.duplicate;
}

export async function removeInbox(sha: string): Promise<void> {
  const db = await open();
  const tx = db.transaction("inbox", "readwrite");
  tx.objectStore("inbox").delete(sha);
  await done(tx);
}
