// utils/history.js
// 「浏览 / 外部跳转」记录。登录会员上报服务端 —— 手机上看过的岗位,一体机上也能回看,
// 是同一个账号的同一份足迹;未登录时仍写本机(功能不消失,只是不跨设备)。
//
// 合规(CLAUDE.md §10 / compliance-boundary §4.4):只记录本人「浏览」与
// 「打开来源平台 / 官方入口」两个动作本身,绝不记录投递 / 预约结果 ——
// 那些都在来源平台完成,本系统无从得知也不建模。
//
// 后端契约(services/api/src/activity/*,逐字段核对过):
//   POST /activity/browse         body { targetType, targetId }
//   POST /activity/external-jump  body { targetType, targetId, action }
//        可选登录:匿名会诚实返回 { recorded:false, reason:'LOGIN_REQUIRED' } 而不落库,
//        所以只在登录态发。targetTitle/sourceName/sourceUrl/externalId 全部由服务端
//        从「已审核 + 已发布」目标补齐,前端伪造不了。目标未发布 → 404,不落脏记录。
//        浏览 30 分钟窗口内同目标去重;跳转每次都记。
//   GET  /me/browse-logs / /me/external-jump-logs → { items, nextCursor, total }
//        item = { id, targetType, targetId, targetTitle|null, sourceName|null,
//                 sourceUrl|null, externalId|null, createdAt }, 跳转多一个 action。
//   DELETE /me/browse-logs/:id、/me/external-jump-logs/:id → { deleted:true }
//        **没有批量清空端点**,所以页面只提供逐条删除,不做假的「一键清空账号记录」。
//   服务端 TTL 默认 30 天到期物理清理。
const store = require('./storage');
const auth = require('./auth');
const api = require('./api');

const TYPES = ['job', 'fair', 'company', 'policy', 'fair_company'];

// 本机类型 → 后端 ActivityTargetType(ACTIVITY_TARGET_TYPES 全集:
// job | job_fair | policy | company_profile | fair_company)。
const SERVER_TYPE = {
  job: 'job',
  fair: 'job_fair',
  company: 'company_profile',
  policy: 'policy',
  fair_company: 'fair_company',
};
// 后端 → 本机(反向)。fair_company 归到招聘会筛选下;后端把父级 JobFair.id 存在
// externalId 里,回跳时用它。
//
// 注:这里原本写的是「一体机产生的记录,小程序没有独立页面」——2026-09-02 起不成立了,
// 小程序有了 fair-company-detail。不上报的直接后果是 AI 参会准备单的回顾态里
// 「你在本机留下的记录」永远为空(服务端按 fair_company + external_apply + externalId=fairId 查),
// 等于摆一个暗示系统在记录、实际什么也没记的区块。
const LOCAL_TYPE = {
  job: 'job',
  job_fair: 'fair',
  policy: 'policy',
  company_profile: 'company',
  fair_company: 'fair',
};
// 每类目标只允许其对应的跳转动作,传错服务端直接 400(JUMP_ACTIONS_BY_TARGET)。
const JUMP_ACTION = {
  job: 'external_apply',
  fair: 'external_appointment',
  company: 'external_open',
  policy: 'external_open',
  // 与一体机一致,也是 fair-visit-plan 回顾态查询用的那一条
  // (targetType:'fair_company' + action:'external_apply')。
  fair_company: 'external_apply',
};
// 动作 → 展示文案。只描述「打开了哪类入口」,不描述办理结果。
const ACTION_LABEL = {
  external_apply: '已打开来源平台',
  external_appointment: '已打开来源平台',
  external_checkin_open: '已打开签到入口',
  external_open: '已打开官方入口',
};

// 每种内容的列表展示样式(与 browse-history.wxml 的 tone-*/ficon 一致)
const META = {
  job:     { icon: 'i-solution',  tone: 'teal' },
  fair:    { icon: 'i-calendar',  tone: 'wheat' },
  company: { icon: 'i-bank',      tone: 'clay' },
  policy:  { icon: 'i-file-text', tone: 'teal' },
  fair_company: { icon: 'i-bank', tone: 'clay' },
};
const MAX = 100; // 本机只留最近 100 条,避免 storage 无限增长

function sid(v) {
  return v == null ? '' : String(v);
}

function readAll() {
  const v = store.get(store.KEYS.HISTORY, []);
  return Array.isArray(v) ? v : [];
}

function writeAll(arr) {
  store.set(store.KEYS.HISTORY, arr.slice(0, MAX));
}

// 记录项落库前白名单化:只保留列表渲染需要的展示字段 + 内部排序时间戳。
function normalize(type, item, act) {
  const it = item || {};
  const meta = META[type] || META.job;
  const isJump = act === 'jump';
  return {
    id: sid(it.id),
    type,
    // rid = 复合唯一键,供 wx:key 使用。含 act:同一内容的「浏览」与「跳转」是两条独立记录。
    rid: `${type}:${sid(it.id)}:${isJump ? 'jump' : 'view'}`,
    title: it.title || '未命名内容',
    act: isJump ? 'jump' : 'view',
    actLabel: isJump ? '已打开来源平台' : '浏览',
    source: it.source || '来源未知',
    icon: meta.icon,
    tone: meta.tone,
    ts: Date.now(),
    // 本机记录没有服务端行 id,删除时按 rid 定位。
    logKind: 'local',
    logId: '',
  };
}

