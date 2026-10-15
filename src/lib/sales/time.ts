const isoDate = /^\d{4}-\d{2}-\d{2}$/;
export function validDate(value: string) {
  if (!isoDate.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function addDays(date: string, count: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function zonedParts(now: Date, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((v) => [v.type, v.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}
export function businessDate(now: Date, timezone: string, startHour: number) {
  const p = zonedParts(now, timezone);
  return p.hour < startHour ? addDays(p.date, -1) : p.date;
}
export function localTimestamp(date: string, hour: number, timezone: string) {
  const wall = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const parts = zonedParts(new Date(instant), timezone);
    const represented = Date.parse(
      `${parts.date}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:00Z`,
    );
    instant += wall - represented;
  }
  return instant;
}
export function dayWindow(date: string, timezone: string, hour: number) {
  return {
    start: localTimestamp(date, hour, timezone),
    end: localTimestamp(addDays(date, 1), hour, timezone),
  };
}
