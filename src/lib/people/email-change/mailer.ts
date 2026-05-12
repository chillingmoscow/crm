/**
 * Email-change mailer — отправка письма подтверждения смены email
 * через общий nodemailer-транспорт (тот же что и invitation mailer).
 *
 * Используется server-action'ом `requestEmailChange` и cron'ом
 * pending-резенда (если когда-нибудь добавим).
 */

import { sendMail, isMailerConfigured } from "@/lib/mail/transporter";
import {
  buildEmailChangeHtml,
  type EmailChangeEmailParams,
} from "@/lib/email-templates/email-change";
import {
  buildEmailChangeAlertHtml,
  type EmailChangeAlertParams,
} from "@/lib/email-templates/email-change-alert";

export type { EmailChangeEmailParams, EmailChangeAlertParams };

export function hasMailerConfig(): boolean {
  return isMailerConfigured();
}

export async function sendEmailChangeConfirmation(
  params: EmailChangeEmailParams,
): Promise<void> {
  if (!isMailerConfigured()) {
    throw new Error("SMTP mailer не настроен");
  }
  await sendMail({
    to: params.to,
    subject: "Подтверждение смены email — Sheerly",
    html: buildEmailChangeHtml(params),
  });
}

/**
 * Alert на СТАРЫЙ email: «кто-то запросил смену адреса; если это не вы,
 * отзовите запрос». Шлём параллельно с confirm-письмом на новый адрес.
 * Если SMTP падает — это не блокирует запрос смены (alert не critical
 * path; confirm на новый email уже отправлен).
 */
export async function sendEmailChangeAlert(
  params: EmailChangeAlertParams,
): Promise<void> {
  if (!isMailerConfigured()) {
    throw new Error("SMTP mailer не настроен");
  }
  await sendMail({
    to: params.to,
    subject: "Запрошена смена email — Sheerly",
    html: buildEmailChangeAlertHtml(params),
  });
}
