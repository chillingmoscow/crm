"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level store для отслеживания фоновых upload'ов файлов в KB-
 * blocknote-редакторе. Юзер-фидбек: «при загрузке файлов показывать
 * статус-бар, скрывать окно добавления, продолжая загрузку в фоне».
 *
 * UploadPanel (см. kb-file-panel.tsx) при пике файла:
 *   1. start(blockId, fileName) — регистрирует upload в store.
 *   2. Запускает `editor.uploadFile(file, blockId)` асинхронно (без
 *      await в handler'е, чтобы можно было сразу закрыть FilePanel).
 *   3. Когда upload завершается — вызывает editor.updateBlock(...) +
 *      finish(blockId). Это автоматически уберёт overlay в empty-state.
 *
 * KbFileBlock / KbAudioBlock / KbImageBlock / KbVideoBlock empty-state
 * (когда url === "") подписаны через useUploadQueueEntry(blockId) —
 * если есть active upload, рендерят `<KbUploadProgressOverlay>` поверх
 * FileBlockWrapper'а.
 */

export type UploadEntry = {
  blockId: string;
  fileName: string;
  startedAt: number;
};

const entries = new Map<string, UploadEntry>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function startUpload(blockId: string, fileName: string) {
  entries.set(blockId, { blockId, fileName, startedAt: Date.now() });
  emit();
}

export function finishUpload(blockId: string) {
  if (entries.delete(blockId)) emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: подписка на upload-status конкретного блока. Возвращает
 *  entry либо null (если upload не активен). useSyncExternalStore с
 *  per-blockId snapshot'ом — компонент перерендерится только когда
 *  именно этот blockId меняется. */
export function useUploadQueueEntry(blockId: string): UploadEntry | null {
  return useSyncExternalStore(
    subscribe,
    () => entries.get(blockId) ?? null,
    () => null,
  );
}
