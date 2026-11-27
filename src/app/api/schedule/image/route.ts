import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { loadScheduleImage, scheduleImageScope } from "@/lib/schedule/schedule-image-data";
import { renderScheduleImage } from "@/lib/schedule/schedule-image-render";
import { scheduleImageFileName } from "@/lib/schedule/schedule-image";
import { isTemplateSort } from "@/lib/schedule/template-order";

/**
 * GET /api/schedule/image?week=YYYY-MM-DD&department=<id|none>&sort=time|name&part=N[&download=1]
 *
 * PNG расписания активного заведения на неделю — та же картинка, что бот
 * отправляет в Telegram. Бинарный ответ не укладывается в server action,
 * поэтому это маршрут. Права и данные — как у `sendScheduleImage`.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const part = Number(url.searchParams.get("part") ?? "0");
  const sort = url.searchParams.get("sort");
  try {
    const scope = await scheduleImageScope();
    const image = await loadScheduleImage(scope, {
      week: url.searchParams.get("week") ?? "",
      department: url.searchParams.get("department") || null,
      sort: isTemplateSort(sort) ? sort : undefined,
    });
    if (!Number.isInteger(part) || part < 0 || part >= image.parts.length)
      return NextResponse.json({ error: "Нет такой части картинки" }, { status: 404 });
    const response = await renderScheduleImage(image, part);
    if (url.searchParams.get("download") === "1") {
      const name = scheduleImageFileName(image, part);
      // ASCII-запасное имя + RFC 5987 для кириллицы; кавычки и переводы строк в имя не попадают.
      response.headers.set(
        "Content-Disposition",
        `attachment; filename="schedule.png"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
    }
    return response;
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Некорректная неделя" }, { status: 400 });
    const message = e instanceof Error ? e.message : "Не удалось сделать картинку";
    const status = /авториз/i.test(message) ? 401 : /планирует|заведение/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
