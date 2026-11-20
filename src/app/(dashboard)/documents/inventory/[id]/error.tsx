"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { PageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/** Ошибка карточки акта: без технических слов, с повтором и ссылкой к списку. */
export default function InventoryDocumentError({
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
        title="Не удалось открыть акт"
        description="Проверьте соединение и повторите попытку"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/documents/inventory">К списку актов</Link>
            </Button>
            <Button onClick={reset}>Повторить</Button>
          </div>
        }
      />
    </PageFrame>
  );
}
