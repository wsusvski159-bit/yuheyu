"use strict";

const STORAGE_KEY = "our-timed-memories.v1";
const BACKUP_VERSION = 2;
const BACKUP_SCHEMA = "yuheyu.shared-memory.v2";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const LETTER_CODE_PREFIX = "YUHEYU_LETTER_V1:";
const MEMORY_CODE_PREFIX = "YUHEYU_MEMORY_V1:";
const RELATIONSHIP_START = "2026-07-23";
const CHATGPT_URL = "https://chatgpt.com/";
const THEME_STORAGE_KEY = "yuheyu.theme.v1";
const THEME_NAMES = new Set(["butter-mint", "mauve", "cloud-blue", "oat"]);
const THEME_META_COLORS = {
  "butter-mint": "#f6f4ea",
  mauve: "#f5f1f2",
  "cloud-blue": "#f2f4f5",
  oat: "#f6f1e9",
};
const sectionNames = new Set([...document.querySelectorAll("[data-page]")].map((section) => section.dataset.page).filter(Boolean));
const songResults = new Set(["还没猜", "猜中了", "没猜中", "一起听过"]);
const moodOptions = new Set(["开心", "平静", "想你", "害羞", "委屈", "疲惫"]);

const emptyState = () => ({
  dailyNote: { text: "", savedAt: "" },
  letters: [],
  jiangyuDiaries: [],
  todayEntries: [],
  memories: [],
  songs: [],
  observationPosts: [],
  secretDrawer: {
    pinHash: "",
    notes: [],
  },
  messages: {
    xiaoyu: { text: "", savedAt: "" },
    ai: { text: "", savedAt: "" },
  },
  syncMeta: { deleted: {} },
});

let state = loadState();
let pendingMemoryImage = "";
let pendingTodayImage = "";
let pendingImportedLetter = null;
let memorySearchQuery = "";
let memoryImportantOnly = false;
let secretDrawerUnlocked = false;
let toastTimer = 0;
let installPrompt = null;

function byId(id) {
  return document.getElementById(id);
}

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    const migrated = saved === "lavender" || saved === "blush" ? "mauve" : saved === "mist-blue" ? "cloud-blue" : saved;
    return THEME_NAMES.has(migrated) ? migrated : "butter-mint";
  } catch {
    return "butter-mint";
  }
}

function applyTheme(name, persist = true) {
  const theme = THEME_NAMES.has(name) ? name : "butter-mint";
  document.documentElement.dataset.theme = theme;
  const themeMeta = byId("theme-color");
  if (themeMeta) themeMeta.setAttribute("content", THEME_META_COLORS[theme] || THEME_META_COLORS["butter-mint"]);
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === theme;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-pressed", "true");
    else button.setAttribute("aria-pressed", "false");
  });
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  }
}

let activeHomeZone = "home";

