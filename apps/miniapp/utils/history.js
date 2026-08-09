// utils/history.js
// 本机「浏览 / 外部跳转」记录(合规:CLAUDE.md §10 仅记录本人浏览、外部跳转,
// 绝不记录任何投递 / 预约结果 —— 结果均在来源平台完成,本机无从得知)。
// 现阶段仅落本机 storage;接后端后改为读 GET /api/v1/me/activity
// (BrowseLog / ExternalJumpLog),并以服务端为准。
const store = require('./storage');

const TYPES = ['job', 'fair', 'company', 'policy'];
// 每种内容的列表展示样式(与 browse-history.wxml 的 tone-*/ficon 一致)
const META = {
  job:     { icon: 'i-solution',  tone: 'teal' },
  fair:    { icon: 'i-calendar',  tone: 'wheat' },
  company: { icon: 'i-bank',      tone: 'clay' },
  policy:  { icon: 'i-file-text', tone: 'teal' },
};
const MAX = 100; // 只保留最近 100 条,避免本机 storage 无限增长

function readAll() {
  const v = store.get(store.KEYS.HISTORY, []);
  return Array.isArray(v) ? v : [];
}

function writeAll(arr) {
  store.set(store.KEYS.HISTORY, arr.slice(0, MAX));
}

// 记录项落库前白名单化:只保留列表渲染需要的展示字段 + 内部排序时间戳。
// 防止把详情页整个对象(可能含大量无关字段)写进 storage。
function normalize(type, item, act) {
  const it = item || {};
  const meta = META[type] || META.job;
  const isJump = act === 'jump';
  return {
    // 统一转字符串:路由参数与后端返回的 id 类型可能不一致
    id: it.id == null ? '' : String(it.id),
    type,
    // rid = 复合唯一键,供 wx:key 使用。含 act:同一内容的「浏览」与「跳转」是两条独立记录,
    // 若同日同时存在会落进同一天分组,单用 type:id 会在该分组内撞 wx:key。
    rid: `${type}:${it.id == null ? '' : String(it.id)}:${isJump ? 'jump' : 'view'}`,
    title: it.title || '未命名内容',
    act: isJump ? 'jump' : 'view',
    actLabel: isJump ? '已打开来源平台' : '浏览',
    source: it.source || '来源未知',
    icon: meta.icon,
    tone: meta.tone,
    ts: Date.now(),
  };
}

function record(type, item, act) {
  if (!TYPES.includes(type) || !item || item.id == null || item.id === '') return false;
  const rec = normalize(type, item, act);
  const arr = readAll();
  // rid 已含 act,同一内容的同类动作去重:移除旧记录,新记录置顶(保留最近一次)
  const next = arr.filter((r) => !(r && r.rid === rec.rid));
  next.unshift(rec);
  writeAll(next);
  return true;
}

// 浏览:进入详情页且真实拿到内容后调用(不在 loading/错误态记录 mock 名称)
function recordView(type, item) {
  return record(type, item, 'view');
}

// 外部跳转:点击「去来源平台 / 官方原文」等外链动作时调用
function recordJump(type, item) {
  return record(type, item, 'jump');
}

function dayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  // 跨年时带上年份,避免 2025-07-27 与 2026-07-27 都显示 07-27 被并进同一天分组
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}-${mm}-${dd}`;
  return `${mm}-${dd}`;
}

function timeLabel(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// 读取(可按 type 过滤),按时间倒序,并补充展示用的 day / time 字面量。
function list(filter) {
  const arr = readAll()
    .filter((r) => r && (!filter || filter === 'all' || r.type === filter))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return arr.map((r) => Object.assign({}, r, { day: dayLabel(r.ts), time: timeLabel(r.ts) }));
}

function clear() {
  store.remove(store.KEYS.HISTORY);
  return true;
}

module.exports = { TYPES, recordView, recordJump, list, clear };
