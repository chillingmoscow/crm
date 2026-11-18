"use client";

import type { ReactNode } from "react";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { PayrollEmployeeCell } from "./payroll-employee-cell";
import s from "./payroll-detail-dialog.module.css";
import tabStyle from "@/components/shared/workspace-tabs.module.css";

/**
 * Боковая панель записей и форм зарплаты. Это обычный `EditDrawer` (520px,
 * вплотную к краю) с двумя готовыми блоками сверху: сотрудник и ключевая
 * сумма. Своего каркаса у панели нет — см. `docs/design-system.md`,
 * «Боковая панель».
 */
export function PayrollDetailDialog({open, onOpenChange, title, description, employee, amount, amountLabel, status, actions, footer, children}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  employee?: { name: string; role?: string | null; avatarUrl?: string | null };
  amount?: ReactNode;
  amountLabel?: string;
  status?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <EditDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description || undefined}
      headerActions={actions}
      footer={footer}
    >
      {employee && <PayrollEmployeeCell {...employee} />}
      {amount != null && (
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{amountLabel}</p>
            <p className="mt-1 break-words text-3xl font-semibold tabular-nums">{amount}</p>
          </div>
          {status}
        </div>
      )}
      {/* Вкладки внутри панели («Детали / История») — тот же общий вид
          представления, что и на странице, без уменьшенной копии. */}
      <div className={`${s.details} ${tabStyle.tabs}`}>{children}</div>
    </EditDrawer>
  );
}