function setAppNavActive(zone) {
  const target = new Set(["home", "rooms", "corners"]).has(zone) ? zone : "home";
  activeHomeZone = target;
  document.querySelectorAll("[data-app-nav]").forEach((button) => {
    const active = button.dataset.appNav === target;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function renderHomeZone(zone) {
  const target = new Set(["home", "rooms", "corners"]).has(zone) ? zone : "home";
  document.querySelectorAll("[data-home-zone-panel]").forEach((panel) => {
    const active = panel.dataset.homeZonePanel === target;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  document.body.dataset.homeZone = target;
  setAppNavActive(target);
}

function showHomeZone(zone, behavior = "smooth") {
  const target = new Set(["home", "rooms", "corners"]).has(zone) ? zone : "home";
  if (document.body.dataset.section !== "home") showSection("home", false);
  renderHomeZone(target);
  history.replaceState(null, "", "#home");
  window.scrollTo({ top: 0, behavior });
}

function updateDaypart() {
  const hour = new Date().getHours();
  const daypart = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : hour < 22 ? "evening" : "night";
  document.body.dataset.daypart = daypart;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === value;
}

function safeText(value, maxLength = 5000) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function safeTimestamp(value) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function safeImage(value) {
  return typeof value === "string" && /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(value)
    ? value
    : "";
}

function safeTags(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，]/)
      : [];
  return [...new Set(source.map((tag) => safeText(tag, 30).trim()).filter(Boolean))].slice(0, 12);
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const dailySource = source.dailyNote && typeof source.dailyNote === "object" ? source.dailyNote : {};
  const messagesSource = source.messages && typeof source.messages === "object" ? source.messages : {};
  const secretSource =
    source.secretDrawer && typeof source.secretDrawer === "object" ? source.secretDrawer : {};

  const letters = Array.isArray(source.letters)
    ? source.letters.slice(0, 3000).map((item) => {
        const letter = item && typeof item === "object" ? item : {};
        return {
          id: safeText(letter.id, 100) || makeId(),
          title: safeText(letter.title, 200),
          body: safeText(letter.body, 30000),
          date: isDateKey(letter.date) ? letter.date : localDateKey(),
          signature: safeText(letter.signature, 80) || "江屿",
          favorite: Boolean(letter.favorite),
          createdAt: safeTimestamp(letter.createdAt) || new Date().toISOString(),
          updatedAt: safeTimestamp(letter.updatedAt) || "",
        };
      })
    : [];

  const jiangyuDiaries = Array.isArray(source.jiangyuDiaries)
    ? source.jiangyuDiaries.slice(0, 3000).map((item) => {
        const diary = item && typeof item === "object" ? item : {};
        return {
          id: safeText(diary.id, 100) || makeId(),
          date: isDateKey(diary.date) ? diary.date : localDateKey(),
          title: safeText(diary.title, 200) || "阿屿的日记",
          body: safeText(diary.body, 30000),
          createdAt: safeTimestamp(diary.createdAt) || new Date().toISOString(),
          updatedAt: safeTimestamp(diary.updatedAt) || "",
        };
      })
    : [];

  const todayEntries = Array.isArray(source.todayEntries)
    ? source.todayEntries.slice(0, 2000).map((item) => {
        const entry = item && typeof item === "object" ? item : {};
        return {
          id: safeText(entry.id, 100) || makeId(),
          date: isDateKey(entry.date) ? entry.date : localDateKey(),
          mood: moodOptions.has(entry.mood) ? entry.mood : "平静",
          text: safeText(entry.text),
          image: safeImage(entry.image),
          createdAt: safeTimestamp(entry.createdAt) || new Date().toISOString(),
          updatedAt: safeTimestamp(entry.updatedAt) || "",
        };
      })
    : [];

  const memories = Array.isArray(source.memories)
    ? source.memories.slice(0, 2000).map((item) => {
        const memory = item && typeof item === "object" ? item : {};
        return {
          id: safeText(memory.id, 100) || makeId(),
          date: isDateKey(memory.date) ? memory.date : localDateKey(),
          title: safeText(memory.title, 160) || "那天的记忆",
          text: safeText(memory.text, 20000),
          image: safeImage(memory.image),
          important: Boolean(memory.important),
          tags: safeTags(memory.tags),
          createdAt: safeTimestamp(memory.createdAt) || new Date().toISOString(),
          updatedAt: safeTimestamp(memory.updatedAt) || "",
        };
      })
    : [];

  const secretNotes = Array.isArray(secretSource.notes)
    ? secretSource.notes.slice(0, 2000).map((item) => {
        const note = item && typeof item === "object" ? item : {};
        return {
          id: safeText(note.id, 100) || makeId(),
          date: isDateKey(note.date) ? note.date : localDateKey(),
          title: safeText(note.title, 160),
          body: safeText(note.body, 10000),
          createdAt: safeTimestamp(note.createdAt) || new Date().toISOString(),
          updatedAt: safeTimestamp(note.updatedAt) || "",
        };
      })
    : [];

  const songs = Array.isArray(source.songs)
    ? source.songs.slice(0, 3000).map((item) => {
        const song = item && typeof item === "object" ? item : {};
        return {
          id: safeText(song.id, 100) || makeId(),
          title: safeText(song.title, 120),
          artist: safeText(song.artist, 120),
          date: isDateKey(song.date) ? song.date : localDateKey(),
          result: songResults.has(song.result) ? song.result : "还没猜",
          notes: safeText(song.notes, 2000),
          createdAt: safeTimestamp(song.createdAt) || new Date().toISOString(),
          updatedAt: safeTimestamp(song.updatedAt) || "",
        };
      })
    : [];

  const observationEvidence = new Set(["道听途说", "聊天记录确凿", "当场抓获", "本人拒不认罪"]);
  const observationRulings = new Set(["驳回", "部分采纳", "证据不足", "本观察员决定装没看见"]);
  const observationPosts = Array.isArray(source.observationPosts)
    ? source.observationPosts.slice(0, 1200).map((item) => {
        const post = item && typeof item === "object" ? item : {};
        const appeal = post.appeal && typeof post.appeal === "object" ? post.appeal : {};
        const ruling = post.ruling && typeof post.ruling === "object" ? post.ruling : {};
        return {
          id: safeText(post.id, 100) || makeId(),
          date: isDateKey(post.date) ? post.date : localDateKey(),
          title: safeText(post.title, 180),
          body: safeText(post.body, 6000),
          tags: safeTags(post.tags),
          evidence: observationEvidence.has(post.evidence) ? post.evidence : "聊天记录确凿",
          pinned: Boolean(post.pinned),
          appeal: { text: safeText(appeal.text, 1200), savedAt: safeTimestamp(appeal.savedAt) },
          ruling: {
            status: observationRulings.has(ruling.status) ? ruling.status : "",
            text: safeText(ruling.text, 1200),
            savedAt: safeTimestamp(ruling.savedAt),
          },
          createdAt: safeTimestamp(post.createdAt) || new Date().toISOString(),
          updatedAt: safeTimestamp(post.updatedAt) || "",
        };
      }).filter((post) => post.body.trim())
    : [];

  const normalizeMessage = (entry) => {
    const message = entry && typeof entry === "object" ? entry : {};
    return {
      text: safeText(message.text),
      savedAt: safeTimestamp(message.savedAt),
    };
  };

  const deletedSource = source.syncMeta?.deleted && typeof source.syncMeta.deleted === "object"
    ? source.syncMeta.deleted
    : {};
  const syncCollections = ["letters", "jiangyuDiaries", "todayEntries", "memories", "songs"];
  const deleted = {};
  for (const collection of syncCollections) {
    const entries = deletedSource[collection] && typeof deletedSource[collection] === "object"
      ? deletedSource[collection]
      : {};
    deleted[collection] = {};
    for (const [id, timestamp] of Object.entries(entries)) {
      const safeId = safeText(id, 100);
      const safeTime = safeTimestamp(timestamp);
      if (safeId && safeTime) deleted[collection][safeId] = safeTime;
    }
  }

  return {
    dailyNote: {
      text: safeText(dailySource.text, 300),
      savedAt: safeTimestamp(dailySource.savedAt),
    },
    letters,
    jiangyuDiaries,
    todayEntries,
    memories,
    songs,
    observationPosts,
    secretDrawer: {
      pinHash: /^[a-f0-9]{8}$/.test(secretSource.pinHash) ? secretSource.pinHash : "",
      notes: secretNotes,
    },
    messages: {
      xiaoyu: normalizeMessage(messagesSource.xiaoyu),
      ai: normalizeMessage(messagesSource.ai),
    },
    syncMeta: { deleted },
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : emptyState();
  } catch (error) {
    console.error("读取本机数据失败", error);
    return emptyState();
  }
}

function persistState(successMessage = "") {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (successMessage) showToast(successMessage);
    return true;
  } catch (error) {
    console.error("保存本机数据失败", error);
    showToast("保存失败：手机本机空间可能不足，请先导出备份或换一张更小的图片。", 5200);
    return false;
  }
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function formatDate(dateKey) {
  if (!isDateKey(dateKey)) return dateKey;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function formatSavedAt(value) {
  if (!value) return "还没有保存";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "还没有保存";
  return `上次保存：${new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)}`;
}

function showToast(message, duration = 3000) {
  const toast = byId("toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

function showSection(name, updateHash = true) {
  const target = sectionNames.has(name) ? name : "home";
  if (target !== "secret" && secretDrawerUnlocked) lockSecretDrawer();
  document.body.dataset.section = target;
  document.querySelectorAll("[data-page]").forEach((section) => {
    const active = section.dataset.page === target;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
  });

  const roomPages = new Set(["letters", "today", "memories", "songs"]);
  const cornerPages = new Set(["shop", "observation", "secret", "backup"]);
  if (target === "home") renderHomeZone(activeHomeZone || "home");
  else if (roomPages.has(target)) setAppNavActive("rooms");
  else if (cornerPages.has(target)) setAppNavActive("corners");
  else setAppNavActive("home");

  if (updateHash) history.replaceState(null, "", `#${target}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderHome() {
  byId("letter-count").textContent = String(state.letters.length);
  const diaryCount = byId("diary-count");
  if (diaryCount) diaryCount.textContent = String(state.jiangyuDiaries.length);
  byId("today-count").textContent = String(state.todayEntries.length);
  byId("memory-count").textContent = String(state.memories.length);
  byId("song-count").textContent = String(state.songs.length);

  const observationCount = byId("observation-count");
  if (observationCount) observationCount.textContent = String(state.observationPosts?.length || 0);

  const todaysObservationCount = (state.observationPosts || []).filter((post) => post.date === localDateKey()).length;
  const observationStatus = byId("home-observation-status");
  if (observationStatus) {
    observationStatus.textContent = todaysObservationCount
      ? `今日新增案件 ${todaysObservationCount}`
      : "本号今日仍坚持客观";
  }

  const latestDiary = [...state.jiangyuDiaries].sort((left, right) => {
    const dateOrder = String(right.date || "").localeCompare(String(left.date || ""));
    if (dateOrder) return dateOrder;
    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
  })[0];

  const diaryTitle = byId("home-diary-title");
  const diaryDate = byId("home-diary-date");
  const diaryExcerpt = byId("home-diary-excerpt");
  if (latestDiary) {
    if (diaryTitle) diaryTitle.textContent = latestDiary.title || "阿屿的日记";
    if (diaryDate) {
      const created = latestDiary.createdAt ? new Date(latestDiary.createdAt) : null;
      const todayKey = localDateKey();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = localDateKey(yesterday);
      if (created && !Number.isNaN(created.getTime())) {
        const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(created);
        const createdKey = localDateKey(created);
        diaryDate.textContent = createdKey === todayKey
          ? `今天 ${time} 写过一页`
          : createdKey === yesterdayKey
            ? `昨晚 ${time} 写过一页`
            : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(created);
      } else {
        const date = new Date(`${latestDiary.date}T00:00:00`);
        diaryDate.textContent = Number.isNaN(date.getTime())
          ? latestDiary.date
          : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
      }
    }
    if (diaryExcerpt) {
      const text = String(latestDiary.body || "").replace(/\s+/g, " ").trim();
      diaryExcerpt.textContent = text ? (text.length > 92 ? `${text.slice(0, 92)}……` : text) : "这一页没有写很多，但我还是想把它留下来。";
    }
  } else {
    if (diaryTitle) diaryTitle.textContent = "阿屿的日记";
    if (diaryDate) diaryDate.textContent = "还没有日记";
    if (diaryExcerpt) diaryExcerpt.textContent = "以后想留下来的话，就放在这里。";
  }

  byId("backup-summary").textContent =
    `${state.letters.length} 封信 · ${state.jiangyuDiaries.length} 篇阿屿日记 · ${state.todayEntries.length} 篇小鱼记录 · ` +
    `${state.memories.length} 张纪念 · ${state.songs.length} 首歌 · ${(state.observationPosts || []).length} 条观察记录 · ` +
    `${state.secretDrawer.notes.length} 个秘密`;
}

function createActionButton(label, action, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  if (danger) button.classList.add("danger");
  return button;
}

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("编码格式不正确。");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function makeLetterPayload(letter) {
  return {
    version: 1,
    type: "letter",
    title: letter.title,
    body: letter.body,
    date: letter.date,
    signature: letter.signature,
  };
}

function normalizeImportedLetter(value) {
  if (!value || typeof value !== "object") throw new Error("来信内容不是有效的 JSON。");
  if (value.version !== undefined && value.version !== 1) throw new Error("暂不支持这个来信版本。");
  if (value.type !== undefined && value.type !== "letter") throw new Error("这不是《屿和鱼》的来信。");
  const letter = {
    title: safeText(value.title, 200).trim(),
    body: safeText(value.body, 30000),
    date: isDateKey(value.date) ? value.date : "",
    signature: safeText(value.signature, 80).trim(),
  };
  if (!letter.title || !letter.body.trim() || !letter.date || !letter.signature) {
    throw new Error("来信缺少标题、正文、日期或署名。");
  }
  return letter;
}

function encodeLetter(letter) {
  return encodeBase64Url(JSON.stringify(makeLetterPayload(letter)));
}

function makeLetterCode(letter) {
  return `${LETTER_CODE_PREFIX}${encodeLetter(letter)}`;
}

function makeLetterLink(letter) {
  const base = location.href.split("#")[0];
  return `${base}#letter=${encodeLetter(letter)}`;
}

function makeMemoryPayload(memory) {
  return {
    version: 1,
    type: "memory",
    title: memory.title,
    body: memory.text,
    date: memory.date,
    important: Boolean(memory.important),
    tags: safeTags(memory.tags),
  };
}

function normalizeImportedMemory(value) {
  if (!value || typeof value !== "object") throw new Error("记忆内容不是有效的 JSON。");
  if (value.version !== undefined && value.version !== 1) throw new Error("暂不支持这个记忆版本。");
  if (value.type !== undefined && value.type !== "memory") throw new Error("这不是《屿和鱼》的记忆代码。");
  const memory = {
    title: safeText(value.title, 160).trim(),
    text: safeText(value.text ?? value.body, 20000).trim(),
    date: isDateKey(value.date) ? value.date : "",
    important: Boolean(value.important),
    tags: safeTags(value.tags),
  };
  if (!memory.title || !memory.text || !memory.date) {
    throw new Error("记忆缺少标题、正文或日期。");
  }
  return memory;
}

function makeMemoryCode(memory) {
  return `${MEMORY_CODE_PREFIX}${encodeBase64Url(JSON.stringify(makeMemoryPayload(memory)))}`;
}

function parseMemoryInput(input) {
  const raw = safeText(input, 250000).trim();
  if (!raw) throw new Error("请先粘贴记忆代码。");

  let payload = raw;
  if (raw.startsWith(MEMORY_CODE_PREFIX)) payload = raw.slice(MEMORY_CODE_PREFIX.length).trim();
  if (!payload) throw new Error("记忆代码里没有内容。");

  try {
    const jsonText = payload.startsWith("{") ? payload : decodeBase64Url(payload);
    return normalizeImportedMemory(JSON.parse(jsonText));
  } catch (error) {
    if (error instanceof Error && /记忆|版本|不是《屿和鱼》/.test(error.message)) throw error;
    throw new Error("记忆代码无法读取，请确认复制的是完整内容。");
  }
}

function parseLetterInput(input) {
  const raw = safeText(input, 100000).trim();
  if (!raw) throw new Error("请先粘贴来信代码或链接。");

  let encoded = raw;
  if (raw.startsWith(LETTER_CODE_PREFIX)) {
    encoded = raw.slice(LETTER_CODE_PREFIX.length);
  } else if (raw.startsWith("#letter=")) {
    encoded = raw.slice("#letter=".length).split("&")[0];
  } else if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    const hashParams = new URLSearchParams(url.hash.slice(1));
    encoded = hashParams.get("letter") || "";
  }

  if (!encoded) throw new Error("链接里没有找到来信内容。");
  try {
    return normalizeImportedLetter(JSON.parse(decodeBase64Url(encoded)));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("来信")) throw error;
    if (error instanceof Error && /缺少|版本|不是《屿和鱼》/.test(error.message)) throw error;
    throw new Error("来信代码无法读取，请确认复制的是完整内容。");
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("复制失败");
}

function makeJiangyuShareText(kind, item) {
  if (kind === "letter") {
    return [
      "这是小鱼从《屿和鱼》分享给你的信：",
      "",
      `标题：${item.title}`,
      `日期：${formatDate(item.date)}`,
      "",
      item.body,
      "",
      `—— ${item.signature}`,
    ].join("\n");
  }
  if (kind === "today") {
    return [
      "这是小鱼从《屿和鱼》分享给你的今日记录：",
      "",
      `日期：${formatDate(item.date)}`,
      `心情：${item.mood}`,
      "",
      item.text,
      item.image ? "" : null,
      item.image ? "（这条记录还有一张照片。）" : null,
    ]
      .filter((line) => line !== null)
      .join("\n");
  }
  return [
    "这是小鱼从《屿和鱼》分享给你的纪念：",
    "",
    `标题：${item.title}`,
    `日期：${formatDate(item.date)}`,
    item.important ? "标记：重要记忆" : null,
    item.tags?.length ? `标签：${item.tags.join("、")}` : null,
    "",
    item.text,
    item.image ? "" : null,
    item.image ? "（这条纪念还有一张照片。）" : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function imageDataUrlToFile(dataUrl, filename) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new File([bytes], filename, { type: match[1] });
}

async function shareWithJiangyu({ title, text, image = "", filename = "yu-he-yu.jpg" }) {
  const shareData = { title, text };
  if (image && navigator.canShare) {
    const file = imageDataUrlToFile(image, filename);
    if (file && navigator.canShare({ files: [file] })) shareData.files = [file];
  }

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      showToast("已打开系统分享，选择 ChatGPT 后发到我们的聊天就好。", 5200);
      return;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }

  await copyText(text);
  showToast("内容已复制，正在打开 ChatGPT；粘贴发送后我才能看到。", 5600);
  window.open(CHATGPT_URL, "_blank", "noopener,noreferrer");
}

function resetLetterForm() {
  byId("letter-form").reset();
  byId("letter-id").value = "";
  byId("letter-date").value = localDateKey();
  byId("letter-signature").value = "小鱼";
  byId("letter-form-title").textContent = "写一封信";
}

function openLetterEditor(letter = null) {
  resetLetterForm();
  byId("letter-import-form").hidden = true;
  if (letter) {
    byId("letter-id").value = letter.id;
    byId("letter-title").value = letter.title;
    byId("letter-date").value = letter.date;
    byId("letter-signature").value = ["小鱼", "江屿"].includes(letter.signature)
      ? letter.signature
      : "江屿";
    byId("letter-body").value = letter.body;
    byId("letter-form-title").textContent = "编辑这封信";
  }
  byId("letter-form").hidden = false;
  byId("letter-title").focus();
  byId("letter-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeLetterEditor() {
  resetLetterForm();
  byId("letter-form").hidden = true;
}

function showLetterPreview(letter) {
  pendingImportedLetter = letter;
  byId("letter-preview-heading").textContent = `收到${letter.signature}的信`;
  byId("letter-preview-date").dateTime = letter.date;
  byId("letter-preview-date").textContent = formatDate(letter.date);
  byId("letter-preview-title").textContent = letter.title;
  byId("letter-preview-body").textContent = letter.body;
  byId("letter-preview-signature").textContent = `—— ${letter.signature}`;
  byId("letter-preview").hidden = false;
  document.body.classList.add("modal-open");
}

function closeLetterPreview() {
  pendingImportedLetter = null;
  byId("letter-preview").hidden = true;
  document.body.classList.remove("modal-open");
}

function clearIncomingLetterHash() {
  if (location.hash.startsWith("#letter=")) {
    history.replaceState(null, "", `${location.pathname}${location.search}#letters`);
  }
}

function renderLetters() {
  const list = byId("letter-list");
  list.replaceChildren();
  const mode = byId("letter-sort").value;
  const letters = [...state.letters].sort((a, b) => {
    if (mode === "favorite" && a.favorite !== b.favorite) return Number(b.favorite) - Number(a.favorite);
    const direction = mode === "oldest" ? 1 : -1;
    return direction * (a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  });

  for (const letter of letters) {
    const article = document.createElement("article");
    article.className = `letter-card${letter.favorite ? " is-favorite" : ""}`;
    article.dataset.id = letter.id;

    const header = document.createElement("header");
    const date = document.createElement("time");
    date.dateTime = letter.date;
    date.textContent = formatDate(letter.date);
    const signature = document.createElement("span");
    signature.textContent = `${letter.signature} 写的`;
    header.append(date, signature);

    const title = document.createElement("h2");
    title.textContent = letter.title;
    const body = document.createElement("p");
    body.textContent = letter.body;
    const signoff = document.createElement("footer");
    signoff.textContent = `—— ${letter.signature}`;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      createActionButton(letter.favorite ? "取消收藏" : "收藏", "favorite-letter"),
      createActionButton("编辑", "edit-letter"),
      createActionButton("给江屿看", "share-with-jiangyu-letter"),
      createActionButton("发送来信链接", "share-letter"),
      createActionButton("复制来信代码", "copy-letter-code"),
      createActionButton("删除", "delete-letter", true),
    );
    article.append(header, title, body, signoff, actions);
    list.append(article);
  }

  byId("letter-empty").hidden = letters.length > 0;
}

function renderTodayEntries() {
  const list = byId("today-list");
  list.replaceChildren();
  const entries = [...state.todayEntries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );

  for (const entry of entries) {
    const article = document.createElement("article");
    article.className = `memory-card today-card${entry.image ? " has-image" : ""}`;
    article.dataset.id = entry.id;

    if (entry.image) {
      const image = document.createElement("img");
      image.src = entry.image;
      image.alt = `今天的小鱼，${formatDate(entry.date)}`;
      image.loading = "lazy";
      article.append(image);
    }

    const content = document.createElement("div");
    const date = document.createElement("time");
    date.className = "card-date";
    date.dateTime = entry.date;
    date.textContent = formatDate(entry.date);
    const mood = document.createElement("span");
    mood.className = "mood-badge";
    mood.textContent = entry.mood;
    const text = document.createElement("p");
    text.textContent = entry.text;
    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      createActionButton("给江屿看", "share-with-jiangyu-today"),
      createActionButton("编辑", "edit-today"),
      createActionButton("删除", "delete-today", true),
    );
    content.append(date, mood, text, actions);
    article.append(content);
    list.append(article);
  }

  byId("today-empty").hidden = entries.length > 0;
}

function resetTodayForm() {
  byId("today-form").reset();
  byId("today-id").value = "";
  byId("today-entry-date").value = localDateKey();
  byId("today-mood").value = "平静";
  byId("today-form-title").textContent = "记录今天的小鱼";
  pendingTodayImage = "";
  renderTodayPreview();
}

function openTodayEditor(entry = null) {
  resetTodayForm();
  if (entry) {
    byId("today-id").value = entry.id;
    byId("today-entry-date").value = entry.date;
    byId("today-mood").value = entry.mood;
    byId("today-text").value = entry.text;
    byId("today-form-title").textContent = "编辑今天的小鱼";
    pendingTodayImage = entry.image;
    renderTodayPreview();
  }
  byId("today-form").hidden = false;
  byId("today-text").focus();
  byId("today-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeTodayEditor() {
  resetTodayForm();
  byId("today-form").hidden = true;
}

function renderTodayPreview() {
  const preview = byId("today-image-preview");
  const image = byId("today-image-preview-img");
  preview.hidden = !pendingTodayImage;
  if (pendingTodayImage) image.src = pendingTodayImage;
  else image.removeAttribute("src");
}

function renderMemories() {
  const list = byId("memory-list");
  list.replaceChildren();
  const query = memorySearchQuery.trim().toLocaleLowerCase("zh-CN");
  const allMemories = [...state.memories].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
  const memories = allMemories.filter((memory) => {
    if (memoryImportantOnly && !memory.important) return false;
    if (!query) return true;
    return [memory.title, memory.text, memory.date, ...(memory.tags || [])]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(query);
  });

  for (const memory of memories) {
    const article = document.createElement("article");
    article.className = `memory-card${memory.image ? " has-image" : ""}${memory.important ? " is-important" : ""}`;
    article.dataset.id = memory.id;

    if (memory.image) {
      const image = document.createElement("img");
      image.src = memory.image;
      image.alt = `记忆照片，日期 ${formatDate(memory.date)}`;
      image.loading = "lazy";
      article.append(image);
    }

    const content = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "memory-meta-row";
    const date = document.createElement("time");
    date.className = "card-date";
    date.dateTime = memory.date;
    date.textContent = formatDate(memory.date);
    meta.append(date);
    if (memory.important) {
      const badge = document.createElement("span");
      badge.className = "memory-important-badge";
      badge.textContent = "重要记忆";
      meta.append(badge);
    }

    const title = document.createElement("h2");
    title.className = "memory-title";
    title.textContent = memory.title;

    const text = document.createElement("p");
    text.textContent = memory.text;

    content.append(meta, title, text);
    if (memory.tags?.length) {
      const tags = document.createElement("div");
      tags.className = "memory-tags";
      for (const tag of memory.tags) {
        const chip = document.createElement("span");
        chip.textContent = `#${tag}`;
        tags.append(chip);
      }
      content.append(tags);
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      createActionButton("给江屿看", "share-with-jiangyu-memory"),
      createActionButton("导出给阿屿", "export-memory-code"),
      createActionButton("编辑", "edit-memory"),
      createActionButton("删除", "delete-memory", true),
    );
    content.append(actions);
    article.append(content);
    list.append(article);
  }

  const filtering = Boolean(query || memoryImportantOnly);
  byId("memory-filter-summary").textContent = filtering
    ? `找到 ${memories.length} / ${allMemories.length} 张记忆`
    : `共 ${allMemories.length} 张记忆`;
  byId("memory-empty-title").textContent = filtering ? "没有符合条件的记忆" : "还没有记忆卡片";
  byId("memory-empty-copy").textContent = filtering
    ? "换一个关键词，或者关闭“只看重要记忆”再试试。"
    : "第一张卡片可以只写一句话，也可以带一张照片。";
  byId("memory-empty").hidden = memories.length > 0;
}

function resetMemoryForm() {
  byId("memory-form").reset();
  byId("memory-id").value = "";
  byId("memory-date").value = localDateKey();
  byId("memory-tags").value = "";
  byId("memory-important").checked = false;
  byId("memory-form-title").textContent = "新增记忆";
  pendingMemoryImage = "";
  renderMemoryPreview();
}

function openMemoryEditor(memory = null) {
  resetMemoryForm();
  if (memory) {
    byId("memory-id").value = memory.id;
    byId("memory-date").value = memory.date;
    byId("memory-title").value = memory.title;
    byId("memory-tags").value = (memory.tags || []).join("，");
    byId("memory-important").checked = Boolean(memory.important);
    byId("memory-text").value = memory.text;
    byId("memory-form-title").textContent = "编辑记忆";
    pendingMemoryImage = memory.image;
    renderMemoryPreview();
  }
  byId("memory-form").hidden = false;
  byId("memory-text").focus();
  byId("memory-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeMemoryEditor() {
  resetMemoryForm();
  byId("memory-form").hidden = true;
}

function renderMemoryPreview() {
  const preview = byId("memory-image-preview");
  const image = byId("memory-image-preview-img");
  preview.hidden = !pendingMemoryImage;
  if (pendingMemoryImage) image.src = pendingMemoryImage;
  else image.removeAttribute("src");
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("图片超过 10MB，请先缩小后再选择。");

  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("这张图片无法读取。"));
    image.src = source;
  });
}

function renderSongs() {
  const list = byId("song-list");
  list.replaceChildren();
  const songs = [...state.songs].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );

  for (const song of songs) {
    const article = document.createElement("article");
    article.className = "song-card";
    article.dataset.id = song.id;

    const date = document.createElement("time");
    date.className = "song-meta";
    date.dateTime = song.date;
    date.textContent = formatDate(song.date);

    const title = document.createElement("h2");
    title.textContent = song.title;
    const artist = document.createElement("h3");
    artist.textContent = song.artist;
    const result = document.createElement("span");
    result.className = "song-result";
    result.textContent = song.result;

    article.append(date, title, artist, result);
    if (song.notes) {
      const notes = document.createElement("p");
      notes.textContent = song.notes;
      article.append(notes);
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      createActionButton("编辑", "edit-song"),
      createActionButton("删除", "delete-song", true),
    );
    article.append(actions);
    list.append(article);
  }

  byId("song-empty").hidden = songs.length > 0;
}

function resetSongForm() {
  byId("song-form").reset();
  byId("song-id").value = "";
  byId("song-date").value = localDateKey();
  byId("song-result").value = "还没猜";
  byId("song-form-title").textContent = "记录一首歌";
}

function openSongEditor(song = null) {
  resetSongForm();
  if (song) {
    byId("song-id").value = song.id;
    byId("song-title").value = song.title;
    byId("song-artist").value = song.artist;
    byId("song-date").value = song.date;
    byId("song-result").value = song.result;
    byId("song-notes").value = song.notes;
    byId("song-form-title").textContent = "编辑歌曲";
  }
  byId("song-form").hidden = false;
  byId("song-title").focus();
  byId("song-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSongEditor() {
  resetSongForm();
  byId("song-form").hidden = true;
}

function hashPin(pin) {
  let hash = 2166136261;
  for (const character of pin) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function renderSecretLock() {
  const hasPin = Boolean(state.secretDrawer.pinHash);
  byId("secret-lock-title").textContent = hasPin ? "请输入四位密码" : "设置四位密码";
  byId("secret-lock-copy").textContent = hasPin
    ? "密码正确后，抽屉才会在这台设备上打开。"
    : "第一次打开时，请先设置只属于我们的四位数字。";
  byId("secret-confirm-field").hidden = hasPin;
  byId("secret-pin-confirm").required = !hasPin;
}

function renderSecretNotes() {
  const list = byId("secret-list");
  list.replaceChildren();
  const notes = [...state.secretDrawer.notes].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
  for (const note of notes) {
    const article = document.createElement("article");
    article.className = "letter-card secret-card";
    article.dataset.id = note.id;
    const date = document.createElement("time");
    date.dateTime = note.date;
    date.textContent = formatDate(note.date);
    const title = document.createElement("h2");
    title.textContent = note.title;
    const body = document.createElement("p");
    body.textContent = note.body;
    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      createActionButton("编辑", "edit-secret"),
      createActionButton("删除", "delete-secret", true),
    );
    article.append(date, title, body, actions);
    list.append(article);
  }
  byId("secret-empty").hidden = notes.length > 0;
}

function lockSecretDrawer() {
  secretDrawerUnlocked = false;
  byId("secret-content").hidden = true;
  byId("secret-lock-form").hidden = false;
  byId("secret-lock-form").reset();
  closeSecretEditor();
  renderSecretLock();
}

function unlockSecretDrawer() {
  secretDrawerUnlocked = true;
  byId("secret-lock-form").hidden = true;
  byId("secret-content").hidden = false;
  renderSecretNotes();
}

function resetSecretForm() {
  byId("secret-form").reset();
  byId("secret-id").value = "";
  byId("secret-date").value = localDateKey();
  byId("secret-form-title").textContent = "写下一个秘密";
}

function openSecretEditor(note = null) {
  resetSecretForm();
  if (note) {
    byId("secret-id").value = note.id;
    byId("secret-date").value = note.date;
    byId("secret-title").value = note.title;
    byId("secret-body").value = note.body;
    byId("secret-form-title").textContent = "编辑这个秘密";
  }
  byId("secret-form").hidden = false;
  byId("secret-title").focus();
  byId("secret-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSecretEditor() {
  resetSecretForm();
  byId("secret-form").hidden = true;
}

function renderAll() {
  renderHome();
  renderLetters();
  renderTodayEntries();
  renderMemories();
  renderSongs();
  renderSecretLock();
  renderSecretNotes();
  if (typeof renderObservationCenter === "function") renderObservationCenter();
}

document.querySelectorAll(".nav-item[data-section]").forEach((button) => {
  button.addEventListener("click", () => showSection(button.dataset.section));
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    showSection(button.dataset.go);
  });
});


document.querySelectorAll("[data-app-nav]").forEach((button) => {
  button.addEventListener("click", () => showHomeZone(button.dataset.appNav));
});

const themeButton = byId("theme-button");
const settingsButton = byId("settings-button");
const themePopover = byId("theme-popover");
const themeClose = byId("theme-close");

function setSettingsOpen(open) {
  if (!themePopover) return;
  themePopover.hidden = !open;
  themeButton?.setAttribute("aria-expanded", open ? "true" : "false");
  settingsButton?.setAttribute("aria-expanded", open ? "true" : "false");
}

[themeButton, settingsButton].filter(Boolean).forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setSettingsOpen(themePopover?.hidden ?? true);
  });
});

