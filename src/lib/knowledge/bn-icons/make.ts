import { createElement, type ComponentType, type SVGProps } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Значок в форме react-icons (`IconType`: `size`, `className`, `color`,
 * `title`) поверх Lucide. BlockNote рисует свои кнопки значками react-icons
 * (набор Remix, заливные глифы); через подмену модулей в next.config.ts они
 * становятся линейными Lucide той же толщины, что во всём приложении
 * (docs/design-system.md → «База знаний» → «Значки и кегли»).
 */
type BnIconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number | string;
  title?: string;
  color?: string;
};

export function makeBnIcon(icon: LucideIcon): ComponentType<BnIconProps> {
  function BnIcon({ size, title, color, ...rest }: BnIconProps) {
    return createElement(icon, {
      ...(rest as Record<string, unknown>),
      width: size ?? 16,
      height: size ?? 16,
      color,
      "aria-hidden": title ? undefined : true,
      "aria-label": title,
    });
  }
  BnIcon.displayName = `BnIcon(${icon.displayName ?? "Lucide"})`;
  return BnIcon;
}
