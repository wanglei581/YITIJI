// utils/favorites.js
// 收藏。登录会员以服务端 /api/v1/me/favorites 为准 —— 手机与一体机是同一个账号、
// 同一份收藏；未登录降级为本机 wx.storage(功能不消失,只是不跨设备),
// 登录后可在「我的收藏」显式合并上传,不静默丢弃用户已有的本机收藏。
//
// 后端契约(services/api/src/member-favorites/*,逐字段核对过,不要按字段名猜):
//   GET    /me/favorites?type=&cursor=&pageSize=  → { items, nextCursor, total }
//          item = { id, targetType, targetId, title|null, createdAt }  ← 只有这 5 个字段,
//          没有 company / salary / tag / tone,所以服务端收藏只能渲染标题 + 收藏时间。
//   POST   /me/favorites   body { targetType, targetId, title? }
//          ValidationPipe 是 whitelist + forbidNonWhitelisted,多传任何字段直接 400;
//          title 服务端一律忽略并从「已审核 + 已发布」目标重新派生 → 本文件不传。
//          目标不存在或未发布 → 404 FAVORITE_TARGET_NOT_FOUND。
//   DELETE /me/favorites/:targetType/:targetId → { removed }(幂等)
//   FavoriteTargetType 只有 job | job_fair | policy —— **没有企业**。
//   企业收藏因此只能留在本机,这是真实的跨设备缺口,不做假同步。
//
// 合规(CLAUDE.md §10):收藏只是本人对第三方 / 官方来源信息的兴趣标记,
// 不涉及投递 / 预约结果,不构成招聘闭环。
const storage = require('./storage');
const auth = require('./auth');
const api = require('./api');

// 本机可保存的类型;company 永远只有本机一份。
const LOCAL_TYPES = ['job', 'fair', 'company', 'policy'];
// 本机类型 → 后端 FavoriteTargetType。缺席即「后端没有这个模型」。
const SERVER_TYPE = { job: 'job', fair: 'job_fair', policy: 'policy' };

const TYPE_META = {
  job:     { icon: 'solution',  tone: 'teal',  label: '岗位' },
  fair:    { icon: 'calendar',  tone: 'wheat', label: '招聘会' },
  company: { icon: 'bank',      tone: 'plum',  label: '企业' },
  policy:  { icon: 'file-text', tone: 'clay',  label: '政策' },
};

// 服务端收藏 id 缓存,**只放内存**,随小程序冷启动失效。
// 故意不落 storage:镜像会在服务端已取消收藏后继续显示「已收藏」,那是伪造状态
// (CLAUDE.md §9 不伪造能力)。冷启动第一次进详情页会先按保守值渲染,再由
// resolveFaved() 用服务端结果纠正 —— 只会「少显示已收藏」,不会凭空多显示。
let serverIds = null;
let serverIdsPromise = null;
// 缓存归属人。同一次小程序运行里退出再换账号登录时,必须作废上一个账号的收藏 id,
// 否则会对新账号显示「已收藏」——那是最典型的伪造状态。
let serverIdsOwner = null;

function ownerKey() {
  const user = auth.getUser();
  return user && typeof user === 'object' ? JSON.stringify(user) : '';
}

function sid(v) {
  return v == null ? '' : String(v);
}

function metaOf(type) {
  return TYPE_META[type] || TYPE_META.job;
}

// ── 本机存储 ────────────────────────────────────────────────

function localBuckets() {
  const raw = storage.get(storage.KEYS.FAVORITES, null);
  const out = {};
  LOCAL_TYPES.forEach((t) => {
    out[t] = raw && typeof raw === 'object' && Array.isArray(raw[t]) ? raw[t] : [];
  });
  return out;
}

function writeBuckets(all) {
  return storage.set(storage.KEYS.FAVORITES, all);
}

// 落库前白名单化:只保留列表渲染需要的展示字段,不把详情页整个对象塞进 storage。
function normalize(type, item) {
  const it = item || {};
  const meta = metaOf(type);
  return {
    id: sid(it.id),
    initial: it.initial || '',
    icon: it.icon || meta.icon,
    title: it.title || '',
    sub: it.sub || '',
    salary: it.salary || '',
    tag: it.tag || '',
    tagTone: it.tagTone || '',
    tone: it.tone || meta.tone,
  };
}

function listLocal(type) {
  const meta = metaOf(type);
  return (localBuckets()[type] || []).map((item) => Object.assign({}, item, {
    id: sid(item && item.id),
    icon: (item && item.icon) || meta.icon,
    tone: (item && item.tone) || meta.tone,
    pending: false,
  }));
}

