"use strict";

const SHOP_PUBLIC_KEY = "yuheyu.shop-public.v2";

function emptyShopPublicState() {
  return {
    wallet: { balance: 0, lifetimeEarned: 0, updatedAt: "" },
    categories: [],
    catalog: [],
    gifts: [],
    activity: [],
  };
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
    categories: Array.isArray(source.categories)
      ? source.categories.slice(0, 30).map((item) => ({
          id: safeText(item?.id, 40),
          name: safeText(item?.name, 60),
          emoji: safeText(item?.emoji, 20),
        })).filter((item) => item.id && item.name)
      : [],
    catalog: Array.isArray(source.catalog)
      ? source.catalog.slice(0, 300).map((item) => ({
          id: safeText(item?.id, 100),
          name: safeText(item?.name, 120),
          emoji: safeText(item?.emoji, 20),
          description: safeText(item?.description, 300),
          price: Number.isFinite(Number(item?.price)) ? Math.max(0, Math.trunc(Number(item.price))) : 0,
          once: Boolean(item?.once),
          category: safeText(item?.category, 40) || "other",
          tag: safeText(item?.tag, 40),
        })).filter((item) => item.id && item.name)
      : [],
    gifts: Array.isArray(source.gifts)
      ? source.gifts.slice(0, 500).map((item) => ({
          id: safeText(item?.id, 100),
          productId: safeText(item?.productId, 100),
          name: safeText(item?.name, 120) || "礼物",
          emoji: safeText(item?.emoji, 20) || "♡",
          description: safeText(item?.description, 300),
          category: safeText(item?.category, 40) || "other",
          tag: safeText(item?.tag, 40),
          note: safeText(item?.note, 500),
          giftedAt: safeTimestamp(item?.giftedAt),
        })).filter((item) => item.id)
      : [],
    activity: Array.isArray(source.activity)
      ? source.activity.slice(0, 60).map((item) => ({
          type: ["earn", "spend", "gift"].includes(item?.type) ? item.type : "earn",
          amount: Number.isFinite(Number(item?.amount)) ? Math.max(0, Math.trunc(Number(item.amount))) : 0,
          text: safeText(item?.text, 240),
          at: safeTimestamp(item?.at),
        }))
      : [],
  };
}

function readShopPublicState() {
  try {
    return normalizeShopPublicState(JSON.parse(localStorage.getItem(SHOP_PUBLIC_KEY) || "null"));
  } catch {
    return emptyShopPublicState();
  }
}

let shopPublicState = readShopPublicState();
let shopQuery = "";
let shopCategory = "all";

function updateShopPublicState(value) {
  shopPublicState = normalizeShopPublicState(value);
  localStorage.setItem(SHOP_PUBLIC_KEY, JSON.stringify(shopPublicState));
  renderShop();
}

function formatShopTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function getShopCategories() {
  const base = [{ id: "all", name: "全部", emoji: "▦" }];
  const seen = new Set(["all"]);
  for (const category of shopPublicState.categories) {
    if (!seen.has(category.id)) {
      base.push(category);
      seen.add(category.id);
    }
  }
  return base;
}

function filteredProducts() {
  const q = shopQuery.trim().toLowerCase();
  return shopPublicState.catalog.filter((item) => {
    if (shopCategory !== "all" && item.category !== shopCategory) return false;
    if (!q) return true;
    return [item.name, item.description, item.tag].join(" ").toLowerCase().includes(q);
  });
}

function renderShopCategories() {
  const wrap = byId("shop-categories");
  if (!wrap) return;
  wrap.replaceChildren();
  for (const category of getShopCategories()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `market-category${shopCategory === category.id ? " is-active" : ""}`;
    button.dataset.category = category.id;
    button.innerHTML = `<span>${category.emoji || "•"}</span><b></b>`;
    button.querySelector("b").textContent = category.name;
    wrap.append(button);
  }
}

function renderShopCatalog() {
  const list = byId("shop-catalog");
  const empty = byId("shop-catalog-empty");
  const count = byId("shop-result-count");
  const title = byId("shop-feed-title");
  if (!list || !empty) return;

  const products = filteredProducts();
  list.replaceChildren();
  empty.hidden = products.length > 0;
  if (count) count.textContent = `${products.length} 件商品`;
  if (title) {
    const category = getShopCategories().find((item) => item.id === shopCategory);
    title.textContent = shopQuery ? `搜索“${shopQuery}”` : shopCategory === "all" ? "猜你喜欢" : category?.name || "逛逛这一类";
  }

  for (const product of products) {
    const card = document.createElement("article");
    card.className = "market-product-card";

    const visual = document.createElement("div");
    visual.className = "market-product-visual";
    const icon = document.createElement("span");
    icon.className = "market-product-emoji";
    icon.textContent = product.emoji || "♡";
    const badge = document.createElement("small");
    badge.textContent = product.tag || (product.once ? "特别款" : "日常好物");
    visual.append(icon, badge);

    const copy = document.createElement("div");
    copy.className = "market-product-copy";
    const name = document.createElement("h3");
    name.textContent = product.name;
    const desc = document.createElement("p");
    desc.textContent = product.description;
    const footer = document.createElement("div");
    footer.className = "market-product-footer";
    const price = document.createElement("strong");
    price.innerHTML = `<small>¥</small>${product.price}`;
    const unit = document.createElement("span");
    unit.textContent = "屿币";
    footer.append(price, unit);
    copy.append(name, desc, footer);
    card.append(visual, copy);
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
    card.className = "gift-card parcel-card";
    const icon = document.createElement("span");
    icon.className = "gift-icon";
    icon.textContent = gift.emoji || "📦";
    const copy = document.createElement("div");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = formatShopTime(gift.giftedAt) || "刚刚送达";
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
  renderShopCategories();
  renderShopCatalog();
  renderShopGifts();
  renderShopActivity();
}

byId("shop-categories")?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  shopCategory = button.dataset.category || "all";
  renderShopCategories();
  renderShopCatalog();
});

byId("shop-search")?.addEventListener("input", (event) => {
  shopQuery = safeText(event.target.value, 120);
  renderShopCatalog();
});

byId("shop-search-clear")?.addEventListener("click", () => {
  shopQuery = "";
  const input = byId("shop-search");
  if (input) {
    input.value = "";
    input.focus();
  }
  renderShopCatalog();
});

byId("shop-refresh")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await syncRequest("/api/shop", { method: "GET" });
    if (!result?.shop) throw new Error("服务没有返回小金库数据。");
    updateShopPublicState(result.shop);
    showToast("小超市理货完成，已经可以逛啦。");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "小超市刷新失败。", 5200);
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
