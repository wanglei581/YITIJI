// utils/org-entry.js
// 「一机构一码」官方采购联名入口工具：
// - 解析冷启动 / 热启动扫码参数（?orgId= 或 scene=o=<orgId>）
// - 持久化仅作视图偏好（非授权凭证），服务端 404/停服或用户恢复默认时立即清理
// - 打印选点页按机构在线终端列表置顶排序（不隐藏其他可用终端，下单仍由服务端复核）

const storage = require('./storage');

const ORG_ID_RE = /^[A-Za-z0-9_-]{1,30}$/;
const MAX_SCENE_LEN = 64;

let _pendingLaunchOrgId = '';

function safeDecode(raw) {
  if (typeof raw !== 'string') return '';
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

function normalizeOrgId(raw) {
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 1) {
      const hit = normalizeOrgId(raw[i]);
      if (hit) return hit;
    }
    return '';
  }
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return ORG_ID_RE.test(trimmed) ? trimmed : '';
}

/**
 * 从页面 onLoad options 或 App onLaunch/onShow query 解析机构编号。
 * 支持两种官方采购发放形态：
 *   1. 公众号菜单 / 网页直链：pages/home/home?orgId=org_xxx
 *   2. 无限制小程序码：scene=o=org_xxx（微信会做 URL 编码，如 o%3Dorg_xxx）
 */
function parseOrgIdFromLaunch(query) {
  if (!query || typeof query !== 'object') return '';
  const direct = normalizeOrgId(safeDecode(typeof query.orgId === 'string' ? query.orgId : (Array.isArray(query.orgId) ? query.orgId[0] : '')));
  if (direct) return direct;

  const rawScene = Array.isArray(query.scene) ? query.scene[0] : query.scene;
  if (typeof rawScene !== 'string' || !rawScene.trim() || rawScene.length > MAX_SCENE_LEN * 3) return '';
  const decoded = safeDecode(rawScene).trim();
  if (!decoded || decoded.length > MAX_SCENE_LEN) return '';

  const pairs = decoded.split('&');
  for (let i = 0; i < pairs.length; i += 1) {
    const seg = pairs[i];
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const k = seg.slice(0, eq).trim();
    const v = seg.slice(eq + 1).trim();
    if (k === 'o' || k === 'org' || k === 'orgId') {
      const valid = normalizeOrgId(v);
      if (valid) return valid;
    }
  }
  return '';
}

/** App 级冷热启动暂存新扫到的机构编号，供首页 onLoad / onShow 消费。 */
function rememberLaunchOrgId(orgId) {
  const valid = normalizeOrgId(orgId);
  if (valid) _pendingLaunchOrgId = valid;
  return valid;
}

function consumePendingLaunchOrgId() {
  const hit = _pendingLaunchOrgId;
  _pendingLaunchOrgId = '';
  return hit;
}

function getStoredOrgContext() {
  const raw = storage.get(storage.KEYS.ORG_ENTRY_CONTEXT, null);
  if (!raw || typeof raw !== 'object') return null;
  const orgId = normalizeOrgId(raw.orgId);
  if (!orgId) return null;
  return {
    orgId,
    orgName: typeof raw.orgName === 'string' ? raw.orgName : '',
    brandName: typeof raw.brandName === 'string' ? raw.brandName : '',
    brandMark: typeof raw.brandMark === 'string' ? raw.brandMark : '',
    brandLogoUrl: typeof raw.brandLogoUrl === 'string' ? raw.brandLogoUrl : '',
    terminalIds: Array.isArray(raw.terminalIds) ? raw.terminalIds.filter((id) => typeof id === 'string' && id) : [],
  };
}

function saveOrgContext(entry) {
  if (!entry || !normalizeOrgId(entry.orgId)) return false;
  const terminalIds = Array.isArray(entry.terminals)
    ? entry.terminals.map((t) => t && t.id).filter((id) => typeof id === 'string' && id)
    : [];
  return storage.set(storage.KEYS.ORG_ENTRY_CONTEXT, {
    orgId: normalizeOrgId(entry.orgId),
    orgName: String(entry.orgName || ''),
    brandName: String(entry.brandName || ''),
    brandMark: String(entry.brandMark || ''),
    brandLogoUrl: entry.brandLogoUrl ? String(entry.brandLogoUrl) : '',
    terminalIds,
    savedAt: Date.now(),
  });
}

function clearOrgContext() {
  _pendingLaunchOrgId = '';
  return storage.remove(storage.KEYS.ORG_ENTRY_CONTEXT);
}

/**
 * 将当前机构关联终端置顶并标记 isOrgTerminal=true，同时保留其余可用终端的相对顺序。
 */
function prioritizeOrgTerminals(terminals, preferredIds) {
  if (!Array.isArray(terminals) || !terminals.length) return [];
  const idSet = new Set(Array.isArray(preferredIds) ? preferredIds : []);
  if (!idSet.size) return terminals.map((item) => Object.assign({}, item, { isOrgTerminal: false }));
  const preferred = [];
  const others = [];
  for (let i = 0; i < terminals.length; i += 1) {
    const item = terminals[i];
    if (item && idSet.has(item.id)) {
      preferred.push(Object.assign({}, item, { isOrgTerminal: true }));
    } else {
      others.push(Object.assign({}, item, { isOrgTerminal: false }));
    }
  }
  return preferred.concat(others);
}

module.exports = {
  normalizeOrgId,
  parseOrgIdFromLaunch,
  rememberLaunchOrgId,
  consumePendingLaunchOrgId,
  getStoredOrgContext,
  saveOrgContext,
  clearOrgContext,
  prioritizeOrgTerminals,
};
