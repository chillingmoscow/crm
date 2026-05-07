import Link from "next/link";

/**
 * Read-only рендер BlockNote CommentBody для page-level комментариев.
 *
 * Body — массив paragraph-блоков; inline-content — text-runs или
 * `kbStaffMention` chip'ы. Стиль chip'ов matches `kbStaffMention`'у в
 * редакторе (см. globals.css → `[data-kb-staff-mention]`) — bold
 * foreground без подчёркивания, hover-accent.
 *
 * Используется в `<PageCommentItem>`. Дублирует логику
 * CommentBodyRenderer из kb-floating-thread.tsx — логика тривиальная
 * и заводить shared-helper ради двух call-site'ов смысла мало.
 */
export function CommentBodyRenderer({ body }: { body: unknown }) {
  if (!Array.isArray(body) || body.length === 0) {
    return <span className="italic text-muted-foreground">пусто</span>;
  }
  return (
    <>
      {body.map((block, blockIdx) => {
        if (!block || typeof block !== "object") return null;
        const b = block as { content?: unknown };
        if (!Array.isArray(b.content) || b.content.length === 0) {
          return blockIdx > 0 ? <br key={blockIdx} /> : null;
        }
        return (
          <span key={blockIdx} className="block whitespace-pre-wrap break-words">
            {b.content.map((item, i) => {
              if (!item || typeof item !== "object") return null;
              const it = item as {
                type?: string;
                text?: string;
                props?: {
                  userId?: string;
                  fullName?: string;
                  avatarUrl?: string;
                };
              };
              if (it.type === "text" && typeof it.text === "string") {
                return <span key={i}>{it.text}</span>;
              }
              if (
                it.type === "kbStaffMention" &&
                typeof it.props?.userId === "string"
              ) {
                const fullName = it.props.fullName ?? "Без имени";
                const avatarUrl = it.props.avatarUrl ?? "";
                const initials = getInitialsForChip(fullName);
                return (
                  <Link
                    key={i}
                    href={`/people/staff/${it.props.userId}`}
                    className="inline-flex items-center gap-1 px-1 py-0.5 mx-px rounded text-foreground font-semibold no-underline hover:bg-accent transition-colors align-baseline"
                  >
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarUrl}
                        alt=""
                        className="size-[14px] rounded-full object-cover bg-muted shrink-0"
                      />
                    ) : (
                      <span className="size-[14px] rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-[8px] font-semibold shrink-0">
                        {initials}
                      </span>
                    )}
                    <span>{fullName}</span>
                  </Link>
                );
              }
              return null;
            })}
          </span>
        );
      })}
    </>
  );
}

function getInitialsForChip(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Reverse-derive plain text + `@FullName` placeholder для edit-mode.
 *  Используется PageCommentItem для pre-fill'а composer'а при «Edit». */
export function extractPlainText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  const lines: string[] = [];
  for (const block of body) {
    if (!block || typeof block !== "object") continue;
    const b = block as { content?: unknown };
    if (!Array.isArray(b.content)) continue;
    const parts: string[] = [];
    for (const item of b.content) {
      if (!item || typeof item !== "object") continue;
      const it = item as {
        type?: string;
        text?: string;
        props?: { fullName?: string };
      };
      if (it.type === "text" && typeof it.text === "string") {
        parts.push(it.text);
      } else if (
        it.type === "kbStaffMention" &&
        typeof it.props?.fullName === "string"
      ) {
        parts.push(`@${it.props.fullName}`);
      }
    }
    lines.push(parts.join(""));
  }
  return lines.join("\n");
}
