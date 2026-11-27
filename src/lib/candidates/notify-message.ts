/**
 * Сообщение о новой анкете в чат найма (Telegram, HTML). Без server-only:
 * текст проверяется тестами node. ФИО ведёт на анкету; телефон, Instagram
 * и Telegram — чтобы связаться с кандидатом прямо из чата.
 */
import { socialLink } from "./social-link.ts";

export type NotifyCandidate = {
  full_name: string;
  desired_position: string | null;
  age: number | null;
  phone: string | null;
  social: Record<string, string> | null;
};

const html = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const clean = (value: string | null | undefined) =>
  value?.replace(/\s+/g, " ").trim() || null;

export function ageLabel(age: number): string {
  const tens = age % 100;
  const last = age % 10;
  const word =
    tens >= 11 && tens <= 14 ? "лет" : last === 1 ? "год" : last >= 2 && last <= 4 ? "года" : "лет";
  return `${age} ${word}`;
}

/** Ссылка на соцсеть или просто подпись, если перейти некуда. */
function social(icon: string, kind: "instagram" | "telegram", raw: string | undefined) {
  const value = clean(raw);
  if (!value) return null;
  const link = socialLink(kind, value);
  const label = html(link.label);
  return `${icon} ${link.href ? `<a href="${html(link.href)}">${label}</a>` : label}`;
}

export function candidateNotifyMessage(candidate: NotifyCandidate, url: string): string {
  const position = clean(candidate.desired_position) ?? "Должность не указана";
  const age =
    candidate.age && Number.isInteger(candidate.age) && candidate.age > 0
      ? ageLabel(candidate.age)
      : null;
  const phone = clean(candidate.phone);
  const contacts = [
    phone && `📞 ${html(phone)}`,
    social("📷", "instagram", candidate.social?.instagram),
    social("✈️", "telegram", candidate.social?.telegram),
  ].filter(Boolean);

  return [
    "📝 <b>Новая анкета</b>",
    [
      `<a href="${html(url)}"><b>${html(clean(candidate.full_name) ?? "Без имени")}</b></a>`,
      html([position, age].filter(Boolean).join(" · ")),
      ...contacts,
    ].join("\n"),
  ].join("\n\n");
}
