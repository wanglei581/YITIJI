// utils/api-org-entry.js
// 「一机构一码」官方采购联名公开入口接口门面（自动纳入 verify-miniapp-api-contract.mjs 契约扫描）。

const config = require('./config');
const { request } = require('./request');

/**
 * 公开读取机构联名入口信息（免登录，响应 Cache-Control: private, no-store）。
 * 停用、归档、授权不可用或不存在的机构由后端统一 404 fail-closed。
 * @param {string} orgId
 * @returns {Promise<object>}
 */
function getPublicOrgEntry(orgId) {
  if (config.USE_MOCK) {
    return Promise.reject(Object.assign(new Error('演示模式下无真实机构入口'), { statusCode: 404 }));
  }
  return request(`/public/miniapp-org-entry?orgId=${encodeURIComponent(orgId)}`, {
    method: 'GET',
    needAuth: false,
  }).then((res) => {
    const data = res && res.data && typeof res.data === 'object' ? res.data : res;
    if (!data || !data.orgId) {
      const err = new Error('未找到可用的机构服务入口');
      err.statusCode = 404;
      throw err;
    }
    return data;
  });
}

module.exports = {
  getPublicOrgEntry,
};
