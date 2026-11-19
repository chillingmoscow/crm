import type { StatusTone } from "@/components/ui/status-badge";
import type { Appointment } from "./types";

export const APPOINTMENT_TITLES = { interview: "Собеседование", trial: "Стажировка" };
const outcomes = {
  interview: { scheduled: "Назначено", passed: "Пройдено", no_show: "Не пришёл", rejected: "Не подошёл", canceled: "Отменено" },
  trial: { scheduled: "Назначена", passed: "Пройдена", no_show: "Не пришёл", rejected: "Не подошёл", canceled: "Отменена" },
};
export function appointmentOutcomeLabel(kind: Appointment["kind"], outcome: string) {
  return outcomes[kind][outcome as Appointment["outcome"]] ?? "Не указан";
}
export const APPOINTMENT_OUTCOME_TONES: Record<Appointment["outcome"], StatusTone> = {
  scheduled: "info",
  passed: "success",
  no_show: "warning",
  rejected: "danger",
  canceled: "neutral",
};
