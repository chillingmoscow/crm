type InvitationEmailParams = {
  to: string;
  actionLink: string;
  venueName: string;
  accountName: string | null;
  inviterName: string | null;
  roleName: string | null;
  existingUser: boolean;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildInvitationHtml(params: InvitationEmailParams) {
  const venueName = escapeHtml(params.venueName);
  const accountName = params.accountName ? escapeHtml(params.accountName) : null;
  const inviterName = params.inviterName ? escapeHtml(params.inviterName) : "Администратор";
  const roleName = params.roleName ? escapeHtml(params.roleName) : "сотрудник";
  const actionLink = escapeHtml(params.actionLink);

  const intro = params.existingUser
    ? "Вас пригласили присоединиться к заведению в Sheerly."
    : "Вас пригласили в Sheerly. Перейдите по ссылке, чтобы завершить регистрацию и присоединиться к заведению.";

  const actionText = params.existingUser
    ? "Принять приглашение"
    : "Завершить регистрацию";

  const accountLine = accountName ? `<p style="margin:0 0 8px;"><strong>Аккаунт:</strong> ${accountName}</p>` : "";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color:#111827; line-height:1.5; padding:24px; background:#f9fafb;">
      <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:24px;">
        <h2 style="margin:0 0 12px; font-size:22px;">Приглашение в Sheerly</h2>
        <p style="margin:0 0 16px;">${intro}</p>
        <p style="margin:0 0 8px;"><strong>Заведение:</strong> ${venueName}</p>
        ${accountLine}
        <p style="margin:0 0 8px;"><strong>Роль:</strong> ${roleName}</p>
        <p style="margin:0 0 20px;"><strong>Пригласил:</strong> ${inviterName}</p>
        <a href="${actionLink}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:8px; font-weight:600;">
          ${actionText}
        </a>
        <p style="margin:18px 0 0; font-size:12px; color:#6b7280;">
          Если кнопка не работает, откройте ссылку вручную:<br />
          <a href="${actionLink}" style="color:#2563eb; word-break:break-all;">${actionLink}</a>
        </p>
      </div>
    </div>
  `;
}

export async function sendInvitationEmail(params: InvitationEmailParams) {
  const apiKey = process.env.RESEND_API_KEY ?? process.env.SMTP_PASS;
  const from = process.env.RESEND_FROM_EMAIL ?? process.env.SMTP_ADMIN_EMAIL ?? "noreply@sheerly.app";

  if (!apiKey) {
    throw new Error("RESEND_API_KEY не задан");
  }

  const subject = params.existingUser
    ? `Вас пригласили в ${params.venueName}`
    : `Завершите регистрацию в ${params.venueName}`;

  const html = buildInvitationHtml(params);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error: ${response.status} ${body}`);
  }
}