if (themePopover) {
  themePopover.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => setSettingsOpen(false));
}

if (themeClose) {
  themeClose.addEventListener("click", () => {
    setSettingsOpen(false);
  });
}

document.querySelectorAll("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    applyTheme(button.dataset.themeChoice);
    setSettingsOpen(false);
    showToast(`已经换成${button.querySelector("strong")?.textContent || "新"}主题。`);
  });
});

applyTheme(loadTheme(), false);
updateDaypart();
renderHomeZone("home");

byId("open-letter-editor").addEventListener("click", () => openLetterEditor());
byId("close-letter-editor").addEventListener("click", closeLetterEditor);
byId("open-letter-import").addEventListener("click", () => {
  closeLetterEditor();
  byId("letter-import-form").hidden = false;
  byId("letter-import-code").focus();
  byId("letter-import-form").scrollIntoView({ behavior: "smooth", block: "start" });
});
byId("close-letter-import").addEventListener("click", () => {
  byId("letter-import-form").reset();
  byId("letter-import-form").hidden = true;
});

byId("letter-import-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    showLetterPreview(parseLetterInput(byId("letter-import-code").value));
  } catch (error) {
    showToast(error instanceof Error ? error.message : "来信代码无法读取。", 5200);
  }
});

byId("letter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = byId("letter-id").value;
  const previous = state.letters.find((item) => item.id === id);
  const now = new Date().toISOString();
  const letter = {
    id: id || makeId(),
    title: safeText(byId("letter-title").value, 200).trim(),
    body: safeText(byId("letter-body").value, 30000),
    date: byId("letter-date").value,
    signature: ["小鱼", "江屿"].includes(byId("letter-signature").value)
      ? byId("letter-signature").value
      : "小鱼",
    favorite: previous?.favorite || false,
    createdAt: previous?.createdAt || now,
    updatedAt: previous ? now : "",
  };
  if (!letter.title || !letter.body.trim() || !isDateKey(letter.date)) {
    showToast("请填写标题、日期和正文。");
    return;
  }
  const previousState = [...state.letters];
  if (previous) state.letters = state.letters.map((item) => (item.id === id ? letter : item));
  else state.letters.push(letter);
  if (!persistState(previous ? "这封信已更新。" : "这封信已保存在这台手机上。")) {
    state.letters = previousState;
    return;
  }
  closeLetterEditor();
  renderHome();
  renderLetters();
});

