import { paletteDot } from "@/lib/palette";
import { cn } from "@/lib/utils";

const sizes = {
  /** 8px — внутри мелкого текста: легенды, подписи 11–12px. */
  sm: "size-2",
  /** 10px — пункты выпадающих списков и меню. */
  md: "size-2.5",
  /** 12px — строки таблиц и списков, сводки. */
  lg: "size-3",
} as const;

/** Цвет, который пользователь задал сам (`#RRGGBB`): у статей финансов — так. */
const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * Точка цвета (шаблона смены, варианта, тега) — один вид во всём приложении.
 * Ставится в flex-ряд с `items-center`: точка по центру строки, а не по
 * верхней линии текста. Правила — docs/design-system.md § «Точка цвета».
 * Цвет — имя палитры или пользовательский hex (статьи финансов).
 */
export function ColorDot({
  color,
  size = "lg",
  className,
}: {
  color: string | null | undefined;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const hex = color && HEX.test(color) ? color : null;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 rounded-full", sizes[size], hex ? null : paletteDot(color), className)}
      style={hex ? { backgroundColor: hex } : undefined}
    />
  );
}
