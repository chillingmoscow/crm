"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getVenueHalls,
  createVenueHall,
  renameVenueHall,
  deleteVenueHall,
  getHallLayout,
  saveHallLayout,
  type Hall,
  type HallLayout,
  type PlanObject,
} from "../hall-actions";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_CANVAS_WIDTH = 1200;
const DEFAULT_CANVAS_HEIGHT = 760;
const MIN_TABLE_SIZE = 72;
const MIN_PARTITION_HEIGHT = 10;
const MIN_PARTITION_WIDTH = 40;
const ROTATION_SNAP_THRESHOLD = 6;
const DRAFT_PREFIX = "planner:draft:";

// ── Types ────────────────────────────────────────────────────

type HallDraft = Pick<
  HallLayout,
  "hall_id" | "canvas_width" | "canvas_height" | "objects"
> & { saved_at: string };

type Interaction =
  | {
      mode: "drag";
      objectId: string;
      startX: number;
      startY: number;
      initialX: number;
      initialY: number;
    }
  | {
      mode: "resize";
      objectId: string;
      startX: number;
      startY: number;
      initialWidth: number;
      initialHeight: number;
      minWidth: number;
      minHeight: number;
    }
  | {
      mode: "rotate";
      objectId: string;
      centerX: number;
      centerY: number;
      pointerAngleOffset: number;
    };

// ── Helpers ──────────────────────────────────────────────────

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeAngle(value: number) {
  let angle = value % 360;
  if (angle < 0) angle += 360;
  return angle;
}

function snapToRightAngles(angle: number): { angle: number; snapped: boolean } {
  const normalized = normalizeAngle(angle);
  const targets = [0, 90, 180, 270, 360];
  for (const target of targets) {
    const effectiveTarget = target === 360 ? 0 : target;
    const diff = Math.min(
      Math.abs(normalized - target),
      Math.abs(normalized - effectiveTarget)
    );
    if (diff <= ROTATION_SNAP_THRESHOLD) return { angle: effectiveTarget, snapped: true };
  }
  return { angle: Math.round(normalized), snapped: false };
}

function createObject(kind: "table" | "partition", shape: "rect" | "circle", tableNumber?: string): PlanObject {
  return {
    id: uid(),
    kind,
    shape,
    x: 120,
    y: 120,
    width: kind === "partition" ? 240 : 100,
    height: kind === "partition" ? 10 : 100,
    rotation: 0,
    table_number: tableNumber,
    capacity_comfortable: kind === "table" ? 4 : undefined,
    capacity_max: kind === "table" ? 6 : undefined,
  };
}


function defaultLayout(hallId: string): HallLayout {
  return {
    hall_id: hallId,
    canvas_width: DEFAULT_CANVAS_WIDTH,
    canvas_height: DEFAULT_CANVAS_HEIGHT,
    objects: [],
    updated_at: new Date().toISOString(),
  };
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function draftKey(hallId: string) {
  return `${DRAFT_PREFIX}${hallId}`;
}

function parseDraft(raw: string | null, hallId: string): HallDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HallDraft>;
    if (
      parsed.hall_id !== hallId ||
      typeof parsed.canvas_width !== "number" ||
      typeof parsed.canvas_height !== "number" ||
      !Array.isArray(parsed.objects) ||
      typeof parsed.saved_at !== "string"
    ) return null;
    return {
      hall_id: parsed.hall_id,
      canvas_width: parsed.canvas_width,
      canvas_height: parsed.canvas_height,
      objects: parsed.objects as PlanObject[],
      saved_at: parsed.saved_at,
    };
  } catch {
    return null;
  }
}

// ── Hall Name Dialog ──────────────────────────────────────────

