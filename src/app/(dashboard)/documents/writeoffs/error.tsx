"use client";
import { AlertCircle } from "lucide-react";
import { PageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
export default function WriteoffsError({ reset }: { reset: () => void }) {
  return (
    <PageFrame>
      <EmptyState
        icon={AlertCircle}
        title="Не удалось загрузить списания"
        description="Проверьте соединение и попробуйте ещё раз."
        action={<Button onClick={reset}>Повторить</Button>}
      />
    </PageFrame>
  );
}
