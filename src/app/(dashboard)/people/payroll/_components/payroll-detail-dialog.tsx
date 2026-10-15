"use client";

import { useRef, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PayrollEmployeeCell } from "./payroll-employee-cell";
import s from "./payroll-detail-dialog.module.css";

/** Shared detail surface for payroll records; creation forms remain separate. */
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
  const panel = useRef<HTMLDivElement>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent ref={panel} tabIndex={-1} className={s.dialog} onOpenAutoFocus={(event) => {
      event.preventDefault(); panel.current?.focus({preventScroll:true});
    }}>
      <header className={s.header}>
        {actions && <div className={s.headerActions}>{actions}</div>}
        <DialogTitle className={s.title}>{title}</DialogTitle>
        <DialogDescription className={s.description}>{description}</DialogDescription>
      </header>
      <div className={s.body}>
        {employee && <div className={s.employee}><PayrollEmployeeCell {...employee} /></div>}
        {amount != null && <div className={s.summary}>
          <div><span>{amountLabel}</span><strong>{amount}</strong></div>{status}
        </div>}
        <div className={s.details}>{children}</div>
      </div>
      {footer && <footer className={s.footer}>{footer}</footer>}
    </DialogContent>
  </Dialog>;
}
