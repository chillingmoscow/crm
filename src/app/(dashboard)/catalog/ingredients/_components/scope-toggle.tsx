"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Тоггл дерева: «Этого заведения» (ингредиенты из актов активного
// venue) / «Весь каталог» (все ингредиенты аккаунта). Каталог общий —
// дублирования нет; это фильтр видимости (Модель C, #362).
export function ScopeToggle({ value }: { value: "venue" | "all" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const set = (next: "venue" | "all") => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "venue") params.delete("scope");
    else params.set("scope", "all");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="inline-flex overflow-hidden rounded-md border border-input text-sm">
      <button
        type="button"
        onClick={() => set("venue")}
        className={
          value === "venue"
            ? "bg-foreground px-3 py-1.5 text-background"
            : "bg-background px-3 py-1.5 text-muted-foreground hover:text-foreground"
        }
      >
        Этого заведения
      </button>
      <button
        type="button"
        onClick={() => set("all")}
        className={
          value === "all"
            ? "bg-foreground px-3 py-1.5 text-background"
            : "bg-background px-3 py-1.5 text-muted-foreground hover:text-foreground"
        }
      >
        Весь каталог
      </button>
    </div>
  );
}
