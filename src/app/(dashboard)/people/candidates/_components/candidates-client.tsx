"use client";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Settings2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TablePageHeader, TableControls } from "@/components/shared/table";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { format } from "date-fns";
import { candidateError } from "@/lib/candidates/errors";
import {
  CANDIDATE_STAGES,
  STATUSES,
  STATUS_CLASSES,
  type CandidateBoardData,
  type CandidatePage,
  type CandidatePermissions,
  type HiringOptions,
  type ListFilters,
} from "@/lib/candidates/types";
import { listCandidates } from "../actions";
import { FieldSelect, StatusBadge, plural } from "./fields";
import { RecruitingSettings } from "./recruiting-settings";
import { CandidateBoard } from "./candidate-board";
import {
  CandidateViewMenu,
  useCandidateView,
  FIELD_LABELS,
  candidateFieldText,
} from "./candidate-view";

export function CandidatesClient({
  initialBoard,
  preferenceKey,
  options,
  permissions,
}: {
  initialBoard: CandidateBoardData;
  preferenceKey: string;
  options: HiringOptions;
  permissions: CandidatePermissions;
}) {
  const view = useCandidateView(preferenceKey);
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [position, setPosition] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [preset, setPreset] = useState<string | null>(null),
    [searchOpen, setSearchOpen] = useState(false),
    [settings, setSettings] = useState(false),
    [boardTotal, setBoardTotal] = useState(initialBoard.total),
    [list, setList] = useState<CandidatePage | null>(null),
    [page, setPage] = useState(0),
    [listLoading, setListLoading] = useState(false),
    [listError, setListError] = useState(""),
    [listRevision, setListRevision] = useState(0);
  const params = useSearchParams(),
    listRequest = useRef(0),
    loadedList = useRef("");
  useEffect(() => {
    if (params.get("settings") === "1" && permissions.integrations)
      setSettings(true);
  }, [params, permissions.integrations]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const filters: ListFilters = useMemo(
    () => ({
      search: query,
      status,
      position,
      from: from || undefined,
      to: to || undefined,
    }),
    [query, status, position, from, to],
  );
  const listKey = JSON.stringify([
    filters,
    page,
    view.listPageSize,
    listRevision,
  ]);
  useEffect(() => {
    if (view.view !== "table" || loadedList.current === listKey) return;
    const request = ++listRequest.current;
    let cancelled = false;
    setListLoading(true);
    setListError("");
    listCandidates({
      ...filters,
      page,
      pageSize: view.listPageSize,
      view: "table",
    })
      .then((next) => {
        if (cancelled || request !== listRequest.current) return;
        loadedList.current = JSON.stringify([
          filters,
          next.page,
          view.listPageSize,
          listRevision,
        ]);
        setList(next);
        setPage(next.page);
      })
      .catch((e) => {
        if (!cancelled && request === listRequest.current)
          setListError(candidateError(e, "Не удалось загрузить список."));
      })
      .finally(() => {
        if (!cancelled && request === listRequest.current)
          setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, view.view]);
  const boardChanged = useCallback(() => setListRevision((n) => n + 1), []);
  const total =
    view.view === "board" ? boardTotal : (list?.total ?? boardTotal);
  const hasFilters = !!(status || position || from || to);
  const reset = () => {
    setStatus("");
    setPosition("");
    setFrom("");
    setTo("");
    setPreset(null);
    setPage(0);
  };
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-5 p-4 md:p-6">
      <TablePageHeader
        className="md:flex-wrap md:items-center [&>div:last-child]:max-w-full"
        title={
          <span className="inline-flex items-center gap-3">
            Кандидаты
            <span
              aria-hidden="true"
              className="rounded-md bg-muted px-2 py-1 text-sm font-normal tabular-nums text-muted-foreground"
            >
              {total}
            </span>
          </span>
        }
        actions={
          <>
            <TableControls
              className="min-w-0 max-w-full"
              search={{
                value: search,
                onChange: setSearch,
                open: searchOpen,
                onOpenChange: setSearchOpen,
                placeholder: "Имя, телефон или должность",
              }}
              filters={{
                active: hasFilters,
                content: (
                  <div className="w-72 space-y-4 p-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-medium">Фильтры</h2>
                      <Button variant="ghost" size="sm" onClick={reset}>
                        Сбросить
                      </Button>
                    </div>
                    <FieldSelect
                      label="Статус"
                      value={status}
                      onChange={(value) => {
                        setStatus(value);
                        setPage(0);
                      }}
                      options={[
                        { value: "", label: "Все статусы" },
                        ...Object.entries(CANDIDATE_STAGES).map(
                          ([value, label]) => ({ value, label }),
                        ),
                      ]}
                    />
                    <FieldSelect
                      label="Должность"
                      value={position}
                      onChange={(value) => {
                        setPosition(value);
                        setPage(0);
                      }}
                      options={[
                        { value: "", label: "Все должности" },
                        ...options.positions.map((p) => ({
                          value: p,
                          label: p,
                        })),
                      ]}
                    />
                    <div className="space-y-2 border-t pt-4">
                      <p className="text-[13px] font-medium">Дата заявки</p>
                      <DateRangeFilter
                        ariaLabel="Дата заявки"
                        value={{
                          start: from ? new Date(`${from}T12:00:00`) : null,
                          end: to ? new Date(`${to}T12:00:00`) : null,
                        }}
                        presetLabel={preset}
                        onChange={(range, label) => {
                          setFrom(
                            range.start
                              ? format(range.start, "yyyy-MM-dd")
                              : "",
                          );
                          setTo(
                            range.end ? format(range.end, "yyyy-MM-dd") : "",
                          );
                          setPreset(label);
                          setPage(0);
                        }}
                      />
                    </div>
                  </div>
                ),
              }}
            />
            <CandidateViewMenu state={view} />
            {permissions.integrations ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setSettings(true)}
              >
                <Settings2 className="mr-2 size-4" />
                Настройки
              </Button>
            ) : null}
          </>
        }
      />
      <p className="sr-only" aria-live="polite">
        {total} {plural(total, ["анкета", "анкеты", "анкет"])}
      </p>
      <div hidden={view.view !== "board"} className="min-w-0">
        <CandidateBoard
          initial={initialBoard}
          filters={filters}
          pageSize={view.boardPageSize}
          fields={view.visibleCards}
          active={view.view === "board"}
          canManage={permissions.manage}
          onTotalChange={setBoardTotal}
          onChanged={boardChanged}
        />
      </div>
      {view.view === "table" ? (
        <div className="min-w-0 space-y-3" aria-busy={listLoading}>
          {listError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <p>{listError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setListRevision((n) => n + 1)}
              >
                Повторить загрузку
              </Button>
            </div>
          ) : null}
          {listLoading ? (
            <p
              className="flex items-center gap-2 text-xs text-muted-foreground"
              role="status"
            >
              <Loader2 className="size-3 motion-safe:animate-spin" />
              Обновляем список…
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {view.visibleColumns.map((id) => (
                    <th
                      key={id}
                      className="whitespace-nowrap px-4 py-3 font-medium"
                    >
                      {FIELD_LABELS[id]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(list?.rows ?? []).map((c) => (
                  <tr key={c.id} className="border-t hover:bg-muted/30">
                    {view.visibleColumns.map((id) => (
                      <td key={id} className="max-w-72 px-4 py-3">
                        {id === "full_name" ? (
                          <Link
                            className="font-medium hover:text-brand"
                            href={`/people/candidates/${c.id}`}
                          >
                            {c.full_name}
                          </Link>
                        ) : id === "photo" ? (
                          c.photo_url ? (
                            <Image
                              unoptimized
                              width={36}
                              height={36}
                              alt=""
                              src={c.photo_url}
                              className="size-9 rounded-md object-cover"
                            />
                          ) : (
                            "—"
                          )
                        ) : id === "status" ? (
                          <StatusBadge
                            className={STATUS_CLASSES[c.status]}
                            label={STATUSES[c.status]}
                          />
                        ) : (
                          <span className="line-clamp-3 break-words">
                            {candidateFieldText(c, id)}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {!listLoading && !list?.rows.length ? (
                  <tr>
                    <td
                      colSpan={view.visibleColumns.length}
                      className="py-14 text-center text-muted-foreground"
                    >
                      {query || hasFilters
                        ? "По этим условиям анкет нет"
                        : "Новые анкеты появятся здесь после отправки формы на сайте."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {list?.total ?? 0}{" "}
              {plural(list?.total ?? 0, ["анкета", "анкеты", "анкет"])}
            </span>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Предыдущая страница списка"
                disabled={page === 0 || listLoading}
                onClick={() => setPage((n) => n - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="tabular-nums">
                {(list?.page ?? 0) + 1} из{" "}
                {Math.max(1, Math.ceil((list?.total ?? 0) / view.listPageSize))}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Следующая страница списка"
                disabled={
                  listLoading ||
                  (page + 1) * view.listPageSize >= (list?.total ?? 0)
                }
                onClick={() => setPage((n) => n + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {settings ? (
        <RecruitingSettings
          options={options}
          owner={permissions.owner}
          onClose={() => setSettings(false)}
        />
      ) : null}
    </div>
  );
}
