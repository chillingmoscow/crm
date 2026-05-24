"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, AlertTriangle, Clock, User } from "lucide-react";

import { useCoarsePointer } from "@/hooks/use-mobile";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import {
  getKbPagePreview,
  getKbStaffPreview,
  type KbPagePreview,
  type KbStaffPreview,
} from "@/lib/knowledge/preview";

// Sprint D Phase 7 — inline-preview tooltip для KB-ссылок. Цель:
// при hover на @-mention или kb-link показать заголовок + иконку +
// первую строку контента + reading-time. Snиppet делает решение
// «открывать или нет» осознанным без navigation'а.
//
// Реализация — single tooltip на весь редактор через делегированный
// mouseover listener. Альтернатива (per-link <Tooltip>) требовала бы
// модифицировать BlockNote-link-rendering или wrap'ить каждую ссылку
// react-компонентом — overkill для feature.
//
// Cache: per-slug Map в module-scope. Hover на ту же ссылку второй
// раз — instant, без сетевого запроса. Кэш живёт всё время сессии;
// для KB-страниц actuality не критична (правки редкие).

// Page-preview cache (per-slug) и staff-preview cache (per-userId).
// Раздельные maps — типы разные, но логика идентична.
const pagePreviewCache = new Map<string, KbPagePreview | null>();
const pageInflight = new Map<string, Promise<KbPagePreview | null>>();
const staffPreviewCache = new Map<string, KbStaffPreview | null>();
const staffInflight = new Map<string, Promise<KbStaffPreview | null>>();

const HOVER_DELAY_MS = 300;
const PAGE_HREF_RE = /^\/knowledge\/([^/?#]+)$/;
const STAFF_HREF_RE =
  /^\/people\/staff\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

type PreviewKind = "page" | "staff";

interface ActivePreview {
  anchor: HTMLAnchorElement;
  /** Уникальный ключ — slug для page'ей, userId для staff'а. */
  key: string;
  kind: PreviewKind;
  rect: DOMRect;
}

type PreviewData =
  | { kind: "page"; data: KbPagePreview }
  | { kind: "staff"; data: KbStaffPreview };

/** Provider-style компонент: монтируется один раз внутри editor-обёртки,
 *  слушает mouseover на document, рендерит абсолютно-позиционированный
 *  tooltip когда курсор над `<a href="/knowledge/...">`. */
export function KbLinkPreview() {
  const [active, setActive] = useState<ActivePreview | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  /** Ref на key, который сейчас «в фокусе» загрузки. loadXxxPreview
   *  читает его перед setPreview — игнорируем stale resolve, если
   *  юзер уже ушёл на другой link. См. Codex #63 P2. */
  const currentKeyRef = useRef<string | null>(null);
  // На тач-устройствах hover-preview не нужен и вреден: iOS эмулирует
  // `mouseover` на ПЕРВЫЙ тап по ссылке (показывает превью), а навигация
  // происходит лишь на ВТОРОЙ тап; вдобавок превью «залипает», т.к.
  // `mouseout` на touch не приходит. На coarse-pointer не вешаем listener.
  const coarsePointer = useCoarsePointer();

  useEffect(() => {
    if (coarsePointer) return;

    const onOver = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      // Игнорим hover внутри самого tooltip'а — иначе при движении
      // курсора с link'а на tooltip он бы пере-открывался по link'у
      // под ним.
      if (tooltipRef.current?.contains(target)) return;

      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) {
        clearHover();
        return;
      }
      const href = anchor.getAttribute("href") ?? "";

      const pageMatch = PAGE_HREF_RE.exec(href);
      const staffMatch = STAFF_HREF_RE.exec(href);
      if (!pageMatch && !staffMatch) {
        clearHover();
        return;
      }
      const kind: PreviewKind = pageMatch ? "page" : "staff";
      const key = pageMatch ? pageMatch[1] : staffMatch![1];

      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => {
        const rect = anchor.getBoundingClientRect();
        setActive({ anchor, key, kind, rect });
        currentKeyRef.current = key;
        if (kind === "page") {
          void loadPagePreview(key, (result) => {
            if (currentKeyRef.current === key && result) {
              setPreview({ kind: "page", data: result });
            }
          });
        } else {
          void loadStaffPreview(key, (result) => {
            if (currentKeyRef.current === key && result) {
              setPreview({ kind: "staff", data: result });
            }
          });
        }
      }, HOVER_DELAY_MS);
    };

    const onOut = (e: MouseEvent) => {
      const next = e.relatedTarget as Element | null;
      if (next && tooltipRef.current?.contains(next)) return;
      clearHover();
    };

    function clearHover() {
      if (hoverTimer.current) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
      currentKeyRef.current = null;
      setActive(null);
      setPreview(null);
    }

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, [coarsePointer]);

  // На каждый новый key — обновить preview state из кэша синхронно
  // (если уже в кэше). Async-fetch выше через loadXxxPreview ставит после.
  useEffect(() => {
    if (!active) return;
    if (active.kind === "page") {
      const cached = pagePreviewCache.get(active.key);
      if (cached !== undefined && cached !== null)
        setPreview({ kind: "page", data: cached });
    } else {
      const cached = staffPreviewCache.get(active.key);
      if (cached !== undefined && cached !== null)
        setPreview({ kind: "staff", data: cached });
    }
  }, [active]);

  if (!active || !preview) return null;

  // Позиционирование: чуть ниже якоря, по центру горизонтали. Если
  // якорь близко к правому краю — clamp по viewport. Простое CSS
  // решение без Floating-UI: для tooltip'а fixed-positioning
  // достаточно, нет вложенных scroll-context'ов.
  const VW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const TOOLTIP_W = 320;
  const left = Math.max(
    8,
    Math.min(
      VW - TOOLTIP_W - 8,
      active.rect.left + active.rect.width / 2 - TOOLTIP_W / 2,
    ),
  );
  const top = active.rect.bottom + 6;

  return (
    <div
      ref={tooltipRef}
      role="tooltip"
      className="fixed z-50 pointer-events-none rounded-lg border border-border bg-card shadow-lg"
      style={{ left, top, width: TOOLTIP_W }}
    >
      {preview.kind === "page" ? (
        <PagePreviewBody data={preview.data} />
      ) : (
        <StaffPreviewBody data={preview.data} />
      )}
    </div>
  );
}

