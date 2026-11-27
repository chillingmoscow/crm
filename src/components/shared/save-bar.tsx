"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { useSaveStatusFromFlag } from "@/components/ui/button-status";
import { useExitValue } from "@/hooks/use-exit-value";
import { cn } from "@/lib/utils";
import { useLeaveGuard } from "./leave-guard";

/**
 * Полоса сохранения для формы, которая правится прямо на странице
 * (карточки сотрудника, должности, подразделения).
 *
 * Видна только когда есть несохранённые изменения: липкая полоса внизу
 * колонки содержимого — «Есть несохранённые изменения» слева, «Отменить»
 * и «Сохранить» справа. Пока изменения есть, уход со страницы спрашивает
 * подтверждение (`useLeaveGuard`). Правила — `docs/design-system.md`,
 * «SaveBar».
 */
export function SaveBar({
  dirty,
  saving = false,
  blocked,
  notice,
  onSave,
  onReset,
  className,
}: {
  dirty: boolean;
  saving?: boolean;
  /** Почему сохранить нельзя: кнопка неактивна, причина написана в полосе. */
  blocked?: string | null;
  /** Что не сохранится при нажатии (часть изменений): текст в полосе. */
  notice?: string | null;
  onSave: () => void;
  onReset: () => void;
  className?: string;
}) {
  // Пока идёт сохранение (и обновление данных после него), уход не
  // спрашиваем: изменения уже отправлены.
  const leaveDialog = useLeaveGuard(dirty && !saving);
  // После успешного сохранения полоса не исчезает сразу: индикатор на
  // кнопке превращается в галочку, через мгновение полоса уходит.
  const status = useSaveStatusFromFlag(saving, !dirty);
  const saved = status === "success" && !dirty;
  const message = saved ? null : (blocked ?? notice);
  const open = dirty || saved;
  // Уходит полоса мягко (`.motion-float-up[data-state=closed]`), а не пропадает в тот же кадр.
  const shown = useExitValue(open);
  // Пока полоса уходит, она выглядит как в последний миг на экране (с
  // галочкой), а не переключается обратно на «Сохранить».
  const lastStatus = useRef(status);
  const lastSaved = useRef(saved);
  if (open) {
    lastStatus.current = status;
    lastSaved.current = saved;
  }
  const barStatus = open ? status : lastStatus.current;
  const barSaved = open ? saved : lastSaved.current;
  return (
    <>
      {shown ? (
        <div
          role="region"
          aria-label={barSaved ? "Изменения сохранены" : "Несохранённые изменения"}
          data-state={open ? "open" : "closed"}
          inert={!open}
          className={cn(
            "motion-float-up sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-md backdrop-blur",
            className,
          )}
        >
          <p
            role="status"
            className={cn(
              "text-sm",
              message
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          >
            {barSaved ? "Изменения сохранены" : (message ?? "Есть несохранённые изменения")}
          </p>
          <div className="flex flex-1 justify-end gap-2 sm:flex-none">
            <Button
              type="button"
              variant="outline"
              disabled={saving || saved}
              onClick={onReset}
            >
              Отменить
            </Button>
            <span data-tip={blocked || undefined} className="inline-flex">
              <Button
                type="button"
                variant={blocked && !saved ? "secondary" : "default"}
                disabled={Boolean(blocked)}
                status={barStatus}
                onClick={onSave}
                className={cn(
                  "min-w-32",
                  blocked && !saved &&
                    "cursor-default text-muted-foreground hover:bg-secondary disabled:opacity-100",
                )}
              >
                Сохранить
              </Button>
            </span>
          </div>
        </div>
      ) : null}
      {leaveDialog}
    </>
  );
}

// ── Несколько секций — одна полоса ───────────────────────────────

/** Секция формы, которая сохраняется общей полосой. */
export type SaveSection = {
  dirty: boolean;
  /** Сохраняет секцию. `false` — не удалось (ошибку секция показала сама). */
  save: () => Promise<boolean>;
  /** Возвращает сохранённые значения. */
  reset: () => void;
  saving?: boolean;
  /** Почему секцию нельзя сохранить в нынешнем виде. */
  blocked?: string | null;
};

type Snapshot = { dirty: boolean; saving: boolean; blocked: string | null };

type ScopeApi = {
  update: (id: string, snapshot: Snapshot | null) => void;
  handlers: Map<string, { current: SaveSection }>;
};

const SaveBarScopeContext = createContext<ScopeApi | null>(null);

/**
 * Одна полоса на экран, в котором несколько независимо сохраняемых секций
 * (основные поля и «Недостача» у подразделения, данные сотрудника и
 * медкнижка). Секции подключаются через `useSaveSection`; «Сохранить»
 * сохраняет все изменённые по очереди и останавливается на первой ошибке.
 * Полоса рендерится последним элементом внутри области.
 *
 * Вложенная область не рисует свою полосу, а отдаёт секции внешней:
 * блок, у которого своя область (настройки оплаты), встраивается во
 * вкладку карточки, и на экране остаётся одна полоса.
 */
export function SaveBarScope({ children }: { children: ReactNode }) {
  const parent = useContext(SaveBarScopeContext);
  const [sections, setSections] = useState<Record<string, Snapshot>>({});
  const [saving, setSaving] = useState(false);
  const handlers = useRef(new Map<string, { current: SaveSection }>());

  const update = useCallback((id: string, snapshot: Snapshot | null) => {
    setSections((prev) => {
      if (!snapshot) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      const old = prev[id];
      if (
        old &&
        old.dirty === snapshot.dirty &&
        old.saving === snapshot.saving &&
        old.blocked === snapshot.blocked
      )
        return prev;
      return { ...prev, [id]: snapshot };
    });
  }, []);
  const api = useMemo<ScopeApi>(
    () => ({ update, handlers: handlers.current }),
    [update],
  );

  const dirtyIds = Object.keys(sections).filter((id) => sections[id].dirty);
  // Секция, которую нельзя сохранить, не держит остальные: «Сохранить»
  // сохраняет всё, что можно, а причина для остального написана в полосе.
  const savableIds = dirtyIds.filter((id) => !sections[id].blocked);
  const reason =
    dirtyIds.map((id) => sections[id].blocked).find(Boolean) ?? null;
  const busy = saving || dirtyIds.some((id) => sections[id].saving);

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const id of savableIds) {
        const section = handlers.current.get(id)?.current;
        if (!section) continue;
        if (!(await section.save())) break;
      }
    } finally {
      setSaving(false);
    }
  };

  if (parent) return <>{children}</>;

  return (
    <SaveBarScopeContext.Provider value={api}>
      {children}
      <SaveBar
        dirty={dirtyIds.length > 0}
        saving={busy}
        blocked={savableIds.length ? null : reason}
        notice={
          savableIds.length && reason ? `${reason}. Остальное сохранится` : null
        }
        onSave={() => void saveAll()}
        onReset={() => {
          for (const id of dirtyIds) handlers.current.get(id)?.current.reset();
        }}
      />
    </SaveBarScopeContext.Provider>
  );
}

/**
 * Подключает секцию к общей полосе ближайшего `SaveBarScope`. Без области
 * возвращает собственную полосу секции — её нужно отрендерить.
 */
export function useSaveSection(section: SaveSection): ReactNode {
  const scope = useContext(SaveBarScopeContext);
  const id = useId();
  const latest = useRef(section);
  latest.current = section;

  useEffect(() => {
    if (!scope) return;
    scope.handlers.set(id, latest);
    return () => {
      scope.handlers.delete(id);
      scope.update(id, null);
    };
  }, [scope, id]);

  const { dirty, saving = false, blocked = null } = section;
  useEffect(() => {
    scope?.update(id, { dirty, saving, blocked });
  }, [scope, id, dirty, saving, blocked]);

  if (scope) return null;
  return (
    <SaveBar
      dirty={dirty}
      saving={saving}
      blocked={blocked}
      onSave={() => void latest.current.save()}
      onReset={() => latest.current.reset()}
    />
  );
}

/**
 * `useSaveSection` в виде компонента — для экрана, который сам рендерит
 * `SaveBarScope` и не может вызвать хук под ним.
 */
export function SaveBarSection(props: SaveSection) {
  const bar = useSaveSection(props);
  return <>{bar}</>;
}
