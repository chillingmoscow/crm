import { buildInvitationHtml } from "@/lib/email-templates/invitation";
import type { InvitationEmailParams } from "@/lib/email-templates/invitation";

export type { InvitationEmailParams };

export async function sendInvitationEmail(params: InvitationEmailParams) {
  const apiKey = process.env.RESEND_API_KEY ?? process.env.SMTP_PASS;
  const from   = process.env.RESEND_FROM_EMAIL ?? process.env.SMTP_ADMIN_EMAIL ?? "noreply@sheerly.app";

  if (!apiKey) {
    throw new Error("RESEND_API_KEY не задан");
  }

  const subject = `Вас пригласили в ${params.venueName} — Sheerly`;
  const html    = buildInvitationHtml(params);

  const response = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [params.to], subject, html }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error: ${response.status} ${body}`);
  }
}
