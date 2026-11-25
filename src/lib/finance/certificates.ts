/**
 * Сертификаты и лицензии контрагента: виды и статус срока. Общие для
 * сервера и браузера.
 */

/** За сколько дней до конца срока сертификат считается истекающим. */
export const CERTIFICATE_ALERT_DAYS = 30;

export type CertificateKind = "conformity_certificate" | "conformity_declaration" | "alcohol_license" | "other";

export const CERTIFICATE_KINDS: { value: CertificateKind; label: string }[] = [
  { value: "conformity_certificate", label: "Сертификат соответствия" },
  { value: "conformity_declaration", label: "Декларация о соответствии" },
  { value: "alcohol_license", label: "Лицензия на алкоголь" },
  { value: "other", label: "Другое" },
];

export function isCertificateKind(value: unknown): value is CertificateKind {
  return CERTIFICATE_KINDS.some((kind) => kind.value === value);
}

export function certificateKindLabel(kind: string): string {
  return CERTIFICATE_KINDS.find((k) => k.value === kind)?.label ?? "Документ";
}

export type CertificateStatus = {
  tone: "expired" | "expiring" | "ok" | "none";
  label: string;
  /** Дней до конца срока; null — бессрочный. */
  daysLeft: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/** Статус по дате окончания (`ГГГГ-ММ-ДД`) относительно сегодняшней. */
export function certificateStatus(validUntil: string | null, today: string): CertificateStatus {
  if (!validUntil) return { tone: "none", label: "Бессрочный", daysLeft: null };
  const daysLeft = dayNumber(validUntil) - dayNumber(today);
  if (daysLeft < 0) return { tone: "expired", label: "Просрочен", daysLeft };
  if (daysLeft === 0) return { tone: "expiring", label: "Истекает сегодня", daysLeft };
  if (daysLeft <= CERTIFICATE_ALERT_DAYS) return { tone: "expiring", label: `Истекает через ${daysLeft} дн.`, daysLeft };
  return { tone: "ok", label: "Действует", daysLeft };
}
