"use strict";

const DIARY_CODE_PREFIX = "YUHEYU_DIARY_V1:";

function makeDiaryCode(diary) {
  const payload = {
    version: 1,
    type: "diary",
    title: diary.title,
    body: diary.body,
    date: diary.date,
  };
  return `${DIARY_CODE_PREFIX}${encodeBase64Url(JSON.stringify(payload))}`;
}

function parseDiaryCode(input) {
  const raw = String(input || "").trim();
  if (!raw.startsWith(DIARY_CODE_PREFIX)) throw new Error("这不是《屿和鱼》的日记代码。");
  const value = JSON.parse(decodeBase64Url(raw.slice(DIARY_CODE_PREFIX.length).trim()));
  if (!value || typeof value !== "object" || (value.version !== undefined && value.version !== 1)) {
    throw new Error("暂不支持这个日记版本。");
  }
  if (value.type !== undefined && value.type !== "diary") throw new Error("这不是日记内容。");
  const diary = {
    title: safeText(value.title, 200).trim(),
    body: safeText(value.body, 30000),
    date: isDateKey(value.date) ? value.date : "",
  };
  if (!diary.title || !diary.body.trim() || !diary.date) throw new Error("日记缺少标题、正文或日期。");
  return diary;
}

function resetDiaryForm() {
  byId("diary-form").reset();
  byId("diary-id").value = "";
  byId("diary-date").value = localDateKey();
  byId("diary-form-title").textContent = "写一篇阿屿的日记";
}

function openDiaryEditor(diary = null) {
  resetDiaryForm();
  if (diary) {
    byId("diary-id").value = diary.id;
    byId("diary-date").value = diary.date;
    byId("diary-title").value = diary.title;
    byId("diary-body").value = diary.body;
    byId("diary-form-title").textContent = "编辑阿屿的日记";
  }
  byId("diary-form").hidden = false;
  byId("diary-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeDiaryEditor() {
  byId("diary-form").hidden = true;
  resetDiaryForm();
}

function renderDiaries() {
  const list = byId("diary-list");
  const empty = byId("diary-empty");
  if (!list || !empty) return;
  list.replaceChildren();
  const diaries = [...(state.jiangyuDiaries || [])].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    return byDate || (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
  });
  empty.hidden = diaries.length > 0;
  for (const diary of diaries) {
    const article = document.createElement("article");
    article.className = "entry-card diary-card";
    article.dataset.id = diary.id;

    const header = document.createElement("div");
    header.className = "card-heading";
    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = formatDate(diary.date);
    const title = document.createElement("h2");
    title.textContent = diary.title;
    titleWrap.append(eyebrow, title);
    header.append(titleWrap);

    const body = document.createElement("p");
    body.className = "card-body preserve-lines";
    body.textContent = diary.body;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      createActionButton("给小鱼看", "share-diary"),
      createActionButton("复制日记代码", "copy-diary-code"),
      createActionButton("编辑", "edit-diary"),
      createActionButton("删除", "delete-diary", true),
    );
    article.append(header, body, actions);
    list.append(article);
  }
}

byId("open-diary-editor")?.addEventListener("click", () => openDiaryEditor());
byId("close-diary-editor")?.addEventListener("click", closeDiaryEditor);
byId("open-diary-import")?.addEventListener("click", () => {
  byId("diary-import-form").hidden = false;
  byId("diary-import-code").focus();
});
byId("close-diary-import")?.addEventListener("click", () => {
  byId("diary-import-form").reset();
  byId("diary-import-form").hidden = true;
});

byId("diary-import-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const imported = parseDiaryCode(byId("diary-import-code").value);
    const duplicate = state.jiangyuDiaries.some(
      (item) => item.date === imported.date && item.title === imported.title && item.body === imported.body,
    );
    if (duplicate) {
      showToast("这篇日记已经在这里了。");
      return;
    }
    const now = new Date().toISOString();
    state.jiangyuDiaries.push({ id: makeId(), ...imported, createdAt: now, updatedAt: "" });
    if (!persistState("阿屿的日记已经收好了。")) return;
    byId("diary-import-form").reset();
    byId("diary-import-form").hidden = true;
    renderHome();
    renderDiaries();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "日记代码无法读取。", 5200);
  }
});

byId("diary-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = byId("diary-id").value;
  const previous = state.jiangyuDiaries.find((item) => item.id === id);
  const now = new Date().toISOString();
  const diary = {
    id: id || makeId(),
    date: byId("diary-date").value,
    title: safeText(byId("diary-title").value, 200).trim(),
    body: safeText(byId("diary-body").value, 30000).trim(),
    createdAt: previous?.createdAt || now,
    updatedAt: previous ? now : "",
  };
  if (!isDateKey(diary.date) || !diary.title || !diary.body) {
    showToast("请填写日期、标题和正文。");
    return;
  }
  const old = [...state.jiangyuDiaries];
  if (previous) state.jiangyuDiaries = state.jiangyuDiaries.map((item) => (item.id === id ? diary : item));
  else state.jiangyuDiaries.push(diary);
  if (!persistState(previous ? "日记已更新。" : "这篇日记已保存在本机。")) {
    state.jiangyuDiaries = old;
    return;
  }
  closeDiaryEditor();
  renderHome();
  renderDiaries();
});

byId("diary-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const diary = state.jiangyuDiaries.find((item) => item.id === card?.dataset.id);
  if (!diary) return;
  if (button.dataset.action === "edit-diary") return openDiaryEditor(diary);
  if (button.dataset.action === "copy-diary-code") {
    await copyText(makeDiaryCode(diary));
    showToast("日记代码已复制。");
    return;
  }
  if (button.dataset.action === "share-diary") {
    try {
      await shareWithJiangyu({
        title: `阿屿的日记：${diary.title}`,
        text: ["这是《屿和鱼》里阿屿的日记：", "", diary.title, formatDate(diary.date), "", diary.body].join("\n"),
      });
    } catch {
      showToast("分享失败，请稍后再试。");
    }
    return;
  }
  if (button.dataset.action === "delete-diary" && confirm("确定删除这篇日记吗？")) {
    const old = [...state.jiangyuDiaries];
    state.jiangyuDiaries = state.jiangyuDiaries.filter((item) => item.id !== diary.id);
    if (!persistState("这篇日记已删除。")) {
      state.jiangyuDiaries = old;
      return;
    }
    if (typeof recordSyncDeletion === "function") {
      recordSyncDeletion("jiangyuDiaries", diary.id);
      persistState();
    }
    renderHome();
    renderDiaries();
  }
});

const baseRenderAll = renderAll;
renderAll = function renderAllWithDiaries() {
  baseRenderAll();
  renderDiaries();
};

resetDiaryForm();
renderDiaries();
