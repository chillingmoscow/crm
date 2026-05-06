"use client";

import { Loader2 } from "lucide-react";

import { useUploadQueueEntry } from "@/app/(dashboard)/knowledge/_components/kb-upload-queue-store";

/**
 * Полоса-индикатор «Загрузка...» которая рендерится вместо empty-state
 * CTA блока, пока в фоне идёт upload (см. kb-upload-queue-store.ts).
 *
 * Размер / pill-радиус / muted-фон совпадают с `.bn-add-file-button`
 * (см. globals.css), чтобы layout не прыгал во время и после upload'а.
 *
 * Прогресс — indeterminate (BN-овский `editor.uploadFile` не выдаёт
 * onProgress). Анимированный «бегущий» fill через CSS keyframes.
 */
export function KbUploadProgressOverlay({ blockId }: { blockId: string }) {
  const entry = useUploadQueueEntry(blockId);
  if (!entry) return null;

  return (
    <div
      className="kb-upload-progress"
      role="status"
      aria-live="polite"
      contentEditable={false}
    >
      <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
      <div className="kb-upload-progress-text">
        <div className="kb-upload-progress-title">
          Загрузка: {entry.fileName}
        </div>
        <div className="kb-upload-progress-bar" aria-hidden>
          <div className="kb-upload-progress-bar-fill" />
        </div>
      </div>
    </div>
  );
}
