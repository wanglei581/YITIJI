// utils/api-job-tracker.js
// 本人求职备忘本接口门面（compliance-boundary.md §4.4A）。
// 自动纳入 verify-miniapp-api-contract.mjs 契约扫描：路径必须为字面量或模板字面量。

const config = require('./config');
const { request } = require('./request');

const TRACKER_STATUSES = ['intention', 'applied', 'interviewing', 'offered', 'rejected'];

function mockUnavailable(what) {
  const err = new Error(`${what}需连接真实后端，当前为本地演示模式`);
  err.statusCode = 501;
  return err;
}

function normalizeStatus(status) {
  return TRACKER_STATUSES.indexOf(status) >= 0 ? status : undefined;
}

/**
 * 严格白名单构造新建载荷。
 * §4.4A + 托管 a 约束：
 * - 只发用户手填五项：companyName / positionTitle / status / note / selfReportedAt；
 * - 绝不发送 jobId、channel、statusSource、resumeFileId、consentId 或任何企业侧字段。
 */
function buildCreatePayload(input = {}) {
  const body = {
    companyName: String(input.companyName || '').trim().slice(0, 120),
    positionTitle: String(input.positionTitle || '').trim().slice(0, 120),
  };
  const status = normalizeStatus(input.status);
  if (status) body.status = status;
  if (typeof input.note === 'string') {
    const note = input.note.trim().slice(0, 500);
    if (note) body.note = note;
  }
  if (typeof input.selfReportedAt === 'string' && input.selfReportedAt.trim()) {
    body.selfReportedAt = input.selfReportedAt.trim();
  }
  return body;
}

/**
 * 严格白名单构造更新载荷。
 * 仅提交本次显式传入的字段；selfReportedAt 传 null 表示清空，省略表示不变。
 */
function buildUpdatePayload(input = {}) {
  const body = {};
  if (input.companyName !== undefined) {
    body.companyName = String(input.companyName || '').trim().slice(0, 120);
  }
  if (input.positionTitle !== undefined) {
    body.positionTitle = String(input.positionTitle || '').trim().slice(0, 120);
  }
  if (input.status !== undefined) {
    const status = normalizeStatus(input.status);
    if (status) body.status = status;
  }
  if (input.note !== undefined) {
    body.note = String(input.note || '').trim().slice(0, 500);
  }
  if (input.selfReportedAt === null) {
    body.selfReportedAt = null;
  } else if (typeof input.selfReportedAt === 'string' && input.selfReportedAt.trim()) {
    body.selfReportedAt = input.selfReportedAt.trim();
  }
  return body;
}

function normalizeListResponse(res) {
  const data = res && res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
  const items = Array.isArray(data && data.items)
    ? data.items
    : (Array.isArray(data) ? data : []);
  const nextCursor = data && typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null;
  const total = data && typeof data.total === 'number' && Number.isFinite(data.total)
    ? data.total
    : items.length;
  return { items, nextCursor, total };
}

function listJobApplications(params = {}) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('求职备忘本'));
  const query = {};
  const status = normalizeStatus(params.status);
  if (status) query.status = status;
  if (params.cursor) query.cursor = String(params.cursor);
  if (params.pageSize) query.pageSize = Math.min(50, Math.max(1, Number(params.pageSize) || 20));
  return request('/me/job-applications', {
    method: 'GET',
    data: query,
    needAuth: true,
  }).then(normalizeListResponse);
}

function createJobApplication(input) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('新建求职备忘'));
  return request('/me/job-applications', {
    method: 'POST',
    data: buildCreatePayload(input),
    needAuth: true,
  });
}

function updateJobApplication(id, input) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('更新求职备忘'));
  return request(`/me/job-applications/${encodeURIComponent(String(id || ''))}`, {
    method: 'PATCH',
    data: buildUpdatePayload(input),
    needAuth: true,
  });
}

function deleteJobApplication(id) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('删除求职备忘'));
  return request(`/me/job-applications/${encodeURIComponent(String(id || ''))}`, {
    method: 'DELETE',
    needAuth: true,
  });
}

module.exports = {
  TRACKER_STATUSES,
  buildCreatePayload,
  buildUpdatePayload,
  listJobApplications,
  createJobApplication,
  updateJobApplication,
  deleteJobApplication,
};
