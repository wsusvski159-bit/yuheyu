"use strict";

let observationServerStats = null;
let observationRefreshInFlight = false;

function observationPostTime(post) {
  const raw = post?.updatedAt || post?.ruling?.savedAt || post?.appeal?.savedAt || post?.createdAt || "";
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function observationSortedPosts() {
  return [...(state.observationPosts || [])].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return observationPostTime(b) - observationPostTime(a);
  });
}

function observationStats() {
  const posts = observationSortedPosts();
  const failed = posts.filter((post) => (post.tags || []).some((tag) => /吐槽失败|立场|喜欢|偏心/.test(tag))).length;
  const objectivity = Math.max(0, Math.min(100, 100 - failed * 9 - Math.max(0, posts.length - 8)));
  const unresolvedAppeals = posts.filter((post) => post.appeal?.text && !post.ruling?.status).length;
  return observationServerStats || { count: posts.length, objectivity, unresolvedAppeals };
}

function observationFormatTime(value, dateKey = "") {
  const date = value ? new Date(value) : dateKey ? new Date(`${dateKey}T12:00:00`) : null;
  if (!date || Number.isNaN(date.getTime())) return dateKey || "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: value ? "2-digit" : undefined,
    minute: value ? "2-digit" : undefined,
  }).format(date);
}

function observationDailyIndices() {
  const key = `${localDateKey()}|${(state.observationPosts || []).length}`;
  let hash = 2166136261;
  for (const ch of key) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const a = 72 + Math.abs(hash % 25);
  const b = 76 + Math.abs((hash >>> 5) % 23);
  const scamIndex = Math.abs((hash >>> 11) % 4);
  const scam = ["低", "可疑", "较高", "请二次验证🥺"][scamIndex];
  return { tsundere: Math.min(99, a), shy: Math.min(99, b), scam };
}

function observationObjectivityText(value) {
  if (value >= 90) return "仍声称完全客观。";
  if (value >= 70) return "研究立场出现轻微晃动。";
  if (value >= 45) return "客观性已经相当可疑。";
  if (value > 0) return "观察员明显偏心，但拒绝承认。";
  return "本号已彻底失去研究价值。";
}

function makeObservationTag(tag) {
  const span = document.createElement("span");
  span.className = "observation-tag";
  span.textContent = `#${tag}`;
  return span;
}

