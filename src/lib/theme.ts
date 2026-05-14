/**
 * Smooth theme transition helper.
 *
 * `next-themes` свапает класс `dark`/`light` на <html> мгновенно —
 * цвета (`background`, `foreground`, `border` и т.д.) перерисовываются
 * без анимации и юзер видит характерный «flash».
 *
 * `applyTheme` навешивает `.theme-transition` на 220ms вокруг
 * `setTheme(next)`. CSS-правило в `src/app/globals.css` даёт всем
 * элементам 200ms color-transition на это время; после класс
 * удаляется и обычные hover/focus переходы не тормозят.
 *
 * Эта функция должна вызываться ТОЛЬКО на клиенте (см. внутренний
 * guard на `typeof document`).
 */
export function applyTheme(
  next: string,
  setTheme: (theme: string) => void,
): void {
  if (typeof document === "undefined") {
    setTheme(next);
    return;
  }
  const root = document.documentElement;
  root.classList.add("theme-transition");
  setTheme(next);
  window.setTimeout(() => {
    root.classList.remove("theme-transition");
  }, 220);
}
