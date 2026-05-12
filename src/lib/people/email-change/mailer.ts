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

export type { EmailChangeEmailParams };

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
