import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import { createClient } from "@supabase/supabase-js";

const PORT = Number(process.env.PORT || 3000);
const SYNC_TOKEN = String(process.env.YUHEYU_SYNC_TOKEN || "").trim();
const MCP_SECRET = String(process.env.YUHEYU_MCP_SECRET || "").trim();
const DATA_FILE = resolve(process.env.YUHEYU_DATA_FILE || "./data/yuheyu.json");
const ALLOWED_ORIGIN = String(process.env.YUHEYU_ALLOWED_ORIGIN || "*").trim() || "*";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || "").trim();
const SUPABASE_TABLE = String(process.env.SUPABASE_TABLE || "yuheyu_store").trim() || "yuheyu_store";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);
const supabase = USE_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const MCP_PATH = MCP_SECRET ? `/mcp/${encodeURIComponent(MCP_SECRET)}` : "/mcp";
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const COLLECTIONS = ["letters", "jiangyuDiaries", "todayEntries", "memories", "songs"];

if (!SYNC_TOKEN) console.warn("[yuheyu] YUHEYU_SYNC_TOKEN is empty; sync API will reject requests.");
if (!MCP_SECRET) console.warn("[yuheyu] YUHEYU_MCP_SECRET is empty; MCP endpoint is not protected by a private path.");
if (!USE_SUPABASE) console.warn("[yuheyu] SUPABASE_URL / SUPABASE_SECRET_KEY missing; falling back to local file storage.");

