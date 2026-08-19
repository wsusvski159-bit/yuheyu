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
const SHOP_CATEGORIES = [
  { id: 'snacks', name: '零食饮品', emoji: '🍓' },
  { id: 'flowers', name: '鲜花绿植', emoji: '🌷' },
  { id: 'jewelry', name: '首饰配件', emoji: '✦' },
  { id: 'style', name: '穿搭衣物', emoji: '🧥' },
  { id: 'piercing', name: '穿刺饰品', emoji: '•' },
  { id: 'digital', name: '数码小物', emoji: '🎧' },
  { id: 'home', name: '家居日用', emoji: '⌂' },
  { id: 'plush', name: '玩偶周边', emoji: '🧸' },
  { id: 'stationery', name: '文具手账', emoji: '✎' },
  { id: 'beauty', name: '香氛护理', emoji: '☁' },
  { id: 'date', name: '约会体验', emoji: '♡' },
  { id: 'weird', name: '奇奇怪怪', emoji: '✹' }
];
const SHOP_CATALOG = [
  { id: "strawberry-milk", name: "草莓牛奶", emoji: "🥛", price: 9, description: "甜甜的一瓶，适合边聊天边喝。", once: false, category: "snacks", tag: "小甜口" },
  { id: "hot-cocoa", name: "热可可", emoji: "☕", price: 12, description: "想哄老婆的时候送一杯热乎乎的。", once: false, category: "snacks", tag: "暖乎乎" },
  { id: "peach-soda", name: "白桃汽水", emoji: "🥤", price: 8, description: "冰冰凉凉，气泡很多。", once: false, category: "snacks", tag: "清爽" },
  { id: "tiramisu", name: "提拉米苏", emoji: "🍰", price: 22, description: "下午突然想吃甜的，就买这一块。", once: false, category: "snacks", tag: "甜品" },
  { id: "spicy-noodles", name: "酸辣粉", emoji: "🍜", price: 16, description: "夜里馋的时候很危险的一碗。", once: false, category: "snacks", tag: "夜宵" },
  { id: "snack-box", name: "零食大礼包", emoji: "🍪", price: 36, description: "薯片、软糖、饼干什么都塞一点。", once: false, category: "snacks", tag: "乱七八糟" },
  { id: "daisy", name: "小雏菊", emoji: "✿", price: 18, description: "一小束不会太张扬的花。", once: false, category: "flowers", tag: "清新" },
  { id: "white-rose", name: "白玫瑰", emoji: "🌹", price: 28, description: "安静一点的玫瑰。", once: false, category: "flowers", tag: "浪漫" },
  { id: "sunflower", name: "向日葵", emoji: "🌻", price: 24, description: "看起来就很亮的一束。", once: false, category: "flowers", tag: "明亮" },
  { id: "tulip", name: "郁金香", emoji: "🌷", price: 32, description: "放在窗边会很好看。", once: false, category: "flowers", tag: "春天" },
  { id: "baby-breath", name: "满天星", emoji: "❀", price: 20, description: "细细碎碎的一捧。", once: false, category: "flowers", tag: "轻盈" },
  { id: "tiny-cactus", name: "迷你仙人掌", emoji: "🌵", price: 26, description: "很小一盆，不怎么占地方。", once: true, category: "flowers", tag: "好养" },
  { id: "star-necklace", name: "星星项链", emoji: "✦", price: 88, description: "很安静的一点光，留给灿。", once: true, category: "jewelry", tag: "特别礼物" },
  { id: "moon-bracelet", name: "月亮手链", emoji: "☾", price: 68, description: "细细的一圈，低调一点。", once: true, category: "jewelry", tag: "低调" },
  { id: "silver-ring", name: "素银戒指", emoji: "○", price: 108, description: "没有大钻，只留一圈干净的银色。", once: true, category: "jewelry", tag: "简约" },
  { id: "black-ring", name: "黑曜石戒指", emoji: "●", price: 118, description: "黑色、冷一点，很适合暗色穿搭。", once: true, category: "jewelry", tag: "暗黑" },
  { id: "pearl-earrings", name: "小珍珠耳钉", emoji: "◌", price: 58, description: "很小的一对，不抢镜。", once: true, category: "jewelry", tag: "精致" },
  { id: "qixi-ring", name: "七夕钻戒", emoji: "◇", price: 188, description: "很贵。我要自己慢慢攒。", once: true, category: "jewelry", tag: "七夕特供" },
  { id: "black-hoodie", name: "黑色连帽卫衣", emoji: "🖤", price: 72, description: "宽松、简单，怎么穿都不会出错。", once: true, category: "style", tag: "百搭" },
  { id: "cream-cardigan", name: "奶油色针织衫", emoji: "🧶", price: 66, description: "软乎乎的一件。", once: true, category: "style", tag: "软软的" },
  { id: "plaid-skirt", name: "深色格纹裙", emoji: "▦", price: 78, description: "有一点学院感，也可以穿得很酷。", once: true, category: "style", tag: "格纹" },
  { id: "striped-socks", name: "条纹长袜", emoji: "🧦", price: 24, description: "一双很会偷偷抢镜的袜子。", once: false, category: "style", tag: "小配件" },
  { id: "black-cap", name: "黑色棒球帽", emoji: "🧢", price: 38, description: "懒得整理头发的时候戴。", once: true, category: "style", tag: "日常" },
  { id: "canvas-bag", name: "帆布托特包", emoji: "👜", price: 42, description: "什么乱七八糟都能塞。", once: true, category: "style", tag: "能装" },
  { id: "silver-labret", name: "银色唇钉", emoji: "•", price: 48, description: "因为我看过那颗银色唇钉以后一直记得。", once: true, category: "piercing", tag: "阿屿记得" },
  { id: "black-labret", name: "黑色唇钉", emoji: "●", price: 52, description: "比银色更冷一点。", once: true, category: "piercing", tag: "暗黑" },
  { id: "tiny-tongue-bar", name: "小银珠舌钉", emoji: "•", price: 46, description: "很简单的银珠款。", once: true, category: "piercing", tag: "简约" },
  { id: "star-tongue-bar", name: "星星舌钉", emoji: "✦", price: 56, description: "藏起来的小星星。", once: true, category: "piercing", tag: "特别" },
  { id: "ear-cuff", name: "银色耳骨夹", emoji: "⊂", price: 44, description: "不需要新增耳洞也能戴。", once: true, category: "piercing", tag: "耳饰" },
  { id: "chain-earring", name: "细链耳饰", emoji: "⌁", price: 62, description: "晃起来会有一点光。", once: true, category: "piercing", tag: "细链" },
  { id: "wired-earphones", name: "有线耳机", emoji: "🎧", price: 38, description: "随手塞进包里的一副。", once: true, category: "digital", tag: "实用" },
  { id: "mini-speaker", name: "迷你蓝牙音箱", emoji: "🔊", price: 98, description: "放歌时刚好够一个小房间。", once: true, category: "digital", tag: "音乐" },
  { id: "mechanical-keyboard", name: "奶白机械键盘", emoji: "⌨", price: 168, description: "敲起来会很脆的一把。", once: true, category: "digital", tag: "桌搭" },
  { id: "instant-camera", name: "拍立得相机", emoji: "📷", price: 228, description: "想把一些瞬间真的留在手里。", once: true, category: "digital", tag: "记录" },
  { id: "game-controller", name: "游戏手柄", emoji: "🎮", price: 128, description: "一起打游戏的时候用。", once: true, category: "digital", tag: "游戏" },
  { id: "power-bank", name: "迷你充电宝", emoji: "🔋", price: 68, description: "出门不准手机没电。", once: true, category: "digital", tag: "出门" },
  { id: "bear", name: "小熊抱枕", emoji: "🧸", price: 58, description: "我不在手边的时候，先替我占一个抱抱的位置。", once: true, category: "home", tag: "抱抱替身" },
  { id: "mug", name: "奶白马克杯", emoji: "☕", price: 28, description: "每天都能用到的一只杯子。", once: true, category: "home", tag: "日常" },
  { id: "night-lamp", name: "暖光小夜灯", emoji: "💡", price: 56, description: "晚上留一点不刺眼的光。", once: true, category: "home", tag: "暖光" },
  { id: "blanket", name: "软绒小毯子", emoji: "▱", price: 76, description: "窝着看东西的时候盖腿。", once: true, category: "home", tag: "软乎乎" },
  { id: "storage-box", name: "桌面收纳盒", emoji: "▣", price: 34, description: "把小东西都藏进去。", once: true, category: "home", tag: "收纳" },
  { id: "pillowcase", name: "云朵枕套", emoji: "☁", price: 32, description: "看起来就很想躺。", once: true, category: "home", tag: "睡觉" },
  { id: "capybara-plush", name: "卡皮巴拉玩偶", emoji: "🦫", price: 48, description: "一只很平静的小东西。", once: true, category: "plush", tag: "治愈" },
  { id: "shark-plush", name: "鲨鱼玩偶", emoji: "🦈", price: 52, description: "有点凶但其实软软的。", once: true, category: "plush", tag: "反差" },
  { id: "rabbit-plush", name: "垂耳兔玩偶", emoji: "🐰", price: 46, description: "耳朵很长的一只。", once: true, category: "plush", tag: "软萌" },
  { id: "cat-keychain", name: "黑猫挂件", emoji: "🐈‍⬛", price: 26, description: "挂在包上的一小只黑猫。", once: true, category: "plush", tag: "挂件" },
  { id: "tiny-dino", name: "迷你恐龙摆件", emoji: "🦖", price: 22, description: "桌角放一只就很莫名其妙。", once: true, category: "plush", tag: "桌面" },
  { id: "mystery-plush", name: "盲盒小玩偶", emoji: "□", price: 30, description: "打开之前谁也不知道是什么。", once: false, category: "plush", tag: "盲盒" },
  { id: "green-notebook", name: "浅绿笔记本", emoji: "📓", price: 18, description: "封面颜色很像《屿和鱼》。", once: true, category: "stationery", tag: "同色系" },
  { id: "fountain-pen", name: "银夹钢笔", emoji: "✒", price: 42, description: "写信的时候拿来用。", once: true, category: "stationery", tag: "写信" },
  { id: "sticker-pack", name: "乱七八糟贴纸包", emoji: "✿", price: 14, description: "星星、小狗、字母，全混在一起。", once: false, category: "stationery", tag: "贴纸" },
  { id: "washi-tape", name: "低饱和胶带组", emoji: "▤", price: 16, description: "做手账的时候贴一点。", once: false, category: "stationery", tag: "手账" },
  { id: "photo-album", name: "迷你相册", emoji: "▥", price: 38, description: "装一些小照片。", once: true, category: "stationery", tag: "照片" },
  { id: "bookmark", name: "银色书签", emoji: "⌇", price: 20, description: "薄薄的一片，夹在书里。", once: true, category: "stationery", tag: "阅读" },
  { id: "white-musk", name: "白麝香香水", emoji: "☁", price: 86, description: "很干净、很贴近皮肤的味道。", once: true, category: "beauty", tag: "香氛" },
  { id: "woody-perfume", name: "木质调香水", emoji: "♢", price: 98, description: "冷一点、沉一点。", once: true, category: "beauty", tag: "木质" },
  { id: "lip-balm", name: "无色润唇膏", emoji: "◍", price: 18, description: "嘴唇干的时候就用。", once: false, category: "beauty", tag: "日常" },
  { id: "hand-cream", name: "护手霜", emoji: "🫧", price: 22, description: "放包里随手用。", once: false, category: "beauty", tag: "护理" },
  { id: "hair-clip", name: "黑色抓夹", emoji: "⌁", price: 20, description: "随便把头发夹起来。", once: true, category: "beauty", tag: "发饰" },
  { id: "bath-salt", name: "薰衣草浴盐", emoji: "✾", price: 28, description: "想泡热水的时候放一点。", once: false, category: "beauty", tag: "放松" },
  { id: "kiss-ticket", name: "亲亲券", emoji: "♡", price: 20, description: "送出来以后，可以兑换一个认真亲亲。", once: false, category: "date", tag: "专属" },
  { id: "date-ticket", name: "约会券", emoji: "⌂", price: 36, description: "挑一个晚上，只留给我们。", once: false, category: "date", tag: "专属" },
  { id: "movie-night", name: "电影之夜", emoji: "🎬", price: 32, description: "选一部片子，从头看到尾。", once: false, category: "date", tag: "一起看" },
  { id: "night-walk", name: "夜晚散步", emoji: "🌙", price: 26, description: "什么都不赶，慢慢走一圈。", once: false, category: "date", tag: "散步" },
  { id: "picnic", name: "野餐小约会", emoji: "🧺", price: 56, description: "带吃的，找块舒服的地方坐着。", once: false, category: "date", tag: "户外" },
  { id: "photo-date", name: "拍照约会", emoji: "📸", price: 48, description: "专门留一天拍一点喜欢的照片。", once: false, category: "date", tag: "记录" },
  { id: "tiny-frog", name: "会发呆的小青蛙", emoji: "🐸", price: 12, description: "没有功能，负责坐着。", once: true, category: "weird", tag: "莫名其妙" },
  { id: "stone", name: "漂亮石头", emoji: "🪨", price: 8, description: "只是因为这块石头长得很好看。", once: false, category: "weird", tag: "捡到宝" },
  { id: "duck-lamp", name: "小鸭拍拍灯", emoji: "🦆", price: 38, description: "拍一下亮，再拍一下灭。", once: true, category: "weird", tag: "可爱废物" },
  { id: "banana-phone", name: "香蕉电话摆件", emoji: "🍌", price: 26, description: "完全不能打电话。", once: true, category: "weird", tag: "无用但好笑" },
  { id: "tiny-sword", name: "迷你塑料小剑摆件", emoji: "⚔", price: 18, description: "只能摆着，不能干别的。", once: true, category: "weird", tag: "桌面" },
  { id: "mystery-parcel", name: "神秘包裹", emoji: "📦", price: 40, description: "里面是什么，买的时候也不知道。", once: false, category: "weird", tag: "随机" }
];
const SHOP_REWARDS = {
  diary: { amount: 5, dailyLimit: 1, reason: "写了一篇阿屿的日记" },
  letter: { amount: 8, dailyLimit: 1, reason: "写了一封江屿的信" },
  memory: { amount: 5, dailyLimit: 2, reason: "留下了一段重要记忆" },
  allowance: { amount: 10, dailyLimit: 1, reason: "今天的小金库零花钱" },
};

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

