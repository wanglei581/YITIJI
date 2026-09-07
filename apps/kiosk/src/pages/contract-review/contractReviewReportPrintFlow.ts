/**
 * 2026-09-06 拍板：签约风险报告可保存、不打印。
 * 前端打印开关与打印按钮已删除；
 * 服务端 print-jobs 对 purpose=contract_review_report 一律 400。
 * 保存到「我的文档」走 keepContractReviewReport。
 */
export const CONTRACT_REVIEW_REPORT_PRINT_FORBIDDEN = true
