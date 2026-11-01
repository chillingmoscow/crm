"use client";
import { PageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <PageFrame className="space-y-4">
      <h1 className="text-2xl font-semibold">Не удалось загрузить списания</h1>
      <Button onClick={reset}>Повторить</Button>
    </PageFrame>
  );
}
