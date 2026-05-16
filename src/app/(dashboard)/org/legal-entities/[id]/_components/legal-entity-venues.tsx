"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Loader2, Link as LinkIcon, Unlink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  attachVenueToLegalEntity,
  detachVenueFromLegalEntity,
  type AccountVenueRow,
} from "@/lib/org/legal-entities";

type LegalEntityNameMap = Record<string, string>;

type Props = {
  legalEntityId: string;
  /** All venues of the active account (with their current default_legal_entity_id). */
  venues: AccountVenueRow[];
  /** id → name lookup for showing where a venue is currently attached. */
  legalEntityNames: LegalEntityNameMap;
  /** When true, attach/detach buttons are hidden (read-only mode). */
  readOnly?: boolean;
};

export function LegalEntityVenues({
  legalEntityId,
  venues,
  legalEntityNames,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [busyVenueId, setBusyVenueId] = useState<string | null>(null);

  const attached = venues.filter((v) => v.default_legal_entity_id === legalEntityId);
  const others   = venues.filter((v) => v.default_legal_entity_id !== legalEntityId);

  const onAttach = async (venueId: string) => {
    setBusyVenueId(venueId);
    const { error } = await attachVenueToLegalEntity(legalEntityId, venueId);
    setBusyVenueId(null);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Заведение прикреплено");
    router.refresh();
  };

  const onDetach = async (venueId: string) => {
    setBusyVenueId(venueId);
    const { error } = await detachVenueFromLegalEntity(venueId);
    setBusyVenueId(null);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Заведение откреплено");
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Заведения</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Currently attached */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Прикреплены к этому юрлицу
          </div>
          {attached.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Пока ни одно заведение не указывает это юрлицо как «по умолчанию».
            </p>
          ) : (
            <ul className="divide-y rounded-md border bg-background">
              {attached.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <Link
                    href={`/org/venues/${v.id}`}
                    className="flex items-center gap-1.5 text-sm hover:underline underline-offset-2"
                  >
                    {v.name}
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onDetach(v.id)}
                      disabled={busyVenueId === v.id}
                    >
                      {busyVenueId === v.id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Unlink className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Открепить
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Other venues — visible in both modes; attach buttons hide when
            the caller is read-only. View-only users still need to see the
            full account ↔ legal-entity topology, just without action
            buttons. */}
        {others.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">
              Остальные заведения аккаунта
            </div>
            <ul className="divide-y rounded-md border bg-background">
              {others.map((v) => {
                const currentLeName = v.default_legal_entity_id
                  ? legalEntityNames[v.default_legal_entity_id] ?? "другое юрлицо"
                  : null;
                return (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/org/venues/${v.id}`}
                        className="text-sm hover:underline underline-offset-2"
                      >
                        {v.name}
                      </Link>
                      {currentLeName && (
                        <div className="text-xs text-muted-foreground">
                          Сейчас: {currentLeName}
                        </div>
                      )}
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onAttach(v.id)}
                        disabled={busyVenueId === v.id}
                        data-tip={
                          currentLeName
                            ? `Заведение перейдёт от «${currentLeName}» к этому юрлицу`
                            : undefined
                        }
                      >
                        {busyVenueId === v.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {currentLeName ? "Перепривязать" : "Привязать"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {others.length === 0 && attached.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            В аккаунте пока нет заведений.
            {!readOnly && (
              <>
                {" "}Создайте первое в разделе{" "}
                <Link href="/org/venues" className="underline underline-offset-2">
                  Заведения
                </Link>
                .
              </>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
