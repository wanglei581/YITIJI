# 「按下去什么都不发生」的按钮清单(回归台实测,2026-08-11)

判据:真的按一下(先 pointerdown/up 再 click),比较整个 body 的 outerHTML +
location.href + data-stage 有没有任何变化;按之前拦掉默认行为不让它跳转。
检测器已用反例验过:造一个死按钮必报、接上动作后不报、把 03 的接线拆掉会重新报出。

共 99 条,按页列(格式:阶段 | 按钮文字 | 类名):

01-home-v6  默认 | 周五招聘会,简历还没改 | .vscene
01-home-v6  默认 | 打印两份材料 | .vscene
01-home-v6  默认 | 我不知道从哪开始 | .vscene
05-phone-relay  s1 | 传文件到机器 | .act
05-phone-relay  s1 | 拍照传过去 | .act
05-phone-relay  s1 | 在手机上完成登录 | .act
06-print-workbench  s2 | (翻页) | .pgbtn
06-print-workbench  s3 | (空文字) | 无类名
06-print-workbench  s3 | 黑白 / 单面 / 跟随文件(纵向) / 强制横向 | 无类名
06-print-workbench  s4 | 应付 3.00 元 · 走收银 | 无类名
07-scan-workbench  s1 | PDF 文档 | .src
07-scan-workbench  s2 | 送稿器 / 仅正面 | 无类名
07-scan-workbench  s4 | (翻页) | .pgbtn
08-file-tools  t1 | del | .del
08-file-tools  t1 | 1 张 / 2 张 / 4 张 | 无类名
08-file-tools  t2 | 小 / 中 / 大 | 无类名
09-resume-workbench  s2 | 正常解析 | 无类名
09-resume-workbench  s5 | (翻页) | .pgbtn
09-resume-workbench  s5 | v1 你上传的原件 | .ver
09-resume-workbench  s5 | 存我的文档 · 扫码带走 / 存进我的简历 / 导出 PDF / 发到我手机 | .out
10-resume-interview  s2 | 这题跳过 / 上一题 / 让小青举个例子 | .qa-opt
10-resume-interview  s3 | (翻页) | .pgbtn
10-resume-interview  s3 | 存进我的简历 / 发到我手机 | .out
11-jobfit-compare  s1 | 从岗位信息选择 | .pick2-tab
11-jobfit-compare  s4 | ‹ / › | .pgbtn
12-material-factory  t1 | (翻页) | .pgbtn
12-material-factory  t1 | 务实 / 写 | 无类名
12-material-factory  t2 | 招聘会递简历 / 提 / 公众号增长 | 无类名
12-material-factory  t3 | 周五招聘会 | 无类名
12-material-factory  t4 | 单栏 · 稳妥机读 | .tplc
16-offline-agencies  joboffline | 路线发到我手机 / 收藏这家机构 | .entry
17-fair-desk  s4 | ‹ / › | .pgbtn
18-campus  s3 | ‹ / › | .pgbtn
20-interview-pod  s1 | 打字作答 | .way
20-interview-pod  s2 | 按住说话 | .recbtn
21-policy  s1 | 离职找工作中 / 本市户籍 / 已办 / 未缴 / 没领过 | .op
21-policy  s3 | ‹ / › | .pgbtn
22-career-plan  s3 | ‹ / › | .pgbtn
25-advisor  默认 | 钉到托盘 | .msg-pin
25-advisor  默认 | 按住说话 | .micbtn
25-advisor  默认 | 今天有新岗位吗 / 我能领哪些补贴 / 这台机器怎么用 | .qp
29-id-photo  s3 | 一寸 25×35mm / 白底 | .sw
29-id-photo  s4b | 我的简历 · 张三_简历_2026.pdf | .way
31-contract-review  s1 | 劳动合同 专项规则包 | .ctype
33-resume-templates  默认 | 全部 | 无类名
36-fairs-hub  默认 | 本周 8/10–8/16 | .dtag
40-session-safety  idle-warn | 我还在,继续 | .pick
40-session-safety  locked | 验证并继续 | .pick
40-session-safety  handover | 继续用本机 / 放弃本机 | .pick
40-session-safety  endclear | 确认结束并清空 | .pick
40-session-safety  recover | 恢复到第 3 步 | .pick
41-fulfillment-states  pay-fail | 重新付一次 / 换个付法 / 先放着不打 | .pick
41-fulfillment-states  pay-pending | 查询支付状态 / 转为待打印订单 | .pick
41-fulfillment-states  refund-doing | 打印退款凭条 / 回打印台重打 | .pick
41-fulfillment-states  refund-done | 打印回执 | .pick
41-fulfillment-states  refund-fail | 打印失败凭条 | .pick
41-fulfillment-states  supply | 我关好了,继续打 / 改到另一台机器 | .pick
41-fulfillment-states  claim | 确认认领 | .pick
41-fulfillment-states  wrongdoc | 立即上报 | .pick
42-my-assets  orders | 全部 6 | .fchip
43-my-records  fav | 全部 6 | .fchip
43-my-records  trace | 浏览记录 5 | .fchip
43-my-records  notice | 全部 7 | .fchip
