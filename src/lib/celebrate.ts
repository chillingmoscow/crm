/**
 * Конфетти на большое событие: из двух точек с боков экрана и залп из
 * центра, ~2,5 с. Используется при сохранении профиля и при «Принять на
 * работу». С `prefers-reduced-motion: reduce` ничего не происходит.
 */
export async function celebrate() {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Библиотека грузится по первому залпу, а не с панелью найма и профилем.
  const { default: confetti } = await import("canvas-confetti");
  const end = Date.now() + 2500;
  const colors = ["#1570EF", "#3b82f6", "#16a34a", "#f59e0b", "#ec4899"];
  const base = { colors, disableForReducedMotion: true } as const;
  (function frame() {
    confetti({ ...base, particleCount: 4, angle: 60, spread: 55, origin: { x: 0, y: 0.6 } });
    confetti({ ...base, particleCount: 4, angle: 120, spread: 55, origin: { x: 1, y: 0.6 } });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  confetti({ ...base, particleCount: 80, spread: 100, origin: { y: 0.4 } });
}
