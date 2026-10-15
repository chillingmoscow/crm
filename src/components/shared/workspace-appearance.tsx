"use client";

import { createContext, useContext } from "react";
import s from "./workspace-appearance.module.css";

const WorkspaceAppearanceContext = createContext(false);

/** Shared dashboard appearance, including controls rendered through portals. */
export function WorkspaceAppearance({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceAppearanceContext.Provider value={true}>
      <div className={s.workspace}>{children}</div>
    </WorkspaceAppearanceContext.Provider>
  );
}

export function useWorkspaceAppearance() {
  return useContext(WorkspaceAppearanceContext);
}
