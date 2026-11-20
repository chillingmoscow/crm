"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PlugZap } from "lucide-react";

import { PageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/** Error on any integrations screen: stays inside the page frame, offers a retry. */
export default function IntegrationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (isDeploymentSkewError(error)) maybeReloadForDeploymentSkew(error);
  }, [error]);

  return <PageFrame>
    <EmptyState icon={PlugZap} title="Не удалось открыть интеграции" description="Повторите попытку. Если ошибка не пропадает, вернитесь к списку интеграций"
      action={<div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" asChild><Link href="/settings/integrations">К интеграциям</Link></Button>
        <Button onClick={reset}>Повторить</Button>
      </div>} />
  </PageFrame>;
}
