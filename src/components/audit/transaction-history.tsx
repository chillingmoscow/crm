"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadTransactionHistory } from "@/lib/finance/transaction-history";
import { EntityAuditTab } from "./entity-audit-tab";
import { Button } from "@/components/ui/button";

export function TransactionHistory({
  transactionId,
}: {
  transactionId: string;
}) {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof loadTransactionHistory>
  > | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError("");
    loadTransactionHistory(transactionId)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить историю",
          );
      });
    return () => {
      active = false;
    };
  }, [transactionId, attempt]);
  if (error)
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Повторить
        </Button>
      </div>
    );
  if (!result)
    return (
      <div
        className="flex items-center gap-2 py-5 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 size={15} className="animate-spin" />
        Загружаем историю…
      </div>
    );
  if (!result.canView)
    return (
      <p className="text-sm text-muted-foreground">
        Для просмотра истории нужно право «Видеть журнал аудита».
      </p>
    );
  if (!result.events.length)
    return (
      <p className="py-3 text-sm text-muted-foreground">
        Событий по этой транзакции пока нет.
      </p>
    );
  return (
    <EntityAuditTab
      mode="entity"
      entityType="transaction"
      entityId={transactionId}
      canView
      initialEvents={result.events}
      initialHasMore={result.hasMore}
      exactTime
      timeZone={result.timeZone}
    />
  );
}
