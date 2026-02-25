"use server";

import { createAdminClient } from "@/lib/supabase/admin";

const DEMO_VENUE_ID = "demo-venue";

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
  table_number?: string;
  capacity?: number;
};

export type HallLayout = {
  hall_id: string;
  canvas_width: number;
  canvas_height: number;
  objects: PlanObject[];
  updated_at: string;
};

export async function getDemoHalls(): Promise<Hall[]> {
  const admin = createAdminClient();
  // Cast is intentional: generated DB types don't include demo tables yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
  const { data } = await db
    .from("venue_halls")
    .select("id, venue_id, name, sort_order")
    .eq("venue_id", DEMO_VENUE_ID)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as Hall[];
}

export async function createDemoHall(
  name: string
): Promise<{ hall: Hall | null; error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) return { hall: null, error: "Введите название зала" };

  const admin = createAdminClient();
  const halls = await getDemoHalls();
  const nextSort = halls.length > 0 ? Math.max(...halls.map((h) => h.sort_order)) + 1 : 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
  const { data, error } = await db
    .from("venue_halls")
    .insert({
      venue_id: DEMO_VENUE_ID,
      name: trimmed,
      sort_order: nextSort,
    })
    .select("id, venue_id, name, sort_order")
    .single();

  if (error) return { hall: null, error: error.message };

  return { hall: data as Hall, error: null };
}

export async function renameDemoHall(
  hallId: string,
  name: string
): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Введите название зала" };

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
  const { error } = await db
    .from("venue_halls")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", hallId);
  return { error: error ? error.message : null };
}

export async function deleteDemoHall(
  hallId: string
): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
  const { error } = await db
    .from("venue_halls")
    .delete()
    .eq("id", hallId);
  return { error: error ? error.message : null };
}

export async function getDemoHallLayout(hallId: string): Promise<HallLayout | null> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
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

export async function saveDemoHallLayout(
  hallId: string,
  payload: { canvas_width: number; canvas_height: number; objects: PlanObject[] }
): Promise<{ updated_at: string | null; error: string | null }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
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
