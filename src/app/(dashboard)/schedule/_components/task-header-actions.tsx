"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const TaskHeaderTarget = createContext<HTMLDivElement | null>(null);

export function TaskHeaderActions({ children }: { children: ReactNode }) {
  const target = useContext(TaskHeaderTarget);
  return target ? createPortal(children, target) : null;
}
