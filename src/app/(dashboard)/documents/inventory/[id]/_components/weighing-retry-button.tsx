"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { retryStockCountCommit } from "@/app/(dashboard)/schedule/tasks/weighing-actions";

/** «Повторить» упавшее проведение взвешивания. */
export function WeighingRetryButton({ commitId }: { commitId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="outline"
        className="h-9"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await retryStockCountCommit(commitId);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setError(null);
            router.refresh();
          })
        }
      >
        {pending ? "Повторяем…" : "Повторить"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
