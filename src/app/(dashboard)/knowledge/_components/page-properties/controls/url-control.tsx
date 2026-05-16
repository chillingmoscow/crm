"use client";

import { useEffect, useRef, useState } from "react";

import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/** URL-property:
 *  - Read-only mode: `<a target="_blank">` с external-link иконкой.
 *  - Edit mode: `<input type="url">`. На blur — нормализуем (если не
 *    пусто и нет схемы — добавляем `https://`).
 *
 *  «Битая» ссылка (не https?://, mailto:, tel: префикса) не блокирует
 *  ввод — БД хранит как есть, рендер показывает amber-border как hint
 *  что juyer возможно опечатался. Жёсткой валидации нет (Notion-style:
 *  принимаем любую строку, помечаем подозрительные). */
const URL_VALID_PREFIX_RE = /^(https?:\/\/|mailto:|tel:)/i;

/** Schemes that могут стать XSS-вектором если попадут в `<a href>`.
 *  Display-сторона уже фильтрует через safeHref, но defence-in-depth:
 *  не пишем такие значения в БД, чтобы экспорт / share / любой другой
 *  потребитель не обошёл фильтр случайно.
 *
 *  Блокируются **все** перечисленные схемы безусловно. Промежуточная
 *  версия (PR #230) пыталась пропускать `host:port`-формы вида
 *  `data:8080` через scheme-specific лookahead'ы, но codex P1
 *  feedback справедливо указал на дыры: после послабления `data:`
 *  без буквы/слэша после двоеточия и `file:` без слэша валидные
 *  data-URI'ы (`data:,payload`, `data:;base64,xxx`, `file:C:/...`)
 *  проходили в БД. Безопасность важнее редкого случая «сервер с
 *  hostname=data на порту 8080» — юзер всегда может ввести
 *  `https://data:8080` явно, если такой случай вообще встретится.
 */
const BLOCKED_SCHEME_RE = /^\s*(javascript|data|vbscript|file):/i;

/** Убирает `https://` / `http://` префикс для display-режима когда
 *  `urlCollapsed === true`. Сама href остаётся полной. mailto: / tel:
 *  префиксы не трогаем — они смысловые. */
export function shortenUrlForDisplay(url: string, collapsed: boolean): string {
  if (!collapsed) return url;
  return url.replace(/^https?:\/\//i, "");
}

export function UrlValueControl({
  value,
  collapsed,
  canEdit,
  onChange,
}: {
  value: string;
  collapsed: boolean;
  canEdit: boolean;
  onChange: (value: string) => void;
}) {
  const trimmed = value.trim();
  const looksValid = trimmed.length === 0 || URL_VALID_PREFIX_RE.test(trimmed);
  const display = shortenUrlForDisplay(trimmed, collapsed);

  // Click-to-edit. Display-mode по дефолту — `<a>` остаётся
  // кликабельной (открывает ссылку). В edit-mode переходим через
  // отдельный pencil-toggle (или click по placeholder'у при empty
  // value). Так клик по самой ссылке не «угоняет» юзера в edit-режим.
  const [editing, setEditing] = useState(false);

  // Local draft — input controlled. См. PR #142 / Codex P1 #142:
  //   1. Collapsed-режим: input показывает scheme-stripped display, БД
  //      должна хранить полный URL.
  //   2. Focus + blur без правок не должен переписывать http://https://.
  const [draft, setDraft] = useState(display);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(display);
  }, [display]);

  // Read-only пользователь — всегда display-mode (clickable link).
  if (!canEdit) {
    if (!trimmed) {
      return <span className="text-[13px] text-muted-foreground/50">—</span>;
    }
    if (!looksValid) {
      return <span className="text-[13px] truncate">{trimmed}</span>;
    }
    return (
      <a
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[13px] text-foreground underline decoration-muted-foreground/40
                   underline-offset-[3px] decoration-[1.5px]
                   hover:decoration-foreground hover:text-foreground transition-colors
                   truncate inline-block max-w-full"
      >
        {display}
      </a>
    );
  }

  const commit = (raw: string) => {
    const v = raw.trim();
    if (v === display) {
      setDraft(display);
      return;
    }
    // Defence-in-depth: never persist a value that starts with an
    // active-content scheme. Display gates via `looksValid`, but if any
    // downstream consumer (export, email, copy-paste reader) drops that
    // gate, the URL becomes an XSS vector. Same allowlist principle as
    // safeHref in @/lib/knowledge/safe-href.
    if (BLOCKED_SCHEME_RE.test(v)) {
      toast.warning("Эта схема URL не поддерживается");
      setDraft(display);
      return;
    }
    if (URL_VALID_PREFIX_RE.test(v)) {
      onChange(v);
      return;
    }
    if (collapsed && trimmed.length > 0) {
      const origSchemeMatch = trimmed.match(/^(https?:\/\/)/i);
      const origScheme = origSchemeMatch ? origSchemeMatch[1] : "https://";
      onChange(`${origScheme}${v}`);
      return;
    }
    if (v.length > 0 && /\.[a-z]{2,}/i.test(v) && !/\s/.test(v)) {
      onChange(`https://${v}`);
      return;
    }
    onChange(v);
  };

  // Edit-mode: bare input без рамки, с auto-focus.
  if (editing) {
    return (
      <input
        autoFocus
        type="url"
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          focusedRef.current = false;
          commit(e.target.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
        placeholder={collapsed ? "example.com" : "https://…"}
        className={cn(
          "w-full bg-transparent text-[13px] outline-none truncate",
          "border-0 p-0",
          !looksValid && "text-amber-700 dark:text-amber-400",
        )}
        aria-invalid={!looksValid}
      />
    );
  }

  // Display-mode: clickable `<a>` или placeholder. Pencil-кнопка
  // справа (на hover) — entry в edit-mode. Если value пустое — клик
  // по placeholder'у сразу переходит в edit (некуда вести ссылкой).
  if (!trimmed) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left text-[13px] text-muted-foreground/50 w-full truncate"
        aria-label="Ввести URL"
      >
        —
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 max-w-full group/url">
      {looksValid ? (
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] text-foreground underline decoration-muted-foreground/40
                     underline-offset-[3px] decoration-[1.5px]
                     hover:decoration-foreground hover:text-foreground transition-colors
                     truncate inline-block max-w-full"
        >
          {display}
        </a>
      ) : (
        <span
          className="text-[13px] text-amber-700 dark:text-amber-400 truncate inline-block max-w-full"
          data-tip="Неверный URL"
        >
          {trimmed}
        </span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Редактировать URL"
        className="size-5 shrink-0 inline-flex items-center justify-center rounded
                   text-muted-foreground/40 hover:text-foreground transition-colors
                   opacity-0 group-hover/url:opacity-100 focus-visible:opacity-100"
      >
        <Pencil className="size-3" />
      </button>
    </span>
  );
}
