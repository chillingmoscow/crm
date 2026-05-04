"use client";

import { createReactInlineContentSpec } from "@blocknote/react";

/**
 * Atomic @-mention сотрудника. Аналог kbPageMention'а, но с
 * мини-аватаркой (или инициалами в кружке как fallback) вместо
 * KB-page-icon'ы. Notion-style: chip жирным шрифтом, не link-цвета,
 * атомарный (backspace удаляет целиком).
 *
 * Persisted props: userId, fullName, avatarUrl.
 */
export const kbStaffMentionInlineContent = createReactInlineContentSpec(
  {
    type: "kbStaffMention",
    propSchema: {
      userId: { default: "" },
      fullName: { default: "" },
      avatarUrl: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const props = inlineContent.props as {
        userId: string;
        fullName: string;
        avatarUrl: string;
      };
      const initials = getInitials(props.fullName);
      return (
        <a
          href={`/people/staff/${props.userId}`}
          contentEditable={false}
          className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-foreground font-semibold no-underline hover:bg-accent transition-colors"
          draggable={false}
          data-kb-staff-mention={props.userId}
        >
          {props.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={props.avatarUrl}
              alt=""
              className="size-[14px] rounded-full object-cover bg-muted shrink-0"
            />
          ) : (
            <span className="size-[14px] rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-[8px] font-semibold shrink-0">
              {initials}
            </span>
          )}
          <span>@{props.fullName || "Без имени"}</span>
        </a>
      );
    },
    toExternalHTML: ({ inlineContent }) => {
      const props = inlineContent.props as {
        userId: string;
        fullName: string;
      };
      return (
        <a href={`/people/staff/${props.userId}`}>
          @{props.fullName || "Без имени"}
        </a>
      );
    },
  },
);

function getInitials(name: string): string {
  const parts = name.split(" ").filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}
