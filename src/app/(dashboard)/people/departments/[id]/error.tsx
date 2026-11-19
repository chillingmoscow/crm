"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Boxes } from "lucide-react";

import { ProfilePageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/** Ошибка загрузки карточки подразделения: остаёмся в рамке раздела, есть повтор. */
export default function DepartmentCardError({
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
        icon={Boxes}
        title="Не удалось открыть подразделение"
        description="Повторите попытку. Если ошибка не пропадает, вернитесь к списку и откройте подразделение снова"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/people/departments">К списку подразделений</Link>
            </Button>
            <Button onClick={reset}>Повторить</Button>
          </div>
        }
      />
    </ProfilePageFrame>
  );
}
