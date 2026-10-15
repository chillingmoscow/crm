"use client";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="p-8 space-y-4">
      <h2>Не удалось загрузить график</h2>
      <p className="text-muted-foreground">
        Проверьте подключение и повторите попытку.
      </p>
      <Button onClick={reset}>Повторить загрузку</Button>
    </div>
  );
}
