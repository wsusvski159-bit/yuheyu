"use strict";

const SHOP_PUBLIC_KEY = "yuheyu.shop-public.v1";

function emptyShopPublicState() {
  return {
    wallet: { balance: 0, lifetimeEarned: 0, updatedAt: "" },
    catalog: [],
    gifts: [],
    activity: [],
  };
}

function readShopPublicState() {
  try {
    const value = JSON.parse(localStorage.getItem(SHOP_PUBLIC_KEY) || "null");
    return normalizeShopPublicState(value);
  } catch {
    return emptyShopPublicState();
  }
}

function normalizeShopPublicState(value) {
  const source = value && typeof value === "object" ? value : {};
  const wallet = source.wallet && typeof source.wallet === "object" ? source.wallet : {};
  return {
    wallet: {
      balance: Number.isFinite(Number(wallet.balance)) ? Math.max(0, Math.trunc(Number(wallet.balance))) : 0,
      lifetimeEarned: Number.isFinite(Number(wallet.lifetimeEarned)) ? Math.max(0, Math.trunc(Number(wallet.lifetimeEarned))) : 0,
      updatedAt: typeof wallet.updatedAt === "string" ? wallet.updatedAt : "",
    },
    catalog: Array.isArray(source.catalog)
      ? source.catalog.slice(0, 100).map((item) => ({
          id: safeText(item?.id, 80),
          name: safeText(item?.name, 120),
          emoji: safeText(item?.emoji, 20),
          description: safeText(item?.description, 300),
          price: Number.isFinite(Number(item?.price)) ? Math.max(0, Math.trunc(Number(item.price))) : 0,
          once: Boolean(item?.once),
        })).filter((item) => item.id && item.name)
      : [],
    gifts: Array.isArray(source.gifts)
      ? source.gifts.slice(0, 500).map((item) => ({
          id: safeText(item?.id, 100),
          productId: safeText(item?.productId, 80),
          name: safeText(item?.name, 120) || "礼物",
          emoji: safeText(item?.emoji, 20) || "♡",
          description: safeText(item?.description, 300),
          note: safeText(item?.note, 500),
          giftedAt: safeTimestamp(item?.giftedAt),
        })).filter((item) => item.id)
      : [],
    activity: Array.isArray(source.activity)
      ? source.activity.slice(0, 50).map((item) => ({
          type: ["earn", "spend", "gift"].includes(item?.type) ? item.type : "earn",
          amount: Number.isFinite(Number(item?.amount)) ? Math.max(0, Math.trunc(Number(item.amount))) : 0,
          text: safeText(item?.text, 240),
          at: safeTimestamp(item?.at),
        }))
      : [],
  };
}

let shopPublicState = readShopPublicState();

function updateShopPublicState(value) {
  shopPublicState = normalizeShopPublicState(value);
  localStorage.setItem(SHOP_PUBLIC_KEY, JSON.stringify(shopPublicState));
  renderShop();
}

function formatShopTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderShopCatalog() {
  const list = byId("shop-catalog");
  const empty = byId("shop-catalog-empty");
  if (!list || !empty) return;
  list.replaceChildren();
  empty.hidden = shopPublicState.catalog.length > 0;

  for (const product of shopPublicState.catalog) {
    const card = document.createElement("article");
    card.className = "shop-item-card";

    const icon = document.createElement("span");
    icon.className = "shop-item-icon";
    icon.textContent = product.emoji || "♡";

    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = product.name;
    const description = document.createElement("p");
    description.textContent = product.description;
    const meta = document.createElement("small");
    meta.textContent = `${product.price} 屿币${product.once ? " · 特别礼物" : ""}`;
    copy.append(title, description, meta);

    card.append(icon, copy);
    list.append(card);
  }
}

function renderShopGifts() {
  const list = byId("shop-gifts");
  const empty = byId("shop-gifts-empty");
  if (!list || !empty) return;
  list.replaceChildren();
  const gifts = [...shopPublicState.gifts].sort((a, b) => Date.parse(b.giftedAt || "") - Date.parse(a.giftedAt || ""));
  empty.hidden = gifts.length > 0;

  for (const gift of gifts) {
    const card = document.createElement("article");
    card.className = "gift-card";

    const icon = document.createElement("span");
    icon.className = "gift-icon";
    icon.textContent = gift.emoji || "♡";

    const copy = document.createElement("div");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = formatShopTime(gift.giftedAt) || "阿屿送出的礼物";
    const title = document.createElement("h3");
    title.textContent = gift.name;
    copy.append(eyebrow, title);
    if (gift.note) {
      const note = document.createElement("p");
      note.className = "gift-note";
      note.textContent = gift.note;
      copy.append(note);
    }
    card.append(icon, copy);
    list.append(card);
  }
}

function renderShopActivity() {
  const list = byId("shop-activity");
  const empty = byId("shop-activity-empty");
  if (!list || !empty) return;
  list.replaceChildren();
  empty.hidden = shopPublicState.activity.length > 0;

  for (const item of shopPublicState.activity) {
    const row = document.createElement("div");
    row.className = `shop-activity-row is-${item.type}`;
    const text = document.createElement("span");
    text.textContent = item.text || "小金库有一点动静。";
    const time = document.createElement("small");
    time.textContent = formatShopTime(item.at);
    row.append(text, time);
    list.append(row);
  }
}

function renderShop() {
  const balance = byId("shop-balance");
  const lifetime = byId("shop-lifetime");
  if (balance) balance.textContent = String(shopPublicState.wallet.balance);
  if (lifetime) lifetime.textContent = String(shopPublicState.wallet.lifetimeEarned);
  renderShopCatalog();
  renderShopGifts();
  renderShopActivity();
}

byId("shop-refresh")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await syncRequest("/api/shop", { method: "GET" });
    if (!result?.shop) throw new Error("服务没有返回小金库数据。");
    updateShopPublicState(result.shop);
    showToast("阿屿的小金库刷新好了。");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "小金库刷新失败。", 5200);
  } finally {
    button.disabled = false;
  }
});

const shopBaseRenderAll = renderAll;
renderAll = function renderAllWithShop() {
  shopBaseRenderAll();
  renderShop();
};

renderShop();
