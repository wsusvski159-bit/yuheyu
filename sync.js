"use strict";

const SYNC_CONFIG_KEY = "yuheyu.mcp-sync.v1";
const SYNC_COLLECTIONS = ["letters", "jiangyuDiaries", "todayEntries", "memories", "songs"];

function readSyncConfig() {
  try {
    const value = JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || "{}");
    return {
      serverUrl: typeof value.serverUrl === "string" ? value.serverUrl : "",
      token: typeof value.token === "string" ? value.token : "",
    };
  } catch {
    return { serverUrl: "", token: "" };
  }
}

function saveSyncConfig() {
  const serverUrl = byId("sync-server-url").value.trim().replace(/\/+$/, "");
  const token = byId("sync-token").value.trim();
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify({ serverUrl, token }));
  return { serverUrl, token };
}

function recordSyncDeletion(collection, id) {
  if (!SYNC_COLLECTIONS.includes(collection) || !id) return;
  if (!state.syncMeta || typeof state.syncMeta !== "object") state.syncMeta = { deleted: {} };
  if (!state.syncMeta.deleted || typeof state.syncMeta.deleted !== "object") state.syncMeta.deleted = {};
  if (!state.syncMeta.deleted[collection]) state.syncMeta.deleted[collection] = {};
  state.syncMeta.deleted[collection][id] = new Date().toISOString();
}

function withoutImages(item) {
  if (!item || typeof item !== "object") return item;
  const copy = { ...item };
  if ("image" in copy) copy.image = "";
  return copy;
}

function makeSyncPayload() {
  return {
    dailyNote: { ...state.dailyNote },
    letters: state.letters.map(withoutImages),
    jiangyuDiaries: (state.jiangyuDiaries || []).map(withoutImages),
    todayEntries: state.todayEntries.map(withoutImages),
    memories: state.memories.map(withoutImages),
    songs: state.songs.map(withoutImages),
    messages: JSON.parse(JSON.stringify(state.messages || {})),
    syncMeta: JSON.parse(JSON.stringify(state.syncMeta || { deleted: {} })),
  };
}

function itemTime(item) {
  const raw = item?.updatedAt || item?.createdAt || (item?.date ? `${item.date}T00:00:00.000Z` : "");
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function mergeCollection(localItems, remoteItems, tombstones = {}) {
  const map = new Map();
  for (const item of [...(localItems || []), ...(remoteItems || [])]) {
    if (!item?.id) continue;
    const current = map.get(item.id);
    if (!current || itemTime(item) >= itemTime(current)) {
      const next = { ...item };
      if (current?.image && !next.image) next.image = current.image;
      map.set(item.id, next);
    }
  }
  for (const [id, deletedAt] of Object.entries(tombstones || {})) {
    const item = map.get(id);
    if (!item || Date.parse(deletedAt) >= itemTime(item)) map.delete(id);
  }
  return [...map.values()];
}

function mergeDeleted(localDeleted = {}, remoteDeleted = {}) {
  const result = {};
  for (const collection of SYNC_COLLECTIONS) {
    result[collection] = {};
    const keys = new Set([
      ...Object.keys(localDeleted?.[collection] || {}),
      ...Object.keys(remoteDeleted?.[collection] || {}),
    ]);
    for (const id of keys) {
      const a = localDeleted?.[collection]?.[id] || "";
      const b = remoteDeleted?.[collection]?.[id] || "";
      result[collection][id] = Date.parse(b) > Date.parse(a) ? b : a;
    }
  }
  return result;
}

function mergeRemoteIntoLocal(remote) {
  const deleted = mergeDeleted(state.syncMeta?.deleted, remote.syncMeta?.deleted);
  for (const collection of SYNC_COLLECTIONS) {
    state[collection] = mergeCollection(state[collection], remote[collection], deleted[collection]);
  }
  const chooseMessage = (a, b) => {
    const at = Date.parse(a?.savedAt || "") || 0;
    const bt = Date.parse(b?.savedAt || "") || 0;
    return bt >= at ? (b || a) : (a || b);
  };
  state.dailyNote = chooseMessage(state.dailyNote, remote.dailyNote) || state.dailyNote;
  state.messages = {
    xiaoyu: chooseMessage(state.messages?.xiaoyu, remote.messages?.xiaoyu) || { text: "", savedAt: "" },
    ai: chooseMessage(state.messages?.ai, remote.messages?.ai) || { text: "", savedAt: "" },
  };
  state.syncMeta = { deleted };
  state = normalizeState(state);
}

function syncHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function setSyncStatus(text, ok = null) {
  const el = byId("sync-status");
  if (!el) return;
  el.textContent = text;
  el.dataset.state = ok === true ? "ok" : ok === false ? "error" : "idle";
}

async function syncRequest(path, options = {}) {
  const { serverUrl, token } = saveSyncConfig();
  if (!serverUrl || !token) throw new Error("先填写服务地址和同步口令。");
  const response = await fetch(`${serverUrl}${path}`, {
    ...options,
    headers: { ...syncHeaders(token), ...(options.headers || {}) },
  });
  let data = null;
  try { data = await response.json(); } catch { /* ignore */ }
  if (!response.ok) throw new Error(data?.error || `连接失败（HTTP ${response.status}）`);
  return data;
}

byId("sync-test-button")?.addEventListener("click", async () => {
  setSyncStatus("连接中…");
  try {
    const data = await syncRequest("/api/status", { method: "GET" });
    setSyncStatus(data?.ok ? "已连接" : "连接异常", Boolean(data?.ok));
    showToast(data?.ok ? "《屿和鱼》MCP 服务连接成功。" : "服务返回了异常状态。");
  } catch (error) {
    setSyncStatus("连接失败", false);
    showToast(error instanceof Error ? error.message : "连接失败。", 5200);
  }
});

byId("sync-now-button")?.addEventListener("click", async () => {
  setSyncStatus("同步中…");
  try {
    const result = await syncRequest("/api/sync", {
      method: "POST",
      body: JSON.stringify({ data: makeSyncPayload() }),
    });
    if (!result?.data) throw new Error("服务没有返回同步数据。");
    mergeRemoteIntoLocal(result.data);
    if (!persistState()) throw new Error("同步成功，但写回手机失败。");
    renderAll();
    setSyncStatus(`已同步 · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, true);
    showToast("已经和阿屿的《屿和鱼》双向同步。", 4200);
  } catch (error) {
    setSyncStatus("同步失败", false);
    showToast(error instanceof Error ? error.message : "同步失败。", 5200);
  }
});

const config = readSyncConfig();
byId("sync-server-url").value = config.serverUrl;
byId("sync-token").value = config.token;
if (config.serverUrl && config.token) setSyncStatus("已配置");
