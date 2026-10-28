"use client";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageFrame } from "@/components/shared/page-frame";
export default function StatisticsError({ reset }: { reset: () => void }) {
  return (
    <PageFrame>
      <EmptyState
        icon={AlertCircle}
        title="Не удалось загрузить статистику"
        description="Проверьте соединение и попробуйте ещё раз."
        action={
          <Button variant="outline" onClick={reset}>
            Повторить
          </Button>
        }
      />
    </PageFrame>
  );
}
