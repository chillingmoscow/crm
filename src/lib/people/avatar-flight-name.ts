import type { CSSProperties } from "react";

/** Имя перехода аватара сотрудника (см. `avatar-flight.ts`). Без "use client" —
 *  нужен и серверной шапке карточки. */
export const flightName = (userId: string) => `staff-avatar-${userId}`;

/** Стиль аватара-цели в шапке карточки и её скелетоне. */
export function flightTargetStyle(userId: string): CSSProperties {
  return {
    viewTransitionName: flightName(userId),
    // view-transition-class нет в типах React — задаём строкой.
    ...({ viewTransitionClass: "staff-avatar" } as CSSProperties),
  };
}
