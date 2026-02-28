/**
 * GoTrue Auth Email Hook
 *
 * GoTrue calls this endpoint (POST) whenever it needs to send an auth email
 * (signup confirmation, password recovery, etc.).
 * We send the email directly via Resend using our own HTML templates.
 *
 * Docs: https://supabase.com/docs/guides/auth/auth-hooks#send-email-hook
 *
 * Required GoTrue env vars on the server:
 *   GOTRUE_HOOK_SEND_EMAIL_ENABLED=true
 *   GOTRUE_HOOK_SEND_EMAIL_URI=https://sheerly.app/api/auth/send-email
 */

import { NextRequest, NextResponse } from "next/server";
import { buildConfirmSignupHtml } from "@/lib/email-templates/confirm-signup";
import { buildResetPasswordHtml } from "@/lib/email-templates/reset-password";

interface GoTrueEmailHookPayload {
  user: {
    id: string;
    email: string;
  };
  email_data: {
    email_action_type: string;
    token: string;
    token_hash: string;
    redirect_to: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

export async function POST(req: NextRequest) {
  let payload: GoTrueEmailHookPayload;

  try {
    payload = (await req.json()) as GoTrueEmailHookPayload;
  } catch {
    // Malformed request — return 200 so GoTrue doesn't retry forever
    console.error("[send-email hook] Failed to parse request body");
    return NextResponse.json({});
  }

  const { user, email_data } = payload;
  const { email_action_type, token_hash, redirect_to, site_url } = email_data ?? {};
  const email = user?.email;

  if (!email || !email_action_type || !token_hash) {
    console.error("[send-email hook] Missing required fields", { email, email_action_type, token_hash });
    return NextResponse.json({});
  }

  // Construct the verification link that the user will click
  // Uses the Supabase / GoTrue public URL from the hook payload (site_url)
  // or falls back to NEXT_PUBLIC_SUPABASE_URL env var
  const supabaseUrl = (site_url ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const verifyParams = new URLSearchParams({
    token:       token_hash,
    type:        email_action_type,
    redirect_to: redirect_to ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://sheerly.app",
  });
  const actionLink = `${supabaseUrl}/auth/v1/verify?${verifyParams.toString()}`;

  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.RESEND_FROM_EMAIL ?? "noreply@sheerly.app";

  if (!apiKey) {
    console.error("[send-email hook] RESEND_API_KEY is not set");
    return NextResponse.json({});
  }

  let subject: string;
  let html: string;

  switch (email_action_type) {
    case "signup":
    case "email_change_new":
    case "email_change_current":
      subject = "Подтвердите email — Sheerly";
      html = buildConfirmSignupHtml({ to: email, actionLink });
      break;

    case "recovery":
      subject = "Сброс пароля — Sheerly";
      html = buildResetPasswordHtml({ to: email, actionLink });
      break;

    default:
      // Unknown action type — return success so GoTrue doesn't stall
      console.warn("[send-email hook] Unhandled email_action_type:", email_action_type);
      return NextResponse.json({});
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: email, subject, html }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[send-email hook] Resend API error:", res.status, err);
    } else {
      console.log("[send-email hook] Email sent:", email_action_type, "→", email);
    }
  } catch (e) {
    console.error("[send-email hook] Network error:", e);
  }

  // Always return 200 — GoTrue treats non-2xx as a hook failure and may retry
  return NextResponse.json({});
}