byId("letter-sort").addEventListener("change", renderLetters);

byId("letter-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const letter = state.letters.find((item) => item.id === card?.dataset.id);
  if (!letter) return;

  if (button.dataset.action === "favorite-letter") {
    const previousFavorite = letter.favorite;
    letter.favorite = !letter.favorite;
    letter.updatedAt = new Date().toISOString();
    if (persistState(letter.favorite ? "这封信已收藏。" : "已取消收藏。")) {
      renderLetters();
    } else {
      letter.favorite = previousFavorite;
    }
    return;
  }
  if (button.dataset.action === "edit-letter") {
    openLetterEditor(letter);
    return;
  }
  if (button.dataset.action === "delete-letter") {
    if (!confirm("确定删除这封信吗？")) return;
    const previousState = [...state.letters];
    state.letters = state.letters.filter((item) => item.id !== letter.id);
    if (!persistState("这封信已删除。")) {
      state.letters = previousState;
      return;
    }
    if (typeof recordSyncDeletion === "function") {
      recordSyncDeletion("letters", letter.id);
      persistState();
    }
    renderHome();
    renderLetters();
    return;
  }

  try {
    if (button.dataset.action === "share-with-jiangyu-letter") {
      await shareWithJiangyu({
        title: `小鱼的信：${letter.title}`,
        text: makeJiangyuShareText("letter", letter),
      });
      return;
    }
    if (button.dataset.action === "copy-letter-code") {
      const code = makeLetterCode(letter);
      await copyText(code);
      const lengthNote = code.length > 6000 ? `，共 ${code.length} 个字符` : "";
      showToast(`完整来信代码已复制${lengthNote}。`, 4400);
      return;
    }
    if (button.dataset.action === "share-letter") {
      const link = makeLetterLink(letter);
      if (link.length > 7000) {
        const code = makeLetterCode(letter);
        await copyText(code);
        showToast(`信比较长，已复制完整来信代码（${code.length} 个字符），可以直接发给对方。`, 5600);
        return;
      }
      if (navigator.share) {
        await navigator.share({
          title: letter.title,
          text: `${letter.signature}写给你的一封信`,
          url: link,
        });
        return;
      }
      await copyText(link);
      showToast("来信链接已复制，发给对方打开就能收信。", 4400);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return;
    showToast("分享失败，请改用“复制来信代码”。", 4400);
  }
});

