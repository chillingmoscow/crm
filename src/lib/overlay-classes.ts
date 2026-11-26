/**
 * Единые классы для overlay-затемнения во всех Radix-обёртках
 * (Dialog / AlertDialog / Sheet / EditDrawer): цвет `bg-black/25` и
 * движение — `.motion-overlay` в globals.css (проявление 300 мс по
 * `--ease-soft`, уход 160 мс `ease-in`, см. docs/motion.md).
 *
 * Любой новый overlay-компонент должен импортировать `overlayClass`
 * вместо ручного дублирования — см. docs/design-system.md § Overlays.
 */
export const overlayClass = "fixed inset-0 z-50 bg-black/25 motion-overlay";
