/** Keep opening an overlay from visually selecting its first button. */
export function focusOverlayContent(event: Event) {
  if (!(event.target instanceof HTMLElement)) return;

  event.preventDefault();
  const content = event.target;
  // Preserve intentional React autoFocus (for example, renaming a record).
  if (content.contains(document.activeElement) && document.activeElement !== content) return;

  // Command menus must accept typing immediately after the search shortcut.
  const input = content.querySelector<HTMLElement>("[autofocus], [cmdk-input]");
  (input ?? content).focus({ preventScroll: true });
}
