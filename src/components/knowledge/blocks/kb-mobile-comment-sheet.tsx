"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Полноэкранный лист для комментариев на touch. Заменяет плавающий
 * BN-поповер (KbFloatingComposer / KbFloatingThread), который на мобильном
 * прятался за тулбаром, тесно показывал @-упоминания и пересекался с
 * системными поповерами iOS («Вырезать / Скопировать / Вставить»).
 *
 * Размер панели = видимая область visualViewport (top=offsetTop, height=
 * vv.height) и обновляется на resize/scroll — так нижний инпут (ответ /
 * новый комментарий) держится НАД клавиатурой, а не за ней.
 *
 * className="bn-thread" на панели — НАМЕРЕННО: composer-guard в
 * blocknote-editor.tsx мониторит фокус/клик по этому селектору, чтобы не
 * закрыть pending-comment при клике внутрь (см. kb-floating-composer.tsx).
 * Кнопка «Закрыть» — внутри `.bn-thread button`, поэтому guard трактует её
 * как intentional-close. Клик по backdrop'у закрывающая логика caller'а
 * гасит сама (для composer'а — blur + stopPendingComment).
 */
export function KbMobileCommentSheet({
  title,
  headerExtra,
  onClose,
  children,
}: {
  title: string;
  /** Доп. контролы в шапке (напр. кнопка «Решить» для треда). */
  headerExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const [vp, setVp] = useState<{ top: number; height: number }>(() => ({
    top: 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const update = () => {
      setVp({
        top: vv?.offsetTop ?? 0,
        height: vv?.height ?? window.innerHeight,
      });
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, []);

  // Лочим скролл страницы, пока лист открыт.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="kb-mobile-comment-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="kb-mobile-comment-sheet bn-thread"
        style={{ top: vp.top, height: vp.height }}
        role="dialog"
        aria-label={title}
      >
        <div className="kb-mobile-comment-sheet-header">
          <span className="kb-mobile-comment-sheet-title">{title}</span>
          <div className="kb-mobile-comment-sheet-actions">
            {headerExtra}
            <button
              type="button"
              className="kb-mobile-comment-sheet-close"
              aria-label="Закрыть"
              onClick={onClose}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
        <div className="kb-mobile-comment-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
