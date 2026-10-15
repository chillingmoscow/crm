"use client";
import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import s from "./compensation-summary.module.css";
export function CompensationRow({ title, hint, icon, children, onEdit, editLabel = "Настроить" }: {
    title: string;
    hint?: string;
    icon: ReactNode;
    children: ReactNode;
    onEdit?: () => void;
    editLabel?: string;
}) {
    return <div className={s.row}><span className={s.icon}>{icon}</span><div className={s.identity}><h3>{title}</h3>{hint && <p>{hint}</p>}</div><div className={s.value}>{children}</div>{onEdit && <Button type="button" variant="ghost" onClick={onEdit} aria-label={`${editLabel}: ${title}`} className={s.configure}><SlidersHorizontal />{editLabel}</Button>}</div>;
}
export function CompensationRates({ solo, team, unit = "₽" }: {
    solo: number | null;
    team: number | null;
    unit?: string;
}) {
    const format = (v: number | null) => v === null ? "Не задано" : unit === "%" ? `${v}%` : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(v)} ₽`;
    return <div className={s.pair}><span><strong>{format(solo)}</strong><small>в одиночку</small></span><span><strong>{format(team)}</strong><small>вдвоём</small></span></div>;
}
