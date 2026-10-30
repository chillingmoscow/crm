"use client";
import { Button } from "@/components/ui/button";
export default function CandidatesError({ reset }: { reset: () => void }) {
  return (
    <div className="p-6 space-y-4">
      <h1>Не удалось открыть кандидатов</h1>
      <p className="text-muted-foreground">
        Проверьте доступ к разделу и подключение к базе данных.
      </p>
      <Button onClick={reset}>Повторить</Button>
    </div>
  );
}
