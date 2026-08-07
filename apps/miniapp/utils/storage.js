// utils/storage.js
// 本地存储封装(wx.getStorageSync / setStorageSync),集中 key 管理,便于清理与调试。

const KEYS = {
  TOKEN: 'zyd_token',
  USER: 'zyd_user',
  MAPPING_RULE: 'zyd_last_mapping', // 预留
  FAVORITES: 'zyd_favorites',       // 本机收藏(岗位/招聘会/企业),接后端后由服务端同步
  HISTORY: 'zyd_history',           // 本机浏览/外部跳转记录,接后端后由服务端埋点为准
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
};

function get(key, fallback = null) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
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

module.exports = { KEYS, get, set, remove };