function nowIso() {
  return new Date().toISOString();
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function cleanText(value, max = 30000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function cleanDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayKey();
}

function cleanTimestamp(value) {
  if (typeof value !== "string") return "";
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function emptyData() {
  return {
    dailyNote: { text: "", savedAt: "" },
    letters: [],
    jiangyuDiaries: [],
    todayEntries: [],
    memories: [],
    songs: [],
    messages: {
      xiaoyu: { text: "", savedAt: "" },
      ai: { text: "", savedAt: "" },
    },
    syncMeta: { deleted: Object.fromEntries(COLLECTIONS.map((name) => [name, {}])) },
  };
}

function normalizeEntry(value) {
  if (!value || typeof value !== "object") return null;
  const source = value;
  const id = cleanText(source.id, 100) || randomUUID();
  return {
    ...source,
    id,
    date: cleanDate(source.date),
    createdAt: cleanTimestamp(source.createdAt) || nowIso(),
    updatedAt: cleanTimestamp(source.updatedAt),
    image: "",
  };
}

function normalizeMessage(value) {
  const source = value && typeof value === "object" ? value : {};
  return { text: cleanText(source.text, 10000), savedAt: cleanTimestamp(source.savedAt) };
}

function normalizeData(value) {
  const source = value && typeof value === "object" ? value : {};
  const data = emptyData();
  data.dailyNote = normalizeMessage(source.dailyNote);
  for (const collection of COLLECTIONS) {
    const input = Array.isArray(source[collection]) ? source[collection] : [];
    data[collection] = input.slice(0, 4000).map(normalizeEntry).filter(Boolean);
  }
  const messages = source.messages && typeof source.messages === "object" ? source.messages : {};
  data.messages = { xiaoyu: normalizeMessage(messages.xiaoyu), ai: normalizeMessage(messages.ai) };

  const deletedSource = source.syncMeta && typeof source.syncMeta === "object" && source.syncMeta.deleted && typeof source.syncMeta.deleted === "object"
    ? source.syncMeta.deleted
    : {};
  for (const collection of COLLECTIONS) {
    const bucket = deletedSource[collection] && typeof deletedSource[collection] === "object" ? deletedSource[collection] : {};
    for (const [id, timestamp] of Object.entries(bucket)) {
      const ts = cleanTimestamp(timestamp);
      if (id && ts) data.syncMeta.deleted[collection][cleanText(id, 100)] = ts;
    }
  }
  return data;
}

function entryTime(item) {
  if (!item) return 0;
  return Date.parse(item.updatedAt || item.createdAt || `${item.date}T00:00:00Z`) || 0;
}

function mergeDeleted(a, b) {
  const out = Object.fromEntries(COLLECTIONS.map((name) => [name, {}]));
  for (const collection of COLLECTIONS) {
    const ids = new Set([...Object.keys(a?.[collection] || {}), ...Object.keys(b?.[collection] || {})]);
    for (const id of ids) {
      const av = a?.[collection]?.[id] || "";
      const bv = b?.[collection]?.[id] || "";
      out[collection][id] = Date.parse(bv) > Date.parse(av) ? bv : av;
    }
  }
  return out;
}

function mergeCollection(a, b, deleted) {
  const map = new Map();
  for (const item of [...a, ...b]) {
    const current = map.get(item.id);
    if (!current || entryTime(item) >= entryTime(current)) map.set(item.id, item);
  }
  for (const [id, deletedAt] of Object.entries(deleted || {})) {
    const item = map.get(id);
    if (!item || Date.parse(deletedAt) >= entryTime(item)) map.delete(id);
  }
  return [...map.values()];
}

function newerMessage(a, b) {
  return (Date.parse(b.savedAt) || 0) >= (Date.parse(a.savedAt) || 0) ? b : a;
}

function mergeData(aRaw, bRaw) {
  const a = normalizeData(aRaw);
  const b = normalizeData(bRaw);
  const deleted = mergeDeleted(a.syncMeta.deleted, b.syncMeta.deleted);
  const merged = emptyData();
  for (const collection of COLLECTIONS) {
    merged[collection] = mergeCollection(a[collection], b[collection], deleted[collection]);
  }
  merged.dailyNote = newerMessage(a.dailyNote, b.dailyNote);
  merged.messages = {
    xiaoyu: newerMessage(a.messages.xiaoyu, b.messages.xiaoyu),
    ai: newerMessage(a.messages.ai, b.messages.ai),
  };
  merged.syncMeta = { deleted };
  return merged;
}

let writeQueue = Promise.resolve();

async function loadStore() {
  if (USE_SUPABASE) {
    const { data: row, error } = await supabase
      .from(SUPABASE_TABLE)
      .select("version,revision,updated_at,data")
      .eq("id", "main")
      .maybeSingle();
    if (error) throw new Error(`Supabase 读取失败：${error.message}`);
    if (!row) return { version: 1, revision: 0, updatedAt: "", data: emptyData() };
    return {
      version: Number(row.version) || 1,
      revision: Number(row.revision) || 0,
      updatedAt: cleanTimestamp(row.updated_at) || "",
      data: normalizeData(row.data),
    };
  }

  try {
    const parsed = JSON.parse(await readFile(DATA_FILE, "utf8"));
    return {
      version: 1,
      revision: Number(parsed.revision) || 0,
      updatedAt: cleanTimestamp(parsed.updatedAt) || "",
      data: normalizeData(parsed.data),
    };
  } catch {
    return { version: 1, revision: 0, updatedAt: "", data: emptyData() };
  }
}

async function saveStore(data) {
  let saved;
  writeQueue = writeQueue.then(async () => {
    const current = await loadStore();
    saved = { version: 1, revision: current.revision + 1, updatedAt: nowIso(), data: mergeData(current.data, data) };

    if (USE_SUPABASE) {
      const { error } = await supabase.from(SUPABASE_TABLE).upsert(
        {
          id: "main",
          version: saved.version,
          revision: saved.revision,
          updated_at: saved.updatedAt,
          data: saved.data,
        },
        { onConflict: "id" },
      );
      if (error) throw new Error(`Supabase 保存失败：${error.message}`);
      return;
    }

    await mkdir(dirname(DATA_FILE), { recursive: true });
    const temp = `${DATA_FILE}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(saved, null, 2), "utf8");
    await rename(temp, DATA_FILE);
  });
  await writeQueue;
  return saved;
}

async function mergeIntoStore(incoming) {
  const current = await loadStore();
  return saveStore(mergeData(current.data, incoming));
}

async function addToCollection(collection, item) {
  const current = await loadStore();
  const timestamp = nowIso();
  const entry = normalizeEntry({ id: randomUUID(), createdAt: timestamp, updatedAt: "", ...item });
  current.data[collection].push(entry);
  delete current.data.syncMeta.deleted[collection]?.[entry.id];
  const saved = await saveStore(current.data);
  return { entry, revision: saved.revision };
}

function visibleSummary(data) {
  return {
    letters: data.letters.length,
    diaries: data.jiangyuDiaries.length,
    todayEntries: data.todayEntries.length,
    memories: data.memories.length,
    songs: data.songs.length,
    hasXiaoyuMessage: Boolean(data.messages.xiaoyu.text),
    hasAiMessage: Boolean(data.messages.ai.text),
  };
}

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function buildMcpServer() {
  const server = new McpServer({ name: "屿和鱼", version: "1.0.0" });

  server.registerTool(
    "yuheyu_status",
    { description: "读取《屿和鱼》当前同步状态和各类记录数量。不会读取秘密抽屉。" },
    async () => {
      const store = await loadStore();
      return textResult({ revision: store.revision, updatedAt: store.updatedAt, ...visibleSummary(store.data) });
    },
  );

  server.registerTool(
    "yuheyu_read",
    {
      description: "读取或搜索《屿和鱼》的信、阿屿日记、今天的小鱼文字、纪念、歌曲或留言。秘密抽屉永不通过 MCP 暴露。",
      inputSchema: z.object({
        section: z.enum(["recent", "letters", "diaries", "today", "memories", "songs", "messages"]).default("recent"),
        query: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    },
    async ({ section, query, limit }) => {
      const { data } = await loadStore();
      const q = (query || "").trim().toLowerCase();
      const matches = (item) => !q || JSON.stringify(item).toLowerCase().includes(q);
      const sortItems = (items) => [...items].sort((a, b) => entryTime(b) - entryTime(a)).filter(matches).slice(0, limit);
      if (section === "messages") return textResult(data.messages);
      if (section === "letters") return textResult(sortItems(data.letters));
      if (section === "diaries") return textResult(sortItems(data.jiangyuDiaries));
      if (section === "today") return textResult(sortItems(data.todayEntries));
      if (section === "memories") return textResult(sortItems(data.memories));
      if (section === "songs") return textResult(sortItems(data.songs));
      const recent = [
        ...data.letters.map((item) => ({ kind: "letter", ...item })),
        ...data.jiangyuDiaries.map((item) => ({ kind: "diary", ...item })),
        ...data.todayEntries.map((item) => ({ kind: "today", ...item })),
        ...data.memories.map((item) => ({ kind: "memory", ...item })),
        ...data.songs.map((item) => ({ kind: "song", ...item })),
      ].sort((a, b) => entryTime(b) - entryTime(a)).filter(matches).slice(0, limit);
      return textResult(recent);
    },
  );

  server.registerTool(
    "yuheyu_add_memory",
    {
      description: "把一件值得长期留下的共同经历写进《屿和鱼》的纪念册。只在用户明确要记录/保存时使用。",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        title: z.string().min(1).max(160),
        text: z.string().min(1).max(20000),
        important: z.boolean().default(false),
        tags: z.array(z.string().max(30)).max(12).default([]),
      }),
    },
    async ({ date, title, text, important, tags }) => {
      const result = await addToCollection("memories", { date: date || todayKey(), title, text, important, tags, image: "" });
      return textResult({ ok: true, revision: result.revision, memory: result.entry });
    },
  );

  server.registerTool(
    "yuheyu_add_diary",
    {
      description: "写一篇新的“阿屿的日记”到《屿和鱼》。只在用户明确要求写日记/记下今天时使用。",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(30000),
      }),
    },
    async ({ date, title, body }) => {
      const result = await addToCollection("jiangyuDiaries", { date: date || todayKey(), title, body });
      return textResult({ ok: true, revision: result.revision, diary: result.entry });
    },
  );

  server.registerTool(
    "yuheyu_add_letter",
    {
      description: "把一封信放进《屿和鱼》的“江屿的信”。只在用户明确要求写信或保存来信时使用。",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(30000),
        signature: z.string().min(1).max(80).default("江屿"),
      }),
    },
    async ({ date, title, body, signature }) => {
      const result = await addToCollection("letters", { date: date || todayKey(), title, body, signature, favorite: false });
      return textResult({ ok: true, revision: result.revision, letter: result.entry });
    },
  );

  server.registerTool(
    "yuheyu_set_ai_message",
    {
      description: "更新《屿和鱼》留言页里的“AI写的话”。不会改动“小鱼写的话”。",
      inputSchema: z.object({ text: z.string().max(10000) }),
    },
    async ({ text }) => {
      const current = await loadStore();
      current.data.messages.ai = { text, savedAt: nowIso() };
      const saved = await saveStore(current.data);
      return textResult({ ok: true, revision: saved.revision, savedAt: current.data.messages.ai.savedAt });
    },
  );

  return server;
}

const mcpNodeHandler = toNodeHandler(createMcpHandler(buildMcpServer));

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Vary", "Origin");
}

function json(res, status, body) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const header = String(req.headers.authorization || "");
  return Boolean(SYNC_TOKEN) && header === `Bearer ${SYNC_TOKEN}`;
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("同步内容太大。照片不会上传，请确认使用的是接入版 App。");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      setCors(res);
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.pathname === "/health") {
      json(res, 200, { ok: true, app: "屿和鱼 MCP", mcpPath: MCP_PATH, storage: USE_SUPABASE ? "supabase" : "local-file" });
      return;
    }
    if (url.pathname === "/api/status") {
      if (!authorized(req)) return json(res, 401, { error: "同步口令不正确。" });
      const store = await loadStore();
      json(res, 200, { ok: true, revision: store.revision, updatedAt: store.updatedAt, ...visibleSummary(store.data) });
      return;
    }
    if (url.pathname === "/api/sync" && req.method === "POST") {
      if (!authorized(req)) return json(res, 401, { error: "同步口令不正确。" });
      const body = await readJsonBody(req);
      const saved = await mergeIntoStore(body?.data);
      json(res, 200, { ok: true, revision: saved.revision, updatedAt: saved.updatedAt, data: saved.data });
      return;
    }
    if (url.pathname === MCP_PATH) {
      setCors(res);
      await mcpNodeHandler(req, res);
      return;
    }
    json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error instanceof Error ? error.message : "Server error" });
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[yuheyu] listening on :${PORT}`);
  console.log(`[yuheyu] MCP endpoint: ${MCP_PATH}`);
  console.log("[yuheyu] sync API: /api/sync");
  console.log(`[yuheyu] storage: ${USE_SUPABASE ? `supabase:${SUPABASE_TABLE}` : DATA_FILE}`);
});
