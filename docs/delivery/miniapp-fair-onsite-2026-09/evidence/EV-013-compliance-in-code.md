# 合规口径写入实现的证据（EV-013）· 2026-09-02 · 修订 8176c1ee2004

## normalize.js —— 明示不造值
 * 参会企业:后端实际返回的是 services/api/src/jobs/fair.types.ts 的 FairCompany
 * (name / jobFairId / jobsCount),不是 packages/shared 的 FairCompanyDTO
 * (companyName / fairId / applyNote / checkinStatus / aiMatchScore)。
 *
 * 这里只做键名对齐,**不造后端没有的值**。
 * 一体机端 httpAdapter.ts 是硬编了 checkinStatus:'pending' 和一句
 * applyNote:'如需了解更多,请扫码前往来源平台' —— 那是前端自己编的字符串,
 * 冒充成了来源方给的提示。小程序不跟这个做法:拿不到就保持缺失,
 * 页面按「暂无」渲染,而不是显示一句谁都没说过的话。
 */
function fairCompanyLike(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return Object.assign({}, raw, {
    companyName: pick(raw.companyName, raw.name),
    fairId:      pick(raw.fairId, raw.jobFairId),
    jobCount:    typeof raw.jobsCount === 'number' ? raw.jobsCount
               : (typeof raw.jobCount === 'number' ? raw.jobCount : undefined),
    coverImageUrl: pick(raw.coverImageUrl, raw.logoUrl),
  });
}
