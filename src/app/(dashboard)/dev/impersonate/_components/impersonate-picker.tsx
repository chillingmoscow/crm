"use client";

import { useMemo, useState, useTransition } from "react";
import { TriangleAlert, UserSearch } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { TablePageHeader } from "@/components/shared/table";
import {
  startImpersonation,
  type ImpersonationTarget,
} from "@/lib/impersonation/actions";

type Props = {
  targets: ImpersonationTarget[];
  loadError: string | null;
  /** Уже идёт просмотр за кем-то (редкий случай: цель тоже в allowlist). */
  alreadyImpersonating: boolean;
};

export function ImpersonatePicker({ targets, loadError, alreadyImpersonating }: Props) {
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) =>
      [t.name, t.email, t.roleName, t.venueName]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [targets, query]);

  const handleStart = (target: ImpersonationTarget) => {
    setPendingId(target.userId);
    startTransition(async () => {
      try {
        const result = await startImpersonation(target.userId);
        // Полная перезагрузка: сессия сменилась, Router Cache прошлой
        // сессии надо сбросить.
        if (result.next) {
          window.location.assign(result.next);
          return;
        }
        if (result.error) toast.error(result.error);
      } catch {
        toast.error("Не удалось войти в режим просмотра — попробуйте ещё раз");
      }
      setPendingId(null);
    });
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <TablePageHeader
        title="Просмотр за пользователя"
        subtitle="Войти в приложение глазами сотрудника вашего аккаунта и проверить, что он действительно видит."
      />

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/15">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="space-y-1 text-[13px] leading-snug text-amber-700 dark:text-amber-300">
          <p className="font-medium">Это настоящая сессия, а не превью.</p>
          <p>
            Всё, что вы нажмёте, уйдёт в базу от имени этого сотрудника: журнал
            событий и поля «кто создал» запишут его. Отличить такую запись от
            настоящей потом нельзя.
          </p>
        </div>
      </div>

      {alreadyImpersonating && (
        <p className="text-sm text-muted-foreground">
          Просмотр уже идёт — сначала вернитесь к себе через баннер сверху.
        </p>
      )}

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : targets.length === 0 ? (
        <EmptyState
          icon={UserSearch}
          title="Некого посмотреть"
          description="В вашем аккаунте нет других сотрудников с активным доступом."
        />
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя, email, должность или заведение"
            className="max-w-sm"
          />

          <div className="overflow-hidden rounded-lg border bg-card">
            {filtered.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                Никого не нашлось
              </p>
            ) : (
              filtered.map((target) => (
                <div
                  key={target.userId}
                  className="flex items-center gap-4 border-b px-5 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{target.name}</p>
                    <p className="truncate text-[13px] text-muted-foreground">
                      {target.roleName} · {target.venueName}
                      {target.email ? ` · ${target.email}` : ""}
                    </p>
                  </div>
                  {target.blockedReason ? (
                    <span className="shrink-0 text-[13px] text-muted-foreground">
                      {target.blockedReason}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0"
                      disabled={pendingId !== null || alreadyImpersonating}
                      onClick={() => handleStart(target)}
                    >
                      {pendingId === target.userId ? "…" : "Смотреть как"}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
