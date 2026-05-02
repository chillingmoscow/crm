"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createKbPage } from "@/lib/knowledge/pages";

/**
 * "Новая страница" CTA used on the landing screen and the empty state.
 * Creates a root-level page and navigates to it.
 */
export function CreateRootPageButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    setPending(true);
    const { slug, error } = await createKbPage({});
    setPending(false);
    if (error || !slug) {
      toast.error(error ?? "Не удалось создать страницу");
      return;
    }
    router.push(`/knowledge/${slug}`);
  };

  return (
    <Button onClick={onClick} disabled={pending} size="sm">
      <Plus className="size-4" />
      Новая страница
    </Button>
  );
}
