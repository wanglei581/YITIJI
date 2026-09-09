# 一体机走查清单（冷开取证）

本文件是实测记录，不是验收结论。表里的值是冷开该 URL 之后页面上读到的 DOM，不做对错判断。

| 项 | 值 |
|---|---|
| 生成时间 | 2026-09-09T16:01:36.108Z |
| git SHA | 8654360ba879 |
| 分支 | chore/walkthrough-harness |
| 预览 origin | http://127.0.0.1:4196 |
| 视口 | 1080×1920 |
| 夹具 | apps/kiosk/tests/visual/fixtures/fusion-w6-api.ts |
| 路由来源 | apps/kiosk/tests/visual/route-manifest.ts productionRoutePatterns → route-sweep-cases.ts |
| 条数 | 108 |
| 截图目录 | docs/progress/evidence/walkthrough-2026-09-09/ |

跑法（`apps/kiosk`）：`pnpm walkthrough:inventory`

每条路由独立 BrowserContext。截图文件名是路由模式的 slug（`/` → `root.png`，`/` 换成 `_`，`:` 丢掉；所以 `/print-scan/convert` 是 `print-scan_convert.png`，`/print/scan-convert` 是 `print_scan-convert.png`）。

## 全表

| # | 模式 | 请求 pathname | 落地 pathname | 主标题 | 主行动按钮 | 顶栏返回 `.qx-topbar-back` | CTA 次级出口 | `button[disabled]` | 壳 | 采集异常 |
|---|---|---|---|---|---|---|---|---|---|---|
|1|/|/|/|首页|登录后查看本人记录 · 点这里说话，比如“帮我打一份简历”进入助手 · 改简历 · 找工作 · 查政策 · 打印机在线打印 · 扫描简历、证明材料与照片，进入后核验打印与扫描能力开始选择材料 · AI 服务AI 简历诊断、逐条优化、生成新版本进入简历服务 · 练习服务模拟面试问答对练，可跳过，不做录用判断进入面试服务 · 第三方来源岗位信息查看来源与更新时间，去来源平台投递查看岗位 · 暂无场次招聘会暂无进行中或即将开始的场次查看招聘会 · 就业政策资格与办理条件以官方核验为准 · 已上架百宝箱进入本机已上架的扩展服务 · 已授权智慧校园进入本机已授权的校园服务 · 鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号|（无）|（无）|（无）|data-qx-frame|（无）|
|2|/login|/login|/login|登录后继续办理|手机号登录 · 手机扫码登录 · 手机号（11 位本人号码） · 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 清空 · 0 · 删除 · 打印与扫描文档、照片、扫描与格式转换，进入后按真实能力状态继续。 · 到机码核销手机上下过单，拿到机码直接来这台机器取。 · 岗位与招聘会来源机构发布的信息，投递与预约都在来源平台自行完成。 · 我已阅读并同意 · 《用户服务协议》 · 《隐私政策》 · 不登录，继续使用|返回首页|不登录，继续使用|获取验证码 · 短信验证码 · 验证并登录|data-qx-frame|（无）|
|3|/member/qr-login|/member/qr-login|/member/qr-login|就业服务大厅 · 当前一体机|（无）|（无）|（无）|（无）|无上述标记|（无）|
|4|/upload/phone|/upload/phone|/upload/phone|（无）|（无）|（无）|（无）|（无）|无上述标记|（无）|
|5|/legal/:doc|/legal/privacy|/legal/privacy|隐私政策|返回 · 缩小字号 · 放大字号 · 用户服务协议 · 隐私政策|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|6|/resume/job-fit|/resume/job-fit|/resume/job-fit|（无）|去上传简历|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|7|/resume/job-fit/actions|/resume/job-fit/actions|/resume/job-fit/actions|（无）|去做岗位匹配参考|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|8|/resume/career-plan|/resume/career-plan|/resume/career-plan|先准备简历，再看四栏方案|去上传简历|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|9|/interview/setup|/interview/setup|/interview/setup|模拟面试|返回 · 制造业 · 信息传输、软件和信息技术服务业 · 金融业 · 教育 · 卫生和社会工作 · 公共管理、社会保障和社会组织 · 选择行业 (20) · 前端开发工程师 · 行政专员 · 市场运营 · 机械工程师 · 会计 · 销售代表 · HR 初筛自我介绍 · 求职动机 · 稳定性 · 薪资沟通 · 业务主管过往经历 · 岗位理解 · 协作与执行 · 技术面试官专业技能 · 项目细节 · 问题解决 · 校招面试官校园经历 · 学习能力 · 职业规划 · 终面负责人价值观 · 长期发展 · 综合判断 · 轻松练习适合第一次练习，问题更基础 · 标准面试接近真实面试节奏 · 压力面试更多追问与细节验证 · 应届生 · 1 年以内 · 1-3 年 · 3-5 年 · 5 年以上 · 转行求职 · 3 分钟快速练习 · 约 3-4 题 · 5 分钟标准练习 · 约 4-6 题 · 8 分钟深度练习 · 约 6-8 题 · 手机扫码上传 · U盘导入 · 本机文件（桌面验证） · 填写目标岗位后开始|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|10|/interview/session|/interview/session|/interview/session|会话已失效，请重新开始|重新开始练习|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|11|/interview/report|/interview/report|/interview/report|（无）|重新开始练习|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|12|/interview/tips|/interview/tips|/interview/tips|面试技巧|返回 · 背景调研了解公司核心业务、近期动态、企业文化，并在面试中自然地表达出来 · 岗位匹配提取岗位 JD（职位描述）中的关键词，对应准备你的经历故事 · 基础演练准备 1 分钟 / 3 分钟自我介绍，回顾简历上每段经历的细节（不能有被问住的空白） · 形象着装根据公司性质（互联网偏休闲，金融/国企偏正装）选择合适着装，保持整洁精神 · 面试材料简历、作品集、证件、纸质材料按需备齐（可在本终端打印简历） · 面试安排确认时间、地点、交通路线；线上面试提前测试设备与网络 · 「请简单自我介绍一下？」 · 「你为什么想应聘这个岗位？」 · 「你最大的优势是什么？」 · 「你最大的不足是什么？」 · 「讲一个你解决困难或挫折的经历。」 · 「你为什么想来我们公司？」 · 「你对薪资有什么期待？」 · 「你还有什么想问我们的？」 · 开始模拟面试|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|13|/interview/reports|/interview/reports|/interview/reports|面试报告|返回 · 手机号登录 · 开始模拟面试|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|14|/screensaver|/screensaver|/|首页|登录后查看本人记录 · 点这里说话，比如“帮我打一份简历”进入助手 · 改简历 · 找工作 · 查政策 · 打印机在线打印 · 扫描简历、证明材料与照片，进入后核验打印与扫描能力开始选择材料 · AI 服务AI 简历诊断、逐条优化、生成新版本进入简历服务 · 练习服务模拟面试问答对练，可跳过，不做录用判断进入面试服务 · 第三方来源岗位信息查看来源与更新时间，去来源平台投递查看岗位 · 暂无场次招聘会暂无进行中或即将开始的场次查看招聘会 · 就业政策资格与办理条件以官方核验为准 · 已上架百宝箱进入本机已上架的扩展服务 · 已授权智慧校园进入本机已授权的校园服务 · 鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号|（无）|（无）|（无）|data-qx-frame|（无）|
|15|/session-timeout|/session-timeout|/|首页|登录后查看本人记录 · 点这里说话，比如“帮我打一份简历”进入助手 · 改简历 · 找工作 · 查政策 · 打印机在线打印 · 扫描简历、证明材料与照片，进入后核验打印与扫描能力开始选择材料 · AI 服务AI 简历诊断、逐条优化、生成新版本进入简历服务 · 练习服务模拟面试问答对练，可跳过，不做录用判断进入面试服务 · 第三方来源岗位信息查看来源与更新时间，去来源平台投递查看岗位 · 暂无场次招聘会暂无进行中或即将开始的场次查看招聘会 · 就业政策资格与办理条件以官方核验为准 · 已上架百宝箱进入本机已上架的扩展服务 · 已授权智慧校园进入本机已授权的校园服务 · 鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号|（无）|（无）|（无）|data-qx-frame|（无）|
|16|/error-offline|/error-offline|/error-offline|网络连接中断|重试连接 · 联系工作人员|（无）|（无）|（无）|无上述标记|（无）|
|17|/assistant|/assistant|/assistant|AI顾问|语音咨询 · 简历与求职材料项目经历、简历格式与求职材料准备 · 面试与沟通面试准备、自我介绍与谈薪沟通 · 岗位与选择岗位理解、Offer 对比与求职方向 · 入职与职场入职材料、试用期与社保公积金常识 · 直接问小青其他问题，不选主题直接咨询 · AI 自我介绍生成描述经历，生成1/3分钟可打印文稿 · AI 求职信生成描述公司岗位和经历，生成可打印求职信 · AI 材料准备清单面试/招聘会前，生成个性化可打印清单 · AI 简历 JD 匹配简历与岗位对比，找出差距和加分建议 · AI 岗位 JD 解读拆解招聘要求，区分门槛与加分项 · AI 面试题预测预测高频题目与回答思路，可打印带走 · AI 企业面试速查面试前5分钟了解企业风格和考察方向 · AI 求职方向探索不知道做什么？对话梳理方向和行动路径 · 应届生没什么经验，简历怎么写工作经历？ · 简历打印用什么纸、什么格式比较合适？ · 灵活就业社保补贴怎么申请？需要什么材料？ · 语音咨询 · 拼音键盘|（无）|（无）|发送|data-kiosk-component=page-frame|（无）|
|18|/profile|/profile|/profile|我的|去登录 · 你自己的简历与文档解析过的简历、生成的材料与扫描件。 · 打印订单与办理进度订单状态由服务端返回，可继续办理。 · 权益台账与活动记录是否有可用权益由接口判定。 · 我的简历这次要用哪一份—条 · 我的文档传上来和生成的文件—条 · 打印订单含取件码与出纸状态—条 · 我的收藏— · 我的权益— · AI 服务记录— · 隐私说明 · 回首页 · 手机号登录|（无）|回首页|（无）|data-qx-frame|（无）|
|19|/me/resumes|/me/resumes|/me/resumes|我的简历|简历诊断与生成 · 收藏岗位·招聘会·政策 · AI记录服务元数据 · 足迹浏览·跳转·进度 · 看第三方岗位与招聘会来源机构、更新时间与外部入口都在详情页里查看岗位 · 打印或扫描材料当场办完的打印、扫描不需要登录，也不会绑定到账号去打印扫描 · 返回我的 · 手机号登录|（无）|返回我的|（无）|data-qx-frame|（无）|
|20|/me/print-orders|/me/print-orders|/me/print-orders|打印订单|返回我的 · 手机号登录 · 去打印扫描 · 查看岗位|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|21|/me/documents|/me/documents|/me/documents|我的文档|返回我的 · 手机号登录 · 去打印扫描 · 查看岗位|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|22|/me/favorites|/me/favorites|/me/favorites|我的收藏|简历诊断与生成 · 收藏岗位·招聘会·政策 · AI记录服务元数据 · 足迹浏览·跳转·进度 · 看第三方岗位与招聘会来源机构、更新时间与外部入口都在详情页里查看岗位 · 打印或扫描材料当场办完的打印、扫描不需要登录，也不会绑定到账号去打印扫描 · 返回我的 · 手机号登录|（无）|返回我的|（无）|data-qx-frame|（无）|
|23|/me/ai-records|/me/ai-records|/me/ai-records|AI服务记录|简历诊断与生成 · 收藏岗位·招聘会·政策 · AI记录服务元数据 · 足迹浏览·跳转·进度 · 看第三方岗位与招聘会来源机构、更新时间与外部入口都在详情页里查看岗位 · 打印或扫描材料当场办完的打印、扫描不需要登录，也不会绑定到账号去打印扫描 · 返回我的 · 手机号登录|（无）|返回我的|（无）|data-qx-frame|（无）|
|24|/me/benefits|/me/benefits|/me/benefits|我的权益|我的权益 · 可参加的活动 · 打印与扫描A4 黑白或彩色，价格以现场公示与服务端报价为准。 · AI 简历服务诊断、优化、生成与材料工坊，都不需要权益。 · 就业政策与补贴指引政策原文与官方申请入口，本机不代办、不收代办费。 · 先看看有哪些活动 · 去登录|返回我的|先看看有哪些活动|（无）|data-qx-frame|（无）|
|25|/me/activity|/me/activity|/me/activity|浏览与跳转记录|简历诊断与生成 · 收藏岗位·招聘会·政策 · AI记录服务元数据 · 足迹浏览·跳转·进度 · 看第三方岗位与招聘会来源机构、更新时间与外部入口都在详情页里查看岗位 · 打印或扫描材料当场办完的打印、扫描不需要登录，也不会绑定到账号去打印扫描 · 返回我的 · 手机号登录|（无）|返回我的|（无）|data-qx-frame|（无）|
|26|/me/activity/:id|/me/activity/sweep-record|/me/activity/sweep-record|记录详情|简历诊断与生成 · 收藏岗位·招聘会·政策 · AI记录服务元数据 · 足迹浏览·跳转·进度 · 看第三方岗位与招聘会来源机构、更新时间与外部入口都在详情页里查看岗位 · 打印或扫描材料当场办完的打印、扫描不需要登录，也不会绑定到账号去打印扫描 · 返回我的 · 手机号登录|（无）|返回我的|（无）|data-qx-frame|（无）|
|27|/me/notifications|/me/notifications|/me/notifications|消息通知|返回我的 · 手机号登录|（无）|返回我的|（无）|data-qx-frame|（无）|
|28|/me/feedback|/me/feedback|/me/feedback|意见反馈|返回我的 · 手机号登录|（无）|返回我的|（无）|data-qx-frame|（无）|
|29|/me/settings|/me/settings|/me/settings|账号设置|返回我的 · 手机号登录 · 用户服务协议服务范围、账号、收费与打印说明 · 隐私政策信息收集、使用与文件留存说明|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|30|/me/privacy-requests|/me/privacy-requests|/me/privacy-requests|隐私与数据请求|返回账号设置 · 手机号登录|（无）|返回账号设置|（无）|data-qx-frame|（无）|
|31|/help|/help|/help|帮助中心|返回我的 · 全部 · 登录与账号 · AI简历服务 · 打印与扫描 · 政策服务 · 岗位与招聘会 · 我的记录 · 隐私与留存 · 登录与账号一定要登录才能使用吗？ · 隐私与留存我上传的简历会被泄露或推送给企业吗？ · 登录与账号为什么离开或刷新后又变回游客了？ · 登录与账号怎么切换成另一个账号？ · AI简历服务AI 简历服务能做什么？ · AI简历服务AI 会保证我面试或录用成功吗？ · 打印与扫描怎么打印文件？ · 打印与扫描扫描的文件保存在哪里？ · 政策服务政策服务能帮我申请补贴吗？ · 岗位与招聘会可以在这里办理岗位申请吗？ · 我的记录在哪里查看我的文档和订单？ · 隐私与留存文件会保存多久？ · 鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|32|/activities|/activities|/activities|权益活动|返回我的 · 我的权益|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|33|/activities/:id|/activities/activity-001|/activities/activity-001|权益活动详情|返回活动 · 登录后领取 · 我的权益|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|34|/renshi|/renshi|/renshi|政策服务|返回首页 · 问 AI 助手 · 就业政策 · 条件核对 · 社保指南 · 就业登记 · 政策公告 · 全部 · 高校毕业生 · 灵活就业 · 返乡务工 · 创业人员 · 困难群体 · 政策发布高校毕业生就业服务指引青岛市人力资源和社会保障局更新 2026-07-24 · 收藏政策 · 补贴指引一次性求职创业补贴综合整理 · 国家政务服务平台口径 · 补贴指引灵活就业社保补贴综合整理 · 官方入口示例：青岛人社（其他地区请查询当地人社平台） · 住房安家高校毕业生住房 / 安家政策综合整理 · 官方入口示例：青岛人才服务（其他地区请查询当地平台） · 技能提升职业技能培训 / 技能提升补贴综合整理 · 人社培训补贴口径 · 创业扶持创业担保贷款 / 创业补贴综合整理 · 官方入口示例：青岛人社（其他地区请查询当地人社平台） · 上传自备材料打印 · 扫码打开来源链接|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|35|/campus|/campus|/campus|校园招聘专区|返回首页 · 企业速览 · 参展企业 · 导览图 · AI求职 · 打印服务 · 扫码预约 · 去来源平台办理 · 参展企业查询1 家企业 · 招聘会导览图展位地图 / 日程 · AI智能求职简历 / 面试 / 准备单 · 自助打印服务简历 / 活动资料 · 查看全部 1 家 · 青青岛示例制造有限公司前端工程师1 个岗位|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|36|/campus/welcome|/campus/welcome|/campus/welcome|校园招聘迎新指引|返回校园招聘 · 返回校园招聘|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|37|/campus/freshman-insights|/campus/freshman-insights|/campus/freshman-insights|校园招聘数据|返回校园招聘 · 返回校园招聘 · 查看招聘会|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|38|/toolbox|/toolbox|/toolbox|百宝箱|返回 · 使用帮助打开站内帮助进入服务|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|39|/smart-campus|/smart-campus|/smart-campus|智慧校园|返回首页 · 迎新指引报到流程、办事窗口、入学与求职准备进入 · 行李帮运合作物流服务入口与服务点说明进入 · VR校园360° 云游校园与重点场馆介绍进入 · 校园卡办理新生办卡、补卡、挂失后快速办理进入 · 一卡通开通开通食堂、门禁、图书馆等校园通行权限进入 · 校园网开通激活校园 Wi-Fi、宿舍网络与上网账号进入|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|40|/smart-campus/welcome|/smart-campus/welcome|/smart-campus/welcome|迎新指引|返回智慧校园 · 入学材料 / 表格打印报到表、承诺书等自助打印 · 第一份简历 · AI 诊断实习求职从这里开始 · 返回智慧校园 · 校园卡办理指引|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|41|/smart-campus/freshman-insights|/smart-campus/freshman-insights|/smart-campus/freshman-insights|迎新服务导览|返回智慧校园 · 打印材料上传报到表、承诺书等 PDF 或图片，本机预览后打印。Word 需转换引擎开放后才能转 PDF。进入 · 简历服务上传简历做 AI 诊断与优化，或按引导生成草稿，并可进入本机打印。进入 · 校园招聘信息查看校园主题招聘会的参展企业、导览与材料。投递请去来源平台，本机不收简历。进入 · 政策服务查看就业政策、社保与档案登记材料指引。只展示已审核信息，不代办、不承诺结果。进入 · 我的文档登录后查看、预览或重新打印本人已保存的文件。未登录时会提示先登录。进入 · 返回智慧校园|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|42|/smart-campus/service/:key|/smart-campus/service/campus-card|/smart-campus/service/campus-card|校园卡办理|返回智慧校园 · 入学材料 / 表格打印报到表、申请表等自助打印 · 返回智慧校园 · 查看迎新报到指引|（无）|（无）|证件照排版打印功能即将上线；当前可用手机照片在打印扫描页打印即将上线|data-kiosk-component=page-frame + w4-page-frame|（无）|
|43|/print-scan|/print-scan|/print-scan|打印扫描服务|文档打印 · 手机扫码上传 · U 盘导入打印 · 照片打印 · 材料扫描 · 格式转换 · 签名盖章 · 证件照 · 到机码核销不是取件码手机上下过单拿到的 8 位数字到机码；早期发出的 10 位字母数字历史码同样能用。扫码或手输都行。不是付款后的取件凭证码 · 我的文档已上传 / 生成的文件查看 → · 打印订单任务状态与取件凭证码查看 → · 反馈问题反馈打印或扫描问题，无需登录查看 →|返回首页|（无）|（无）|data-qx-frame|（无）|
|44|/print-scan/feature/:key|/print-scan/feature/id-photo|/print-scan/feature/id-photo|证件照|已经有证件照文件现在可用相册里已有的证件照，传进来按普通照片打印。尺寸和底色以你手上的原图为准。 · 纸质照片想留电子版在奔图面板上扫成 PDF，回本机取走。扫描不做裁切和底色处理。 · 返回打印扫描 · 先用照片打印|（无）|返回打印扫描|（无）|data-qx-frame|（无）|
|45|/print-scan/convert|/print-scan/convert|/print-scan/convert|图片转 PDF|本机上传一张 · 手机扫码上传一张 · U 盘导入图片 · 返回打印扫描|返回打印扫描|返回打印扫描|至少加一张图再合成（还没有图片，没有可合成的内容）|data-qx-frame|（无）|
|46|/print-scan/sign|/print-scan/sign|/print-scan/sign|签名盖章|文档打印传文件、选参数、去打印。要打印机就绪 · 材料扫描把纸质材料扫成电子件。要扫描仪就绪 · 图片转 PDF几张照片拼成一份 PDF。不经过打印机 · AI 顾问说不清就直接问她。随时可以问 · 返回打印扫描 · 去登录|返回打印扫描|返回打印扫描|（无）|data-qx-frame|（无）|
|47|/print/scan-convert|/print/scan-convert|/print-scan/convert|图片转 PDF|本机上传一张 · 手机扫码上传一张 · U 盘导入图片 · 返回打印扫描|返回打印扫描|返回打印扫描|至少加一张图再合成（还没有图片，没有可合成的内容）|data-qx-frame|（无）|
|48|/print/scan-sign|/print/scan-sign|/print-scan/sign|签名盖章|文档打印传文件、选参数、去打印。要打印机就绪 · 材料扫描把纸质材料扫成电子件。要扫描仪就绪 · 图片转 PDF几张照片拼成一份 PDF。不经过打印机 · AI 顾问说不清就直接问她。随时可以问 · 返回打印扫描 · 去登录|返回打印扫描|返回打印扫描|（无）|data-qx-frame|（无）|
|49|/print/scan-feature|/print/scan-feature|/print-scan/feature/id-photo|证件照|已经有证件照文件现在可用相册里已有的证件照，传进来按普通照片打印。尺寸和底色以你手上的原图为准。 · 纸质照片想留电子版在奔图面板上扫成 PDF，回本机取走。扫描不做裁切和底色处理。 · 返回打印扫描 · 先用照片打印|（无）|返回打印扫描|（无）|data-qx-frame|（无）|
|50|/print/upload|/print/upload|/print/upload|文档打印|手机扫码上传（PDF / JPG / PNG · 单份 ≤ 10MB） · 本机选文件（PDF / JPG / PNG · 单份 ≤ 15MB） · 扫描纸质原件 · 从我的文档或最近打印文件选择 · 退出 · 回打印扫描|返回打印扫描|退出 · 回打印扫描|U 盘导入（本机未接通 · 重试也没用） · 下一步：材料检查（这一步还没有文件，先用上面任一通道把文件搬进来）|data-qx-frame|（无）|
|51|/print/desk|/print/desk|/print/desk?step=check|材料检查|返回打印扫描 · 去选文件|返回选文件|返回打印扫描|（无）|data-qx-frame|（无）|
|52|/print/material-check|/print/material-check|/print/desk?step=check|材料检查|返回打印扫描 · 去选文件|返回选文件|返回打印扫描|（无）|data-qx-frame|（无）|
|53|/print/preview|/print/preview|/print/desk?step=preview|预览与打印参数|返回打印扫描 · 去选文件|返回选文件|返回打印扫描|（无）|data-qx-frame|（无）|
|54|/print/params|/print/params|/print/desk?step=preview|预览与打印参数|返回打印扫描 · 去选文件|返回选文件|返回打印扫描|（无）|data-qx-frame|（无）|
|55|/print/confirm|/print/confirm|/print/confirm|报价确认|我的打印订单 · 重新选文件|返回预览与参数|我的打印订单|（无）|data-qx-frame|（无）|
|56|/print/cashier|/print/cashier|/print/cashier|订单支付|我的打印订单 · 重新发起打印|返回我的打印订单|我的打印订单|（无）|data-qx-frame|（无）|
|57|/print/progress|/print/progress|/print/progress|未找到打印任务|重新上传文件|返回首页|（无）|（无）|data-qx-frame|（无）|
|58|/print/done|/print/done|/print/done|无法确认打印结果|返回首页 · 使用帮助|（无）|返回首页|（无）|data-qx-frame|（无）|
|59|/resume|/resume|/resume/source|AI 简历诊断|返回首页 · 没有电子简历？AI 帮你生成一份填写真实信息 → AI 润色排版 → 导出 PDF 当场打印（不编造任何经历）去生成 · U盘上传从已插入一体机的 U 盘中选择简历文件只读取你主动选择的文件，上传完成后即可拔出 U 盘。 · 云端上传选择云盘同步目录或本机下载目录中的简历文件适合先把云盘文件下载到本机目录后选择；不会保存你的云盘账号。 · 手机扫码上传用手机扫码选择简历文件，再回到一体机确认二维码只含一次性上传令牌；手机端不会获得一体机会员登录凭证。 · 点击上传文件Word 转换暂未开放，请另存为 PDF 上传；支持 PDF / 图片格式，单个文件最大 10MBPDFJPGPNGWEBP · 切换为通用诊断 · 基础信息完整度 · 求职目标清晰度 · 经历表达清晰度 · 成果量化程度 · 岗位关键词覆盖 · 版式与可读性 · 选择行业方向|（无）|（无）|请先上传简历文件|data-kiosk-component=page-frame|（无）|
|60|/resume/upload|/resume/upload|/resume/source|AI 简历诊断|返回首页 · 没有电子简历？AI 帮你生成一份填写真实信息 → AI 润色排版 → 导出 PDF 当场打印（不编造任何经历）去生成 · U盘上传从已插入一体机的 U 盘中选择简历文件只读取你主动选择的文件，上传完成后即可拔出 U 盘。 · 云端上传选择云盘同步目录或本机下载目录中的简历文件适合先把云盘文件下载到本机目录后选择；不会保存你的云盘账号。 · 手机扫码上传用手机扫码选择简历文件，再回到一体机确认二维码只含一次性上传令牌；手机端不会获得一体机会员登录凭证。 · 点击上传文件Word 转换暂未开放，请另存为 PDF 上传；支持 PDF / 图片格式，单个文件最大 10MBPDFJPGPNGWEBP · 切换为通用诊断 · 基础信息完整度 · 求职目标清晰度 · 经历表达清晰度 · 成果量化程度 · 岗位关键词覆盖 · 版式与可读性 · 选择行业方向|（无）|（无）|请先上传简历文件|data-kiosk-component=page-frame|（无）|
|61|/resume/source|/resume/source|/resume/source|AI 简历诊断|返回首页 · 没有电子简历？AI 帮你生成一份填写真实信息 → AI 润色排版 → 导出 PDF 当场打印（不编造任何经历）去生成 · U盘上传从已插入一体机的 U 盘中选择简历文件只读取你主动选择的文件，上传完成后即可拔出 U 盘。 · 云端上传选择云盘同步目录或本机下载目录中的简历文件适合先把云盘文件下载到本机目录后选择；不会保存你的云盘账号。 · 手机扫码上传用手机扫码选择简历文件，再回到一体机确认二维码只含一次性上传令牌；手机端不会获得一体机会员登录凭证。 · 点击上传文件Word 转换暂未开放，请另存为 PDF 上传；支持 PDF / 图片格式，单个文件最大 10MBPDFJPGPNGWEBP · 切换为通用诊断 · 基础信息完整度 · 求职目标清晰度 · 经历表达清晰度 · 成果量化程度 · 岗位关键词覆盖 · 版式与可读性 · 选择行业方向|（无）|（无）|请先上传简历文件|data-kiosk-component=page-frame|（无）|
|62|/resume/generate|/resume/generate|/resume/generate|AI 简历生成|返回简历服务 · 返回|（无）|（无）|下一步：求职意向|data-kiosk-component=page-frame|（无）|
|63|/resume/generate/preview|/resume/generate/preview|/resume/generate/preview|简历预览|打开我的简历登录之后，服务端留存期内的版本可以直接打开 · 返回简历服务上传、诊断、优化都在那一页 · 返回服务大厅 · 重新填一份|（无）|返回服务大厅|（无）|data-qx-frame|（无）|
|64|/resume/parse|/resume/parse|/resume/parse|未找到简历文件|返回上传简历|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|65|/resume/report|/resume/report|/resume/report|简历诊断报告|返回简历来源 · 返回简历来源重新上传或扫描一份简历，交给解析 · 打开我的诊断记录从已保存的记录里挑一份继续 · 去打印 / 扫描不需要报告也能出纸 · 返回首页 · 去上传简历|（无）|返回首页|（无）|data-qx-frame|（无）|
|66|/resume/optimize|/resume/optimize|/resume/optimize|优化建议|重新上传简历 · 返回诊断报告看清楚要改哪几处，再决定怎么改 · 手动逐项修改自己填写并原样导出草稿，不经过模型 · 打开我的简历查看和整理已保存的版本 · 返回报告|（无）|返回报告|（无）|data-qx-frame|（无）|
|67|/resume/optimize/compare|/resume/optimize/compare|/resume/optimize/compare|逐条改写对照|去上传简历 · 返回优化页|（无）|返回优化页|（无）|data-qx-frame|（无）|
|68|/resume/export|/resume/export|/resume/optimize|优化建议|重新上传简历 · 返回诊断报告看清楚要改哪几处，再决定怎么改 · 手动逐项修改自己填写并原样导出草稿，不经过模型 · 打开我的简历查看和整理已保存的版本 · 返回报告|（无）|返回报告|（无）|data-qx-frame|（无）|
|69|/resume/templates|/resume/templates|/resume/templates|简历素材库|返回首页 · 全部 · 简历模板 · 通用|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|70|/resume/materials|/resume/materials|/resume/materials|求职材料库|返回首页 · 全部 · 求职信 · 感谢信 · 作品集 · 材料清单 · 校招 · 社招 · 通用|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|71|/resume-service|/resume-service|/resume-service|AI简历服务|返回 · AI简历诊断上传PDF或图片简历，AI自动解析结构、识别问题，给出针对性改进建议进入 · AI简历优化输入目标岗位后，AI定向重写简历表达，提升岗位匹配度进入 · 简历生成引导式填写基本信息，AI生成完整简历草稿，可下载打印进入 · 简历素材库浏览版式参考和求职材料模板，辅助自主编辑进入 · 职业规划AI结合你的经历与目标，生成职业发展方向与行动建议进入 · 求职材料整理求职附件清单，生成求职信、自我介绍等辅助材料进入 · 简历打印优化完成后直接在本机打印，走标准文档打印流程进入 · 岗位匹配参考AI分析简历与目标岗位的匹配度，给出差距与提升方向进入 · 我的简历查看已保存的简历文件 · AI服务记录查看历次AI诊断与优化 · 自我评估完成职业能力自我测评|（无）|（无）|（无）|v6-runtime-shell + data-kiosk-component=page-frame|（无）|
|72|/scan|/scan|/scan?stage=start|材料扫描|选择扫描类型：简历扫描 · 选择扫描类型：证件扫描 · 选择扫描类型：普通文档 · 改用面板扫描到 U 盘 · 下一步 · 创建扫描会话|返回打印扫描|改用面板扫描到 U 盘|（无）|data-qx-frame|（无）|
|73|/scan/start|/scan/start|/scan?stage=start|材料扫描|选择扫描类型：简历扫描 · 选择扫描类型：证件扫描 · 选择扫描类型：普通文档 · 改用面板扫描到 U 盘 · 下一步 · 创建扫描会话|返回打印扫描|改用面板扫描到 U 盘|（无）|data-qx-frame|（无）|
|74|/scan/settings|/scan/settings|/scan?stage=settings|未创建扫描任务|安全返回扫描首页|返回打印扫描|安全返回扫描首页|未创建扫描任务|data-qx-frame|（无）|
|75|/scan/progress|/scan/progress|/scan?stage=start|材料扫描|选择扫描类型：简历扫描 · 选择扫描类型：证件扫描 · 选择扫描类型：普通文档 · 改用面板扫描到 U 盘 · 下一步 · 创建扫描会话|返回打印扫描|改用面板扫描到 U 盘|（无）|data-qx-frame|（无）|
|76|/scan/result|/scan/result|/scan?stage=start|材料扫描|选择扫描类型：简历扫描 · 选择扫描类型：证件扫描 · 选择扫描类型：普通文档 · 改用面板扫描到 U 盘 · 下一步 · 创建扫描会话|返回打印扫描|改用面板扫描到 U 盘|（无）|data-qx-frame|（无）|
|77|/jobs|/jobs|/jobs|岗位信息|开始推荐 · 全部 · 全职 · 实习 · 校招 · 兼职 · 全部 · 青岛公共就业服务网 · 线下机构门店 · 城市 / 行业筛选 · 仅看收藏 0 · 最新同步 · 薪资标注优先 · 前端工程师 · 收藏岗位 · 查看岗位 · AI岗位推荐登录后基于本人简历推荐，仅供参考 · 找企业来源企业与岗位导览 · 线下招聘机构 · 官方与合作平台目录|返回岗位服务|线下招聘机构|上一页 · 下一页|data-qx-frame|（无）|
|78|/jobs/:id|/jobs/job-001|/jobs/job-001|岗位详情|收藏岗位 · AI岗位解读看懂职责与准备点 · 岗位匹配参考用本人简历做准备 · 打印岗位信息A4 黑白 · 以现场公示价为准 · 扫码投递 · 返回岗位列表 · 扫码投递 · 去来源平台投递|（无）|返回岗位列表 · 扫码投递|查看企业来源企业未关联|data-qx-frame|（无）|
|79|/jobs/:id/offline|/jobs/offline-job-001/offline|/jobs/offline-job-001/offline|线下机构岗位|回机构目录重新找目录里的机构带地址与来源编号 · 先把材料打好不依赖这条岗位信息 · 查看来源机构门店 · 回机构目录|返回机构详情|查看来源机构门店|（无）|data-qx-frame|（无）|
|80|/offline-agencies|/offline-agencies|/offline-agencies|线下招聘机构|搜索 · 全部 · 市南区 · 清除全部 · 打印自备材料登记表、复印件、自带简历，A4 黑白 · 纸质材料扫成 PDF在奔图面板上扫，文件回本机取 · 简历先过一遍上传或扫描后做一次诊断 · 用本人简历 · 填写求职方向 · 返回岗位服务 · 查询机构目录|返回岗位服务|返回岗位服务|（无）|data-qx-frame|（无）|
|81|/offline-agencies/:id|/offline-agencies/agency-001|/offline-agencies/agency-001|青岛合规人力服务机构|查看岗位 现场咨询岗位 · 用本人简历 · 填写求职方向 · 返回机构目录 · 查看该机构岗位|返回机构列表|返回机构目录|（无）|data-qx-frame|（无）|
|82|/jobs-service|/jobs-service|/jobs-service|岗位信息|返回 · 全职岗位第三方平台同步的全职岗位信息，可筛选行业、地区与薪资范围进入 · 实习岗位适合在校生与应届生的实习机会，来自第三方权威来源进入 · 兼职信息灵活就业与兼职机会，第三方来源展示，投递请前往来源平台进入 · 全部岗位按分类查看全部来源岗位，支持关键词搜索与综合筛选进入 · 找企业查看参与机构的企业信息与在招岗位来源，了解目标企业进入 · 岗位大师上传简历后，AI分析与岗位的匹配度，给出针对性优化建议进入 · 线上招聘平台扫码打开第三方招聘平台官网，岗位与投递均在该平台自行完成进入 · 线下招聘机构查看附近线下人力资源机构，直接咨询求职机会进入 · 浏览记录查看已浏览的岗位 · 外部跳转记录查看已打开的来源平台|（无）|（无）|（无）|v6-runtime-shell + data-kiosk-component=page-frame|（无）|
|83|/notifications|/notifications|/notifications|消息通知|返回我的 · 手机号登录|（无）|返回我的|（无）|data-qx-frame|（无）|
|84|/companies|/companies|/companies|找企业|全部 · 央企 · 国企 · 事业单位 · 选择类型 (12) · 全部 · 智能制造 · 互联网/软件 · AI/大数据 · 电子信息 · 新能源 · 选择行业 (18) · 全部 · 社招 · 校招 · 实习 · 兼职 · 招聘会参展 · 全部 · 人社平台 · 大学就业网 · 招聘会主办方 · 第三方合规平台 · 青岛示例制造有限公司招聘会参展民营企业山东省 · 青岛市 · 崂山区来源 青岛公共就业服务网代表岗位：前端工程师 · 查看在招岗位 · 用本人简历 · 填写求职方向 · 返回岗位服务 · 按条件筛选|返回岗位服务|返回岗位服务|（无）|data-qx-frame|（无）|
|85|/companies/:id|/companies/company-001|/companies/company-001|青岛示例制造有限公司|去来源平台查看 · 查看岗位 · 去来源平台投递 · 用本人简历 · 填写求职方向 · 返回企业目录 · 查看在招岗位|返回找企业|返回企业目录|（无）|data-qx-frame|（无）|
|86|/job-fairs|/job-fairs|/job-fairs|招聘会|返回首页 · 全部地区 · 按日期筛选招聘会 · 全部 · 即将开始 · 进行中 · 已结束 · 只看收藏 · 查看 2026 青岛高校毕业生招聘会 详情 · 收藏招聘会 · 扫码预约|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|87|/job-fairs/checkin|/job-fairs/checkin|/job-fairs/checkin|来源平台入场入口|返回 · 查看详情 · 来源平台签到码 · 返回首页 · 查看招聘会|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|88|/job-fairs/:id|/job-fairs/fair-001|/job-fairs/fair-001|2026 青岛高校毕业生招聘会|返回 · 收藏招聘会 · 详情与特色 · 参展企业与岗位 · 场馆导览 · 数据大屏 · 扫码在手机上导航 · 展馆导览查看会场布局 · 活动资料0 份 · 可打印 · 现场数据行业分布 · 岗位规模 · AI参会准备单基于本人简历生成 · AI准备单 · 扫码签到 · 打印资料 · 扫码预约|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|89|/job-fairs/:id/companies|/job-fairs/fair-001/companies|/job-fairs/fair-001/companies|参会企业|返回详情 · 全部 · 智能制造专区 · 青青岛示例制造有限公司medium展位 A01智能制造招聘 2 人 · 1 岗示例参展企业。查看详情 / 扫码查看 · 场馆导览 · 查看招聘会|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|90|/fairs-service|/fairs-service|/fairs-service|招聘会信息|返回 · 社会招聘会查看企业社会招聘会场次，了解参会企业、时间和地点信息进入 · 校园招聘会查看高校或机构组织的校园专场招聘会，含企业名录和预约入口进入 · 扫码签到现场活动签到二维码展示与识别引导进入 · AI参会规划告诉AI顾问你想参加的招聘会，小青为你生成参会清单和时间安排进入 · 求职材料准备提前准备好简历和求职材料，现场打印后直接使用进入 · 活动资料打印上传或扫描招聘会相关材料，本机直接打印备用进入 · 浏览记录查看最近浏览的招聘会 · 外部跳转记录查看已前往来源平台的记录|（无）|（无）|（无）|v6-runtime-shell + data-kiosk-component=page-frame|（无）|
|91|/job-fairs/:id/companies/:companyId|/job-fairs/fair-001/companies/fair-company-001|/job-fairs/fair-001/companies/fair-company-001|招聘会参展企业|列表视图 · 海报视图 · 不限 · 不限 · 大专及以上 · 本科及以上 · 硕士及以上 · 不限 · 应届生 · 1年以上 · 3年以上 · 5年以上 · 不限 · 全职 · 兼职 · 实习 · 扫码投递手机扫码前往来源平台 · 去来源平台投递系统不接收简历 · 打印企业资料用于现场咨询准备 · 打印岗位清单按需打印本企业岗位 · 用本人简历 · 填写求职方向 · 联系工作人员 · 返回列表 · 去来源平台投递|返回参展企业列表|返回列表|（无）|data-qx-frame|（无）|
|92|/job-fairs/:id/map|/job-fairs/fair-001/map|/job-fairs/fair-001/map|场馆导览|返回详情 · 返回详情 · 查看参展企业 · 查看可打印导览资料|（无）|（无）|智能制造专区青岛市|data-kiosk-component=page-frame + w4-page-frame|（无）|
|93|/job-fairs/:id/materials|/job-fairs/fair-001/materials|/job-fairs/fair-001/materials|活动资料|返回详情 · 参会企业 · 查看招聘会|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|94|/job-fairs/:id/visit-plan|/job-fairs/fair-001/visit-plan|/job-fairs/fair-001/visit-plan|AI参会准备单|返回详情 · 去上传简历 · 打印活动资料|（无）|（无）|（无）|data-kiosk-component=page-frame + w4-page-frame|（无）|
|95|/job-fairs/:id/stats|/job-fairs/fair-001/stats|/job-fairs/fair-001/stats|（无）|（无）|（无）|（无）|（无）|无上述标记|（无）|
|96|/resume/self-assessment/intro|/resume/self-assessment/intro|/resume/self-assessment/intro|自我探索 · 倾向参考|返回|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|97|/resume/self-assessment/questions|/resume/self-assessment/questions|/resume/self-assessment/questions|自我探索 · 倾向参考|返回 · 去看说明并同意|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|98|/resume/self-assessment/result|/resume/self-assessment/result|/resume/self-assessment/result|自我探索 · 倾向参考|重新作答|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|99|/resume/self-assessment/history|/resume/self-assessment/history|/resume/self-assessment/history|自我探索 · 倾向参考|返回 · 前往 AI 服务记录|（无）|（无）|（无）|data-kiosk-component=page-frame|（无）|
|100|/interview-service|/interview-service|/interview-service|AI面试训练|返回 · 开始模拟面试立即开始选择岗位类型和难度，进入AI模拟面试间，完成后即时出报告进入 · 职业自我评估回答AI设计的问卷，获得个人优势、薄弱项与职业方向参考报告进入 · 职业规划建议结合你的经历与目标，AI生成阶段性职业发展路径与行动建议进入 · 面试技巧常见面试问题解析、自我介绍模板、薪资谈判要点等实用技巧进入 · 评估历史查看历次自我评估报告，追踪职业认知的成长变化进入 · 行业薪资参考问AI顾问了解目标岗位的市场薪资范围和谈薪技巧进入 · AI服务记录查看历次AI服务调用记录 · 训练报告查看全部模拟面试报告|（无）|（无）|（无）|v6-runtime-shell + data-kiosk-component=page-frame|（无）|
|101|/print/pickup-claim|/print/pickup-claim|/print/pickup-claim|输入你的到机码|不用手输：把手机上的码，对准机身侧面的扫码区扫码模组靠接近感应触发，不会一直亮着。把手机屏幕亮度调高，再把屏幕凑近扫码区。 · 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 输入 10 位历史码 · 0 · 用机身扫码区免输码 · 问工作人员帮你查订单 · 返回|返回打印扫描|返回|删除 · 确认校验|data-qx-frame|（无）|
|102|/ai/plan|/ai/plan|/ai/plan|小青的作业面|去问小青 · 看我的 AI 服务记录|返回问小青|去问小青|（无）|data-qx-frame|（无）|
|103|/session-resume|/session-resume|/login|登录后继续办理|手机号登录 · 手机扫码登录 · 手机号（11 位本人号码） · 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 清空 · 0 · 删除 · 打印与扫描文档、照片、扫描与格式转换，进入后按真实能力状态继续。 · 到机码核销手机上下过单，拿到机码直接来这台机器取。 · 岗位与招聘会来源机构发布的信息，投递与预约都在来源平台自行完成。 · 我已阅读并同意 · 《用户服务协议》 · 《隐私政策》 · 不登录，继续使用|返回首页|不登录，继续使用|获取验证码 · 短信验证码 · 验证并登录|data-qx-frame|（无）|
|104|/jobs/online-platforms|/jobs/online-platforms|/jobs/online-platforms|线上招聘平台|B第三方官网入口Boss直聘直聘平台www.zhipin.com手机扫码打开在官网继续浏览扫码打开来源平台 · 前第三方官网入口前程无忧综合平台www.51job.com手机扫码打开在官网继续浏览扫码打开来源平台 · 智第三方官网入口智联招聘综合平台www.zhaopin.com手机扫码打开在官网继续浏览扫码打开来源平台 · 猎第三方官网入口猎聘中高端平台www.liepin.com手机扫码打开在官网继续浏览扫码打开来源平台 · AI 找岗方向快捷选项加自由填写，确认后再进入 AI 对话 · 用本人简历 · 填写求职方向 · 返回岗位服务 · 去看岗位信息|返回岗位服务|返回岗位服务|（无）|data-qx-frame|（无）|
|105|/contract-review|/contract-review|/|首页|登录后查看本人记录 · 点这里说话，比如“帮我打一份简历”进入助手 · 改简历 · 找工作 · 查政策 · 打印机在线打印 · 扫描简历、证明材料与照片，进入后核验打印与扫描能力开始选择材料 · AI 服务AI 简历诊断、逐条优化、生成新版本进入简历服务 · 练习服务模拟面试问答对练，可跳过，不做录用判断进入面试服务 · 第三方来源岗位信息查看来源与更新时间，去来源平台投递查看岗位 · 暂无场次招聘会暂无进行中或即将开始的场次查看招聘会 · 就业政策资格与办理条件以官方核验为准 · 已上架百宝箱进入本机已上架的扩展服务 · 已授权智慧校园进入本机已授权的校园服务 · 鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号|（无）|（无）|（无）|data-qx-frame|（无）|
|106|/contract-review/processing|/contract-review/processing|/|首页|登录后查看本人记录 · 点这里说话，比如“帮我打一份简历”进入助手 · 改简历 · 找工作 · 查政策 · 打印机在线打印 · 扫描简历、证明材料与照片，进入后核验打印与扫描能力开始选择材料 · AI 服务AI 简历诊断、逐条优化、生成新版本进入简历服务 · 练习服务模拟面试问答对练，可跳过，不做录用判断进入面试服务 · 第三方来源岗位信息查看来源与更新时间，去来源平台投递查看岗位 · 暂无场次招聘会暂无进行中或即将开始的场次查看招聘会 · 就业政策资格与办理条件以官方核验为准 · 已上架百宝箱进入本机已上架的扩展服务 · 已授权智慧校园进入本机已授权的校园服务 · 鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号|（无）|（无）|（无）|data-qx-frame|（无）|
|107|/contract-review/result|/contract-review/result|/|首页|登录后查看本人记录 · 点这里说话，比如“帮我打一份简历”进入助手 · 改简历 · 找工作 · 查政策 · 打印机在线打印 · 扫描简历、证明材料与照片，进入后核验打印与扫描能力开始选择材料 · AI 服务AI 简历诊断、逐条优化、生成新版本进入简历服务 · 练习服务模拟面试问答对练，可跳过，不做录用判断进入面试服务 · 第三方来源岗位信息查看来源与更新时间，去来源平台投递查看岗位 · 暂无场次招聘会暂无进行中或即将开始的场次查看招聘会 · 就业政策资格与办理条件以官方核验为准 · 已上架百宝箱进入本机已上架的扩展服务 · 已授权智慧校园进入本机已授权的校园服务 · 鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号|（无）|（无）|（无）|data-qx-frame|（无）|
|108|/policy-service|/policy-service|/policy-service|政策服务|返回 · 就业政策就业补贴、灵活就业等政策信息，由合作机构提交并经平台审核后展示进入 · 社保指南参保流程、社保办事材料清单，含城镇职工和灵活就业人员险种说明进入 · 档案 / 登记人事档案托管办理材料指引、毕业生就业登记流程与证明开具说明进入 · 补贴指引就业补贴、失业保险、创业扶持政策说明与来源链接进入 · AI政策助手提问政策疑问、补贴资格、办事材料，AI顾问给出个性化解答进入 · 政策收藏查看已收藏的政策，方便随时回顾进入 · 浏览记录查看最近浏览的政策文章 · AI政策问答记录查看历次AI政策问答记录|（无）|（无）|（无）|v6-runtime-shell + data-kiosk-component=page-frame|（无）|

