"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";

import { ProfilePageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/** Ошибка загрузки: в рамке раздела, без технических слов, с повтором. */
export default function CounterpartyCardError({
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
    <ProfilePageFrame>
      <EmptyState
        icon={Building2}
        title="Не удалось открыть контрагента"
        description="Повторите попытку. Если ошибка не пропадает, вернитесь к списку и откройте карточку снова"
        action={(
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/finance/counterparties">К списку контрагентов</Link>
            </Button>
            <Button onClick={reset}>Повторить</Button>
          </div>
        )}
      />
    </ProfilePageFrame>
  );
}
