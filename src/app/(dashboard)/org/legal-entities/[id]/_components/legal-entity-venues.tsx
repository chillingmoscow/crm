"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ProfileSection,
  ProfileSectionAddButton,
} from "@/components/shared/profile-section";
import {
  attachVenueToLegalEntity,
  detachVenueFromLegalEntity,
  type AccountVenueRow,
} from "@/lib/org/legal-entities";

function VenueTile() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <Building2 className="size-4" />
    </span>
  );
}

/**
 * Заведения юрлица: у кого оно «по умолчанию». Привязка меняет поле
 * заведения, поэтому кнопки — по праву правки заведений, а не юрлиц.
 */
export function LegalEntityVenues({
  legalEntityId,
  venues,
  legalEntityNames,
  canEdit,
}: {
  legalEntityId: string;
  /** Действующие заведения аккаунта с их текущим юрлицом. */
  venues: AccountVenueRow[];
  legalEntityNames: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);

  const attached = venues.filter((v) => v.default_legal_entity_id === legalEntityId);
  const others = venues.filter((v) => v.default_legal_entity_id !== legalEntityId);

  const run = (venueId: string, action: () => Promise<{ error: string | null }>, done: string) => {
    setBusyId(venueId);
    startTransition(async () => {
      const { error } = await action();
      setBusyId(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(done);
      setAttachOpen(false);
      router.refresh();
    });
  };

  return (
    <ProfileSection
      title="Заведения"
      description="Юрлицо подставляется в финансовые документы этих заведений по умолчанию"
      actions={
        canEdit ? (
          <Popover open={attachOpen} onOpenChange={setAttachOpen}>
            <PopoverTrigger asChild>
              <ProfileSectionAddButton
                disabled={isPending || others.length === 0}
                data-tip={
                  others.length === 0
                    ? venues.length === 0
                      ? "В аккаунте пока нет заведений"
                      : "Все заведения уже работают через это юрлицо"
                    : undefined
                }
              >
                Привязать заведение
              </ProfileSectionAddButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 max-w-[calc(100vw-24px)] p-1">
              <div className="max-h-72 overflow-y-auto" aria-label="Заведения аккаунта">
                {others.map((v) => {
                  const current = v.default_legal_entity_id
                    ? legalEntityNames[v.default_legal_entity_id] ?? "другое юрлицо"
                    : null;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          v.id,
                          () => attachVenueToLegalEntity(legalEntityId, v.id),
                          `«${v.name}» теперь работает через это юрлицо`,
                        )
                      }
                      className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
                    >
                      <span className="w-full truncate">{v.name}</span>
                      {current ? (
                        <span className="w-full truncate text-xs text-muted-foreground">
                          Сейчас: {current}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        ) : undefined
      }
    >
      {attached.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {venues.length === 0 ? "В аккаунте пока нет заведений" : "Заведений пока нет"}
        </p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {attached.map((v) => (
            <li key={v.id} className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2">
              <VenueTile />
              <Link
                href={`/org/venues/${v.id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium transition-colors duration-200 hover:text-brand"
                data-tip={v.name}
              >
                {v.name}
              </Link>
              {canEdit ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="touch-target size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    run(v.id, () => detachVenueFromLegalEntity(v.id), `«${v.name}» отвязано от юрлица`)
                  }
                  disabled={isPending && busyId === v.id}
                  aria-label={`Отвязать заведение «${v.name}»`}
                  data-tip="Отвязать заведение"
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </ProfileSection>
  );
}
