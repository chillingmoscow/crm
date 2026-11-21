"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/** Ошибка загрузки страницы «Продаж»: в рамке раздела, без технических слов, с повтором. */
export function SalesError({
  error,
  reset,
  page,
  title,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  page: string;
  title: string;
}) {
  useEffect(() => {
    if (isDeploymentSkewError(error)) maybeReloadForDeploymentSkew(error);
  }, [error]);
  return (
    <PageFrame>
      <Breadcrumbs items={[{ label: "Продажи" }, { label: page }]} />
      <EmptyState
        icon={AlertCircle}
        title={title}
        description="Проверьте соединение и повторите попытку"
        action={<Button onClick={reset}>Повторить</Button>}
      />
    </PageFrame>
  );
}
