// Pure helpers for the fines chat notification (no server-only: tested by node).

export type NotifyRow = {
  kind: string;
  medium: "money" | "bonus" | "none";
  amount: number;
  reason: string;
  business_date: string;
  employee_name: string;
  warnings_in_month: number;
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function formatAdjustmentMessage(row: NotifyRow): string {
  const warning = row.kind === "warning";
  const category = warning ? "ПРЕДУПРЕЖДЕНИЕ" : row.amount < 0 ? "ШТРАФ" : "ПРЕМИЯ";
  const lines = [
    `<b>${category}</b>`,
    `📅  ${formatDate(row.business_date)}`,
    `👫  ${escapeHtml(row.employee_name)}`,
  ];
  if (!warning) {
    const amount = Math.abs(Number(row.amount));
    const text = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
    lines.push(row.medium === "bonus" ? `💰  ${text} бонусов` : `💰  ${text}₽`);
  }
  lines.push(`📜  ${escapeHtml(row.reason)}`);
  if (warning) lines.push(`📮 Кол-во предупреждений: ${row.warnings_in_month}`);
  return lines.join("\n");
}

/**
 * Report a message Telegram has already accepted. A failed report must never
 * turn into an error state (that would resend the message): the row stays in
 * `sending` and the problem is surfaced to the caller only.
 */
export async function reportDelivered(
  report: () => Promise<void>,
): Promise<{ idle: false; sent: true; error?: string }> {
  try {
    await report();
    return { idle: false, sent: true };
  } catch (e) {
    const detail = e instanceof Error && e.message ? e.message : "";
    return { idle: false, sent: true, error: `Сообщение отправлено, но результат не записан${detail ? `: ${detail}` : ""}`.slice(0, 500) };
  }
}
