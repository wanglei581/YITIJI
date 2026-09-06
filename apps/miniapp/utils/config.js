// utils/config.js
// 前端集成层配置。禁止在此保存任何密钥(appSecret / 支付商户证书 / OCR key 等),
// 敏感凭证只允许存在于后端 env。前端只持有 baseUrl 与开关。

/**
 * USE_MOCK:
 *   true  → api 层直接返回本地 mock 数据(仅用于离线调试)
 *   false → api 层走真实 wx.request(baseUrl + path)【当前状态】
 *
 * 已于 2026-08-01 切换为真实后端。前置条件均已满足:
 *   - zyidai.cn 已 ICP 备案,标准 443 + 有效证书
 *   - 微信公众平台已配置 request / uploadFile 合法域名 = https://zyidai.cn
 *   - /api/v1/health 返回 db=postgres
 *
 * 影响面(2026-09-02 复核):全仓 58 个注册页面中 47 个调用数据层
 *   (utils/api 或经 utils/history、favorites、reminders 中转),107 个端点。
 *   原注释写的"仅 9 个页面"是 2026-08-01 切真当天的数字,早已不成立——
 *   照它判断改动影响面会严重低估。
 *   免登录只读:jobs / job-detail / fairs / fair-detail / companies /
 *              company-detail / policies / policy-detail
 *   需短信登录:login
 * 其余页面仍为静态原型,与本开关无关——它们显示占位内容不是切真失败。
 *
 * 已知空数据:/policies 线上返回 [],页面显示空态属正常,
 * 该归一化逻辑尚未见过真实样本。
 */
const config = {
  // 已备案域名,已在微信公众平台配置 request 合法域名。裸 IP 不可用,必须域名。
  baseUrl: 'https://zyidai.cn',
  apiPrefix: '/api/v1',
  USE_MOCK: false,
  timeout: 15000,
  // 文件上传单独放宽:简历 PDF 体积远大于普通请求体,弱网下 15s 容易误判失败
  uploadTimeout: 60000,
  // AI 解析可能同步返回结果(实测线上走真实 LLM,单次 20~40s),
  // 超时必须大于模型耗时,否则前端先超时、后端却已扣费产出结果
  aiTimeout: 90000,
  // 模拟网络延迟(仅 USE_MOCK 生效),让 loading 态在 DevTools 里可见
  mockDelay: 200,
};

module.exports = config;
