import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Exclude: Next.js internals, static assets, API routes, and static HTML files.
    // API routes handle auth themselves; HTML files must be publicly accessible
    // (GoTrue fetches email templates from /public/email-templates/).
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};
