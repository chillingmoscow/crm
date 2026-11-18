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
  onSave,
  onReset,
  className,
}: {
  dirty: boolean;
  saving?: boolean;
  /** Почему сохранить нельзя: кнопка неактивна, причина в подсказке. */
  blocked?: string | null;
  onSave: () => void;
  onReset: () => void;
  className?: string;
}) {
  const leaveDialog = useLeaveGuard(dirty);
  return (
    <>
      {dirty ? (
        <div
          role="region"
          aria-label="Несохранённые изменения"
          className={cn(
            "sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-md backdrop-blur",
            className,
          )}
        >
          <p role="status" className="text-sm text-muted-foreground">
            Есть несохранённые изменения
          </p>
          <div className="flex flex-1 justify-end gap-2 sm:flex-none">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onReset}
            >
              Отменить
            </Button>
            <span data-tip={blocked || undefined} className="inline-flex">
              <Button
                type="button"
                variant={blocked ? "secondary" : "default"}
                disabled={saving || Boolean(blocked)}
                onClick={onSave}
                className={cn(
                  "min-w-32",
                  blocked &&
                    "cursor-default text-muted-foreground hover:bg-secondary disabled:opacity-100",
                )}
              >
                {saving ? "Сохраняем…" : "Сохранить"}
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
 */
export function SaveBarScope({ children }: { children: ReactNode }) {
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
  const blocked =
    dirtyIds.map((id) => sections[id].blocked).find(Boolean) ?? null;
  const busy = saving || dirtyIds.some((id) => sections[id].saving);

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const id of dirtyIds) {
        const section = handlers.current.get(id)?.current;
        if (!section) continue;
        if (!(await section.save())) break;
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <SaveBarScopeContext.Provider value={api}>
      {children}
      <SaveBar
        dirty={dirtyIds.length > 0}
        saving={busy}
        blocked={blocked}
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
