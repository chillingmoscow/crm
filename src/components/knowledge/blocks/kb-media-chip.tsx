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
 * Layout: chip + caption обёрнуты в column-flex `<div>`, чтобы caption
 * рендерился ПОД chip'ом, а не сбоку. Без обёртки родитель `.bn-block-
 * content` имеет `display: flex` row → chip и `<p>` становились flex-
 * сиблингами в одной строке, caption уезжал вправо от файла.
 *
 * Caption: рендерим всегда `<p class="bn-file-caption">` пустой/с
 * текстом — BN-default `FileBlockWrapper` ставит этот элемент после
 * chip'а (см. ti в blocknote-react.js, line 2576-79). Без него:
 *   • caption у юзера НЕ отображается, даже если он раньше его задал
 *     (Codex P1/P2 на PR #136 — captions «исчезают» когда мы
 *     bypass'аем wrapper);
 *   • placeholder «Добавить подпись» (CSS `:empty::before` в globals.css)
 *     не работает — селектор сидит именно на `.bn-file-caption:empty`.
 *
 * `onClick` (опционально) — для file-блоков юзер просил «клик =
 * открыть в новой вкладке». Передаётся хост-блоком (kb-file-block.tsx),
 * который async-resolve'ит kbfile:// URL через editor.resolveFileUrl.
 *
 * `meta` (опционально) — text справа от label'а: file-extension /
 * size / etc. Renders as small muted badge.
 */
export function KbMediaChip({
  icon,
  label,
  meta,
  caption,
  variant,
  onClick,
  className,
}: {
  icon: ReactNode;
  /** Видимый текст: filename для uploaded или URL для embed-видео. */
  label: string;
  /** Подпись справа от label (file-extension, size). Опционально. */
  meta?: string;
  /** `kb_blocks.props.caption` — подпись под медиа. Пустая строка / undefined →
   *  рендерим пустой `<p>` для placeholder hover-эффекта в edit-mode. */
  caption?: string;
  variant: "minimal" | "card";
  /** Клик на chip'е. Используется для file-блоков (открыть в новой
   *  вкладке). Если не передан — chip только выделяет блок (PM ловит
   *  mousedown). */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  className?: string;
}) {
  return (
    <div className="kb-media-chip-wrapper">
      <div
        contentEditable={false}
        draggable={false}
        onClick={onClick}
        className={cn(
          "kb-media-chip",
          variant === "card"
            ? "kb-media-chip--card"
            : "kb-media-chip--minimal",
          onClick && "kb-media-chip--clickable",
          className,
        )}
      >
        <span className="kb-media-chip__icon">{icon}</span>
        <span className="kb-media-chip__label">{label}</span>
        {meta && <span className="kb-media-chip__meta">{meta}</span>}
      </div>
      <p className="bn-file-caption">{caption}</p>
    </div>
  );
}