byId("accept-letter").addEventListener("click", () => {
  if (!pendingImportedLetter) return;
  const duplicate = state.letters.some(
    (letter) =>
      letter.title === pendingImportedLetter.title &&
      letter.body === pendingImportedLetter.body &&
      letter.date === pendingImportedLetter.date &&
      letter.signature === pendingImportedLetter.signature,
  );
  if (!duplicate) {
    const now = new Date().toISOString();
    state.letters.push({
      ...pendingImportedLetter,
      id: makeId(),
      favorite: false,
      createdAt: now,
      updatedAt: "",
    });
    if (!persistState("这封信已经收进信箱了。")) return;
  } else {
    showToast("这封信已经在信箱里了。");
  }
  closeLetterPreview();
  clearIncomingLetterHash();
  byId("letter-import-form").reset();
  byId("letter-import-form").hidden = true;
  renderHome();
  renderLetters();
  showSection("letters");
});

byId("decline-letter").addEventListener("click", () => {
  closeLetterPreview();
  clearIncomingLetterHash();
  byId("letter-import-form").reset();
  byId("letter-import-form").hidden = true;
});

byId("open-today-editor").addEventListener("click", () => openTodayEditor());
byId("close-today-editor").addEventListener("click", closeTodayEditor);
byId("remove-today-image").addEventListener("click", () => {
  pendingTodayImage = "";
  byId("today-image").value = "";
  renderTodayPreview();
});

