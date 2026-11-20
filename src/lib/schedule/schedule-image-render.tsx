import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import {
  DAY_COL,
  LABEL_TEXT,
  LAYOUT as L,
  OTHER_TEXT,
  rowHeight,
  scheduleImageHeight,
  slotHeight,
  type ImageSlot,
  type ScheduleImage,
} from "./schedule-image";

/**
 * PNG расписания (next/og) в раскладке «По шаблонам». Одна и та же картинка
 * уходит на скачивание и в Telegram, поэтому рисуется на сервере. Размеры и
 * высоты строк считает `schedule-image.ts` (шкала дизайн-системы ×2).
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
/** --palette-{c}-dot: точка цвета шаблона, как `ColorDot`. */
const DOT: Record<string, string> = {
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

/** Одна строка текста фиксированной высоты: всё, что не влезло, — «…». */
function Line({ text, width, size = L.font, height = L.line, weight = 400, color = C.foreground }: {
  text: string;
  /** Ширина обязательна: без неё «…» не сработает и текст вылезет в соседний столбец. */
  width: number;
  size?: number;
  height?: number;
  weight?: 400 | 500 | 600;
  color?: string;
}) {
  return (
    <div
      style={{
        display: "block",
        width,
        height,
        lineHeight: `${height}px`,
        fontSize: size,
        fontWeight: weight,
        color,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {text}
    </div>
  );
}

const SLOT_TEXT = DAY_COL - L.cellPad * 2 - L.slotPadX * 2;
function Slot({ slot }: { slot: ImageSlot }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: slotHeight(slot),
        padding: `${L.slotPadY}px ${L.slotPadX}px`,
        borderRadius: 12,
        background: SLOT_BG[slot.color] ?? SLOT_BG.gray,
      }}
    >
      {slot.title ? <Line text={slot.title} width={SLOT_TEXT} color={C.mutedForeground} /> : null}
      {slot.name.map((line, i) => (
        <Line key={`n${i}`} text={line} width={SLOT_TEXT} weight={i === 0 ? 600 : 400} />
      ))}
      {slot.time.map((line, i) => (
        <Line key={`t${i}`} text={line} width={SLOT_TEXT} color={C.mutedForeground} />
      ))}
    </div>
  );
}

export async function renderScheduleImage(image: ScheduleImage, part: number) {
  const current = image.parts[part];
  if (!current) throw new Error("Нет такой части картинки");
  const subtitle = [image.period, image.parts.length > 1 ? `${part + 1} из ${image.parts.length}` : ""]
    .filter(Boolean)
    .join(" · ");
  const border = `2px solid ${C.border}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: `0 ${L.pad}px`,
          background: C.background,
          fontFamily: "Inter",
          color: C.foreground,
        }}
      >
        <div style={{ height: L.header, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <Line text={image.venueName} width={L.width - L.pad * 2} size={40} height={52} weight={600} />
          <Line text={`Расписание · ${subtitle}`} width={L.width - L.pad * 2} size={28} height={40} color={C.mutedForeground} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", border, borderRadius: 16, background: C.card, overflow: "hidden" }}>
          <div style={{ display: "flex", height: L.headRow, background: C.muted, color: C.mutedForeground, fontSize: L.font, fontWeight: 500 }}>
            <div style={{ width: L.labelCol, display: "flex", alignItems: "center", paddingLeft: 24 }}>
              <Line text="Шаблоны смен" width={L.labelCol - 40} height={L.headRow} color={C.mutedForeground} weight={500} />
            </div>
            {image.days.map((d) => (
              <div
                key={d.date}
                style={{ width: DAY_COL, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: border }}
              >
                {`${d.weekday} ${d.day}`}
              </div>
            ))}
          </div>
          {current.rows.length === 0 && (
            <div
              style={{
                height: L.empty - 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                color: C.mutedForeground,
                borderTop: border,
              }}
            >
              Опубликованных смен нет
            </div>
          )}
          {current.rows.map((row) => (
            <div key={row.key} style={{ display: "flex", height: rowHeight(row), borderTop: border }}>
              <div style={{ width: L.labelCol, display: "flex", padding: `${L.rowPadY}px 16px ${L.rowPadY}px 24px`, gap: 12 }}>
                {row.color ? (
                  <div
                    style={{
                      width: L.dot,
                      height: L.dot,
                      marginTop: (L.titleLine - L.dot) / 2,
                      borderRadius: L.dot,
                      background: DOT[row.color] ?? DOT.gray,
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {row.title.map((line, i) => (
                    <Line
                      key={i}
                      text={line}
                      width={row.color ? LABEL_TEXT : OTHER_TEXT}
                      size={L.titleFont}
                      height={L.titleLine}
                      weight={500}
                    />
                  ))}
                  {row.subtitle.map((line, i) => (
                    <Line key={`s${i}`} text={line} width={LABEL_TEXT} color={C.mutedForeground} />
                  ))}
                </div>
              </div>
              {row.days.map((slots, i) => (
                <div
                  key={i}
                  style={{
                    width: DAY_COL,
                    display: "flex",
                    flexDirection: "column",
                    padding: L.cellPad,
                    gap: L.slotGap,
                    borderLeft: border,
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
      </div>
    ),
    {
      width: L.width,
      height: scheduleImageHeight(current),
      fonts: await loadFonts(),
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

/** PNG как байты — для отправки ботом. */
export async function renderScheduleImagePng(image: ScheduleImage, part: number) {
  return (await renderScheduleImage(image, part)).arrayBuffer();
}