function PagePreviewBody({ data }: { data: KbPagePreview }) {
  return (
    <div className="flex items-start gap-2 p-3">
      <KbPageIcon icon={data.icon} color={data.icon_color} size={20} />
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground truncate">
          <span className="truncate">{data.title || "Без названия"}</span>
          {data.is_locked && (
            <Lock className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          {data.required_reading && (
            <AlertTriangle className="size-3 shrink-0 fill-yellow-400 text-yellow-700 dark:text-yellow-400" />
          )}
        </div>
        {data.snippet ? (
          <p className="text-[12px] leading-snug text-muted-foreground line-clamp-3">
            {data.snippet}
          </p>
        ) : (
          <p className="text-[12px] italic text-muted-foreground/70">
            Страница пока пустая
          </p>
        )}
        {data.reading_minutes !== null && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <Clock className="size-3" />≈ {data.reading_minutes} мин
          </span>
        )}
      </div>
    </div>
  );
}

function StaffPreviewBody({ data }: { data: KbStaffPreview }) {
  const initials = getInitials(data.full_name);
  return (
    <div className="flex items-start gap-2.5 p-3">
      {data.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.avatar_url}
          alt=""
          className="size-9 rounded-full object-cover bg-muted shrink-0"
        />
      ) : (
        <span className="size-9 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-xs font-semibold shrink-0">
          {initials || <User className="size-4" />}
        </span>
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <span className="text-sm font-semibold text-foreground truncate">
          {data.full_name || "Без имени"}
        </span>
        {data.role_name && (
          <span className="text-[12px] text-muted-foreground truncate">
            {data.role_name}
          </span>
        )}
      </div>
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

async function loadPagePreview(
  slug: string,
  setPreview: (p: KbPagePreview | null) => void,
): Promise<void> {
  if (pagePreviewCache.has(slug)) {
    setPreview(pagePreviewCache.get(slug) ?? null);
    return;
  }
  let promise = pageInflight.get(slug);
  if (!promise) {
    promise = getKbPagePreview(slug).then(({ preview }) => preview);
    pageInflight.set(slug, promise);
  }
  try {
    const result = await promise;
    pagePreviewCache.set(slug, result);
    setPreview(result);
  } catch {
    // Silent — следующий hover повторит попытку.
  } finally {
    pageInflight.delete(slug);
  }
}

async function loadStaffPreview(
  userId: string,
  setPreview: (p: KbStaffPreview | null) => void,
): Promise<void> {
  if (staffPreviewCache.has(userId)) {
    setPreview(staffPreviewCache.get(userId) ?? null);
    return;
  }
  let promise = staffInflight.get(userId);
  if (!promise) {
    promise = getKbStaffPreview(userId).then(({ preview }) => preview);
    staffInflight.set(userId, promise);
  }
  try {
    const result = await promise;
    staffPreviewCache.set(userId, result);
    setPreview(result);
  } catch {
    // Silent — следующий hover повторит попытку.
  } finally {
    staffInflight.delete(userId);
  }
}