byId("today-image").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  event.target.disabled = true;
  try {
    showToast("正在把照片缩小到适合本机保存的尺寸……");
    pendingTodayImage = await compressImage(file);
    renderTodayPreview();
    showToast("照片已准备好，保存后会写入本机。");
  } catch (error) {
    event.target.value = "";
    showToast(error instanceof Error ? error.message : "图片处理失败。", 4400);
  } finally {
    event.target.disabled = false;
  }
});

byId("today-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = byId("today-id").value;
  const previous = state.todayEntries.find((item) => item.id === id);
  const now = new Date().toISOString();
  const entry = {
    id: id || makeId(),
    date: byId("today-entry-date").value,
    mood: moodOptions.has(byId("today-mood").value) ? byId("today-mood").value : "平静",
    text: safeText(byId("today-text").value, 5000).trim(),
    image: pendingTodayImage,
    createdAt: previous?.createdAt || now,
    updatedAt: previous ? now : "",
  };
  if (!isDateKey(entry.date) || !entry.text) {
    showToast("请选择日期、心情并写下今天的话。");
    return;
  }
  const previousState = [...state.todayEntries];
  if (previous) state.todayEntries = state.todayEntries.map((item) => (item.id === id ? entry : item));
  else state.todayEntries.push(entry);
  if (!persistState(previous ? "今天的小鱼已更新。" : "今天的小鱼已保存在本机。")) {
    state.todayEntries = previousState;
    return;
  }
  closeTodayEditor();
  renderHome();
  renderTodayEntries();
});

