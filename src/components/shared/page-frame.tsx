import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import s from "./page-frame.module.css";

/** Shared content width and gutters, matching the payroll workspace. */
export function PageFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(s.frame, className)} {...props} />;
}
