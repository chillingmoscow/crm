import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { candidatePhotos } from "@/lib/candidates/data";
import { uuid } from "@/lib/candidates/schema";

const candidateIds = z.array(uuid).min(1).max(100);

export async function GET(request: NextRequest) {
  const ids = candidateIds.safeParse(request.nextUrl.searchParams.get("ids")?.split(","));
  if (!ids.success) return NextResponse.json({}, { status: 400 });

  try {
    const photos = await candidatePhotos([...new Set(ids.data)]);
    return NextResponse.json(photos, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({}, { status: 403 });
  }
}
