/**
 * Единые классы для overlay-затемнения во всех Radix-обёртках
 * (Dialog / Sheet / EditDrawer). Унифицируют: цвет (`bg-black/25`),
 * длительность открытия (200 ms) и закрытия (150 ms), easing.
 *
 * Любой новый overlay-компонент должен импортировать `overlayClass`
 * вместо ручного дублирования — см. docs/design-system.md § Overlays.
 */
export const overlayClass =
  "fixed inset-0 z-50 bg-black/25 " +
  "data-[state=open]:animate-in data-[state=closed]:animate-out " +
  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
  "data-[state=open]:duration-200 data-[state=closed]:duration-150 " +
  "data-[state=open]:ease-out data-[state=closed]:ease-in";

/**
 * Тайминги для самой панели (Sheet/EditDrawer contents). Длительности
 * совпадают с overlay'ем, чтобы fade и slide начинались/заканчивались
 * одновременно.
 */
export const overlayContentTiming =
  "data-[state=open]:duration-200 data-[state=closed]:duration-150 " +
  "data-[state=open]:ease-out data-[state=closed]:ease-in";
