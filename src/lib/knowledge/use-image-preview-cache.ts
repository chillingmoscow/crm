"use client";

import { useEffect, useState } from "react";

const DB_NAME = "sheerly-kb-media-cache";
const DB_VERSION = 1;
const STORE_NAME = "image-previews";
const CACHE_VERSION = "v1";
const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 0.72;
const MAX_RECORDS = 120;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type PreviewRecord = {
  key: string;
  blob: Blob;
  createdAt: number;
  byteSize: number;
};

type PreviewState =
  | { status: "idle"; url: null; revoke: false }
  | { status: "loading"; url: null; revoke: false }
  | { status: "ready"; url: string; revoke: true }
  | { status: "error"; url: string; revoke: false };

export function useCachedImagePreviewUrl({
  storagePath,
  sourceUrl,
}: {
  storagePath: string | null;
  sourceUrl: string | null;
}): PreviewState {
  const [state, setState] = useState<PreviewState>({
    status: "idle",
    url: null,
    revoke: false,
  });

  useEffect(() => {
    if (!storagePath || !sourceUrl || !canUsePreviewCache()) {
      setState(
        sourceUrl
          ? { status: "error", url: sourceUrl, revoke: false }
          : { status: "idle", url: null, revoke: false },
      );
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const key = `${CACHE_VERSION}:${MAX_DIMENSION}:${storagePath}`;
    setState({ status: "loading", url: null, revoke: false });

    void getOrCreatePreviewBlob(key, sourceUrl)
      .then((blob) => {
        if (!blob) throw new Error("preview unavailable");
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setState({ status: "ready", url, revoke: true });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error", url: sourceUrl, revoke: false });
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storagePath, sourceUrl]);

  return state;
}

function canUsePreviewCache(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof indexedDB !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof fetch === "function" &&
    typeof createImageBitmap === "function"
  );
}

async function getOrCreatePreviewBlob(
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
  const original = await response.blob();
  if (!isCompressibleImage(original.type)) return null;

  const preview = await createPreviewBlob(original);
  if (!preview) return null;

  const record: PreviewRecord = {
    key,
    blob: preview,
    createdAt: Date.now(),
    byteSize: preview.size,
  };
  await writeRecord(db, record);
  void cleanupOldRecords(db).catch(() => {});
  return preview;
}

function isCompressibleImage(type: string): boolean {
  if (!type.startsWith("image/")) return false;
  return type !== "image/svg+xml" && type !== "image/gif";
}

async function createPreviewBlob(original: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(original, {
    imageOrientation: "from-image",
  });
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return (
      (await canvasToBlob(canvas, "image/webp", WEBP_QUALITY)) ??
      (await canvasToBlob(canvas, "image/jpeg", 0.78))
    );
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
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
): Promise<PreviewRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result as PreviewRecord | undefined) ?? null);
  });
}

function writeRecord(db: IDBDatabase, record: PreviewRecord): Promise<void> {
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
  const keys = Array.from(new Set([...staleKeys, ...overflowKeys]));
  if (keys.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readAllRecords(db: IDBDatabase): Promise<PreviewRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result as PreviewRecord[]) ?? []);
  });
}
