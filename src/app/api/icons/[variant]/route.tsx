import { renderAppIcon } from "@/lib/icons";

// PNG-иконки для manifest (Android/desktop). /api/ исключён из
// auth-middleware, поэтому отдаётся без редиректа на /login.
export const runtime = "nodejs";

const VARIANTS: Record<string, { size: number; maskable?: boolean }> = {
  "192": { size: 192 },
  "512": { size: 512 },
  maskable: { size: 512, maskable: true },
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ variant: string }> },
) {
  const { variant } = await ctx.params;
  const cfg = VARIANTS[variant];
  if (!cfg) return new Response("Not found", { status: 404 });
  return renderAppIcon(cfg.size, { maskable: cfg.maskable });
}
