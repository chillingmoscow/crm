import type React from "react";

export const KB_FILE_SCHEME = "kbfile://";

export function stopBlockInteraction(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function stopBlockMenuAction(event: React.SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}
