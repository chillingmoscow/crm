import test from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.app";
const { avatarThumbUrl } = await import("./avatar-thumb.ts");

test("публичное фото Supabase идёт через оптимизатор, адрес сохраняется целиком", () => {
  const src = "https://supabase.example.app/storage/v1/object/public/avatars/u1/avatar?t=1700";
  assert.equal(
    avatarThumbUrl(src),
    `/_next/image?url=${encodeURIComponent(src)}&w=96&q=75`,
  );
});

test("выгрузка Glide тоже уменьшается", () => {
  const src = "https://storage.googleapis.com/glide-prod.appspot.com/uploads-v2/a/pub/b.png";
  assert.equal(avatarThumbUrl(src, 64), `/_next/image?url=${encodeURIComponent(src)}&w=64&q=75`);
});

test("подписанные, чужие и пустые адреса не трогаем", () => {
  const signed = "https://supabase.example.app/storage/v1/object/sign/candidate-files/x.jpg?token=abc";
  assert.equal(avatarThumbUrl(signed), signed);
  assert.equal(avatarThumbUrl("https://lh3.googleusercontent.com/a/b"), "https://lh3.googleusercontent.com/a/b");
  assert.equal(avatarThumbUrl("https://storage.googleapis.com/other-bucket/x.png"), "https://storage.googleapis.com/other-bucket/x.png");
  assert.equal(avatarThumbUrl("/local.png"), "/local.png");
  assert.equal(avatarThumbUrl(null), null);
  assert.equal(avatarThumbUrl(""), null);
});
