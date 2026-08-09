// utils/favorites.js
// 本机收藏(收藏)真实持久化。合规:§10 允许系统记录本人「收藏」行为;
// 只收藏第三方/官方来源的展示信息(岗位/招聘会/企业),不涉及投递/预约结果。
// 当前存本地 wx.storage;接后端后改为 POST/DELETE /api/v1/me/favorites 并以服务端为准。
const storage = require('./storage');

const TYPES = ['job', 'fair', 'company'];

// 收藏项落库前白名单化:只保留列表渲染需要的展示字段,不把调用方任意字段塞进 storage。
// 字段与 pages/favorites/favorites.wxml 绑定一致(wx:key="id")。
function normalize(item) {
  const it = item || {};
  return {
    // 统一转字符串:路由参数 opts.id / dataset.id 均为 String,接后端后 id 可能是 Number,
    // 转字符串可避免 isFaved/remove 的 === 因类型不一致而失配。
    id: it.id == null ? '' : String(it.id),
    initial: it.initial || '',
    title: it.title || '',
    sub: it.sub || '',
    salary: it.salary || '',
    tag: it.tag || '',
    tagTone: it.tagTone || '',
    tone: it.tone || 'plum',
  };
}

// 读取全量收藏,结构:{ job: [item...], fair: [...], company: [...] }
function readAll() {
  const raw = storage.get(storage.KEYS.FAVORITES, null);
  const out = { job: [], fair: [], company: [] };
  if (raw && typeof raw === 'object') {
    TYPES.forEach((t) => {
      if (Array.isArray(raw[t])) out[t] = raw[t];
    });
  }
  return out;
}

function writeAll(all) {
  return storage.set(storage.KEYS.FAVORITES, all);
}

// 某类型下的收藏列表
function list(type) {
  return readAll()[type] || [];
}

// 是否已收藏
function isFaved(type, id) {
  if (!type || !id) return false;
  return list(type).some((it) => it && String(it.id) === String(id));
}

// 切换收藏。item 需含 id 及展示字段(initial/title/sub/salary/tag/tagTone/tone)。
// 返回切换后的状态:true=已收藏,false=已取消。
function toggle(type, item) {
  if (!TYPES.includes(type) || !item || !item.id) return false;
  const all = readAll();
  const arr = all[type] || [];
  const idx = arr.findIndex((it) => it && String(it.id) === String(item.id));
  let faved;
  if (idx >= 0) {
    arr.splice(idx, 1);
    faved = false;
  } else {
    arr.unshift(normalize(item)); // 最近收藏置顶,只存白名单展示字段
    faved = true;
  }
  all[type] = arr;
  writeAll(all);
  return faved;
}

// 移除单条
function remove(type, id) {
  if (!TYPES.includes(type) || !id) return false;
  const all = readAll();
  const arr = all[type] || [];
  const next = arr.filter((it) => it && String(it.id) !== String(id));
  all[type] = next;
  writeAll(all);
  return next.length !== arr.length;
}

module.exports = { TYPES, readAll, list, isFaved, toggle, remove };
