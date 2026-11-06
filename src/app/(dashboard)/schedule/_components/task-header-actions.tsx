"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const TaskHeaderTarget = createContext<HTMLDivElement | null>(null);
export const TaskTitleTarget = createContext<
  ((title: string | null) => void) | null
>(null);

export function TaskPageTitle({ title }: { title: string | null }) {
  const setTitle = useContext(TaskTitleTarget);
  useEffect(() => {
    setTitle?.(title);
    return () => setTitle?.(null);
  }, [setTitle, title]);
  return null;
}

export function TaskHeaderActions({ children }: { children: ReactNode }) {
  const target = useContext(TaskHeaderTarget);
  return target ? createPortal(children, target) : null;
}
