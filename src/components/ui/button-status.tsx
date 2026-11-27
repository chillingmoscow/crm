"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";


export type ButtonStatus = "idle" | "pending" | "success";

/** Сколько держится галочка после успеха, мс (docs/motion.md). */
export const SAVE_SUCCESS_MS = 1200;

/**
 * Содержимое кнопки с состоянием: подпись, индикатор и галочка лежат в
 * одной клетке сетки и сменяют друг друга прозрачностью — ширина кнопки
 * не прыгает. Анимации — `.btn-status-*` в globals.css.
 */
export function ButtonStatusContent({
  status,
  children,
}: {
  status: ButtonStatus;
  children: ReactNode;
}) {
  return (
    <span className="btn-status grid place-items-center">
      <span
        className="btn-status-label inline-flex items-center gap-2"
        data-hidden={status !== "idle" || undefined}
      >
        {children}
      </span>
      <span className="btn-status-icon" data-shown={status === "pending" || undefined} aria-hidden>
        <Loader2 className="animate-spin" />
      </span>
      <span className="btn-status-icon btn-status-check" data-shown={status === "success" || undefined} aria-hidden>
        <Check />
      </span>
      <span className="sr-only" aria-live="polite">
        {status === "pending" ? "Сохраняем" : status === "success" ? "Сохранено" : ""}
      </span>
    </span>
  );
}

/**
 * Состояние кнопки сохранения. `run(save)` ставит «pending», после успеха —
 * «success» на `SAVE_SUCCESS_MS`, потом снова «idle». Успех — когда `save`
 * не бросил и не вернул `false` (как `SaveSection.save`).
 *
 *   const [status, run] = useSaveStatus();
 *   <Button status={status} onClick={() => run(save)}>Сохранить</Button>
 */
export function useSaveStatus(): [
  ButtonStatus,
  (save: () => Promise<unknown>) => Promise<boolean>,
] {
  const [status, setStatus] = useState<ButtonStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const run = useCallback(async (save: () => Promise<unknown>) => {
    clearTimeout(timer.current);
    setStatus("pending");
    let ok = false;
    try {
      ok = (await save()) !== false;
    } finally {
      if (mounted.current) {
        setStatus(ok ? "success" : "idle");
        if (ok)
          timer.current = setTimeout(() => {
            if (mounted.current) setStatus("idle");
          }, SAVE_SUCCESS_MS);
      }
    }
    return ok;
  }, []);
  return [status, run];
}

/**
 * То же для готового флага `saving` (полоса сохранения, формы с
 * `useTransition`). Успех — когда после сохранения `done` стал true
 * (полоса: изменений не осталось). Свежие данные после сохранения часто
 * приходят следующим рендером, поэтому ждём `done` ещё секунду после
 * `saving` → false; не дождались — сохранение не удалось, галочки нет.
 */
export function useSaveStatusFromFlag(saving: boolean, done: boolean): ButtonStatus {
  // Успех считаем в том же рендере, где закончилось сохранение (состояние
  // из пропсов, без эффекта): иначе полоса сохранения на кадр исчезает
  // между «Сохраняем» и галочкой и появляется заново.
  const [prevSaving, setPrevSaving] = useState(saving);
  const [armed, setArmed] = useState(false);
  const [success, setSuccess] = useState(false);
  if (saving !== prevSaving) {
    setPrevSaving(saving);
    if (saving) {
      setArmed(true);
      setSuccess(false);
    }
  }
  if (armed && !saving && done) {
    setArmed(false);
    setSuccess(true);
  }
  // Снова есть изменения — галочку убираем сразу, кнопка снова «Сохранить».
  if (success && !done) setSuccess(false);
  // Галочка гаснет через SAVE_SUCCESS_MS.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(false), SAVE_SUCCESS_MS);
    return () => clearTimeout(t);
  }, [success]);
  // Не дождались `done` за секунду — сохранение не удалось, разоружаемся.
  useEffect(() => {
    if (!armed || saving) return;
    const t = setTimeout(() => setArmed(false), 1000);
    return () => clearTimeout(t);
  }, [armed, saving]);
  if (saving) return "pending";
  return success ? "success" : "idle";
}