## 落地 pathname ≠ 请求 pathname

共 19 条。比较的是 pathname（落地栏附带 search，便于看 `?stage=` / `?step=`）。

| 模式 | 请求 pathname | 落地 pathname | 壳 |
|---|---|---|---|
| /screensaver | /screensaver | / | data-qx-frame |
| /session-timeout | /session-timeout | / | data-qx-frame |
| /print/scan-convert | /print/scan-convert | /print-scan/convert | data-qx-frame |
| /print/scan-sign | /print/scan-sign | /print-scan/sign | data-qx-frame |
| /print/scan-feature | /print/scan-feature | /print-scan/feature/id-photo | data-qx-frame |
| /print/material-check | /print/material-check | /print/desk?step=check | data-qx-frame |
| /print/preview | /print/preview | /print/desk?step=preview | data-qx-frame |
| /print/params | /print/params | /print/desk?step=preview | data-qx-frame |
| /resume | /resume | /resume/source | data-kiosk-component=page-frame |
| /resume/upload | /resume/upload | /resume/source | data-kiosk-component=page-frame |
| /resume/export | /resume/export | /resume/optimize | data-qx-frame |
| /scan/start | /scan/start | /scan?stage=start | data-qx-frame |
| /scan/settings | /scan/settings | /scan?stage=settings | data-qx-frame |
| /scan/progress | /scan/progress | /scan?stage=start | data-qx-frame |
| /scan/result | /scan/result | /scan?stage=start | data-qx-frame |
| /session-resume | /session-resume | /login | data-qx-frame |
| /contract-review | /contract-review | / | data-qx-frame |
| /contract-review/processing | /contract-review/processing | / | data-qx-frame |
| /contract-review/result | /contract-review/result | / | data-qx-frame |

