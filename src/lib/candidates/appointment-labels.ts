import type { Appointment } from "./types";

export const APPOINTMENT_TITLES = { interview: "Собеседование", trial: "Стажировка" };
const outcomes = {
  interview: { scheduled: "Назначено", passed: "Пройдено", no_show: "Не пришёл", rejected: "Не подошёл", canceled: "Отменено" },
  trial: { scheduled: "Назначена", passed: "Пройдена", no_show: "Не пришёл", rejected: "Не подошёл", canceled: "Отменена" },
};
export function appointmentOutcomeLabel(kind: Appointment["kind"], outcome: string) {
  return outcomes[kind][outcome as Appointment["outcome"]] ?? "Не указан";
}
export const APPOINTMENT_OUTCOME_CLASSES = {
  scheduled: "bg-brand/10 text-brand",
  passed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  no_show: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  rejected: "bg-destructive/10 text-destructive",
  canceled: "bg-muted text-muted-foreground",
};
