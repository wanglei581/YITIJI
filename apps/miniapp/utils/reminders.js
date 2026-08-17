// utils/reminders.js
// 招聘会本地提醒：基于 wx.Storage 的纯本地提醒管理。
// 不依赖后端，不需要微信订阅消息模板；
// App 启动时检查并展示 24h 内临近提醒。

const STORAGE_KEY = 'zyd_fair_reminders';

/** 读取所有已设置的提醒，返回 { [fairId]: item } */
function getAll() {
  try {
    const v = wx.getStorageSync(STORAGE_KEY);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (_) {
    return {};
  }
}

/** 某招聘会是否已设置提醒 */
function isSet(fairId) {
  return !!getAll()[String(fairId)];
}

/**
 * 设置提醒
 * @param {{ id: string, title: string, startTime: string, venue?: string }} fair
 */
function set(fair) {
  const all = getAll();
  all[String(fair.id)] = {
    id: String(fair.id),
    title: fair.title || '招聘会',
    startTime: fair.startTime || '',
    venue: fair.venue || '',
    createdAt: Date.now(),
  };
  try {
    wx.setStorageSync(STORAGE_KEY, all);
    return true;
  } catch (_) {
    return false;
  }
}

/** 取消提醒 */
function remove(fairId) {
  const all = getAll();
  delete all[String(fairId)];
  try {
    wx.setStorageSync(STORAGE_KEY, all);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 切换提醒状态
 * @returns {boolean} true=已设置，false=已取消
 */
function toggle(fair) {
  if (isSet(fair.id)) {
    remove(fair.id);
    return false;
  }
  set(fair);
  return true;
}

/**
 * 返回未来 24h 内即将开始的提醒（App 启动时展示）
 * @returns {Array}
 */
function getUpcoming() {
  const all = getAll();
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  return Object.values(all).filter((item) => {
    if (!item.startTime) return false;
    const t = new Date(item.startTime).getTime();
    return !isNaN(t) && t > now && t <= in24h;
  });
}

/** 返回所有已设提醒的 fairId 集合，列表页快速批量判断用 */
function getIdSet() {
  return new Set(Object.keys(getAll()));
}

module.exports = { isSet, set, remove, toggle, getAll, getUpcoming, getIdSet };
