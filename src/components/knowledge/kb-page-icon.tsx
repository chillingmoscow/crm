import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  colorTextClass,
  getKbLucideIcon,
  isKbLucideIcon,
} from "@/lib/knowledge/icons";

interface KbPageIconProps {
  icon: string | null | undefined;
  color?: string | null;
  /** Numeric pixel size for both lucide icon stroke и emoji glyph. */
  size?: number;
  /** Optional class on the outer span (для align/margin внутри строк). */
  className?: string;
  /** Fallback Lucide icon when `icon` пустое. По умолчанию FileText. */
  fallback?: typeof FileText;
}

/**
 * Универсальный рендерер иконки KB-страницы.
 *
 * `icon` может быть:
 *  - имя из реестра `KB_ICONS` (e.g. `book-open`) → рендерим Lucide
 *    с цветным тинтом из `color`;
 *  - произвольный текст / emoji (e.g. `📄`) → рендерим как glyph,
 *    цвет игнорируется (emoji уже цветные);
 *  - пустое → fallback Lucide-иконка серого цвета.
 *
 * Стороны вызова: tree, breadcrumb, page-editor title, recent list,
 * search results, mention menu, trash list.
 */
export function KbPageIcon({
  icon,
  color,
  size = 16,
  className,
  fallback,
}: KbPageIconProps) {
  if (icon && isKbLucideIcon(icon)) {
    const Icon = getKbLucideIcon(icon)!;
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center shrink-0",
          colorTextClass(color) || "text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size }}
      >
        <Icon className="w-full h-full" />
      </span>
    );
  }

  if (icon && icon.trim().length > 0) {
    // Emoji / свободный текст — игнорируем color (emoji уже цветной).
    return (
      <span
        className={cn("inline-flex items-center justify-center shrink-0 leading-none", className)}
        style={{ width: size, height: size, fontSize: size }}
      >
        {icon}
      </span>
    );
  }

  const Fallback = fallback ?? FileText;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center shrink-0 text-muted-foreground",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Fallback className="w-full h-full" />
    </span>
  );
}
