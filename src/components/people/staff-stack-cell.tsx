/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import Link from "next/link";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { personInitials } from "@/lib/format/initials";
import { pluralRu } from "@/lib/format/plural";
import { avatarThumbUrl } from "@/lib/people/avatar-thumb";
import { cn } from "@/lib/utils";

export type StaffStackMember = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

const STACK = 3;

/** Круг 24px: фото или две буквы на сером, как у всех людей без фото. */
function MiniAvatar({
  person,
  className,
}: {
  person: StaffStackMember;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = avatarThumbUrl(person.avatarUrl) ?? person.avatarUrl;
  return (
    <span
      className={cn(
        "relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background",
        className,
      )}
    >
      <span aria-hidden>{personInitials(person.name)}</span>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          width={24}
          height={24}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

/**
 * Ячейка «Сотрудники» в списках должностей и подразделений: до трёх аватаров
 * и число. По наведению (или нажатию на телефоне) — карточка со списком
 * людей, каждый ведёт в свою карточку сотрудника.
 */
export function StaffStackCell({
  title,
  staff,
}: {
  /** Чьи это люди: название должности или подразделения. */
  title: string;
  staff: StaffStackMember[];
}) {
  const [open, setOpen] = useState(false);
  if (staff.length === 0)
    return <span className="text-muted-foreground">—</span>;

  const label = `${staff.length} ${pluralRu(staff.length, "сотрудник", "сотрудника", "сотрудников")}`;
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${title}`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((v) => !v);
          }}
          className="-mx-1 inline-flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex shrink-0 -space-x-1.5">
            {staff.slice(0, STACK).map((p) => (
              <MiniAvatar key={p.id} person={p} />
            ))}
          </span>
          <span className="truncate tabular-nums">{label}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        collisionPadding={16}
        className="w-72 max-w-[calc(100vw-32px)] p-1"
      >
        <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
          {title}
        </p>
        <ul className="max-h-72 overflow-y-auto">
          {staff.map((p) => (
            <li key={p.id}>
              <Link
                href={`/people/staff/${p.id}`}
                className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <MiniAvatar person={p} className="ring-0" />
                <span className="truncate">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}
