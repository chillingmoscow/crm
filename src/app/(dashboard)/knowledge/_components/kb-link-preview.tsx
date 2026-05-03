"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, AlertTriangle, Clock } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import {
  getKbPagePreview,
  type KbPagePreview,
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

const previewCache = new Map<string, KbPagePreview | null>();
const inflight = new Map<string, Promise<KbPagePreview | null>>();

const HOVER_DELAY_MS = 300;
const SLUG_HREF_RE = /^\/knowledge\/([^/?#]+)$/;

interface ActivePreview {
  anchor: HTMLAnchorElement;
  slug: string;
  rect: DOMRect;
}

/** Provider-style компонент: монтируется один раз внутри editor-обёртки,
 *  слушает mouseover на document, рендерит абсолютно-позиционированный
 *  tooltip когда курсор над `<a href="/knowledge/...">`. */
export function KbLinkPreview() {
  const [active, setActive] = useState<ActivePreview | null>(null);
  const [preview, setPreview] = useState<KbPagePreview | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  /** Ref на slug, который сейчас «в фокусе» загрузки. loadPreview
   *  читает его перед setPreview — игнорируем stale resolve, если
   *  юзер уже ушёл на другой link. См. Codex #63 P2. */
  const currentSlugRef = useRef<string | null>(null);

  useEffect(() => {
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
      const match = SLUG_HREF_RE.exec(href);
      if (!match) {
        clearHover();
        return;
      }
      const slug = match[1];

      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => {
        const rect = anchor.getBoundingClientRect();
        setActive({ anchor, slug, rect });
        currentSlugRef.current = slug;
        void loadPreview(slug, (result) => {
          // Race-guard: если за время fetch'а юзер ушёл на другой link
          // (или вообще со страницы), currentSlugRef уже другой —
          // отбрасываем stale-резолв чтобы не показать чужой preview.
          // См. Codex #63 P2.
          if (currentSlugRef.current === slug) {
            setPreview(result);
          }
        });
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
      currentSlugRef.current = null;
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
  }, []);

  // На каждый новый slug — обновить preview state из кэша синхронно
  // (если уже в кэше). Async-fetch выше через loadPreview ставит после.
  useEffect(() => {
    if (!active) return;
    const cached = previewCache.get(active.slug);
    if (cached !== undefined) setPreview(cached);
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
      <div className="flex items-start gap-2 p-3">
        <KbPageIcon icon={preview.icon} color={preview.icon_color} size={20} />
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground truncate">
            <span className="truncate">{preview.title || "Без названия"}</span>
            {preview.is_locked && (
              <Lock className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            {preview.required_reading && (
              <AlertTriangle className="size-3 shrink-0 fill-yellow-400 text-yellow-700 dark:text-yellow-400" />
            )}
          </div>
          {preview.snippet ? (
            <p className="text-[12px] leading-snug text-muted-foreground line-clamp-3">
              {preview.snippet}
            </p>
          ) : (
            <p className="text-[12px] italic text-muted-foreground/70">
              Страница пока пустая
            </p>
          )}
          {preview.reading_minutes !== null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
              <Clock className="size-3" />≈ {preview.reading_minutes} мин
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

async function loadPreview(
  slug: string,
  setPreview: (p: KbPagePreview | null) => void,
): Promise<void> {
  if (previewCache.has(slug)) {
    setPreview(previewCache.get(slug) ?? null);
    return;
  }
  // Дедуп параллельных запросов на тот же slug.
  let promise = inflight.get(slug);
  if (!promise) {
    promise = getKbPagePreview(slug).then(({ preview }) => preview);
    inflight.set(slug, promise);
  }
  // try/finally — на reject (transient network) ОБЯЗАТЕЛЬНО снимаем
  // promise из inflight, иначе rejected promise остаётся в map'е
  // навсегда и любой следующий hover на этот slug переиспользует его
  // → preview никогда не retry'ится до перезагрузки страницы. См.
  // Codex #63 P2.
  //
  // Кэш в `previewCache` пишем ТОЛЬКО на success — иначе следующий
  // hover вернул бы из cache'а null (без retry'я), маскируя transient-
  // failure'ы. На reject — silent no-op, hover просто не покажет
  // preview, и следующий вызов попробует заново.
  try {
    const result = await promise;
    previewCache.set(slug, result);
    setPreview(result);
  } catch {
    // Transient — оставляем previewCache пустым, чтобы next hover
    // попробовал ещё раз. setPreview не вызываем — UI просто не
    // покажет tooltip.
  } finally {
    inflight.delete(slug);
  }
}
