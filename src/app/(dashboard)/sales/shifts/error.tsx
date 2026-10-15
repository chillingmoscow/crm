"use client";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
export default function ErrorSalesShifts({ reset }: { reset: () => void }) {
  return (
    <div className="px-4 md:px-6">
      <EmptyState
        icon={AlertCircle}
        title="Не удалось загрузить смены"
        description="Проверьте соединение и попробуйте ещё раз."
        action={
          <Button variant="outline" onClick={reset}>
            Повторить
          </Button>
        }
      />
    </div>
  );
}
