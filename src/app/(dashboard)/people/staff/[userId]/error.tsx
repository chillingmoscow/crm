"use client";

import { useEffect } from "react";
import Link from "next/link";
import { UserX } from "lucide-react";

import { ProfilePageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/** Ошибка загрузки карточки сотрудника: остаёмся в рамке раздела, есть повтор. */
export default function StaffCardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Устаревшая версия приложения после выкладки: перезагружаемся, как и
  // общий обработчик ошибок (src/app/error.tsx).
  useEffect(() => {
    if (isDeploymentSkewError(error)) maybeReloadForDeploymentSkew(error);
  }, [error]);

  return (
    <ProfilePageFrame>
      <EmptyState
        icon={UserX}
        title="Не удалось открыть карточку сотрудника"
        description="Повторите попытку. Если ошибка не пропадает, вернитесь к списку и откройте карточку снова."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/people/staff">К списку сотрудников</Link>
            </Button>
            <Button onClick={reset}>Повторить</Button>
          </div>
        }
      />
    </ProfilePageFrame>
  );
}