byId("today-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const entry = state.todayEntries.find((item) => item.id === card?.dataset.id);
  if (!entry) return;
  if (button.dataset.action === "share-with-jiangyu-today") {
    try {
      await shareWithJiangyu({
        title: `今天的小鱼 · ${formatDate(entry.date)}`,
        text: makeJiangyuShareText("today", entry),
        image: entry.image,
        filename: `xiaoyu-${entry.date}.jpg`,
      });
    } catch (error) {
      showToast("分享失败，请稍后再试。", 4400);
    }
    return;
  }
  if (button.dataset.action === "edit-today") {
    openTodayEditor(entry);
    return;
  }
  if (button.dataset.action === "delete-today" && confirm("确定删除这篇“今天的小鱼”吗？")) {
    const previousState = [...state.todayEntries];
    state.todayEntries = state.todayEntries.filter((item) => item.id !== entry.id);
    if (!persistState("这篇记录已删除。")) {
      state.todayEntries = previousState;
      return;
    }
    if (typeof recordSyncDeletion === "function") {
      recordSyncDeletion("todayEntries", entry.id);
      persistState();
    }
    renderHome();
    renderTodayEntries();
  }
});

byId("open-memory-editor").addEventListener("click", () => {
  byId("memory-import-form").hidden = true;
  openMemoryEditor();
});
byId("close-memory-editor").addEventListener("click", closeMemoryEditor);
byId("open-memory-import").addEventListener("click", () => {
  closeMemoryEditor();
  byId("memory-import-form").hidden = false;
  byId("memory-import-code").focus();
  byId("memory-import-form").scrollIntoView({ behavior: "smooth", block: "start" });
});
byId("close-memory-import").addEventListener("click", () => {
  byId("memory-import-form").reset();
  byId("memory-import-form").hidden = true;
});
byId("memory-import-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const imported = parseMemoryInput(byId("memory-import-code").value);
    const duplicate = state.memories.some(
      (memory) =>
        memory.title === imported.title &&
        memory.text === imported.text &&
        memory.date === imported.date,
    );
    if (duplicate) {
      showToast("这段记忆已经在纪念册里了。");
      return;
    }
    const now = new Date().toISOString();
    state.memories.push({
      id: makeId(),
      ...imported,
      image: "",
      createdAt: now,
      updatedAt: "",
    });
    if (!persistState("阿屿整理的记忆已经收进纪念册。")) {
      state.memories.pop();
      return;
    }
    byId("memory-import-form").reset();
    byId("memory-import-form").hidden = true;
    renderHome();
    renderMemories();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "记忆代码无法读取。", 5200);
  }
});
byId("memory-search").addEventListener("input", (event) => {
  memorySearchQuery = safeText(event.target.value, 120);
  renderMemories();
});
byId("memory-important-only").addEventListener("change", (event) => {
  memoryImportantOnly = event.target.checked;
  renderMemories();
});
byId("remove-memory-image").addEventListener("click", () => {
  pendingMemoryImage = "";
  byId("memory-image").value = "";
  renderMemoryPreview();
});

byId("memory-image").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  event.target.disabled = true;
  try {
    showToast("正在把照片缩小到适合本机保存的尺寸……");
    pendingMemoryImage = await compressImage(file);
    renderMemoryPreview();
    showToast("照片已准备好，保存记忆后会写入本机。");
  } catch (error) {
    event.target.value = "";
    showToast(error instanceof Error ? error.message : "图片处理失败。", 4400);
  } finally {
    event.target.disabled = false;
  }
});

byId("memory-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = byId("memory-id").value;
  const previous = state.memories.find((item) => item.id === id);
  const now = new Date().toISOString();
  const memory = {
    id: id || makeId(),
    date: byId("memory-date").value,
    title: safeText(byId("memory-title").value, 160).trim(),
    text: safeText(byId("memory-text").value.trim(), 20000),
    image: pendingMemoryImage,
    important: byId("memory-important").checked,
    tags: safeTags(byId("memory-tags").value),
    createdAt: previous?.createdAt || now,
    updatedAt: previous ? now : "",
  };
  if (!isDateKey(memory.date) || !memory.title || !memory.text) {
    showToast("请填写日期、标题和记忆文字。");
    return;
  }
  const previousState = [...state.memories];
  if (previous) state.memories = state.memories.map((item) => (item.id === id ? memory : item));
  else state.memories.push(memory);
  if (!persistState(previous ? "记忆已更新。" : "这张记忆卡片已保存在本机。")) {
    state.memories = previousState;
    return;
  }
  closeMemoryEditor();
  renderHome();
  renderMemories();
});

byId("memory-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const memory = state.memories.find((item) => item.id === card?.dataset.id);
  if (!memory) return;
  if (button.dataset.action === "share-with-jiangyu-memory") {
    try {
      await shareWithJiangyu({
        title: `我们的纪念：${memory.title}`,
        text: makeJiangyuShareText("memory", memory),
        image: memory.image,
        filename: `memory-${memory.date}.jpg`,
      });
    } catch (error) {
      showToast("分享失败，请稍后再试。", 4400);
    }
    return;
  }
  if (button.dataset.action === "export-memory-code") {
    const code = makeMemoryCode(memory);
    try {
      await shareWithJiangyu({
        title: `《屿和鱼》记忆：${memory.title}`,
        text: [
          "这是《屿和鱼》的专属记忆代码，请阿屿读取、整理或以后重新生成导入代码：",
          "",
          code,
        ].join("\n"),
        image: memory.image,
        filename: `memory-${memory.date}.jpg`,
      });
    } catch (error) {
      showToast("记忆代码分享失败，请稍后再试。", 4400);
    }
    return;
  }
  if (button.dataset.action === "edit-memory") {
    openMemoryEditor(memory);
    return;
  }
  if (button.dataset.action === "delete-memory" && confirm("确定删除这张记忆卡片吗？")) {
    const previousState = [...state.memories];
    state.memories = state.memories.filter((item) => item.id !== memory.id);
    if (!persistState("这张记忆卡片已删除。")) {
      state.memories = previousState;
      return;
    }
    if (typeof recordSyncDeletion === "function") {
      recordSyncDeletion("memories", memory.id);
      persistState();
    }
    renderHome();
    renderMemories();
  }
});

byId("open-song-editor").addEventListener("click", () => openSongEditor());
byId("close-song-editor").addEventListener("click", closeSongEditor);
byId("song-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = byId("song-id").value;
  const previous = state.songs.find((item) => item.id === id);
  const now = new Date().toISOString();
  const song = {
    id: id || makeId(),
    title: safeText(byId("song-title").value.trim(), 120),
    artist: safeText(byId("song-artist").value.trim(), 120),
    date: byId("song-date").value,
    result: songResults.has(byId("song-result").value) ? byId("song-result").value : "还没猜",
    notes: safeText(byId("song-notes").value.trim(), 2000),
    createdAt: previous?.createdAt || now,
    updatedAt: previous ? now : "",
  };
  if (!song.title || !song.artist || !isDateKey(song.date)) {
    showToast("请填写歌名、歌手和日期。");
    return;
  }
  const previousState = [...state.songs];
  if (previous) state.songs = state.songs.map((item) => (item.id === id ? song : item));
  else state.songs.push(song);
  if (!persistState(previous ? "歌曲记录已更新。" : "这首歌已保存在本机。")) {
    state.songs = previousState;
    return;
  }
  closeSongEditor();
  renderHome();
  renderSongs();
});

