-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 136_roles_icon_color.sql
-- Adds icon_color column to public.roles so the role picker can apply a Notion-
-- style colour tint on top of the lucide icon (parity with KB icon picker).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.roles
  add column if not exists icon_color text;

comment on column public.roles.icon_color is
  'Palette tint applied to the role icon (one of @/lib/palette names: '
  'default | gray | brown | orange | yellow | green | blue | purple | pink | red). '
  'NULL = render the icon in default muted colour.';
