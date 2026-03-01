"use server";

import { createClient } from "@/lib/supabase/server";

// ── Types ────────────────────────────────────────────────────

export type Hall = {
  id: string;
  venue_id: string;
  name: string;
  sort_order: number;
};

export type PlanObject = {
  id: string;
  kind: "table" | "partition";
  shape: "rect" | "circle";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  name?: string;
  table_number?: string;
  capacity_comfortable?: number;
  capacity_max?: number;
  comment?: string;
};

export type HallLayout = {
  hall_id: string;
  canvas_width: number;
  canvas_height: number;
  objects: PlanObject[];
  updated_at: string;
};

// ── Helpers ──────────────────────────────────────────────────

async function getAuthDb() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { db: supabase, user };
}

// ── Hall CRUD ────────────────────────────────────────────────

export async function getVenueHalls(venueId: string): Promise<Hall[]> {
  const { db, user } = await getAuthDb();
  if (!user) return [];

  const { data } = await db
    .from("venue_halls")
    .select("id, venue_id, name, sort_order")
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (data ?? []) as Hall[];
}

export async function createVenueHall(
  venueId: string,
  name: string
): Promise<{ hall: Hall | null; error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) return { hall: null, error: "Введите название зала" };

  const { db, user } = await getAuthDb();
  if (!user) return { hall: null, error: "Не авторизован" };

  // Compute next sort_order
  const { data: existing } = await db
    .from("venue_halls")
    .select("sort_order")
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSort =
    ((existing?.[0] as { sort_order: number } | undefined)?.sort_order ?? -1) + 1;

  const { data, error } = await db
    .from("venue_halls")
    .insert({ venue_id: venueId, name: trimmed, sort_order: nextSort })
    .select("id, venue_id, name, sort_order")
    .single();

  if (error) return { hall: null, error: error.message };
  return { hall: data as Hall, error: null };
}

export async function renameVenueHall(
  hallId: string,
  name: string
): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Введите название зала" };

  const { db, user } = await getAuthDb();
  if (!user) return { error: "Не авторизован" };

  const { error } = await db
    .from("venue_halls")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", hallId);

  return { error: error ? error.message : null };
}

export async function deleteVenueHall(
  hallId: string
): Promise<{ error: string | null }> {
  const { db, user } = await getAuthDb();
  if (!user) return { error: "Не авторизован" };

  const { error } = await db.from("venue_halls").delete().eq("id", hallId);
  return { error: error ? error.message : null };
}

// ── Layout CRUD ──────────────────────────────────────────────

export async function getHallLayout(hallId: string): Promise<HallLayout | null> {
  const { db, user } = await getAuthDb();
  if (!user) return null;

  const { data } = await db
    .from("hall_layouts")
    .select("hall_id, canvas_width, canvas_height, objects, updated_at")
    .eq("hall_id", hallId)
    .maybeSingle();

  if (!data) return null;

  return {
    hall_id: data.hall_id,
    canvas_width: data.canvas_width,
    canvas_height: data.canvas_height,
    objects: Array.isArray(data.objects) ? (data.objects as PlanObject[]) : [],
    updated_at: data.updated_at,
  };
}

export async function saveHallLayout(
  hallId: string,
  payload: {
    canvas_width: number;
    canvas_height: number;
    objects: PlanObject[];
  }
): Promise<{ updated_at: string | null; error: string | null }> {
  const { db, user } = await getAuthDb();
  if (!user) return { updated_at: null, error: "Не авторизован" };

  const now = new Date().toISOString();

  const { data, error } = await db
    .from("hall_layouts")
    .upsert(
      {
        hall_id: hallId,
        canvas_width: payload.canvas_width,
        canvas_height: payload.canvas_height,
        objects: payload.objects,
        updated_at: now,
      },
      { onConflict: "hall_id" }
    )
    .select("updated_at")
    .single();

  if (error) return { updated_at: null, error: error.message };
  return { updated_at: data.updated_at as string, error: null };
}
