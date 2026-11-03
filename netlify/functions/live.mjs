// 팀 현황: 팀원이 지금 작업 중인 화면과 활동 기록
// 저장소 "banner-live" (Netlify Blobs)
//   GET  /api/live                 작업 세션 목록 + 최근 저장한 소재 기록
//   GET  /api/live/:sid            세션의 현재 작업 상태 (보기 전용 화면용)   ?thumb=1 → 미리보기 이미지
//   POST /api/live                 작업 상태 보내기 { sid, name, state, imgs, thumb, tid, size, headline }
//   POST /api/live?ping=1          '작업 중' 신호만 보내기 { sid, name }
//   POST /api/live?event=1         소재 저장 기록 { sid, name, type, thumb, tid, size, headline }
//   GET/PUT /api/limg/:hash        작업에 쓰인 이미지 (같은 이미지는 한 번만 저장)
import { getStore } from "@netlify/blobs";

const KEEP_DAYS = 30;
const MAX_IMG = 5 * 1024 * 1024;
const MAX_BODY = 1024 * 1024;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clip = (v, n) => String(v || "").slice(0, n);
const okId = (v) => /^[a-z0-9-]{6,64}$/i.test(v || "");
const jpeg = (d) => (typeof d === "string" && d.startsWith("data:image/jpeg;base64,") ? Buffer.from(d.slice(23), "base64") : null);

export default async (req, context) => {
  const store = getStore({ name: "banner-live", consistency: "strong" });
  const url = new URL(req.url);
  const isImg = url.pathname.startsWith("/api/limg/");
  const sid = context.params && context.params.sid;
  const hash = context.params && context.params.hash;

  if (isImg) {
    if (!/^[a-f0-9]{64}$/.test(hash || "")) return json({ code: "bad_request" }, 400);
    if (req.method === "GET") {
      const e = await store.getWithMetadata("img/" + hash, { type: "arrayBuffer" });
      if (!e) return new Response("not found", { status: 404 });
      return new Response(e.data, { headers: { "content-type": e.metadata?.type || "image/png", "cache-control": "public, max-age=31536000, immutable" } });
    }
    if (req.method === "PUT") {
      const type = (req.headers.get("content-type") || "").split(";")[0];
      if (!/^image\/(png|jpeg|webp)$/.test(type)) return json({ code: "bad_type" }, 415);
      if (!(await store.getMetadata("img/" + hash))) {
        const data = await req.arrayBuffer();
        if (!data.byteLength || data.byteLength > MAX_IMG) return json({ code: "too_large" }, 413);
        await store.set("img/" + hash, data, { metadata: { type } });
      }
      return json({ ok: true });
    }
    return json({ code: "bad_request" }, 400);
  }

  if (req.method === "GET" && !sid) {
    const since = Date.now() - KEEP_DAYS * 864e5;
    const meta = async (prefix) => {
      const { blobs } = await store.list({ prefix });
      return (await Promise.all(blobs.map(async (b) => {
        const m = await store.getMetadata(b.key);
        return m && m.metadata ? { id: b.key.slice(prefix.length), ...m.metadata } : null;
      }))).filter((x) => x && (x.updated || x.time || 0) > since);
    };
    const [sessions, pings, events] = await Promise.all([meta("s/"), meta("h/"), meta("e/")]);
    const ping = Object.fromEntries(pings.map((p) => [p.id, p.updated]));
    sessions.forEach((s) => { s.seen = Math.max(s.updated || 0, ping[s.id] || 0); });
    sessions.sort((a, b) => b.seen - a.seen);
    events.sort((a, b) => b.time - a.time);
    return json({ ok: true, now: Date.now(), sessions, events: events.slice(0, 300) });
  }

  if (req.method === "GET" && sid) {
    if (url.searchParams.get("thumb")) {
      const t = await store.get("st/" + sid, { type: "arrayBuffer" });
      if (!t) return new Response("not found", { status: 404 });
      return new Response(t, { headers: { "content-type": "image/jpeg", "cache-control": "no-cache" } });
    }
    const e = await store.getWithMetadata("s/" + sid, { type: "json" });
    if (!e) return json({ code: "not_found" }, 404);
    return json({ ok: true, meta: e.metadata, ...e.data });
  }

  if (req.method === "POST" && !sid) {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ code: "too_large" }, 413);
    let b; try { b = JSON.parse(text); } catch { return json({ code: "bad_request" }, 400); }
    if (!b || !okId(b.sid)) return json({ code: "bad_request" }, 400);
    const now = Date.now(), name = clip(b.name, 30) || "이름 없음";

    if (url.searchParams.get("ping")) {
      await store.set("h/" + b.sid, "", { metadata: { updated: now, name } });
      return json({ ok: true });
    }

    const prev = await store.getMetadata("s/" + b.sid);
    const pm = (prev && prev.metadata) || {};

    if (url.searchParams.get("event")) {
      const eid = "e-" + now.toString(36) + Math.random().toString(36).slice(2, 6);
      const ev = { sid: b.sid, name, type: clip(b.type, 8), tid: clip(b.tid, 16), size: clip(b.size, 12), headline: clip(b.headline, 40), time: now };
      await store.set("e/" + eid, "", { metadata: ev });
      const t = jpeg(b.thumb); if (t && t.length < 300 * 1024) await store.set("st/" + eid, t);
      if (prev) {
        const cur = await store.get("s/" + b.sid, { type: "json" });
        await store.setJSON("s/" + b.sid, cur || {}, { metadata: { ...pm, exports: (pm.exports || 0) + 1, updated: now, name } });
      }
      return json({ ok: true, id: eid });
    }

    if (typeof b.state !== "string") return json({ code: "bad_request" }, 400);
    const meta = {
      name, started: pm.started || now, updated: now, edits: (pm.edits || 0) + 1, exports: pm.exports || 0,
      tid: clip(b.tid, 16), size: clip(b.size, 12), headline: clip(b.headline, 40),
    };
    await store.setJSON("s/" + b.sid, { state: b.state, imgs: b.imgs || null }, { metadata: meta });
    const t = jpeg(b.thumb); if (t && t.length < 200 * 1024) await store.set("st/" + b.sid, t);
    return json({ ok: true });
  }

  return json({ code: "bad_request" }, 400);
};

export const config = { path: ["/api/live", "/api/live/:sid", "/api/limg/:hash"] };
