import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ImageRow, ImageSlot, ScheduleImage } from "./schedule-image";

/**
 * PNG расписания (next/og). Одна и та же картинка уходит на скачивание и в
 * Telegram, поэтому рисуется на сервере.
 *
 * Размеры — шкала дизайн-системы ×2: картинка 1200px шириной на телефоне
 * показывается примерно в 400pt, то есть каждый пиксель макета — два пикселя
 * картинки. Кегли 40/28/24 — это 20/14/12 из шкалы, радиусы 16/12 — 8/6.
 *
 * В растровой картинке нет CSS-переменных, поэтому цвета ниже — значения
 * токенов светлой темы из `globals.css` (комментарий — имя токена).
 */
const C = {
  background: "#fafafa", // --background
  card: "#ffffff",
  foreground: "#09090b", // --foreground
  muted: "#f4f4f5", // --muted
  mutedForeground: "#71717a", // --muted-foreground
  border: "#e4e4e7", // --border
};
/** --palette-{c}-bg; синий — bg-brand/10 поверх фона. */
const SLOT_BG: Record<string, string> = {
  gray: "#f3f4f6",
  brown: "#efe2d6",
  orange: "#ffedd5",
  yellow: "#fef9c3",
  green: "#d1fae5",
  blue: "#e3ecf9",
  purple: "#ede9fe",
  pink: "#fce7f3",
  red: "#fee2e2",
};
/** --palette-{c}-dot: полоска цвета шаблона, как в виде «Список». */
const SLOT_DOT: Record<string, string> = {
  gray: "#6b7280",
  brown: "#92664a",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#10b981",
  blue: "#1570ef",
  purple: "#8b5cf6",
  pink: "#ec4899",
  red: "#ef4444",
};

export const IMAGE_WIDTH = 1200;
const PAD = 48;
const NAME_COL = 280;
const DAY_COL = (IMAGE_WIDTH - PAD * 2 - NAME_COL) / 7;
const HEADER_H = 160;
const HEAD_ROW_H = 64;
const GROUP_ROW_H = 60;
const SLOT_H = 76;
const SLOT_GAP = 8;
const CELL_PAD = 8;
const ROW_MIN_H = 104;
const EMPTY_H = 200;
const FOOT = PAD;

const rowHeight = (row: ImageRow) => {
  const most = Math.max(1, ...row.days.map((d) => d.length));
  return Math.max(ROW_MIN_H, CELL_PAD * 2 + most * SLOT_H + (most - 1) * SLOT_GAP);
};

export function scheduleImageHeight(image: ScheduleImage, part: number) {
  const groups = image.parts[part]?.groups ?? [];
  const body = groups.length
    ? groups.reduce((sum, g) => sum + GROUP_ROW_H + g.rows.reduce((s, r) => s + rowHeight(r), 0), 0)
    : EMPTY_H;
  return HEADER_H + HEAD_ROW_H + body + FOOT;
}

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 600; style: "normal" }[]> | null = null;
function loadFonts() {
  // Inter из public/: в нём есть кириллица (встроенный шрифт next/og — только латиница).
  fonts ??= Promise.all(
    ([[400, "Regular"], [500, "Medium"], [600, "SemiBold"]] as const).map(async ([weight, file]) => ({
      name: "Inter",
      weight,
      style: "normal" as const,
      data: await readFile(path.join(process.cwd(), "public", "fonts", "inter", `Inter-${file}.ttf`)),
    })),
  ).catch((e) => {
    fonts = null;
    throw e;
  });
  return fonts;
}

function Slot({ slot }: { slot: ImageSlot }) {
  return (
    <div
      style={{
        display: "flex",
        height: SLOT_H,
        borderRadius: 12,
        background: SLOT_BG[slot.color] ?? SLOT_BG.gray,
        overflow: "hidden",
      }}
    >
      <div style={{ width: 6, background: SLOT_DOT[slot.color] ?? SLOT_DOT.gray }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 10 }}>
        <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2, color: C.foreground }}>{slot.start}</div>
        <div style={{ fontSize: 24, fontWeight: 400, lineHeight: 1.2, color: C.mutedForeground }}>{slot.end}</div>
      </div>
    </div>
  );
}

const oneLine = {
  display: "block",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

export async function renderScheduleImage(image: ScheduleImage, part: number) {
  const current = image.parts[part];
  if (!current) throw new Error("Нет такой части картинки");
  const height = scheduleImageHeight(image, part);
  const subtitle = [image.period, image.parts.length > 1 ? `${part + 1} из ${image.parts.length}` : ""]
    .filter(Boolean)
    .join(" · ");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: `0 ${PAD}px`,
          background: C.background,
          fontFamily: "Inter",
          color: C.foreground,
        }}
      >
        <div style={{ height: HEADER_H, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ ...oneLine, fontSize: 40, fontWeight: 600, lineHeight: 1.3 }}>{image.venueName}</div>
          <div style={{ ...oneLine, fontSize: 28, lineHeight: 1.45, color: C.mutedForeground }}>
            {`Расписание · ${subtitle}`}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: `2px solid ${C.border}`,
            borderRadius: 16,
            background: C.card,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", height: HEAD_ROW_H, background: C.muted, color: C.mutedForeground }}>
            <div style={{ width: NAME_COL, display: "flex", alignItems: "center", paddingLeft: 24, fontSize: 24, fontWeight: 500 }}>
              Сотрудники
            </div>
            {image.days.map((d) => (
              <div
                key={d.date}
                style={{
                  width: DAY_COL,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderLeft: `2px solid ${C.border}`,
                  fontSize: 24,
                  fontWeight: 500,
                }}
              >
                {`${d.weekday} ${d.day}`}
              </div>
            ))}
          </div>
          {current.groups.length === 0 && (
            <div
              style={{
                height: EMPTY_H - 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                color: C.mutedForeground,
                borderTop: `2px solid ${C.border}`,
              }}
            >
              Опубликованных смен нет
            </div>
          )}
          {current.groups.map((group) => (
            <div key={group.id} style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  height: GROUP_ROW_H,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 24,
                  borderTop: `2px solid ${C.border}`,
                  background: C.muted,
                  fontSize: 28,
                  fontWeight: 600,
                }}
              >
                {`${group.name} · ${group.rows.length}`}
              </div>
              {group.rows.map((row) => (
                <div key={row.key} style={{ display: "flex", height: rowHeight(row), borderTop: `2px solid ${C.border}` }}>
                  <div
                    style={{
                      width: NAME_COL,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      padding: "0 16px 0 24px",
                    }}
                  >
                    <div style={{ ...oneLine, fontSize: 28, fontWeight: 500, lineHeight: 1.3 }}>{row.name}</div>
                    {row.role ? (
                      <div style={{ ...oneLine, fontSize: 24, lineHeight: 1.4, color: C.mutedForeground }}>{row.role}</div>
                    ) : null}
                  </div>
                  {row.days.map((slots, i) => (
                    <div
                      key={i}
                      style={{
                        width: DAY_COL,
                        display: "flex",
                        flexDirection: "column",
                        padding: CELL_PAD,
                        gap: SLOT_GAP,
                        borderLeft: `2px solid ${C.border}`,
                      }}
                    >
                      {slots.map((slot, j) => (
                        <Slot key={j} slot={slot} />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: IMAGE_WIDTH,
      height,
      fonts: await loadFonts(),
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

/** PNG как байты — для отправки ботом. */
export async function renderScheduleImagePng(image: ScheduleImage, part: number) {
  return (await renderScheduleImage(image, part)).arrayBuffer();
}
