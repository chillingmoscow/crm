import type { KbAnalyticsTopUser } from "@/lib/knowledge/analytics";

/** Топ-юзеров по активности в KB. Server-component. Рядом с топ-
 *  страницами на /knowledge/analytics. */
export function KbAnalyticsTopUsers({
  rows,
}: {
  rows: KbAnalyticsTopUser[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 px-2">
        За выбранный период никто не читал базу знаний.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-px">
      {rows.map((row, idx) => (
        <li
          key={row.user_id}
          className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent transition-colors"
        >
          <span className="w-5 text-right text-xs font-mono tabular-nums text-muted-foreground">
            {idx + 1}.
          </span>
          <Avatar name={row.name} avatarUrl={row.avatar_url} />
          <span className="flex-1 truncate text-sm font-medium">
            {row.name}
          </span>
          <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
            {row.unique_pages} стр · {row.session_count} сессий
          </span>
          <span className="w-20 text-right text-sm font-medium tabular-nums">
            {formatDuration(row.total_seconds)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}ч ${remMin}м` : `${hours}ч`;
}

/** 28×28 avatar — initials fallback, как в MiniAvatar (entity-info-popover). */
function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className="size-7 rounded-full object-cover bg-muted shrink-0"
      />
    );
  }
  return (
    <span className="size-7 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-xs font-semibold shrink-0">
      {initials}
    </span>
  );
}