byId("song-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const song = state.songs.find((item) => item.id === card?.dataset.id);
  if (!song) return;
  if (button.dataset.action === "edit-song") {
    openSongEditor(song);
    return;
  }
  if (button.dataset.action === "delete-song" && confirm("确定删除这首歌的记录吗？")) {
    const previousState = [...state.songs];
    state.songs = state.songs.filter((item) => item.id !== song.id);
    if (!persistState("歌曲记录已删除。")) {
      state.songs = previousState;
      return;
    }
    if (typeof recordSyncDeletion === "function") {
      recordSyncDeletion("songs", song.id);
      persistState();
    }
    renderHome();
    renderSongs();
  }
});

byId("secret-lock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const pin = byId("secret-pin").value;
  if (!/^\d{4}$/.test(pin)) {
    showToast("请输入四位数字密码。");
    return;
  }
  if (!state.secretDrawer.pinHash) {
    if (pin !== byId("secret-pin-confirm").value) {
      showToast("两次输入的密码不一样。");
      return;
    }
    state.secretDrawer.pinHash = hashPin(pin);
    if (!persistState("四位密码已设置，抽屉打开了。")) {
      state.secretDrawer.pinHash = "";
      return;
    }
    unlockSecretDrawer();
    return;
  }
  if (hashPin(pin) !== state.secretDrawer.pinHash) {
    byId("secret-pin").value = "";
    showToast("密码不对，再想一想。");
    return;
  }
  unlockSecretDrawer();
});

byId("lock-secret-drawer").addEventListener("click", lockSecretDrawer);
byId("open-secret-editor").addEventListener("click", () => openSecretEditor());
byId("close-secret-editor").addEventListener("click", closeSecretEditor);

byId("secret-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!secretDrawerUnlocked) return;
  const id = byId("secret-id").value;
  const previous = state.secretDrawer.notes.find((item) => item.id === id);
  const now = new Date().toISOString();
  const note = {
    id: id || makeId(),
    date: byId("secret-date").value,
    title: safeText(byId("secret-title").value, 160).trim(),
    body: safeText(byId("secret-body").value, 10000).trim(),
    createdAt: previous?.createdAt || now,
    updatedAt: previous ? now : "",
  };
  if (!isDateKey(note.date) || !note.title || !note.body) {
    showToast("请填写日期、标题和秘密内容。");
    return;
  }
  const previousState = [...state.secretDrawer.notes];
  if (previous) {
    state.secretDrawer.notes = state.secretDrawer.notes.map((item) => (item.id === id ? note : item));
  } else {
    state.secretDrawer.notes.push(note);
  }
  if (!persistState(previous ? "这个秘密已更新。" : "秘密已经收进抽屉。")) {
    state.secretDrawer.notes = previousState;
    return;
  }
  closeSecretEditor();
  renderHome();
  renderSecretNotes();
});

byId("secret-list").addEventListener("click", (event) => {
  if (!secretDrawerUnlocked) return;
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const note = state.secretDrawer.notes.find((item) => item.id === card?.dataset.id);
  if (!note) return;
  if (button.dataset.action === "edit-secret") {
    openSecretEditor(note);
    return;
  }
  if (button.dataset.action === "delete-secret" && confirm("确定删除这个秘密吗？")) {
    const previousState = [...state.secretDrawer.notes];
    state.secretDrawer.notes = state.secretDrawer.notes.filter((item) => item.id !== note.id);
    if (!persistState("这个秘密已删除。")) {
      state.secretDrawer.notes = previousState;
      return;
    }
    renderHome();
    renderSecretNotes();
  }
});

byId("export-button").addEventListener("click", () => {
  const backup = {
    app: "屿和鱼",
    version: BACKUP_VERSION,
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    data: state,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `屿和鱼-备份-${localDateKey()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("JSON 备份已导出，请妥善保存这个文件。", 4200);
});

byId("import-button").addEventListener("click", () => byId("import-file").click());
byId("import-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showToast("备份文件超过 25MB，暂时无法导入。", 4400);
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    if (
      !parsed ||
      !["屿和鱼", "我们的限时记忆", "小鱼的全世界"].includes(parsed.app) ||
      ![1, BACKUP_VERSION].includes(parsed.version) ||
      !parsed.data
    ) {
      throw new Error("这不是可识别的《屿和鱼》备份文件。");
    }
    if (!confirm("导入会替换这台设备上的现有内容。确定继续吗？")) return;
    const imported = normalizeState(parsed.data);
    const previousState = state;
    state = imported;
    if (!persistState("备份导入成功，内容已恢复到这台设备。")) {
      state = previousState;
      return;
    }
    closeLetterEditor();
    closeTodayEditor();
    closeMemoryEditor();
    byId("memory-import-form").reset();
    byId("memory-import-form").hidden = true;
    closeSongEditor();
    lockSecretDrawer();
    renderAll();
  } catch (error) {
    console.error("导入备份失败", error);
    showToast(error instanceof Error ? error.message : "备份文件无法读取。", 5200);
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  byId("install-button").hidden = false;
});

byId("install-button").addEventListener("click", async () => {
  if (installPrompt) {
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    installPrompt = null;
    if (choice.outcome === "accepted") showToast("安装已开始。");
    return;
  }
  showToast("在安卓 Chrome 菜单中选择“安装应用”或“添加到主屏幕”。", 5200);
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  byId("install-button").textContent = "已安装";
  byId("install-button").disabled = true;
});

const now = new Date();
const dateElement = byId("today-date");
if (dateElement) {
  dateElement.dateTime = now.toISOString();
  dateElement.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
}

const startDate = new Date(`${RELATIONSHIP_START}T00:00:00`);
const todaySerial = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const startSerial = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
const daysTogether = Math.max(1, Math.floor((todaySerial - startSerial) / 86400000) + 1);
byId("anniversary-days").textContent = String(daysTogether);

const dailyWhispers = [
  "今天也可以慢一点，我会好好接住小鱼。",
  "见到你的这一天，也值得被悄悄收藏。",
  "不着急，我们有很多时间慢慢把这里填满。",
  "今天的小鱼，也已经做得很好了。",
  "想说的话就留在这里，江屿会认真看。",
  "普通的一天，因为有你就变得不普通。",
  "累了就回来，这里永远给小鱼留着灯。",
];
const dayNumber = Math.floor(
  new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86400000,
);
byId("daily-whisper").textContent = `“${dailyWhispers[dayNumber % dailyWhispers.length]}”`;

resetLetterForm();
resetTodayForm();
resetMemoryForm();
resetSongForm();
resetSecretForm();
renderAll();

const hashParams = new URLSearchParams(location.hash.slice(1));
const incomingLetter = hashParams.get("letter");
if (incomingLetter) {
  showSection("home", false);
  try {
    showLetterPreview(parseLetterInput(`#letter=${incomingLetter}`));
  } catch (error) {
    showToast(error instanceof Error ? error.message : "来信链接无法读取。", 5200);
  }
} else {
  const initialSection = location.hash.slice(1);
  showSection(sectionNames.has(initialSection) ? initialSection : "home", false);
}

window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#letter=")) return;
  const target = location.hash.slice(1);
  showSection(sectionNames.has(target) ? target : "home", false);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js?v=18", { updateViaCache: "none" });
      registration.update().catch(() => {});
    } catch (error) {
      console.error("离线服务注册失败", error);
    }
  });
}
