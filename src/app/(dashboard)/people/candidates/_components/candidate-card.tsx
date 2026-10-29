"use client";
import Link from "next/link";
import Image from "next/image";
import { GripVertical, Loader2 } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { Candidate } from "@/lib/candidates/types";
import {
  candidateFieldText,
  FIELD_LABELS,
  type CandidateField,
} from "./candidate-view";
import { plural } from "./fields";

export function CandidateCardBody({
  candidate: c,
  fields,
}: {
  candidate: Candidate;
  fields: CandidateField[];
}) {
  const shown = new Set(fields);
  return (
    <>
      <div className="flex items-start gap-3">
        {shown.has("photo") ? (
          c.photo_url ? (
            <Image
              unoptimized
              src={c.photo_url}
              alt=""
              draggable={false}
              width={40}
              height={40}
              className="size-10 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
              {c.full_name.slice(0, 1)}
            </div>
          )
        ) : null}
        <div className="min-w-0 pr-4">
          <p className="break-words text-sm font-medium">{c.full_name}</p>
          {shown.has("desired_position") || shown.has("age") ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[
                shown.has("desired_position")
                  ? c.desired_position || "Должность не указана"
                  : "",
                shown.has("age") && c.age
                  ? `${c.age} ${plural(c.age, ["год", "года", "лет"])}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
      {fields
        .filter((id) => !["photo", "desired_position", "age"].includes(id))
        .map((id) => {
          if (
            (c[id as keyof Candidate] === null ||
              c[id as keyof Candidate] === "") &&
            id !== "submitted_at"
          )
            return null;
          return (
            <p
              key={id}
              className="mt-3 line-clamp-2 break-words text-xs text-muted-foreground"
            >
              {id === "submitted_at"
                ? ""
                : `${id === "salary_expectation" ? "Ожидания" : FIELD_LABELS[id]}: `}
              {candidateFieldText(c, id)}
            </p>
          );
        })}
    </>
  );
}
export function CandidateCard({
  candidate,
  fields,
  disabled,
  saving,
  register,
}: {
  candidate: Candidate;
  fields: CandidateField[];
  disabled: boolean;
  saving: boolean;
  register: (id: string, node: HTMLElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: candidate.id,
    disabled,
  });
  return (
    <article
      ref={(node) => {
        setNodeRef(node);
        register(candidate.id, node);
      }}
      data-candidate-id={candidate.id}
      onPointerDown={(event) => listeners?.onPointerDown?.(event)}
      className={cn(
        "group relative touch-pan-y rounded-lg border bg-card transition-[border-color,opacity] duration-150 hover:border-brand/40 motion-reduce:transition-none",
        saving && "border-brand/50",
        isDragging && "opacity-25",
      )}
    >
      <Link
        href={`/people/candidates/${candidate.id}`}
        draggable={false}
        className="block rounded-lg p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <CandidateCardBody candidate={candidate} fields={fields} />
        {saving ? (
          <span
            className="mt-2 flex items-center gap-1.5 text-xs text-brand"
            role="status"
          >
            <Loader2 className="size-3 motion-safe:animate-spin" />
            Сохраняем…
          </span>
        ) : null}
      </Link>
      {!disabled || isDragging ? (
        <button
          type="button"
          {...attributes}
          onKeyDown={(event) => listeners?.onKeyDown?.(event)}
          aria-label={`Переместить кандидата ${candidate.full_name}`}
          className="absolute right-1 top-2 flex size-7 touch-none items-center justify-center rounded text-muted-foreground opacity-50 hover:bg-muted hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
    </article>
  );
}