## 没有任何出口的

判据（只描述怎么数，不是结论）：落地页看不到 `.qx-topbar-back`，且 `.qx-ctabar` 里没有 `data-variant` 不是 `primary` 的按钮。底部主导航不计入。

共 58 条。

| 模式 | 请求 pathname | 落地 pathname | 顶栏返回 | CTA 次级出口 | 壳 |
|---|---|---|---|---|---|
| / | / | / | （无） | （无） | data-qx-frame |
| /member/qr-login | /member/qr-login | /member/qr-login | （无） | （无） | 无上述标记 |
| /upload/phone | /upload/phone | /upload/phone | （无） | （无） | 无上述标记 |
| /legal/:doc | /legal/privacy | /legal/privacy | （无） | （无） | data-kiosk-component=page-frame |
| /resume/job-fit | /resume/job-fit | /resume/job-fit | （无） | （无） | data-kiosk-component=page-frame |
| /resume/job-fit/actions | /resume/job-fit/actions | /resume/job-fit/actions | （无） | （无） | data-kiosk-component=page-frame |
| /resume/career-plan | /resume/career-plan | /resume/career-plan | （无） | （无） | data-kiosk-component=page-frame |
| /interview/setup | /interview/setup | /interview/setup | （无） | （无） | data-kiosk-component=page-frame |
| /interview/session | /interview/session | /interview/session | （无） | （无） | data-kiosk-component=page-frame |
| /interview/report | /interview/report | /interview/report | （无） | （无） | data-kiosk-component=page-frame |
| /interview/tips | /interview/tips | /interview/tips | （无） | （无） | data-kiosk-component=page-frame |
| /interview/reports | /interview/reports | /interview/reports | （无） | （无） | data-kiosk-component=page-frame |
| /screensaver | /screensaver | / | （无） | （无） | data-qx-frame |
| /session-timeout | /session-timeout | / | （无） | （无） | data-qx-frame |
| /error-offline | /error-offline | /error-offline | （无） | （无） | 无上述标记 |
| /assistant | /assistant | /assistant | （无） | （无） | data-kiosk-component=page-frame |
| /me/print-orders | /me/print-orders | /me/print-orders | （无） | （无） | data-kiosk-component=page-frame |
| /me/documents | /me/documents | /me/documents | （无） | （无） | data-kiosk-component=page-frame |
| /me/settings | /me/settings | /me/settings | （无） | （无） | data-kiosk-component=page-frame |
| /help | /help | /help | （无） | （无） | data-kiosk-component=page-frame |
| /activities | /activities | /activities | （无） | （无） | data-kiosk-component=page-frame |
| /activities/:id | /activities/activity-001 | /activities/activity-001 | （无） | （无） | data-kiosk-component=page-frame |
| /renshi | /renshi | /renshi | （无） | （无） | data-kiosk-component=page-frame |
| /campus | /campus | /campus | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /campus/welcome | /campus/welcome | /campus/welcome | （无） | （无） | data-kiosk-component=page-frame |
| /campus/freshman-insights | /campus/freshman-insights | /campus/freshman-insights | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /toolbox | /toolbox | /toolbox | （无） | （无） | data-kiosk-component=page-frame |
| /smart-campus | /smart-campus | /smart-campus | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /smart-campus/welcome | /smart-campus/welcome | /smart-campus/welcome | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /smart-campus/freshman-insights | /smart-campus/freshman-insights | /smart-campus/freshman-insights | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /smart-campus/service/:key | /smart-campus/service/campus-card | /smart-campus/service/campus-card | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /resume | /resume | /resume/source | （无） | （无） | data-kiosk-component=page-frame |
| /resume/upload | /resume/upload | /resume/source | （无） | （无） | data-kiosk-component=page-frame |
| /resume/source | /resume/source | /resume/source | （无） | （无） | data-kiosk-component=page-frame |
| /resume/generate | /resume/generate | /resume/generate | （无） | （无） | data-kiosk-component=page-frame |
| /resume/parse | /resume/parse | /resume/parse | （无） | （无） | data-kiosk-component=page-frame |
| /resume/templates | /resume/templates | /resume/templates | （无） | （无） | data-kiosk-component=page-frame |
| /resume/materials | /resume/materials | /resume/materials | （无） | （无） | data-kiosk-component=page-frame |
| /resume-service | /resume-service | /resume-service | （无） | （无） | v6-runtime-shell + data-kiosk-component=page-frame |
| /jobs-service | /jobs-service | /jobs-service | （无） | （无） | v6-runtime-shell + data-kiosk-component=page-frame |
| /job-fairs | /job-fairs | /job-fairs | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /job-fairs/checkin | /job-fairs/checkin | /job-fairs/checkin | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /job-fairs/:id | /job-fairs/fair-001 | /job-fairs/fair-001 | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /job-fairs/:id/companies | /job-fairs/fair-001/companies | /job-fairs/fair-001/companies | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /fairs-service | /fairs-service | /fairs-service | （无） | （无） | v6-runtime-shell + data-kiosk-component=page-frame |
| /job-fairs/:id/map | /job-fairs/fair-001/map | /job-fairs/fair-001/map | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /job-fairs/:id/materials | /job-fairs/fair-001/materials | /job-fairs/fair-001/materials | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /job-fairs/:id/visit-plan | /job-fairs/fair-001/visit-plan | /job-fairs/fair-001/visit-plan | （无） | （无） | data-kiosk-component=page-frame + w4-page-frame |
| /job-fairs/:id/stats | /job-fairs/fair-001/stats | /job-fairs/fair-001/stats | （无） | （无） | 无上述标记 |
| /resume/self-assessment/intro | /resume/self-assessment/intro | /resume/self-assessment/intro | （无） | （无） | data-kiosk-component=page-frame |
| /resume/self-assessment/questions | /resume/self-assessment/questions | /resume/self-assessment/questions | （无） | （无） | data-kiosk-component=page-frame |
| /resume/self-assessment/result | /resume/self-assessment/result | /resume/self-assessment/result | （无） | （无） | data-kiosk-component=page-frame |
| /resume/self-assessment/history | /resume/self-assessment/history | /resume/self-assessment/history | （无） | （无） | data-kiosk-component=page-frame |
| /interview-service | /interview-service | /interview-service | （无） | （无） | v6-runtime-shell + data-kiosk-component=page-frame |
| /contract-review | /contract-review | / | （无） | （无） | data-qx-frame |
| /contract-review/processing | /contract-review/processing | / | （无） | （无） | data-qx-frame |
| /contract-review/result | /contract-review/result | / | （无） | （无） | data-qx-frame |
| /policy-service | /policy-service | /policy-service | （无） | （无） | v6-runtime-shell + data-kiosk-component=page-frame |

