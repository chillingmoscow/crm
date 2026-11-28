"use client";

import { createReactInlineContentSpec } from "@blocknote/react";
import { PersonAvatar } from "@/components/people/person-avatar";

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
      return (
        <a
          href={`/people/staff/${props.userId}`}
          contentEditable={false}
          className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-foreground font-semibold no-underline hover:bg-accent transition-colors"
          draggable={false}
          data-kb-staff-mention={props.userId}
        >
          <PersonAvatar src={props.avatarUrl} name={props.fullName || "Без имени"} size="xs" interactive={false} />
          <span>{props.fullName || "Без имени"}</span>
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
          {props.fullName || "Без имени"}
        </a>
      );
    },
  },
);

