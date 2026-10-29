import type { Appointment } from "./types";

/** Appointments arrive ordered by date, time, creation time and id descending. */
export function canScheduleCandidateTrial(appointments: Appointment[], status: string) {
  const latest = appointments.find((appointment) => appointment.kind === "interview");
  return ["interview", "trial"].includes(status) && latest?.outcome === "passed" &&
    !!latest.notes?.trim() && !!latest.starts_at && new Date(latest.starts_at).getTime() <= Date.now();
}

export function interviewFeedbackEntries(feedback: Appointment["interview_feedback"] | undefined) {
  const entries: [string, string][] = [];
  if (!feedback) return entries;
  if (feedback.punctuality) entries.push(["Пунктуальность", feedback.punctuality === "on_time" ? "Вовремя" : "Опоздал"]);
  if (feedback.appearance) entries.push(["Внешний вид", feedback.appearance]);
  if (feedback.communication) entries.push(["Общение", feedback.communication]);
  if (typeof feedback.smiled === "boolean") entries.push(["Улыбался", feedback.smiled ? "Да" : "Нет"]);
  return entries;
}
