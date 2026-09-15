// utils/storage.js
// 本地存储封装(wx.getStorageSync / setStorageSync),集中 key 管理,便于清理与调试。

const KEYS = {
  // 曾成功登录过、且未主动登出：401 静默补签的准入依据。
  // 不能用「有没有 token」推断——getToken() 在过期时会先清会话，
  // 使「自然过期」与「主动登出」两种状态看起来完全一样。
  RESIGNIN_ELIGIBLE: 'resignin_eligible',
  TOKEN: 'zyd_token',
  USER: 'zyd_user',
  MAPPING_RULE: 'zyd_last_mapping', // 预留
  FAVORITES: 'zyd_favorites',       // 本机收藏(岗位/招聘会/企业),接后端后由服务端同步
  HISTORY: 'zyd_history',           // 本机浏览/外部跳转记录,接后端后由服务端埋点为准
  REMINDERS: 'zyd_fair_reminders',  // 招聘会本地提醒 { [fairId]: item }
  // 最近一次 AI 简历解析任务 { taskId, accessToken, fileName, ts }。
  // accessToken 是匿名读取诊断报告的唯一凭证,后端只在提交解析时下发一次,
  // 丢失就必须重新上传重新解析(重复消耗一次模型调用),所以必须落地而非只放内存。
  // 解析→诊断是线性流程,只保留最近一条即可。
  RESUME_TASK: 'zyd_resume_task',

  // 最近一次模拟面试会话 { sessionId, accessToken, position, questionTarget, ts }。
  // 与 RESUME_TASK 同理:accessToken 只在创建会话时下发一次,是匿名用户继续答题和
  // 读取报告的唯一凭证。面试是多回合流程,中途退出页面后要能回到同一会话,
  // 所以必须落地。注意这是 x-interview-access-token,与简历的 token 是两套。
  INTERVIEW_SESSION: 'zyd_interview_session',

  // 语音说简历 → 从零建简历 的一次性交接。
  // 只在 wizard 走完、即将 redirect 到 resume-build 时写入，resume-build 读完即删。
  // 不复用 RESUME_TASK：那是解析任务凭证，写进去会把诊断/优化五页指到 kind 不对的任务上。
  RESUME_VOICE_HANDOFF: 'zyd_resume_voice_handoff',
};

function get(key, fallback = null) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

/**
 * 读一次，并且**把「读失败」和「读到的是空」分开**。
 *
 * get() 把两者压成同一个 fallback,对"读出来渲染一下"的调用方没有区别;对**读-改-写
 * 全量**的调用方则是一个静默的数据丢失口子——它拿到一个假的空集合,把差集写回去,
 * 盘上原有的记录就此消失,而返回值一路都是"成功"。
 * utils/print-order-idempotency.js 的幂等键就是这种形态:丢一条未落定的记录 =
 * 下一次提交铸一个新键 = 服务端再建一张订单、再扣一笔钱。
 *
 * 所以这类调用方必须用本函数,并在 ok === false 时 fail-closed(什么都不写)。
 *
 * **`found` 与 `ok` 是两件事,必须分开。** 只有 `ok && !found`(wx 在 key 不存在时返回
 * `''`,部分实现返回 `undefined`)才是一个确定的答案:本机确实没有这一格,调用方可以
 * 放心地把它当成空集合、照常写第一条。其余一切形态——读抛异常、或者读出来是 `null` /
 * 对象 / 字符串 / 数字——都**证明不了本机没有记录**:调用方拿它当空集合去写回全量,
 * 盘上真实存在的记录就会被这一次"看起来是空"的读抹掉。
 * 上一版把 `''`/`undefined` 和真实存储的 `null` 一起折成 `value: null`,两者就此不可分。
 *
 * @returns {{ok: boolean, found: boolean, value: any}}
 *   ok=false  这一次根本没读到(抛异常),value/found 无意义;
 *   found=false 本机确实没有这一格(唯一可以当"空"处理的形态);
 *   found=true  读到了东西,形状对不对由调用方按自己的 schema 判断。
 */
function read(key) {
  try {
    const v = wx.getStorageSync(key);
    if (v === '' || v === undefined) return { ok: true, found: false, value: null };
    return { ok: true, found: true, value: v };
  } catch (e) {
    return { ok: false, found: false, value: null };
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { KEYS, get, read, set, remove };
