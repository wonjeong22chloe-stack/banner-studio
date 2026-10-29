// 팀 작업함: 배너 작업(설정 + 이미지)을 팀이 함께 보관하는 곳
// 저장소 "banner-works" (Netlify Blobs)
//   GET    /api/works              작업 목록
//   GET    /api/works/:id          작업 내용(JSON)       ?thumb=1 → 미리보기 이미지
//   POST   /api/works              새 작업 저장 (JSON)
//   PUT    /api/works/:id          덮어쓰기
//   DELETE /api/works/:id          지우기
//   GET    /api/wimg/:hash         작업에 쓰인 이미지
//   PUT    /api/wimg/:hash         이미지 올리기 (같은 이미지는 한 번만 저장돼요)
// 환경 변수 TEAM_PASSWORD 가 있으면 저장·덮어쓰기·지우기에 비밀번호가 필요해요.
import { getStore } from "@netlify/blobs";

const MAX_IMG = 5 * 1024 * 1024;
const MAX_WORK = 2 * 1024 * 1024;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export default async (req, context) => {
  const store = getStore({ name: "banner-works", consistency: "strong" });
  const password = process.env.TEAM_PASSWORD || "";
  const url = new URL(req.url);
  const isImg = url.pathname.startsWith("/api/wimg/");
  const id = context.params && context.params.id;
  const hash = context.params && context.params.hash;

  if (req.method === "GET") {
    if (isImg) {
      const e = await store.getWithMetadata("img/" + hash, { type: "arrayBuffer" });
      if (!e) return new Response("not found", { status: 404 });
      return new Response(e.data, { headers: { "content-type": e.metadata?.type || "image/png", "cache-control": "public, max-age=31536000, immutable" } });
    }
    if (!id) {
      const { blobs } = await store.list({ prefix: "work/" });
      const items = (await Promise.all(blobs.map(async (b) => {
        const m = await store.getMetadata(b.key);
        return m && m.metadata ? { id: b.key.slice(5), ...m.metadata } : null;
      }))).filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0));
      return json({ ok: true, needsPassword: Boolean(password), items });
    }
    if (url.searchParams.get("thumb")) {
      const t = await store.get("thumb/" + id, { type: "arrayBuffer" });
      if (!t) return new Response("not found", { status: 404 });
      return new Response(t, { headers: { "content-type": "image/jpeg", "cache-control": "no-cache" } });
    }
    const w = await store.get("work/" + id, { type: "json" });
    if (!w) return json({ code: "not_found" }, 404);
    return json(w);
  }

  if (password && req.headers.get("x-team-password") !== password) return json({ code: "bad_password" }, 401);

  if (isImg && req.method === "PUT") {
    if (!/^[a-f0-9]{64}$/.test(hash || "")) return json({ code: "bad_request" }, 400);
    const type = (req.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(png|jpeg|webp)$/.test(type)) return json({ code: "bad_type" }, 415);
    const exists = await store.getMetadata("img/" + hash);
    if (!exists) {
      const data = await req.arrayBuffer();
      if (!data.byteLength) return json({ code: "empty" }, 400);
      if (data.byteLength > MAX_IMG) return json({ code: "too_large" }, 413);
      await store.set("img/" + hash, data, { metadata: { type } });
    }
    return json({ ok: true });
  }

  if ((req.method === "POST" && !id) || (req.method === "PUT" && id)) {
    const text = await req.text();
    if (text.length > MAX_WORK) return json({ code: "too_large" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ code: "bad_request" }, 400); }
    if (!body || body.format !== "banner-studio-team-work" || typeof body.state !== "string") return json({ code: "bad_request" }, 400);
    const wid = id || newId();
    const meta = {
      name: String(body.name || "이름 없는 작업").slice(0, 60),
      author: String(body.author || "").slice(0, 30),
      size: String(body.size || "").slice(0, 12),
      updated: Date.now(),
    };
    if (typeof body.thumb === "string" && body.thumb.startsWith("data:image/jpeg;base64,")) {
      const bytes = Buffer.from(body.thumb.slice("data:image/jpeg;base64,".length), "base64");
      if (bytes.length < 400 * 1024) await store.set("thumb/" + wid, bytes);
    }
    delete body.thumb;
    await store.setJSON("work/" + wid, body, { metadata: meta });
    return json({ ok: true, item: { id: wid, ...meta } });
  }

  if (req.method === "DELETE" && id && !isImg) {
    await store.delete("work/" + id);
    await store.delete("thumb/" + id);
    return json({ ok: true });
  }

  return json({ code: "bad_request" }, 400);
};

export const config = { path: ["/api/works", "/api/works/:id", "/api/wimg/:hash"] };