function localHas(type, id) {
  const target = sid(id);
  return (localBuckets()[type] || []).some((it) => it && sid(it.id) === target);
}

function toggleLocal(type, item) {
  const all = localBuckets();
  const arr = all[type] || [];
  const target = sid(item.id);
  const idx = arr.findIndex((it) => it && sid(it.id) === target);
  let faved;
  if (idx >= 0) {
    arr.splice(idx, 1);
    faved = false;
  } else {
    arr.unshift(normalize(type, item)); // 最近收藏置顶
    faved = true;
  }
  all[type] = arr;
  writeBuckets(all);
  return faved;
}

function removeLocal(type, id) {
  const all = localBuckets();
  const arr = all[type] || [];
  const target = sid(id);
  const next = arr.filter((it) => it && sid(it.id) !== target);
  all[type] = next;
  writeBuckets(all);
  return next.length !== arr.length;
}

// ── 服务端 id 集合 ──────────────────────────────────────────

function emptySets() {
  return { job: new Set(), job_fair: new Set(), policy: new Set() };
}

// 逐页拉全量 id(每页 50,硬上限 10 页):详情页心形按钮要判断「是否已收藏」,
// 只能靠完整 id 集合。超出上限的部分不再拉,只影响回显,不影响列表页分页浏览。
function fetchAllServerIds() {
  const sets = emptySets();
  let cursor = null;
  const step = (round) => {
    if (round >= 10) return Promise.resolve(sets);
    const params = cursor ? { cursor, pageSize: 50 } : { pageSize: 50 };
    return api.getMyFavorites(params).then((items) => {
      (items || []).forEach((it) => {
        const bucket = it && sets[it.targetType];
        if (bucket) bucket.add(sid(it.targetId));
      });
      const next = items && items.nextCursor;
      if (!next) return sets;
      cursor = next;
      return step(round + 1);
    });
  };
  return step(0);
}

function syncServerIds(force) {
  if (!auth.isLoggedIn()) {
    serverIds = null;
    serverIdsPromise = null;
    serverIdsOwner = null;
    return Promise.resolve(null);
  }
  const owner = ownerKey();
  if (serverIdsOwner !== null && serverIdsOwner !== owner) {
    // 换账号：上一个账号的缓存立即作废，不允许跨账号复用
    serverIds = null;
    serverIdsPromise = null;
  }
  if (serverIds && !force) return Promise.resolve(serverIds);
  if (serverIdsPromise && !force) return serverIdsPromise;
  serverIdsPromise = fetchAllServerIds()
    .then((sets) => {
      serverIds = sets;
      serverIdsOwner = owner;
      serverIdsPromise = null;
      return sets;
    })
    .catch((err) => {
      serverIdsPromise = null;
      throw err;
    });
  return serverIdsPromise;
}

function setCached(serverType, id, faved) {
  if (!serverIds || !serverIds[serverType]) return;
  if (faved) serverIds[serverType].add(sid(id));
  else serverIds[serverType].delete(sid(id));
}

/** 该类型此刻是否走服务端(有后端模型 + 已登录)。 */
function isServerBacked(type) {
  return !!SERVER_TYPE[type] && auth.isLoggedIn();
}

// ── 对外接口 ────────────────────────────────────────────────

/**
 * 同步判断是否已收藏。详情页 onLoad 需要立刻拿到值,不能等网络。
 * 登录态下缓存未热时返回 false(保守),随后由 resolveFaved() 纠正。
 */
function isFaved(type, id) {
  if (!type || id == null || id === '') return false;
  const st = SERVER_TYPE[type];
  if (st && auth.isLoggedIn()) {
    const warm = serverIds && serverIdsOwner === ownerKey();
    return warm ? serverIds[st].has(sid(id)) : false;
  }
  return localHas(type, id);
}

/** 权威判断(登录态查服务端)。网络失败时 reject,调用方应保留当前值而不是显示"未收藏"。 */
function resolveFaved(type, id) {
  const st = SERVER_TYPE[type];
  if (!st || !auth.isLoggedIn()) return Promise.resolve(localHas(type, id));
  return syncServerIds().then((sets) => (sets ? sets[st].has(sid(id)) : localHas(type, id)));
}

/**
 * 切换收藏。返回 { faved, source: 'server'|'local', hint }。
 * 服务端失败时 reject,调用方必须保持原状态并提示,不得假装成功。
 */
