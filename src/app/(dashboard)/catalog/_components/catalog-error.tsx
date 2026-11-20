"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { PageFrame, ProfilePageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/**
 * Ошибка загрузки раздела или карточки номенклатуры: в рамке страницы, без
 * технических слов, с повтором. У карточки — ещё и путь назад к списку.
 */
export function CatalogError({
  error,
  reset,
  title,
  back,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
  back?: { href: string; label: string };
}) {
  useEffect(() => {
    if (isDeploymentSkewError(error)) maybeReloadForDeploymentSkew(error);
  }, [error]);

  const Frame = back ? ProfilePageFrame : PageFrame;
  return (
    <Frame>
      <EmptyState
        icon={AlertCircle}
        title={title}
        description="Проверьте соединение и повторите попытку"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {back ? (
              <Button variant="outline" asChild>
                <Link href={back.href}>{back.label}</Link>
              </Button>
            ) : null}
            <Button onClick={reset}>Повторить</Button>
          </div>
        }
      />
    </Frame>
  );
}
