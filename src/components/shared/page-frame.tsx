import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import s from "./page-frame.module.css";

/** Shared content width and gutters, matching the payroll workspace. */
export function PageFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(s.frame, className)} {...props} />;
}

/**
 * Рамка карточки сущности: `PageFrame` и одна колонка 720px по центру.
 * В колонке стоят шапка, вкладки и содержимое всех вкладок, поэтому
 * ширина не меняется при переключении. См. docs/design-system.md,
 * «Ширина контента».
 */
export function ProfilePageFrame({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <PageFrame {...props}>
      <div
        className={cn(
          "mx-auto flex w-full min-w-0 max-w-[720px] flex-col gap-6",
          className,
        )}
      >
        {children}
      </div>
    </PageFrame>
  );
}