function toggle(type, item) {
  if (!LOCAL_TYPES.includes(type) || !item || item.id == null || item.id === '') {
    return Promise.reject(new Error('收藏内容不完整,无法收藏'));
  }
  const id = sid(item.id);
  const st = SERVER_TYPE[type];
  if (!st || !auth.isLoggedIn()) {
    const faved = toggleLocal(type, item);
    let hint = '';
    if (faved && !st) hint = '已收藏到本机（企业收藏暂不支持跨设备）';
    else if (faved) hint = '已收藏到本机，登录后可同步到账号';
    return Promise.resolve({ faved, source: 'local', hint });
  }
  return resolveFaved(type, id).then((was) => {
    const op = was ? api.removeMyFavorite(st, id) : api.addMyFavorite(st, id);
    return op.then(() => {
      setCached(st, id, !was);
      return { faved: !was, source: 'server', hint: '' };
    });
  });
}

/** 取消收藏(收藏列表页用)。登录态走服务端;顺带清掉同 id 的本机残留。 */
function remove(type, id) {
  const st = SERVER_TYPE[type];
  if (!st || !auth.isLoggedIn()) return Promise.resolve(removeLocal(type, id));
  return api.removeMyFavorite(st, sid(id)).then((res) => {
    setCached(st, sid(id), false);
    removeLocal(type, id);
    return !!(res && res.removed);
  });
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

// 服务端条目 → 列表展示行。服务端只有 title/createdAt,所以 salary/tag 一律留空,
// 不从本机旧记录拼凑"看起来更完整"的假信息。
function fromServer(type, item) {
  const meta = metaOf(type);
  const it = item || {};
  const when = fmtTime(it.createdAt);
  return {
    id: sid(it.targetId),
    initial: '',
    icon: meta.icon,
    tone: meta.tone,
    title: it.title || `${meta.label}详情`,
    sub: when ? `收藏于 ${when}` : `已同步到账号`,
    salary: '',
    tag: '',
    tagTone: '',
    pending: false,
  };
}

/**
 * 某个 Tab 的收藏列表。
 * 返回 { source, items }。source='server' 表示这批数据来自账号(与一体机同一份)。
 * 登录态下若本机还有未合并的同类收藏,会作为 pending 行追加在末尾 ——
 * 否则这些数据会在页面上凭空消失,属于静默丢弃。
 */
function listPage(type) {
  const st = SERVER_TYPE[type];
  if (!st || !auth.isLoggedIn()) {
    return Promise.resolve({ source: 'local', items: listLocal(type) });
  }
  return api.getMyFavorites({ type: st, pageSize: 50 }).then((items) => {
    const rows = (items || []).map((it) => fromServer(type, it));
    const onServer = new Set(rows.map((r) => r.id));
    const pending = listLocal(type)
      .filter((r) => r.id && !onServer.has(r.id))
      .map((r) => Object.assign({}, r, { pending: true, sub: '本机收藏 · 未同步到账号' }));
    return { source: 'server', items: rows.concat(pending) };
  });
}

/** 本机还有多少条「后端支持但尚未同步」的收藏(企业不计入,后端本就没有企业收藏)。 */
function localPending() {
  const all = localBuckets();
  const out = [];
  Object.keys(SERVER_TYPE).forEach((type) => {
    (all[type] || []).forEach((it) => {
      if (it && sid(it.id)) out.push({ type, id: sid(it.id) });
    });
  });
  return out;
}

/**
 * 显式把本机收藏合并到账号(用户在「我的收藏」点按才触发,不静默上传)。
 * 服务端 (endUserId,targetType,targetId) 唯一键 upsert,重复合并不会产生重复行。
 * 只清除**成功**上传的本机记录;失败的(例如来源内容已下线 → 404)原样保留,
 * 绝不因为一次失败就丢掉用户的数据。
 */
function mergeLocalToAccount() {
  if (!auth.isLoggedIn()) return Promise.resolve({ merged: 0, failed: 0 });
  const pending = localPending();
  if (!pending.length) return Promise.resolve({ merged: 0, failed: 0 });
  const merged = [];
  let failed = 0;
  const step = (i) => {
    if (i >= pending.length) return Promise.resolve();
    const row = pending[i];
    return api.addMyFavorite(SERVER_TYPE[row.type], row.id)
      .then(() => { merged.push(row); })
      .catch(() => { failed += 1; })
      .then(() => step(i + 1));
  };
  return step(0).then(() => {
    merged.forEach((row) => removeLocal(row.type, row.id));
    return syncServerIds(true)
      .catch(() => null)
      .then(() => ({ merged: merged.length, failed }));
  });
}

module.exports = {
  LOCAL_TYPES,
  SERVER_TYPE,
  TYPE_META,
  isServerBacked,
  isFaved,
  resolveFaved,
  syncServerIds,
  toggle,
  remove,
  listPage,
  listLocal,
  localPending,
  mergeLocalToAccount,
};