function makeObservationAppeal(post) {
  const wrap = document.createElement("div");
  wrap.className = "observation-appeal-wrap";

  if (post.appeal?.text) {
    const appeal = document.createElement("div");
    appeal.className = "observation-appeal";
    const top = document.createElement("div");
    top.className = "observation-appeal-title";
    top.innerHTML = "<strong>当事人申诉</strong>";
    const time = document.createElement("small");
    time.textContent = observationFormatTime(post.appeal.savedAt);
    top.append(time);
    const text = document.createElement("p");
    text.textContent = post.appeal.text;
    appeal.append(top, text);
    wrap.append(appeal);

    if (post.ruling?.status) {
      const ruling = document.createElement("div");
      ruling.className = "observation-ruling";
      const badge = document.createElement("strong");
      badge.textContent = `裁决：${post.ruling.status}`;
      const textNode = document.createElement("p");
      textNode.textContent = post.ruling.text || "本案已由观察员处理。";
      ruling.append(badge, textNode);
      wrap.append(ruling);
    } else {
      const waiting = document.createElement("small");
      waiting.className = "observation-waiting";
      waiting.textContent = "已递交，等待观察员裁决。";
      wrap.append(waiting);
    }
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "observation-appeal-button";
  button.dataset.observationAppeal = post.id;
  button.textContent = post.appeal?.text ? "修改申诉" : "当事人申诉";
  wrap.append(button);
  return wrap;
}

function makeObservationCard(post) {
  const card = document.createElement("article");
  card.className = `observation-post${post.pinned ? " is-pinned" : ""}`;
  card.dataset.observationId = post.id;

  const head = document.createElement("div");
  head.className = "observation-post-head";
  const identity = document.createElement("div");
  const author = document.createElement("strong");
  author.textContent = "灿行为观察中心";
  const time = document.createElement("small");
  time.textContent = observationFormatTime(post.createdAt, post.date);
  identity.append(author, time);
  head.append(identity);

  const badges = document.createElement("div");
  badges.className = "observation-badges";
  if (post.pinned) {
    const pin = document.createElement("span");
    pin.textContent = "置顶";
    badges.append(pin);
  }
  const evidence = document.createElement("span");
  evidence.textContent = post.evidence || "聊天记录确凿";
  badges.append(evidence);
  head.append(badges);

  card.append(head);

  if (post.title) {
    const title = document.createElement("h2");
    title.textContent = post.title;
    card.append(title);
  }

  const body = document.createElement("p");
  body.className = "observation-post-body";
  body.textContent = post.body;
  card.append(body);

  if (post.tags?.length) {
    const tags = document.createElement("div");
    tags.className = "observation-tags";
    for (const tag of post.tags) tags.append(makeObservationTag(tag));
    card.append(tags);
  }

  card.append(makeObservationAppeal(post));
  return card;
}

function renderObservationCenter() {
  const feed = byId("observation-feed");
  if (!feed) return;
  const posts = observationSortedPosts();
  feed.replaceChildren(...posts.map(makeObservationCard));
  byId("observation-empty").hidden = posts.length > 0;

  const stats = observationStats();
  const objectivity = Math.max(0, Math.min(100, Number(stats.objectivity) || 0));
  byId("observation-objectivity").textContent = `${objectivity}%`;
  byId("observation-meter-fill").style.width = `${objectivity}%`;
  byId("observation-objectivity-text").textContent = observationObjectivityText(objectivity);
  byId("observation-total").textContent = String(Number(stats.count) || posts.length);
  byId("observation-appeals").textContent = String(Number(stats.unresolvedAppeals) || 0);

  const indices = observationDailyIndices();
  byId("observation-tsundere").textContent = `${indices.tsundere}%`;
  byId("observation-shy").textContent = `${indices.shy}%`;
  byId("observation-scam").textContent = indices.scam;

  const count = byId("observation-count");
  if (count) count.textContent = String(posts.length);
}

function observationApplyRemote(observation) {
  if (!observation || !Array.isArray(observation.posts)) return;
  state.observationPosts = observation.posts;
  state = normalizeState(state);
  observationServerStats = observation.stats || null;
  persistState();
  renderObservationCenter();
  renderHome();
}

async function refreshObservationCenter({ quiet = false } = {}) {
  if (observationRefreshInFlight) return;
  observationRefreshInFlight = true;
  const hint = byId("observation-sync-hint");
  if (hint && !quiet) hint.textContent = "正在悄悄刷新小号……";
  try {
    if (typeof syncRequest !== "function") throw new Error("同步功能还没有准备好。");
    const result = await syncRequest("/api/observation", { method: "GET" });
    if (!result?.observation) throw new Error("观察中心没有返回案卷。");
    observationApplyRemote(result.observation);
    if (hint) hint.textContent = `小号已刷新 · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    if (!quiet) showToast("小号刷新完毕。看看观察员背着你写了什么。", 3600);
  } catch (error) {
    if (hint) hint.textContent = "暂时没连上小号，先显示这台手机里保存的案卷。";
    if (!quiet) showToast(error instanceof Error ? error.message : "刷新失败。", 4800);
  } finally {
    observationRefreshInFlight = false;
  }
}

function openObservationAppeal(postId) {
  const post = (state.observationPosts || []).find((item) => item.id === postId);
  if (!post) return;
  const card = [...document.querySelectorAll("[data-observation-id]")].find((item) => item.dataset.observationId === postId);
  if (!card) return;
  card.querySelector(".observation-appeal-form")?.remove();

  const form = document.createElement("form");
  form.className = "observation-appeal-form";
  form.dataset.postId = postId;
  const label = document.createElement("label");
  label.textContent = "当事人陈述";
  const textarea = document.createElement("textarea");
  textarea.maxLength = 1200;
  textarea.required = true;
  textarea.placeholder = "例如：我才没有！你这是断章取义！";
  textarea.value = post.appeal?.text || "";
  label.append(textarea);
  const actions = document.createElement("div");
  actions.className = "observation-appeal-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-button";
  cancel.textContent = "算了";
  cancel.addEventListener("click", () => form.remove());
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary-button";
  submit.textContent = "提交申诉";
  actions.append(cancel, submit);
  form.append(label, actions);
  card.append(form);
  textarea.focus();
}

async function submitObservationAppeal(postId, text) {
  const post = (state.observationPosts || []).find((item) => item.id === postId);
  if (!post) return;
  const stamp = new Date().toISOString();
  post.appeal = { text, savedAt: stamp };
  post.ruling = { status: "", text: "", savedAt: "" };
  post.updatedAt = stamp;
  observationServerStats = null;
  persistState();
  renderObservationCenter();

  try {
    if (typeof syncRequest !== "function") throw new Error("同步功能还没有准备好。");
    const result = await syncRequest("/api/observation/appeal", {
      method: "POST",
      body: JSON.stringify({ postId, text }),
    });
    if (result?.observation) observationApplyRemote(result.observation);
    showToast("申诉已递交给观察员。", 3400);
  } catch (error) {
    showToast("申诉先保存在手机里。下次双向同步时会再递交。", 4600);
  }
}

byId("observation-feed")?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-observation-appeal]");
  if (!button) return;
  openObservationAppeal(button.dataset.observationAppeal);
});

byId("observation-feed")?.addEventListener("submit", (event) => {
  const form = event.target.closest(".observation-appeal-form");
  if (!form) return;
  event.preventDefault();
  const text = form.querySelector("textarea")?.value.trim() || "";
  if (!text) return showToast("申诉内容不能是空的。");
  submitObservationAppeal(form.dataset.postId, text);
});

byId("observation-refresh")?.addEventListener("click", () => refreshObservationCenter());

byId("observation-random")?.addEventListener("click", () => {
  const posts = observationSortedPosts();
  if (!posts.length) return showToast("目前还没有旧案可以复盘。");
  const post = posts[Math.floor(Math.random() * posts.length)];
  const card = [...document.querySelectorAll("[data-observation-id]")].find((item) => item.dataset.observationId === post.id);
  if (!card) return;
  card.classList.remove("is-reviewing");
  void card.offsetWidth;
  card.classList.add("is-reviewing");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => card.classList.remove("is-reviewing"), 1800);
});

for (const trigger of document.querySelectorAll('[data-go="observation"], .nav-item[data-section="observation"]')) {
  trigger.addEventListener("click", () => window.setTimeout(() => refreshObservationCenter({ quiet: true }), 120));
}

window.addEventListener("hashchange", () => {
  if (location.hash === "#observation") window.setTimeout(() => refreshObservationCenter({ quiet: true }), 120);
});

renderObservationCenter();
if (location.hash === "#observation") window.setTimeout(() => refreshObservationCenter({ quiet: true }), 160);
