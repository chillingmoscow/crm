/**
 * Invitation mailer — отправка письма-приглашения через общий
 * nodemailer-транспорт (см. @/lib/mail/transporter).
 *
 * Раньше конфиг и transporter жили прямо здесь; теперь вынесены в
 * @/lib/mail/transporter чтобы переиспользовать для email-change и
 * других будущих рассылок.
 */

import { sendMail, isMailerConfigured } from "@/lib/mail/transporter";
import { buildInvitationHtml } from "@/lib/email-templates/invitation";
import type { InvitationEmailParams } from "@/lib/email-templates/invitation";

export type { InvitationEmailParams };

export function hasCustomMailerConfig(): boolean {
  return isMailerConfigured();
}

export async function sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
  if (!isMailerConfigured()) {
    throw new Error("SMTP mailer не настроен");
  }
  await sendMail({
    to: params.to,
    subject: `Вас пригласили в ${params.venueName} — Sheerly`,
    html: buildInvitationHtml(params),
  });
}
