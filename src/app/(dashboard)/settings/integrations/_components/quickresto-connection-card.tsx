"use client";

import Link from "next/link";
import { CheckCircle2, PlugZap, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InventorySyncButton } from "@/app/(dashboard)/inventory/_components/inventory-sync-button";

/**
 * Карточка интеграции Quick Resto на странице «Настройки → Интеграции».
 *
 * Раньше здесь всегда была одна кнопка «Запустить интеграцию» — независимо от
 * того, подключено уже или нет. Со стороны это читалось как «ничего не
 * настроено», хотя синхронизация давно работала.
 *
 * Клиентский компонент, потому что даты форматируются в часовом поясе
 * пользователя (`toLocaleString`), как и в кнопке синхронизации; на сервере
 * получились бы времена UTC.
 */

export type QuickRestoConnectionView = {
  login: string | null;
  status: string | null;
  /** Последняя успешная проверка учётных данных API. */
  lastTestedAt: string | null;
  /** Последняя успешная проверка доступа в backoffice. */
  backofficeLastTestedAt: string | null;
  /** Настроен ли доступ в backoffice: без него не проводятся акты. */
  backofficeConfigured: boolean;
};

function formatMoment(value: string | null): string {
  return value ? new Date(value).toLocaleString("ru-RU") : "—";
}

export function QuickRestoConnectionCard({
  connection,
  canSync,
  lastSyncedAt,
}: {
  connection: QuickRestoConnectionView | null;
  canSync: boolean;
  lastSyncedAt: string | null;
}) {
  const connected = Boolean(connection) && connection?.status !== "disabled";

  return (
    <div className="mt-6 max-w-xl rounded-xl border p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/15">
          <PlugZap className="h-5 w-5 text-blue-600 dark:text-blue-300" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-medium">Quick Resto</h2>
            {connection ? (
              connected ? (
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
                >
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Подключено
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-300"
                >
                  Отключено
                </Badge>
              )
            ) : null}
          </div>

          {connection ? (
            <>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Учётная запись</dt>
                <dd className="min-w-0 break-words">{connection.login ?? "—"}</dd>

                <dt className="text-muted-foreground">Проверка доступа</dt>
                <dd>{formatMoment(connection.lastTestedAt)}</dd>

                <dt className="text-muted-foreground">Backoffice</dt>
                <dd>
                  {connection.backofficeConfigured
                    ? `настроен, проверен ${formatMoment(connection.backofficeLastTestedAt)}`
                    : "не настроен"}
                </dd>
              </dl>

              {/* Без backoffice-доступа акт нельзя провести в Quick Resto —
                  синхронизация при этом работает, поэтому это предупреждение,
                  а не ошибка. */}
              {!connection.backofficeConfigured ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  Без доступа в backoffice акты нельзя провести в Quick Resto.
                  Добавьте его в мастере интеграции.
                </p>
              ) : null}

              {/* Синхронизация — основное действие, поэтому первой. Кнопка
                  тянет за собой подпись «Последняя синхронизация», из-за
                  которой пара не помещается в строку карточки; раскладка
                  вертикальная осознанно, а не по недосмотру. */}
              <div className="mt-4 flex flex-col items-start gap-3">
                {canSync ? (
                  <InventorySyncButton canSync={canSync} lastSyncedAt={lastSyncedAt} />
                ) : null}
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/integrations/quickresto">
                    Изменить учётные данные
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                Подключите Quick Resto, чтобы импортировать заведения, должности и
                сотрудников, а затем синхронизировать номенклатуру и акты
                инвентаризации.
              </p>
              <Button asChild className="mt-4">
                <Link href="/settings/integrations/quickresto">Запустить интеграцию</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
