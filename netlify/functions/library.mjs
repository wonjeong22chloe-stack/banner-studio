// 팀 공용 라이브러리 (상품컷 · 로고)
// 이미지는 Netlify Blobs 저장소 "banner-library"에 저장돼요.
//   GET    /api/library         목록
//   GET    /api/library/:id     이미지 파일
//   POST   /api/library?name=&kind=product|logo   이미지 올리기 (본문 = 이미지 파일)
//   DELETE /api/library/:id     지우기
// 환경 변수 TEAM_PASSWORD 를 정하면, 올리기·지우기에 그 비밀번호가 필요해요.
import { getStore } from "@netlify/blobs";

const MAX_BYTES = 5 * 1024 * 1024;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default async (req, context) => {
  const store = getStore({ name: "banner-library", consistency: "strong" });
  const password = process.env.TEAM_PASSWORD || "";
  const id = context.params && context.params.id;

  // 목록: 이미지 파일에 붙은 정보(metadata)를 모아서 돌려줘요
  if (req.method === "GET" && !id) {
    const { blobs } = await store.list({ prefix: "img/" });
    const items = (await Promise.all(blobs.map(async (b) => {
      const m = await store.getMetadata(b.key);
      return m && m.metadata ? { id: b.key.slice(4), ...m.metadata } : null;
    }))).filter(Boolean).sort((a, b) => (b.added || 0) - (a.added || 0));
    return json({ ok: true, needsPassword: Boolean(password), items });
  }

  // 이미지 파일
  if (req.method === "GET" && id) {
    const entry = await store.getWithMetadata("img/" + id, { type: "arrayBuffer" });
    if (!entry) return new Response("not found", { status: 404 });
    return new Response(entry.data, {
      headers: { "content-type": entry.metadata?.type || "image/png", "cache-control": "public, max-age=31536000, immutable" },
    });
  }

  // 여기부터는 바꾸는 요청: 비밀번호 확인
  if (password && req.headers.get("x-team-password") !== password) return json({ code: "bad_password" }, 401);

  if (req.method === "POST" && !id) {
    const url = new URL(req.url);
    const type = (req.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(png|jpeg|webp)$/.test(type)) return json({ code: "bad_type" }, 415);
    const data = await req.arrayBuffer();
    if (!data.byteLength) return json({ code: "empty" }, 400);
    if (data.byteLength > MAX_BYTES) return json({ code: "too_large" }, 413);
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const item = {
      name: (url.searchParams.get("name") || "이미지").slice(0, 60),
      kind: url.searchParams.get("kind") === "logo" ? "logo" : "product",
      mono: url.searchParams.get("mono") === "1",
      light: url.searchParams.get("light") === "1",
      added: Date.now(),
      type,
    };
    await store.set("img/" + newId, data, { metadata: item });
    return json({ ok: true, item: { id: newId, ...item } });
  }

  if (req.method === "DELETE" && id) {
    await store.delete("img/" + id);
    return json({ ok: true });
  }

  return json({ code: "bad_request" }, 400);
};

export const config = { path: ["/api/library", "/api/library/:id"] };
