"use client";
import { Button } from "@/components/ui/button";
import { PageFrame } from "@/components/shared/page-frame";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <PageFrame>
      <div className="rounded-xl border p-8">
        <h1 className="text-lg font-semibold">Не удалось загрузить сведения</h1>
        <p className="my-3 text-sm text-muted-foreground">
          Проверьте выбранное заведение и доступ к настройкам зарплаты.
        </p>
        <Button variant="outline" onClick={reset}>
          Повторить
        </Button>
      </div>
    </PageFrame>
  );
}