function HallNameDialog({
  title,
  initialValue,
  isPending,
  onConfirm,
  onCancel,
}: {
  title: string;
  initialValue: string;
  isPending: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 bg-background rounded-xl border shadow-xl w-full max-w-sm p-6">
        <h3 className="font-semibold text-base mb-4">{title}</h3>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onConfirm(value);
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Название зала"
          className="mb-4"
        />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            size="sm"
            disabled={isPending || !value.trim()}
            onClick={() => onConfirm(value)}
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
            {title === "Новый зал" ? "Создать" : "Сохранить"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────

export function FloorPlanTab({ venueId }: { venueId: string }) {
  const [halls, setHalls] = useState<Hall[]>([]);
  const [selectedHallId, setSelectedHallId] = useState<string | null>(null);
  const [layout, setLayout] = useState<HallLayout | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [hallDialog, setHallDialog] = useState<{ mode: "create" | "rename"; value: string } | null>(null);
  const [rotationSnapActive, setRotationSnapActive] = useState(false);
  const [isPending, startTransition] = useTransition();

  const interactionRef = useRef<Interaction | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLDivElement>(null);

  const selectedObject = useMemo(
    () => layout?.objects.find((item) => item.id === selectedObjectId) ?? null,
    [layout, selectedObjectId]
  );

  const statusText = useMemo(() => {
    if (!selectedHallId) return "";
    if (isDirty && draftSavedAt) return "Черновик · есть несохранённые изменения";
    if (isDirty) return "Есть несохранённые изменения";
    if (draftSavedAt) return "Черновик сохранён локально";
    return "";
  }, [selectedHallId, isDirty, draftSavedAt]);

  // ── Draft localStorage helpers ────────────────────────────

  const saveDraftToLocalStorage = (hallId: string, current: HallLayout, savedAt: string) => {
    const payload: HallDraft = {
      hall_id: hallId,
      canvas_width: current.canvas_width,
      canvas_height: current.canvas_height,
      objects: current.objects,
      saved_at: savedAt,
    };
    localStorage.setItem(draftKey(hallId), JSON.stringify(payload));
  };

  const readDraftFromLocalStorage = (hallId: string): HallDraft | null => {
    const parsed = parseDraft(localStorage.getItem(draftKey(hallId)), hallId);
    if (!parsed) { localStorage.removeItem(draftKey(hallId)); return null; }
    return parsed;
  };

  const clearDraftFromLocalStorage = (hallId: string) => {
    localStorage.removeItem(draftKey(hallId));
  };

  // ── Layout resolution ─────────────────────────────────────

  const resolveHallLayout = async (
    hallId: string,
    preferDraft: boolean
  ): Promise<{ layout: HallLayout; draftAt: string | null; fromDraft: boolean }> => {
    if (preferDraft) {
      const draft = readDraftFromLocalStorage(hallId);
      if (draft) {
        return {
          layout: {
            hall_id: draft.hall_id,
            canvas_width: draft.canvas_width,
            canvas_height: draft.canvas_height,
            objects: draft.objects,
            updated_at: draft.saved_at,
          },
          draftAt: draft.saved_at,
          fromDraft: true,
        };
      }
    }
    const nextLayout = await getHallLayout(hallId);
    return { layout: nextLayout ?? defaultLayout(hallId), draftAt: null, fromDraft: false };
  };

  // ── Object mutation helpers ───────────────────────────────

  const mutateObjects = (fn: (current: PlanObject[]) => PlanObject[]) => {
    setLayout((prev) => {
      if (!prev) return prev;
      return { ...prev, objects: fn(prev.objects) };
    });
    setIsDirty(true);
  };

  const updateObject = (id: string, patch: Partial<PlanObject>) => {
    mutateObjects((prev) =>
      prev.map((obj) => (obj.id === id ? { ...obj, ...patch } : obj))
    );
  };

  // ── Hall loading ──────────────────────────────────────────

  const loadHallLayout = (hallId: string, preferDraft = true) => {
    startTransition(async () => {
      const next = await resolveHallLayout(hallId, preferDraft);
      setSelectedObjectId(null);
      setLayout(next.layout);
      setSelectedHallId(hallId);
      setIsDirty(next.fromDraft);
      setDraftSavedAt(next.draftAt);
      if (next.fromDraft) toast.info("Восстановлен локальный черновик");
    });
  };

  const persistCurrentDraftNow = () => {
    if (!selectedHallId || !layout || !isDirty) return;
    const now = new Date().toISOString();
    saveDraftToLocalStorage(selectedHallId, layout, now);
    setDraftSavedAt(now);
  };

  // ── Init: load halls on tab mount ─────────────────────────

  useEffect(() => {
    getVenueHalls(venueId).then((loadedHalls) => {
      setHalls(loadedHalls);
      if (loadedHalls.length > 0) {
        loadHallLayout(loadedHalls[0].id, true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  // ── Autosave draft ────────────────────────────────────────

  useEffect(() => {
    if (!selectedHallId || !layout || !isDirty) return;
    const timer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      saveDraftToLocalStorage(selectedHallId, layout, savedAt);
      setDraftSavedAt(savedAt);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [selectedHallId, layout, isDirty]);

  // ── Esc closes inspector ──────────────────────────────────

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspectorOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  // ── FAB outside-click collapse ────────────────────────────

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!fabRef.current) return;
      if (!fabRef.current.contains(event.target as Node)) setFabOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // ── Pointer move / up (drag, resize, rotate) ─────────────

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (!current) return;
      setIsDirty(true);

      if (current.mode === "drag") {
        setRotationSnapActive(false);
        const nextX = current.initialX + (event.clientX - current.startX);
        const nextY = current.initialY + (event.clientY - current.startY);
        setLayout((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            objects: prev.objects.map((obj) =>
              obj.id === current.objectId
                ? { ...obj, x: Math.round(nextX), y: Math.round(nextY) }
                : obj
            ),
          };
        });
        return;
      }

      if (current.mode === "resize") {
        setRotationSnapActive(false);
        const width = Math.max(
          current.minWidth,
          current.initialWidth + (event.clientX - current.startX)
        );
        const height = Math.max(
          current.minHeight,
          current.initialHeight + (event.clientY - current.startY)
        );
        setLayout((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            objects: prev.objects.map((obj) =>
              obj.id === current.objectId
                ? { ...obj, width: Math.round(width), height: Math.round(height) }
                : obj
            ),
          };
        });
        return;
      }

      // rotate
      const pointerAngle =
        (Math.atan2(
          event.clientY - current.centerY,
          event.clientX - current.centerX
        ) * 180) / Math.PI;
      const nextAngle = snapToRightAngles(pointerAngle - current.pointerAngleOffset);
      setRotationSnapActive(nextAngle.snapped);
      setLayout((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          objects: prev.objects.map((obj) =>
            obj.id === current.objectId ? { ...obj, rotation: nextAngle.angle } : obj
          ),
        };
      });
    };

    const onPointerUp = () => {
      interactionRef.current = null;
      setRotationSnapActive(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // ── Interaction starters ──────────────────────────────────

  const startDrag = (event: React.PointerEvent, object: PlanObject) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedObjectId(object.id);
    interactionRef.current = {
      mode: "drag",
      objectId: object.id,
      startX: event.clientX,
      startY: event.clientY,
      initialX: object.x,
      initialY: object.y,
    };
  };

  const startResize = (event: React.PointerEvent, object: PlanObject) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedObjectId(object.id);
    interactionRef.current = {
      mode: "resize",
      objectId: object.id,
      startX: event.clientX,
      startY: event.clientY,
      initialWidth: object.width,
      initialHeight: object.height,
      minWidth: object.kind === "partition" ? MIN_PARTITION_WIDTH : MIN_TABLE_SIZE,
      minHeight: object.kind === "partition" ? MIN_PARTITION_HEIGHT : MIN_TABLE_SIZE,
    };
  };

  const startRotate = (event: React.PointerEvent, object: PlanObject) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canvasRef.current) return;
    setSelectedObjectId(object.id);
    const bounds = canvasRef.current.getBoundingClientRect();
    const centerX = bounds.left + object.x + object.width / 2;
    const centerY = bounds.top + object.y + object.height / 2;
    const pointerAngle =
      (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI;
    interactionRef.current = {
      mode: "rotate",
      objectId: object.id,
      centerX,
      centerY,
      pointerAngleOffset: pointerAngle - object.rotation,
    };
  };

  // ── Hall CRUD handlers ────────────────────────────────────

  const onSelectHall = (hallId: string) => {
    if (hallId === selectedHallId) return;
    if (isDirty && !window.confirm("Есть несохранённые изменения. Переключить зал без сохранения?")) {
      return;
    }
    persistCurrentDraftNow();
    loadHallLayout(hallId, true);
  };

  const onCreateHall = () => {
    setHallDialog({ mode: "create", value: "Новый зал" });
  };

  const onRenameHall = () => {
    if (!selectedHallId) return;
    const hall = halls.find((item) => item.id === selectedHallId);
    if (!hall) return;
    setHallDialog({ mode: "rename", value: hall.name });
  };

  const onHallDialogConfirm = (name: string) => {
    if (!hallDialog) return;
    const { mode } = hallDialog;
    const trimmed = name.trim();
    if (!trimmed) return;
    setHallDialog(null);

    if (mode === "create") {
      persistCurrentDraftNow();
      startTransition(async () => {
        const result = await createVenueHall(venueId, trimmed);
        if (result.error || !result.hall) {
          toast.error(result.error ?? "Не удалось создать зал");
          return;
        }
        setHalls((prev) => [...prev, result.hall as Hall]);
        setSelectedHallId(result.hall.id);
        setSelectedObjectId(null);
        setLayout(defaultLayout(result.hall.id));
        setIsDirty(false);
        setDraftSavedAt(null);
        toast.success("Зал создан");
      });
    } else if (mode === "rename" && selectedHallId) {
      startTransition(async () => {
        const result = await renameVenueHall(selectedHallId, trimmed);
        if (result.error) { toast.error(result.error); return; }
        setHalls((prev) =>
          prev.map((item) =>
            item.id === selectedHallId ? { ...item, name: trimmed } : item
          )
        );
        toast.success("Название обновлено");
      });
    }
  };

  const onDeleteHall = () => {
    if (!selectedHallId) return;
    const hall = halls.find((item) => item.id === selectedHallId);
    if (!hall) return;
    if (!window.confirm(`Удалить зал «${hall.name}»?`)) return;
    startTransition(async () => {
      const deletingId = selectedHallId;
      const result = await deleteVenueHall(deletingId);
      if (result.error) { toast.error(result.error); return; }
      clearDraftFromLocalStorage(deletingId);
      const nextHalls = halls.filter((item) => item.id !== deletingId);
      setHalls(nextHalls);
      const nextSelected = nextHalls[0]?.id ?? null;
      setSelectedHallId(nextSelected);
      setSelectedObjectId(null);
      setDraftSavedAt(null);
      if (!nextSelected) {
        setLayout(null);
        setIsDirty(false);
        toast.success("Зал удалён");
        return;
      }
      const next = await resolveHallLayout(nextSelected, true);
      setLayout(next.layout);
      setIsDirty(next.fromDraft);
      setDraftSavedAt(next.draftAt);
      if (next.fromDraft) toast.info("Восстановлен локальный черновик");
      toast.success("Зал удалён");
    });
  };

  // ── Object / save handlers ────────────────────────────────

  const nextTableNumber = (objects: PlanObject[]): string => {
    const used = new Set(
      objects
        .filter((o) => o.kind === "table" && o.table_number)
        .map((o) => parseInt(o.table_number!, 10))
        .filter((n) => !isNaN(n))
    );
    let n = 1;
    while (used.has(n)) n++;
    return String(n);
  };

  const addObject = (kind: "table" | "partition", shape: "rect" | "circle") => {
    if (!layout) return;
    const tableNum = kind === "table" ? nextTableNumber(layout.objects) : undefined;
    const object = createObject(kind, shape, tableNum);
    mutateObjects((prev) => [...prev, object]);
    setSelectedObjectId(object.id);
    setFabOpen(false);
  };

  const onDeleteObject = () => {
    if (!selectedObjectId) return;
    mutateObjects((prev) => prev.filter((item) => item.id !== selectedObjectId));
    setSelectedObjectId(null);
  };

  const onSave = () => {
    if (!selectedHallId || !layout) return;
    startTransition(async () => {
      const result = await saveHallLayout(selectedHallId, {
        canvas_width: layout.canvas_width,
        canvas_height: layout.canvas_height,
        objects: layout.objects,
      });
      if (result.error) { toast.error(result.error); return; }
      clearDraftFromLocalStorage(selectedHallId);
      setLayout((prev) =>
        prev ? { ...prev, updated_at: result.updated_at ?? prev.updated_at } : prev
      );
      setIsDirty(false);
      setDraftSavedAt(null);
      toast.success("Схема сохранена");
    });
  };

  const onResetDraft = () => {
    if (!selectedHallId) return;
    if (!window.confirm("Сбросить локальный черновик и загрузить данные из базы?")) return;
    clearDraftFromLocalStorage(selectedHallId);
    setDraftSavedAt(null);
    loadHallLayout(selectedHallId, false);
    toast.success("Черновик сброшен");
  };

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="mt-4 space-y-3">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 pb-1">
        {/* Hall selector */}
        <div className="min-w-[180px] max-w-[280px] flex-1">
          <Select
            value={selectedHallId ?? ""}
            onValueChange={onSelectHall}
            disabled={isPending || halls.length === 0}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Выберите зал" />
            </SelectTrigger>
            <SelectContent>
              {halls.map((hall) => (
                <SelectItem key={hall.id} value={hall.id}>
                  {hall.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button size="sm" variant="outline" className="h-8" onClick={onCreateHall} disabled={isPending}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Зал
        </Button>
        <Button
          size="sm" variant="outline" className="h-8"
          onClick={onRenameHall}
          disabled={isPending || !selectedHallId}
        >
          <Pencil className="w-3.5 h-3.5 mr-1" />
          Переименовать
        </Button>
        <Button
          size="sm" variant="outline"
          className="h-8 text-muted-foreground hover:text-destructive"
          onClick={onDeleteHall}
          disabled={isPending || !selectedHallId}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" />
          Удалить
        </Button>

        <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />

        <div className="ml-auto flex items-center gap-2">
          {statusText && (
            <span className="text-xs text-muted-foreground hidden md:block">{statusText}</span>
          )}
          <Button
            size="sm" variant="outline" className="h-8"
            onClick={onResetDraft}
            disabled={isPending || !selectedHallId || !draftSavedAt}
          >
            Сбросить черновик
          </Button>
          <Button
            size="sm" className="h-8"
            onClick={onSave}
            disabled={isPending || !selectedHallId || !isDirty}
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5 mr-1" />
            )}
            Сохранить
          </Button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div className="relative border rounded-lg overflow-hidden h-[620px]">
        {!layout ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground border-dashed border rounded-lg">
            {halls.length === 0 ? "Создайте зал, чтобы начать" : "Загрузка..."}
          </div>
        ) : (
          <div
            ref={canvasRef}
            className="relative bg-muted/20 h-full w-full overflow-hidden"
            style={{
              backgroundImage:
                "linear-gradient(rgba(15,23,42,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.07) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedObjectId(null);
                setFabOpen(false);
              }
            }}
          >
            {/* Snap axes */}
            {selectedObject && (
              <>
                <div
                  className={`absolute top-0 bottom-0 border-l border-dashed pointer-events-none ${
                    rotationSnapActive ? "border-emerald-500" : "border-blue-300"
                  }`}
                  style={{ left: selectedObject.x + selectedObject.width / 2 }}
                />
                <div
                  className={`absolute left-0 right-0 border-t border-dashed pointer-events-none ${
                    rotationSnapActive ? "border-emerald-500" : "border-blue-300"
                  }`}
                  style={{ top: selectedObject.y + selectedObject.height / 2 }}
                />
              </>
            )}

            {/* Objects */}
            {layout.objects.map((object) => {
              const selected = selectedObjectId === object.id;
              const isCircle = object.shape === "circle";
              const isPartition = object.kind === "partition";

              return (
                <div
                  key={object.id}
                  className="absolute touch-none select-none"
                  style={{
                    left: object.x,
                    top: object.y,
                    width: object.width,
                    height: object.height,
                  }}
                  onPointerDown={(event) => startDrag(event, object)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setSelectedObjectId(object.id);
                    setInspectorOpen(true);
                  }}
                >
                  {/* Shape */}
                  <div
                    className={`absolute inset-0 border-2 ${
                      isPartition
                        ? "bg-zinc-300/70 border-zinc-500"
                        : "bg-background border-primary/80"
                    } ${isCircle ? "rounded-full" : "rounded-md"}`}
                    style={{
                      transform: `rotate(${object.rotation}deg)`,
                      transformOrigin: "center center",
                    }}
                  />

                  {/* Table label: name or number */}
                  {object.kind === "table" && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs font-medium pointer-events-none px-2">
                      <span className="truncate leading-tight text-center">
                        {object.name || `#${object.table_number || "?"}`}
                      </span>
                    </div>
                  )}

                  {/* Selection ring + handles */}
                  {selected && (
                    <>
                      <div
                        className={`absolute -inset-1 border border-blue-500 rounded pointer-events-none`}
                        style={{
                          transform: `rotate(${object.rotation}deg)`,
                          transformOrigin: "center center",
                        }}
                      />
                      {/* Resize handle */}
                      <button
                        type="button"
                        className="absolute -right-2.5 -bottom-2.5 w-6 h-6 rounded-full bg-blue-600 border-2 border-white text-white flex items-center justify-center shadow"
                        onPointerDown={(event) => startResize(event, object)}
                        aria-label="Resize"
                      >
                        <Maximize2 className="w-3 h-3" />
                      </button>
                      {/* Rotate handle */}
                      <button
                        type="button"
                        className={`absolute left-1/2 -translate-x-1/2 -top-8 w-6 h-6 rounded-full border-2 border-white text-white flex items-center justify-center shadow ${
                          rotationSnapActive ? "bg-emerald-600" : "bg-amber-500"
                        }`}
                        onPointerDown={(event) => startRotate(event, object)}
                        aria-label="Rotate"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}

            {/* FAB */}
            <div
              ref={fabRef}
              className="absolute bottom-6 right-6 z-20 flex flex-col items-end gap-2.5"
            >
              {/* Inspector button (shown when object selected) */}
              {selectedObject && (
                <Button
                  size="icon"
                  className="h-14 w-14 rounded-full shadow-xl"
                  variant="secondary"
                  onClick={() => setInspectorOpen(true)}
                  aria-label="Настройки объекта"
                >
                  <Settings2 className="w-5 h-5" />
                </Button>
              )}

              {/* FAB sub-actions */}
              {fabOpen && (
                <div className="flex flex-col items-end gap-2">
                  <Button
                    size="sm" className="shadow-lg" variant="secondary"
                    onClick={() => addObject("table", "circle")}
                    disabled={isPending}
                  >
                    Круглый стол
                  </Button>
                  <Button
                    size="sm" className="shadow-lg" variant="secondary"
                    onClick={() => addObject("table", "rect")}
                    disabled={isPending}
                  >
                    Прямоугольный стол
                  </Button>
                  <Button
                    size="sm" className="shadow-lg" variant="secondary"
                    onClick={() => addObject("partition", "rect")}
                    disabled={isPending}
                  >
                    Перегородка
                  </Button>
                </div>
              )}

              {/* Main FAB button */}
              <Button
                size="icon"
                className="h-14 w-14 rounded-full shadow-xl"
                onClick={() => setFabOpen((v) => !v)}
                aria-label="Добавить объект"
              >
                <Plus
                  className={`w-6 h-6 transition-transform ${fabOpen ? "rotate-45" : ""}`}
                />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Hall name dialog ── */}
      {hallDialog && (
        <HallNameDialog
          title={hallDialog.mode === "create" ? "Новый зал" : "Переименовать зал"}
          initialValue={hallDialog.value}
          isPending={isPending}
          onConfirm={onHallDialogConfirm}
          onCancel={() => setHallDialog(null)}
        />
      )}

      {/* ── Inspector slide-over ── */}
      {inspectorOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setInspectorOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full sm:w-[380px] bg-background border-l shadow-xl overflow-y-auto">
            <div className="h-14 border-b px-4 flex items-center justify-between">
              <h2 className="font-semibold text-sm">
                {selectedObject?.kind === "table" ? "Настройки стола" : "Настройки перегородки"}
              </h2>
              <Button
                size="icon" variant="ghost" className="h-8 w-8"
                onClick={() => setInspectorOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-4">
              {!selectedObject ? (
                <p className="text-sm text-muted-foreground">Выберите объект на схеме.</p>
              ) : (
                <div className="space-y-3">
                  {/* Table-specific fields */}
                  {selectedObject.kind === "table" && (
                    <>
                      <div>
                        <Label htmlFor="obj-name">Название</Label>
                        <Input
                          id="obj-name"
                          value={selectedObject.name ?? ""}
                          onChange={(e) =>
                            updateObject(selectedObject.id, { name: e.target.value || undefined })
                          }
                          placeholder="Например: «VIP-зона»"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="obj-number">Номер стола</Label>
                        <Input
                          id="obj-number"
                          value={selectedObject.table_number ?? ""}
                          onChange={(e) =>
                            updateObject(selectedObject.id, { table_number: e.target.value })
                          }
                          className="mt-1"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor="obj-cap-c">Комфортная вместимость</Label>
                          <Input
                            id="obj-cap-c"
                            type="number"
                            min={0}
                            value={String(selectedObject.capacity_comfortable ?? 0)}
                            onChange={(e) =>
                              updateObject(selectedObject.id, {
                                capacity_comfortable: Math.max(
                                  0,
                                  toNumber(e.target.value, selectedObject.capacity_comfortable ?? 0)
                                ),
                              })
                            }
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="obj-cap-m">Максимальная вместимость</Label>
                          <Input
                            id="obj-cap-m"
                            type="number"
                            min={0}
                            value={String(selectedObject.capacity_max ?? 0)}
                            onChange={(e) =>
                              updateObject(selectedObject.id, {
                                capacity_max: Math.max(
                                  0,
                                  toNumber(e.target.value, selectedObject.capacity_max ?? 0)
                                ),
                              })
                            }
                            className="mt-1"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="obj-comment">Комментарий</Label>
                        <Textarea
                          id="obj-comment"
                          value={selectedObject.comment ?? ""}
                          onChange={(e) =>
                            updateObject(selectedObject.id, { comment: e.target.value || undefined })
                          }
                          placeholder="Заметки о столе..."
                          rows={3}
                          className="mt-1"
                        />
                      </div>
                    </>
                  )}

                  <Separator />

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-rose-200 text-rose-400 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-300"
                    onClick={onDeleteObject}
                  >
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Удалить объект
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