// 上报服务端。fire-and-forget:失败一律静默 —— 记录失败绝不能阻断用户浏览
// 或打开来源平台。匿名不发请求(服务端本就不为匿名落库,省一次无效往返)。
function report(type, item, act) {
  if (!auth.isLoggedIn()) return;
  const targetType = SERVER_TYPE[type];
  const targetId = sid(item && item.id);
  if (!targetType || !targetId) return;
  const call = act === 'jump'
    ? api.recordJumpActivity({ targetType, targetId, action: JUMP_ACTION[type] })
    : api.recordBrowseActivity({ targetType, targetId });
  call.catch(() => {});
}

function record(type, item, act) {
  if (!TYPES.includes(type) || !item || item.id == null || item.id === '') return false;
  // 本机始终写一份:登录态下它是服务端不可达时的降级视图(页面会明确标注「本机缓存」),
  // 未登录时它就是唯一的一份。
  const rec = normalize(type, item, act);
  const arr = readAll();
  const next = arr.filter((r) => !(r && r.rid === rec.rid));
  next.unshift(rec);
  writeAll(next);
  report(type, item, act);
  return true;
}

/** 浏览:进入详情页且真实拿到内容后调用(不在 loading/错误态记录空对象) */
function recordView(type, item) {
  return record(type, item, 'view');
}

/** 外部跳转:点击「去来源平台 / 官方原文」等外链动作时调用 */
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
  // 跨年时带上年份,避免不同年的同月同日被并进同一天分组
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}-${mm}-${dd}`;
  return `${mm}-${dd}`;
}

function timeLabel(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function decorate(rows, filter) {
  return rows
    .filter((r) => r && (!filter || filter === 'all' || r.type === filter))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .map((r) => Object.assign({}, r, { day: dayLabel(r.ts), time: timeLabel(r.ts) }));
}

/** 本机记录(未登录时的唯一来源;登录态下作为服务端不可达时的降级视图)。 */
function listLocal(filter) {
  return decorate(readAll(), filter);
}

// 服务端日志行 → 与本机记录同形的展示行,页面无需分两套渲染。
function fromServer(item, kind) {
  const it = item || {};
  const type = LOCAL_TYPE[it.targetType] || 'job';
  const meta = META[type] || META.job;
  const isJump = kind === 'jump';
  // fair_company 没有独立详情页,后端把父级招聘会 id 放在 externalId,回跳用它。
  const routeId = it.targetType === 'fair_company' ? sid(it.externalId) : sid(it.targetId);
  const ts = Date.parse(it.createdAt);
  return {
    id: routeId,
    type,
    rid: `${kind}:${sid(it.id)}`,
    title: it.targetTitle || '未命名内容',
    act: isJump ? 'jump' : 'view',
    actLabel: isJump ? (ACTION_LABEL[it.action] || '已打开来源入口') : '浏览',
    source: it.sourceName || '来源未知',
    icon: meta.icon,
    tone: meta.tone,
    ts: Number.isNaN(ts) ? 0 : ts,
    logKind: kind,
    logId: sid(it.id),
  };
}

/**
 * 账号记录:浏览 + 外部跳转两个端点合并成一条时间线(和本机记录同形)。
 * 任一端点失败即整体 reject —— 页面必须显示「加载失败」,
 * 绝不能把加载不出来伪装成「没有记录」。
 */
function listServer(filter) {
  return Promise.all([
    api.getMyBrowseLogs({ pageSize: 50 }),
    api.getMyJumpLogs({ pageSize: 50 }),
  ]).then(([browse, jumps]) => {
    const rows = (browse || []).map((it) => fromServer(it, 'browse'))
      .concat((jumps || []).map((it) => fromServer(it, 'jump')));
    return decorate(rows, filter);
  });
}

/** 删除一条。服务端记录调对应端点(服务端校验归属并写审计);本机记录按 rid 删。 */
function removeRecord(record0) {
  const r = record0 || {};
  if (r.logKind === 'browse' && r.logId) return api.deleteMyBrowseLog(r.logId);
  if (r.logKind === 'jump' && r.logId) return api.deleteMyJumpLog(r.logId);
  const arr = readAll();
  writeAll(arr.filter((x) => !(x && x.rid === r.rid)));
  return Promise.resolve({ deleted: true });
}

/** 清空本机记录。不碰账号记录 —— 后端没有批量清空端点,不做假的一键清空。 */
function clearLocal() {
  store.remove(store.KEYS.HISTORY);
  return true;
}

function hasLocal() {
  return readAll().length > 0;
}

module.exports = {
  TYPES,
  SERVER_TYPE,
  recordView,
  recordJump,
  listLocal,
  listServer,
  removeRecord,
  clearLocal,
  hasLocal,
};