## 壳不是新壳的

判据（只描述怎么数，不是结论）：落地页没有 `[data-qx-frame="true"]`。其它标记原样记下（`v6-runtime-shell` / `data-kiosk-component=page-frame` / `w4-page-frame`）。

共 52 条。

| 模式 | 请求 pathname | 落地 pathname | 实测壳标记 | 主标题 |
|---|---|---|---|---|
| /member/qr-login | /member/qr-login | /member/qr-login | 无上述标记 | 就业服务大厅 · 当前一体机 |
| /upload/phone | /upload/phone | /upload/phone | 无上述标记 | （无） |
| /legal/:doc | /legal/privacy | /legal/privacy | data-kiosk-component=page-frame | 隐私政策 |
| /resume/job-fit | /resume/job-fit | /resume/job-fit | data-kiosk-component=page-frame | （无） |
| /resume/job-fit/actions | /resume/job-fit/actions | /resume/job-fit/actions | data-kiosk-component=page-frame | （无） |
| /resume/career-plan | /resume/career-plan | /resume/career-plan | data-kiosk-component=page-frame | 先准备简历，再看四栏方案 |
| /interview/setup | /interview/setup | /interview/setup | data-kiosk-component=page-frame | 模拟面试 |
| /interview/session | /interview/session | /interview/session | data-kiosk-component=page-frame | 会话已失效，请重新开始 |
| /interview/report | /interview/report | /interview/report | data-kiosk-component=page-frame | （无） |
| /interview/tips | /interview/tips | /interview/tips | data-kiosk-component=page-frame | 面试技巧 |
| /interview/reports | /interview/reports | /interview/reports | data-kiosk-component=page-frame | 面试报告 |
| /error-offline | /error-offline | /error-offline | 无上述标记 | 网络连接中断 |
| /assistant | /assistant | /assistant | data-kiosk-component=page-frame | AI顾问 |
| /me/print-orders | /me/print-orders | /me/print-orders | data-kiosk-component=page-frame | 打印订单 |
| /me/documents | /me/documents | /me/documents | data-kiosk-component=page-frame | 我的文档 |
| /me/settings | /me/settings | /me/settings | data-kiosk-component=page-frame | 账号设置 |
| /help | /help | /help | data-kiosk-component=page-frame | 帮助中心 |
| /activities | /activities | /activities | data-kiosk-component=page-frame | 权益活动 |
| /activities/:id | /activities/activity-001 | /activities/activity-001 | data-kiosk-component=page-frame | 权益活动详情 |
| /renshi | /renshi | /renshi | data-kiosk-component=page-frame | 政策服务 |
| /campus | /campus | /campus | data-kiosk-component=page-frame + w4-page-frame | 校园招聘专区 |
| /campus/welcome | /campus/welcome | /campus/welcome | data-kiosk-component=page-frame | 校园招聘迎新指引 |
| /campus/freshman-insights | /campus/freshman-insights | /campus/freshman-insights | data-kiosk-component=page-frame + w4-page-frame | 校园招聘数据 |
| /toolbox | /toolbox | /toolbox | data-kiosk-component=page-frame | 百宝箱 |
| /smart-campus | /smart-campus | /smart-campus | data-kiosk-component=page-frame + w4-page-frame | 智慧校园 |
| /smart-campus/welcome | /smart-campus/welcome | /smart-campus/welcome | data-kiosk-component=page-frame + w4-page-frame | 迎新指引 |
| /smart-campus/freshman-insights | /smart-campus/freshman-insights | /smart-campus/freshman-insights | data-kiosk-component=page-frame + w4-page-frame | 迎新服务导览 |
| /smart-campus/service/:key | /smart-campus/service/campus-card | /smart-campus/service/campus-card | data-kiosk-component=page-frame + w4-page-frame | 校园卡办理 |
| /resume | /resume | /resume/source | data-kiosk-component=page-frame | AI 简历诊断 |
| /resume/upload | /resume/upload | /resume/source | data-kiosk-component=page-frame | AI 简历诊断 |
| /resume/source | /resume/source | /resume/source | data-kiosk-component=page-frame | AI 简历诊断 |
| /resume/generate | /resume/generate | /resume/generate | data-kiosk-component=page-frame | AI 简历生成 |
| /resume/parse | /resume/parse | /resume/parse | data-kiosk-component=page-frame | 未找到简历文件 |
| /resume/templates | /resume/templates | /resume/templates | data-kiosk-component=page-frame | 简历素材库 |
| /resume/materials | /resume/materials | /resume/materials | data-kiosk-component=page-frame | 求职材料库 |
| /resume-service | /resume-service | /resume-service | v6-runtime-shell + data-kiosk-component=page-frame | AI简历服务 |
| /jobs-service | /jobs-service | /jobs-service | v6-runtime-shell + data-kiosk-component=page-frame | 岗位信息 |
| /job-fairs | /job-fairs | /job-fairs | data-kiosk-component=page-frame + w4-page-frame | 招聘会 |
| /job-fairs/checkin | /job-fairs/checkin | /job-fairs/checkin | data-kiosk-component=page-frame + w4-page-frame | 来源平台入场入口 |
| /job-fairs/:id | /job-fairs/fair-001 | /job-fairs/fair-001 | data-kiosk-component=page-frame + w4-page-frame | 2026 青岛高校毕业生招聘会 |
| /job-fairs/:id/companies | /job-fairs/fair-001/companies | /job-fairs/fair-001/companies | data-kiosk-component=page-frame + w4-page-frame | 参会企业 |
| /fairs-service | /fairs-service | /fairs-service | v6-runtime-shell + data-kiosk-component=page-frame | 招聘会信息 |
| /job-fairs/:id/map | /job-fairs/fair-001/map | /job-fairs/fair-001/map | data-kiosk-component=page-frame + w4-page-frame | 场馆导览 |
| /job-fairs/:id/materials | /job-fairs/fair-001/materials | /job-fairs/fair-001/materials | data-kiosk-component=page-frame + w4-page-frame | 活动资料 |
| /job-fairs/:id/visit-plan | /job-fairs/fair-001/visit-plan | /job-fairs/fair-001/visit-plan | data-kiosk-component=page-frame + w4-page-frame | AI参会准备单 |
| /job-fairs/:id/stats | /job-fairs/fair-001/stats | /job-fairs/fair-001/stats | 无上述标记 | （无） |
| /resume/self-assessment/intro | /resume/self-assessment/intro | /resume/self-assessment/intro | data-kiosk-component=page-frame | 自我探索 · 倾向参考 |
| /resume/self-assessment/questions | /resume/self-assessment/questions | /resume/self-assessment/questions | data-kiosk-component=page-frame | 自我探索 · 倾向参考 |
| /resume/self-assessment/result | /resume/self-assessment/result | /resume/self-assessment/result | data-kiosk-component=page-frame | 自我探索 · 倾向参考 |
| /resume/self-assessment/history | /resume/self-assessment/history | /resume/self-assessment/history | data-kiosk-component=page-frame | 自我探索 · 倾向参考 |
| /interview-service | /interview-service | /interview-service | v6-runtime-shell + data-kiosk-component=page-frame | AI面试训练 |
| /policy-service | /policy-service | /policy-service | v6-runtime-shell + data-kiosk-component=page-frame | 政策服务 |
