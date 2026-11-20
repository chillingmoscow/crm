"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

import { PageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/** Ошибка загрузки журнала: в рамке раздела, без технических слов, с повтором. */
export default function AuditError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isDeploymentSkewError(error)) maybeReloadForDeploymentSkew(error);
  }, [error]);

  return (
    <PageFrame>
      <EmptyState
        icon={AlertCircle}
        title="Не удалось открыть журнал событий"
        description="Проверьте соединение и повторите попытку"
        action={<Button onClick={reset}>Повторить</Button>}
      />
    </PageFrame>
  );
}