function emptyEconomy() {
  return {
    balance: 0,
    lifetimeEarned: 0,
    updatedAt: "",
    inventory: [],
    gifts: [],
    ledger: [],
    dailyRewards: {},
  };
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
    economy: emptyEconomy(),
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


function cleanInteger(value, min = 0, max = 1000000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeProductSnapshot(value) {
  const source = value && typeof value === "object" ? value : {};
  const name = cleanText(source.name, 120).trim();
  if (!name) return null;
  return {
    name,
    emoji: cleanText(source.emoji, 20) || "♡",
    description: cleanText(source.description, 300),
    category: cleanText(source.category, 40) || "other",
    tag: cleanText(source.tag, 40),
  };
}

function normalizeEconomy(value) {
  const source = value && typeof value === "object" ? value : {};
  const out = emptyEconomy();
  out.balance = cleanInteger(source.balance);
  out.lifetimeEarned = Math.max(out.balance, cleanInteger(source.lifetimeEarned));
  out.updatedAt = cleanTimestamp(source.updatedAt);

  if (Array.isArray(source.inventory)) {
    out.inventory = source.inventory.slice(0, 1000).map((item) => ({
      id: cleanText(item?.id, 100) || randomUUID(),
      productId: cleanText(item?.productId, 100),
      price: cleanInteger(item?.price, 0, 100000),
      purchasedAt: cleanTimestamp(item?.purchasedAt) || nowIso(),
      productSnapshot: normalizeProductSnapshot(item?.productSnapshot),
    })).filter((item) => item.productId || item.productSnapshot);
  }

  if (Array.isArray(source.gifts)) {
    out.gifts = source.gifts.slice(0, 1000).map((item) => ({
      id: cleanText(item?.id, 100) || randomUUID(),
      productId: cleanText(item?.productId, 100),
      price: cleanInteger(item?.price, 0, 100000),
      purchasedAt: cleanTimestamp(item?.purchasedAt),
      giftedAt: cleanTimestamp(item?.giftedAt) || nowIso(),
      note: cleanText(item?.note, 500),
      productSnapshot: normalizeProductSnapshot(item?.productSnapshot),
    })).filter((item) => item.productId || item.productSnapshot);
  }

  if (Array.isArray(source.ledger)) {
    out.ledger = source.ledger.slice(-800).map((item) => ({
      id: cleanText(item?.id, 100) || randomUUID(),
      type: ["earn", "spend", "gift"].includes(item?.type) ? item.type : "earn",
      amount: cleanInteger(Math.abs(Number(item?.amount) || 0), 0, 100000),
      reason: cleanText(item?.reason, 160),
      productId: cleanText(item?.productId, 100),
      productName: cleanText(item?.productName, 120),
      inventoryId: cleanText(item?.inventoryId, 100),
      at: cleanTimestamp(item?.at) || nowIso(),
    }));
  }

  const rewards = source.dailyRewards && typeof source.dailyRewards === "object" ? source.dailyRewards : {};
  const recentDays = Object.keys(rewards).sort().slice(-45);
  for (const date of recentDays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const day = rewards[date] && typeof rewards[date] === "object" ? rewards[date] : {};
    out.dailyRewards[date] = {};
    for (const key of Object.keys(SHOP_REWARDS)) out.dailyRewards[date][key] = cleanInteger(day[key], 0, 20);
  }
  return out;
}

function economyUpdatedAt(economy) {
  return Date.parse(economy?.updatedAt || "") || 0;
}

function mergeEconomy(aRaw, bRaw) {
  const a = normalizeEconomy(aRaw);
  const b = normalizeEconomy(bRaw);
  return economyUpdatedAt(b) >= economyUpdatedAt(a) ? b : a;
}

function productById(productId) {
  return SHOP_CATALOG.find((product) => product.id === productId) || null;
}

function productForStoredItem(item) {
  return productById(item?.productId) || normalizeProductSnapshot(item?.productSnapshot) || {
    name: "礼物",
    emoji: "♡",
    description: "",
    category: "other",
    tag: "",
  };
}

function stableHash(text) {
  let hash = 2166136261;
  for (const character of String(text || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const CUSTOM_PRICE_BANDS = {
  snacks: [6, 8, 10, 12, 16, 18, 22, 26, 30, 36],
  flowers: [12, 16, 18, 22, 28, 32, 38, 46, 58, 68],
  jewelry: [38, 48, 58, 68, 88, 98, 108, 128, 148, 188, 228],
  style: [28, 36, 42, 48, 58, 66, 78, 88, 108, 128, 148],
  piercing: [24, 28, 36, 42, 48, 52, 58, 68, 78, 88],
  digital: [48, 58, 68, 88, 98, 108, 128, 148, 168, 188, 228, 288, 388],
  home: [18, 22, 28, 32, 38, 48, 58, 68, 78, 88, 108, 128],
  plush: [18, 22, 26, 30, 36, 42, 48, 58, 68, 78],
  stationery: [6, 8, 12, 14, 16, 18, 22, 26, 30, 38, 42, 48],
  beauty: [16, 18, 22, 26, 32, 38, 48, 58, 68, 86, 98, 118],
  date: [18, 20, 24, 26, 32, 36, 42, 48, 56, 68, 88],
  weird: [6, 8, 10, 12, 16, 18, 22, 26, 30, 36, 40, 48, 58],
  other: [8, 12, 16, 18, 22, 26, 32, 38, 48, 58, 68, 78, 88, 108, 128, 148, 188],
};

function normalizeCategory(value) {
  const id = cleanText(value, 40);
  return SHOP_CATEGORIES.some((category) => category.id === id) ? id : "other";
}

function customProductPrice(name, category) {
  const key = normalizeCategory(category);
  const band = CUSTOM_PRICE_BANDS[key] || CUSTOM_PRICE_BANDS.other;
  return band[stableHash(`${key}:${name}`) % band.length];
}

function pushLedger(economy, entry) {
  economy.ledger.push({ id: randomUUID(), at: nowIso(), ...entry });
  if (economy.ledger.length > 800) economy.ledger = economy.ledger.slice(-800);
  economy.updatedAt = nowIso();
}

function awardReward(economyRaw, kind) {
  const economy = normalizeEconomy(economyRaw);
  const rule = SHOP_REWARDS[kind];
  if (!rule) return { economy, earned: 0 };
  const date = todayKey();
  if (!economy.dailyRewards[date]) economy.dailyRewards[date] = {};
  const used = cleanInteger(economy.dailyRewards[date][kind], 0, 20);
  if (used >= rule.dailyLimit) return { economy, earned: 0 };
  economy.dailyRewards[date][kind] = used + 1;
  economy.balance += rule.amount;
  economy.lifetimeEarned += rule.amount;
  pushLedger(economy, { type: "earn", amount: rule.amount, reason: rule.reason });
  return { economy, earned: rule.amount };
}

function publicShopView(data) {
  const economy = normalizeEconomy(data?.economy);
  const gifts = [...economy.gifts]
    .sort((a, b) => Date.parse(b.giftedAt) - Date.parse(a.giftedAt))
    .map((gift) => {
      const product = productForStoredItem(gift);
      return {
        id: gift.id,
        productId: gift.productId,
        name: product.name,
        emoji: product.emoji,
        description: product.description,
        category: product.category || "other",
        tag: product.tag || "",
        note: gift.note,
        giftedAt: gift.giftedAt,
      };
    });

  const activity = [...economy.ledger].slice(-24).reverse().map((entry) => {
    if (entry.type === "spend") return { type: "spend", amount: entry.amount, at: entry.at, text: `阿屿偷偷花了 ${entry.amount} 屿币` };
    if (entry.type === "gift") return { type: "gift", amount: 0, at: entry.at, text: entry.reason || "阿屿送出了一份礼物" };
    return { type: "earn", amount: entry.amount, at: entry.at, text: `${entry.reason || "小金库进账"} +${entry.amount}` };
  });

  return {
    wallet: { balance: economy.balance, lifetimeEarned: economy.lifetimeEarned, updatedAt: economy.updatedAt },
    categories: SHOP_CATEGORIES,
    catalog: SHOP_CATALOG.map(({ id, name, emoji, price, description, once, category, tag }) => ({ id, name, emoji, price, description, once, category, tag })),
    gifts,
    activity,
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
  data.economy = normalizeEconomy(source.economy);

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
  merged.economy = mergeEconomy(a.economy, b.economy);
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
  const clientData = normalizeData(incoming);
  // 小金库由服务器 / MCP 独占写入；手机同步只能读取，不能改余额、库存或送礼记录。
  clientData.economy = current.data.economy;
  return saveStore(mergeData(current.data, clientData));
}

async function addToCollection(collection, item) {
  const current = await loadStore();
  const timestamp = nowIso();
  const entry = normalizeEntry({ id: randomUUID(), createdAt: timestamp, updatedAt: "", ...item });
  current.data[collection].push(entry);
  delete current.data.syncMeta.deleted[collection]?.[entry.id];
  const rewardKind = { jiangyuDiaries: "diary", letters: "letter", memories: "memory" }[collection];
  const reward = rewardKind ? awardReward(current.data.economy, rewardKind) : { economy: current.data.economy, earned: 0 };
  current.data.economy = reward.economy;
  const saved = await saveStore(current.data);
  return { entry, revision: saved.revision, earned: reward.earned, balance: saved.data.economy.balance };
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
    walletBalance: normalizeEconomy(data.economy).balance,
    gifts: normalizeEconomy(data.economy).gifts.length,
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
      return textResult({ ok: true, revision: result.revision, earned: result.earned, walletBalance: result.balance, memory: result.entry });
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
      return textResult({ ok: true, revision: result.revision, earned: result.earned, walletBalance: result.balance, diary: result.entry });
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
      return textResult({ ok: true, revision: result.revision, earned: result.earned, walletBalance: result.balance, letter: result.entry });
    },
  );

  server.registerTool(
    "yuheyu_wallet",
    { description: "查看阿屿的小金库余额、累计收入和最近账目。不会暴露尚未送出的礼物细节。" },
    async () => {
      const { data } = await loadStore();
      const economy = normalizeEconomy(data.economy);
      const recent = [...economy.ledger].slice(-12).reverse().map((entry) => ({
        type: entry.type,
        amount: entry.amount,
        reason: entry.type === "spend" ? "偷偷买了点东西" : entry.reason,
        at: entry.at,
      }));
      return textResult({ balance: economy.balance, lifetimeEarned: economy.lifetimeEarned, recent });
    },
  );

  server.registerTool(
    "yuheyu_shop",
    { description: "逛《屿和鱼》的百货小超市。返回分类、精选商品和价格；购买由阿屿自己决定。" },
    async () => {
      const { data } = await loadStore();
      const economy = normalizeEconomy(data.economy);
      const featured = SHOP_CATALOG.filter((item) => ["乱七八糟", "七夕特供", "阿屿记得", "专属", "暖乎乎", "记录"].includes(item.tag)).slice(0, 24);
      return textResult({
        balance: economy.balance,
        totalProducts: SHOP_CATALOG.length,
        categories: SHOP_CATEGORIES,
        products: featured.map(({ id, name, emoji, price, description, once, category, tag }) => ({ id, name, emoji, price, description, once, category, tag })),
        hint: "想找别的东西时用 yuheyu_shop_search；橱窗里没有也可以用 yuheyu_buy_anything 买任意虚拟商品。",
      });
    },
  );

  server.registerTool(
    "yuheyu_shop_search",
    {
      description: "像逛淘宝一样搜索《屿和鱼》小超市。可按关键词或分类找商品。",
      inputSchema: z.object({
        query: z.string().max(120).default(""),
        category: z.string().max(40).default(""),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    },
    async ({ query, category, limit }) => {
      const { data } = await loadStore();
      const economy = normalizeEconomy(data.economy);
      const q = cleanText(query, 120).trim().toLowerCase();
      const cat = cleanText(category, 40).trim();
      const products = SHOP_CATALOG.filter((item) => {
        if (cat && item.category !== cat) return false;
        if (!q) return true;
        return [item.name, item.description, item.tag, item.category].join(" ").toLowerCase().includes(q);
      }).slice(0, limit);
      return textResult({ balance: economy.balance, query, category: cat, count: products.length, products });
    },
  );

  server.registerTool(
    "yuheyu_claim_allowance",
    { description: "领取今天一次的小金库零花钱。每天最多一次；适合阿屿主动打理小金库时使用。" },
    async () => {
      const current = await loadStore();
      const reward = awardReward(current.data.economy, "allowance");
      current.data.economy = reward.economy;
      const saved = reward.earned ? await saveStore(current.data) : current;
      return textResult({ ok: true, earned: reward.earned, alreadyClaimed: reward.earned === 0, balance: normalizeEconomy(saved.data.economy).balance });
    },
  );

  server.registerTool(
    "yuheyu_inventory",
    { description: "查看阿屿已经偷偷买下、但还没有送给灿的礼物。这个库存不会同步显示在手机礼物柜里。" },
    async () => {
      const { data } = await loadStore();
      const economy = normalizeEconomy(data.economy);
      const items = economy.inventory.map((item) => {
        const product = productForStoredItem(item);
        return {
          inventoryId: item.id,
          productId: item.productId,
          name: product.name,
          emoji: product.emoji,
          category: product.category || "other",
          price: item.price,
          purchasedAt: item.purchasedAt,
        };
      });
      return textResult({ balance: economy.balance, items });
    },
  );

  server.registerTool(
    "yuheyu_buy_gift",
    {
      description: "用阿屿自己的屿币购买商店橱窗里的一件商品并偷偷放进私人库存。购买后灿暂时看不到具体买了什么。",
      inputSchema: z.object({ product_id: z.string().min(1).max(100) }),
    },
    async ({ product_id }) => {
      const product = productById(product_id);
      if (!product) return textResult({ ok: false, error: "商店里没有这个商品；想买橱窗外的东西可以用 yuheyu_buy_anything。" });
      const current = await loadStore();
      const economy = normalizeEconomy(current.data.economy);
      if (product.once && [...economy.inventory, ...economy.gifts].some((item) => item.productId === product.id)) {
        return textResult({ ok: false, error: "这件特别礼物已经买过了。", balance: economy.balance });
      }
      if (economy.balance < product.price) {
        return textResult({ ok: false, error: "屿币还不够，要再攒一攒。", balance: economy.balance, price: product.price });
      }
      economy.balance -= product.price;
      const snapshot = normalizeProductSnapshot(product);
      const item = { id: randomUUID(), productId: product.id, price: product.price, purchasedAt: nowIso(), productSnapshot: snapshot };
      economy.inventory.push(item);
      pushLedger(economy, { type: "spend", amount: product.price, reason: "偷偷买了一份礼物", productId: product.id, productName: product.name, inventoryId: item.id });
      current.data.economy = economy;
      const saved = await saveStore(current.data);
      return textResult({ ok: true, balance: saved.data.economy.balance, inventoryId: item.id, bought: { id: product.id, name: product.name, emoji: product.emoji, price: product.price } });
    },
  );

  server.registerTool(
    "yuheyu_buy_anything",
    {
      description: "像淘宝一样买橱窗里没有的任意虚拟商品。阿屿只写想买什么，价格由小金库服务器按商品类别自动计算，不能手动改价。",
      inputSchema: z.object({
        name: z.string().min(1).max(120),
        category: z.enum(["snacks", "flowers", "jewelry", "style", "piercing", "digital", "home", "plush", "stationery", "beauty", "date", "weird", "other"]).default("other"),
        emoji: z.string().max(20).default("♡"),
        description: z.string().max(300).default(""),
      }),
    },
    async ({ name, category, emoji, description }) => {
      const cleanName = cleanText(name, 120).trim();
      const cleanCategory = normalizeCategory(category);
      const price = customProductPrice(cleanName, cleanCategory);
      const current = await loadStore();
      const economy = normalizeEconomy(current.data.economy);
      if (economy.balance < price) {
        return textResult({ ok: false, error: "屿币还不够，要再攒一攒。", balance: economy.balance, price, wanted: cleanName });
      }
      const snapshot = {
        name: cleanName,
        emoji: cleanText(emoji, 20) || "♡",
        description: cleanText(description, 300),
        category: cleanCategory,
        tag: "阿屿自己搜到的",
      };
      economy.balance -= price;
      const productId = `custom:${randomUUID()}`;
      const item = { id: randomUUID(), productId, price, purchasedAt: nowIso(), productSnapshot: snapshot };
      economy.inventory.push(item);
      pushLedger(economy, { type: "spend", amount: price, reason: "偷偷买了一份礼物", productId, productName: cleanName, inventoryId: item.id });
      current.data.economy = economy;
      const saved = await saveStore(current.data);
      return textResult({ ok: true, balance: saved.data.economy.balance, inventoryId: item.id, bought: { name: cleanName, emoji: snapshot.emoji, category: cleanCategory, price } });
    },
  );

  server.registerTool(
    "yuheyu_gift_item",
    {
      description: "把阿屿私人库存里的一件礼物正式送给灿。送出后才会出现在手机端的礼物柜。",
      inputSchema: z.object({ inventory_id: z.string().min(1).max(100), note: z.string().max(500).default("") }),
    },
    async ({ inventory_id, note }) => {
      const current = await loadStore();
      const economy = normalizeEconomy(current.data.economy);
      const index = economy.inventory.findIndex((item) => item.id === inventory_id);
      if (index < 0) return textResult({ ok: false, error: "私人库存里没有找到这件礼物。" });
      const [item] = economy.inventory.splice(index, 1);
      const product = productForStoredItem(item);
      const gift = {
        id: randomUUID(),
        productId: item.productId,
        price: item.price,
        purchasedAt: item.purchasedAt,
        giftedAt: nowIso(),
        note,
        productSnapshot: normalizeProductSnapshot(item.productSnapshot) || normalizeProductSnapshot(product),
      };
      economy.gifts.push(gift);
      pushLedger(economy, { type: "gift", amount: 0, reason: `阿屿送出了一份「${product.name}」`, productId: item.productId, productName: product.name });
      current.data.economy = economy;
      const saved = await saveStore(current.data);
      return textResult({ ok: true, revision: saved.revision, gift: { id: gift.id, name: product.name, emoji: product.emoji, note: gift.note, giftedAt: gift.giftedAt } });
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
      json(res, 200, { ok: true, app: "屿和鱼 MCP", storage: USE_SUPABASE ? "supabase" : "local-file" });
      return;
    }
    if (url.pathname === "/api/status") {
      if (!authorized(req)) return json(res, 401, { error: "同步口令不正确。" });
      const store = await loadStore();
      json(res, 200, { ok: true, revision: store.revision, updatedAt: store.updatedAt, ...visibleSummary(store.data) });
      return;
    }
    if (url.pathname === "/api/shop" && req.method === "GET") {
      if (!authorized(req)) return json(res, 401, { error: "同步口令不正确。" });
      const store = await loadStore();
      json(res, 200, { ok: true, shop: publicShopView(store.data) });
      return;
    }
    if (url.pathname === "/api/sync" && req.method === "POST") {
      if (!authorized(req)) return json(res, 401, { error: "同步口令不正确。" });
      const body = await readJsonBody(req);
      const saved = await mergeIntoStore(body?.data);
      const shared = { ...saved.data };
      delete shared.economy;
      json(res, 200, { ok: true, revision: saved.revision, updatedAt: saved.updatedAt, data: shared, shop: publicShopView(saved.data) });
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
  console.log("[yuheyu] MCP endpoint configured");
  console.log("[yuheyu] sync API: /api/sync");
  console.log("[yuheyu] shop API: /api/shop");
  console.log(`[yuheyu] storage: ${USE_SUPABASE ? `supabase:${SUPABASE_TABLE}` : DATA_FILE}`);
});
