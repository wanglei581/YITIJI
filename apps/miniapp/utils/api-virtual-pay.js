// utils/api-virtual-pay.js
// 小程序微信虚拟支付与会员已购服务次数接口门面。
// 与 utils/api.js 分离，按 api-<领域>.js 命名自动纳入 verify-miniapp-api-contract.mjs。

const config = require('./config');
const { request } = require('./request');

function mockUnavailable(what) {
  const e = new Error(`${what}需连接真实后端，当前为本地演示数据模式`);
  e.statusCode = 501;
  return e;
}

/**
 * 读取本人仍可用的一体机 AI 服务次数（开关关着时同样返回 200）。
 * 兼容旧版后端：purchaseEnabled 仅在服务端显式返回布尔值时透传。
 * @returns {Promise<{ items: Array<{ serviceKind: string, createdAt: string }>, purchaseEnabled?: boolean }>}
 */
function listServiceCredits() {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('一体机服务次数'));
  return request('/member/service-credits', { method: 'GET', needAuth: true }).then((res) => {
    const out = {
      items: Array.isArray(res && res.items) ? res.items : [],
    };
    if (res && typeof res.purchaseEnabled === 'boolean') {
      out.purchaseEnabled = res.purchaseEnabled;
    }
    return out;
  });
}

/**
 * 发起单次服务虚拟支付下单并取回服务端签名参数。
 * signData 保持服务端原样字符串，绝不做 JSON.parse / JSON.stringify 重序列化。
 * @param {{ serviceKind: 'resume_optimize' | 'mock_interview', code: string }} params
 */
function createVirtualPayOrder(params = {}) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('服务购买'));
  return request('/member/virtual-pay/orders', {
    method: 'POST',
    data: {
      serviceKind: params.serviceKind,
      code: params.code,
    },
    needAuth: true,
  });
}

module.exports = {
  listServiceCredits,
  createVirtualPayOrder,
};
