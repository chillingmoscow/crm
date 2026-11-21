"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/** «Повторить» у блока, который не загрузился: перечитывает страницу с сервера. */
export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-w-28"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Повторяем…" : "Повторить"}
    </Button>
  );
}
