import type { ShiftTemplate } from "@/lib/schedule/types";

export function TemplateName({ name, subtitle }: Pick<ShiftTemplate, "name" | "subtitle">) {
  return (
    <span className="block min-w-0 break-words leading-tight">
      <span className="block font-medium">{name}</span>
      {subtitle && (
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
          {subtitle}
        </span>
      )}
    </span>
  );
}
