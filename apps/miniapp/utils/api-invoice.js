// utils/api-invoice.js
// 会员自助开票接口门面（与 utils/api.js 分离，自动纳入 verify-miniapp-api-contract.mjs 契约扫描）。
// 契约基准：docs/api/member-invoice-requests.md。

const config = require('./config');
const { request } = require('./request');

function mockUnavailable(what) {
  const e = new Error(`${what}需连接真实后端，当前为本地演示数据模式`);
  e.statusCode = 501;
  return e;
}

/**
 * 读取本人可开票订单与已有开票申请的订单（游标分页）。
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ items: Array<object>, nextCursor: string | null }>}
 */
function listInvoiceOrders(options = {}) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('自助开票'));
  const data = {};
  if (Number.isInteger(options.limit) && options.limit >= 1 && options.limit <= 50) {
    data.limit = options.limit;
  }
  if (typeof options.cursor === 'string' && options.cursor.trim()) {
    data.cursor = options.cursor.trim();
  }
  return request('/me/invoice-orders', { method: 'GET', data, needAuth: true }).then((res) => ({
    items: Array.isArray(res && res.items) ? res.items : [],
    nextCursor: (res && typeof res.nextCursor === 'string' && res.nextCursor) ? res.nextCursor : null,
  }));
}

/**
 * 提交电子发票申请。仅发送契约白名单字段；个人抬头不传 taxId。
 * @param {{ orderKind: string, orderId: string, titleType: string, title: string, taxId?: string, email: string }} payload
 */
function submitInvoiceRequest(payload = {}) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('自助开票'));
  const body = {
    orderKind: payload.orderKind,
    orderId: payload.orderId,
    titleType: payload.titleType,
    title: payload.title,
    email: payload.email,
  };
  if (payload.titleType === 'company' && typeof payload.taxId === 'string' && payload.taxId.trim()) {
    body.taxId = payload.taxId.trim();
  }
  return request('/me/invoice-requests', { method: 'POST', data: body, needAuth: true });
}

/**
 * 读取本人单条开票申请详情（服务端只返回打码后的 taxIdMasked 与 emailMasked）。
 * @param {string} requestId
 */
function getInvoiceRequest(requestId) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('开票申请详情'));
  const safeId = encodeURIComponent(String(requestId || '').trim());
  return request(`/me/invoice-requests/${safeId}`, { method: 'GET', needAuth: true });
}

module.exports = {
  listInvoiceOrders,
  submitInvoiceRequest,
  getInvoiceRequest,
};
