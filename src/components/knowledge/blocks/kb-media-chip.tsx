"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Свёрнутая (collapsed / showPreview=false / тип=file) репрезентация
 * media-блока — иконка слева + filename / URL справа. Пишется как
 * замена BN-default'ному `FileNameWithIcon` (`ei` в blocknote-react.js)
 * — последний хардкодит `RiFile2Line` иконку для ВСЕХ типов, и у
 * свёрнутого видео / аудио показывалась file-иконка, что юзера
 * сбивало с толку.
 *
 * Стилизация:
 *   • `variant="minimal"` — тонкий padding/no border, BN-default-look:
 *     для свернутых медиа (video/audio/image), которые «временно»
 *     схлопнуты и обычно скоро раскрываются обратно. Здесь pill
 *     визуально перегружал ряд в обычном тексте.
 *   • `variant="card"` — pill с border'ом + bg, Notion-style: для
 *     `file`-блоков, у которых нет preview-режима — это их основное
 *     представление.
 *
 * `contentEditable={false}` чип не редактируется как текст; click
 * на нём просто выделяет блок (PM ловит `mousedown` на selectednode
 * → формат-toolbar открывается).
 */
export function KbMediaChip({
  icon,
  label,
  variant,
  className,
}: {
  icon: ReactNode;
  /** Видимый текст: filename для uploaded или URL для embed-видео. */
  label: string;
  variant: "minimal" | "card";
  className?: string;
}) {
  return (
    <div
      contentEditable={false}
      draggable={false}
      className={cn(
        "kb-media-chip",
        variant === "card"
          ? "kb-media-chip--card"
          : "kb-media-chip--minimal",
        className,
      )}
    >
      <span className="kb-media-chip__icon">{icon}</span>
      <span className="kb-media-chip__label">{label}</span>
    </div>
  );
}
