"use client";

import { useEffect, useState } from "react";

const DB_NAME = "sheerly-kb-media-cache";
const DB_VERSION = 1;
const STORE_NAME = "audio-blobs";
const CACHE_VERSION = "v1";
const MAX_RECORDS = 40;
const MAX_BLOB_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 350 * 1024 * 1024;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type AudioRecord = {
  key: string;
  blob: Blob;
  createdAt: number;
  byteSize: number;
};

type AudioCacheState =
  | { status: "idle"; url: null }
  | { status: "loading"; url: null }
  | { status: "ready"; url: string }
  | { status: "error"; url: string };

export function useCachedAudioBlobUrl({
  storagePath,
  sourceUrl,
}: {
  storagePath: string | null;
  sourceUrl: string | null;
}): AudioCacheState {
  const [state, setState] = useState<AudioCacheState>({
    status: "idle",
    url: null,
  });

  useEffect(() => {
    if (!storagePath || !sourceUrl || !canUseAudioCache()) {
      setState(
        sourceUrl
          ? { status: "error", url: sourceUrl }
          : { status: "idle", url: null },
      );
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const key = `${CACHE_VERSION}:${storagePath}`;
    setState({ status: "loading", url: null });

    void getOrCreateAudioBlob(key, sourceUrl)
      .then((blob) => {
        if (!blob) throw new Error("audio unavailable");
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setState({ status: "ready", url });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", url: sourceUrl });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storagePath, sourceUrl]);

  return state;
}

function canUseAudioCache(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof indexedDB !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof fetch === "function"
  );
}

async function getOrCreateAudioBlob(
  key: string,
  sourceUrl: string,
): Promise<Blob | null> {
  const db = await openDb();
  const cached = await readRecord(db, key);
  if (cached && Date.now() - cached.createdAt < MAX_AGE_MS) {
    return cached.blob;
  }

  const response = await fetch(sourceUrl, { cache: "force-cache" });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.type.startsWith("audio/") || blob.size > MAX_BLOB_BYTES) {
    return null;
  }

  const record: AudioRecord = {
    key,
    blob,
    createdAt: Date.now(),
    byteSize: blob.size,
  };
  await writeRecord(db, record);
  void cleanupOldRecords(db).catch(() => {});
  return blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function readRecord(
  db: IDBDatabase,
  key: string,
): Promise<AudioRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result as AudioRecord | undefined) ?? null);
  });
}

function writeRecord(db: IDBDatabase, record: AudioRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).put(record);
  });
}

async function cleanupOldRecords(db: IDBDatabase): Promise<void> {
  const records = await readAllRecords(db);
  const now = Date.now();
  const staleKeys = records
    .filter((r) => now - r.createdAt > MAX_AGE_MS)
    .map((r) => r.key);
  const overflowKeys = records
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(MAX_RECORDS)
    .map((r) => r.key);
  const newestFirst = [...records].sort((a, b) => b.createdAt - a.createdAt);
  let totalBytes = 0;
  const quotaKeys: string[] = [];
  for (const record of newestFirst) {
    totalBytes += record.byteSize;
    if (totalBytes > MAX_TOTAL_BYTES) quotaKeys.push(record.key);
  }
  const keys = Array.from(new Set([...staleKeys, ...overflowKeys, ...quotaKeys]));
  if (keys.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readAllRecords(db: IDBDatabase): Promise<AudioRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result as AudioRecord[]) ?? []);
  });
}
