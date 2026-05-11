"use client";

export function GalleryMenuSwitchIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      className="kb-gallery-menu-switch"
      data-checked={checked || undefined}
      aria-hidden
    >
      <span />
    </span>
  );
}
