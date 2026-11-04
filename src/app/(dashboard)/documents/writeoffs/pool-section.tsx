"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WARNING_BADGE_CLASS } from "@/components/shared/inventory-status-badge";
import type { WriteoffRow } from "@/lib/stock/writeoff-view";
import {
  writeoffChargeRubles,
  writeoffCounts,
  type WriteoffPoolAssignment,
} from "@/lib/stock/writeoff-pools";
import type { WriteoffData } from "./actions";

type Pool = WriteoffPoolAssignment["pool"];
const poolNames: Record<Pool, string> = {
  shared: "Вся команда",
  department: "Подразделение",
  personal: "Один сотрудник",
  excluded: "Не удерживать",
};

/** Блок «Кто платит» в карточке акта: видно, разнесён ли акт, и можно разнести. */
export function PoolSection({
  row,
  data,
  canAssign,
  onAssign,
}: {
  row: WriteoffRow;
  data: WriteoffData;
  canAssign: boolean;
  onAssign: (pool: Pool | null, key: string | null) => Promise<void>;
}) {
  const doc = row.native;
  const mark = row.assignment;
  const [pool, setPool] = useState<Pool | "">(mark?.pool ?? "");
  const [key, setKey] = useState(mark?.key ?? "");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  if (!doc) return null;

  const counts = writeoffCounts(doc);
  const rubles = writeoffChargeRubles(doc.payload.kind, doc.payload.lines);
  const noKey = pool === "shared" || pool === "excluded";
  const zero = counts && rubles === 0;
  const complete =
    noKey || ((pool === "department" || pool === "personal") && !!key);
  const changed =
    pool !== (mark?.pool ?? "") || (key || null) !== (mark?.key ?? null);

  const departments = data.targets.departments.filter(
    (d) => !d.archived || d.id === mark?.key,
  );
  const employees = data.targets.employees.filter(
    (e) => e.active || e.id === mark?.key,
  );

  async function run(kind: "save" | "clear") {
    setBusy(kind);
    try {
      if (kind === "clear") {
        await onAssign(null, null);
        setPool("");
        setKey("");
      } else {
        await onAssign(pool as Pool, noKey ? null : key);
      }
      toast.success(kind === "clear" ? "Разнесение снято" : "Акт разнесён");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось сохранить разнесение",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="space-y-4 rounded-xl border p-4"
      aria-label="Кто платит"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Кто платит</h3>
        {row.poolState === "unassigned" && (
          <Badge
            variant="outline"
            className={`font-normal ${WARNING_BADGE_CLASS}`}
          >
            Не разнесён
          </Badge>
        )}
      </div>
      <p className="break-words text-sm">
        {mark ? (
          row.pool
        ) : zero ? (
          <span className="text-muted-foreground">
            Сумма акта 0 ₽: разносить его не нужно, месяц он не блокирует.
          </span>
        ) : counts ? (
          <span className="text-muted-foreground">
            Пока не выбрано. Пока акт не разнесён, месяц не посчитан.
          </span>
        ) : (
          <span className="text-muted-foreground">
            {doc.payload.processed
              ? "Акт пропал из источника и в расчёт не идёт."
              : "Черновик в расчёт не идёт, пока его не проведут."}
          </span>
        )}
      </p>
      {mark && !counts && (
        <p className="text-xs text-muted-foreground">
          {doc.payload.processed
            ? "Акт пропал из источника и в расчёт не идёт. Разнесение сохранилось: если акт вернётся, оно применится."
            : "Черновик в расчёт не идёт, пока его не проведут. Выбор сохранится."}
        </p>
      )}
      {rubles !== null && counts && mark?.pool !== "excluded" && (
        <p className="text-xs text-muted-foreground">
          К разнесению: {rubles.toLocaleString("ru-RU")} ₽ — каждая позиция
          округлена отдельно.
        </p>
      )}
      {doc.payload.kind === "personal" && !mark && (
        <p className="rounded-lg bg-muted p-3 text-xs">
          Личное потребление сотрудник оплачивает сам, это не удержание. Обычно
          здесь выбирают «Не удерживать».
        </p>
      )}
      {canAssign ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="writeoff-pool">Плательщик</Label>
            <Select
              value={pool}
              onValueChange={(v) => {
                setPool(v as Pool);
                setKey("");
              }}
            >
              <SelectTrigger id="writeoff-pool" className="w-full">
                <SelectValue placeholder="Выберите, кто платит" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(poolNames) as Pool[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {poolNames[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {pool === "department" && (
            <div className="space-y-2">
              <Label htmlFor="writeoff-department">Подразделение</Label>
              <Select value={key} onValueChange={setKey}>
                <SelectTrigger id="writeoff-department" className="w-full">
                  <SelectValue placeholder="Выберите подразделение" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                      {d.archived ? " (в архиве)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {pool === "personal" && (
            <div className="space-y-2">
              <Label htmlFor="writeoff-employee">Сотрудник</Label>
              <Select value={key} onValueChange={setKey}>
                <SelectTrigger id="writeoff-employee" className="w-full">
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                      {e.active ? "" : " (не работает)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!complete || !changed || busy !== null}
              onClick={() => void run("save")}
            >
              {busy === "save" && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Сохранить
            </Button>
            {mark && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void run("clear")}
              >
                {busy === "clear" && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Снять разнесение
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Разносить акты может сотрудник с отдельным правом. Если нужно,
          обратитесь к владельцу аккаунта.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Акт разносится целиком: разделить его по позициям нельзя.
      </p>
    </section>
  );
}
