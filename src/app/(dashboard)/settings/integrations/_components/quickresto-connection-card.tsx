"use client";

import Link from "next/link";
import { CheckCircle2, PlugZap, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalDateTime } from "@/components/shared/local-date-time";
import { InventorySyncButton } from "@/app/(dashboard)/inventory/_components/inventory-sync-button";

/**
 * Карточка интеграции Quick Resto на странице «Настройки → Интеграции».
 *
 * Раньше здесь всегда была одна кнопка «Запустить интеграцию» — независимо от
 * того, подключено уже или нет. Со стороны это читалось как «ничего не
 * настроено», хотя синхронизация давно работала.
 *
 * Клиентский компонент ради кнопки синхронизации; даты рисует LocalDateTime,
 * который сам разбирается с часовым поясом и гидратацией.
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

export function QuickRestoConnectionCard({
  connection,
  canSync,
  lastSyncedAt,
}: {
  connection: QuickRestoConnectionView | null;
  canSync: boolean;
  lastSyncedAt: string | null;
}) {
  // «Подключено» — только когда доступ хоть раз успешно проверялся. Строка
  // появляется в базе раньше проверки и получает status='active' по умолчанию,
  // поэтому брошенный на полпути мастер оставлял бы карточку с зелёным бейджем
  // и кнопкой синхронизации, которая гарантированно вернёт отказ.
  const disabled = connection?.status === "disabled";
  const verified = Boolean(connection?.lastTestedAt);
  const connected = Boolean(connection) && !disabled && verified;

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
              ) : disabled ? (
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-300"
                >
                  Отключено
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300"
                >
                  Не проверено
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
                <dd>
                  {connection.lastTestedAt ? (
                    <LocalDateTime value={connection.lastTestedAt} />
                  ) : (
                    "ни разу не проверялся"
                  )}
                </dd>

                <dt className="text-muted-foreground">Backoffice</dt>
                <dd>
                  {connection.backofficeConfigured ? (
                    <>
                      настроен, проверен{" "}
                      <LocalDateTime value={connection.backofficeLastTestedAt} />
                    </>
                  ) : (
                    "не настроен"
                  )}
                </dd>
              </dl>

              {/* Сохранённое, но ни разу не проверенное подключение: мастер
                  пишет строку до проверки, и на этом можно было остановиться. */}
              {!connected && !disabled ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  Учётные данные сохранены, но доступ ни разу не проверялся.
                  Завершите мастер интеграции — до этого синхронизация работать
                  не будет.
                </p>
              ) : null}

              {/* Без backoffice-доступа акт нельзя провести в Quick Resto —
                  синхронизация при этом работает, поэтому это предупреждение,
                  а не ошибка. */}
              {connected && !connection.backofficeConfigured ? (
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
                {/* Синхронизация требует активного проверенного подключения:
                    её server action ищет строку с status='active', и на
                    отключённом или непроверенном вернёт отказ. Кнопку в таком
                    состоянии не показываем вовсе. */}
                {connected && canSync ? (
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
