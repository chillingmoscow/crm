"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { PageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/**
 * Ошибка загрузки страницы базы знаний: в общей рамке, без технических
 * слов, с повтором (docs/design-system.md → «Состояния»). На вложенных
 * страницах — ссылка на главную раздела.
 */
export function KbRouteError({
  error,
  reset,
  title,
  backToKnowledge = true,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
  backToKnowledge?: boolean;
}) {
  useEffect(() => {
    if (isDeploymentSkewError(error)) maybeReloadForDeploymentSkew(error);
  }, [error]);

  return (
    <PageFrame>
      <EmptyState
        icon={AlertCircle}
        title={title}
        description="Проверьте соединение и повторите попытку"
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={reset}>Повторить</Button>
            {backToKnowledge && (
              <Button variant="outline" asChild>
                <Link href="/knowledge">К базе знаний</Link>
              </Button>
            )}
          </div>
        }
      />
    </PageFrame>
  );
}
