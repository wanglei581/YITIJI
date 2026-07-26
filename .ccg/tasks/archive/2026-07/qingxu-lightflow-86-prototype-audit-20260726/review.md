# 审查与验证记录

## 基线结论

- 原型站点是 Kiosk 单端证据；历史 86 路径口径漏掉后来加入的 `/me/privacy-requests`。
- 最新主线 Kiosk 为 87 条 URL pattern：82 个页面组件落点 + 5 个重定向。
- 主线已合入大部分迁移与 stage-fit，本批只收口权益活动详情、法务文档、百宝箱专区三个共享壳层缺口。
- Cursor PR #371 / `7da74dfb` 冲突且 CI 失败，未 cherry-pick；只读提取其可复核的视觉意图。
- Kiosk 保持 LightFlow；Admin/Partner 保持 Inkpaper；未修改受保护的 `/me/*` 生产文件。

## TDD

- 静态 RED：`verify:fusion-w5` 因 Benefit 缺少 `KioskPageFrame` 失败；`verify:lightflow-k1-public-entry` 因 Legal 缺少共享 Frame/Header/返回合同失败。无无关基线失败。
- 三页实现后静态 GREEN；真实 API、加载/空态/错误/重试、登录/权限、禁用、返回、外链/二维码与合规语义保留。
- 独立审查首次发现 Legal 在 390×844 的标题宽度归零/控件重叠、移动覆盖缺失，以及 Toolbox 空态选择器错误。
- 新增 Legal `@w5-mobile` 浏览器合同后先取得预期 RED，再以页面专用窄屏布局修复到 GREEN；Toolbox 断言改为真实 `.tb-tile`。

## 审查

- 内部独立终审：`APPROVE`，Critical=0、Warning=0。复核实测 390×700/390×844 长文内部滚动、无横向溢出、无页头控件重叠、所有按钮不小于 52px。
- Claude 最终终审：`APPROVE`，Critical=0；其关于 390×700 自动化/人工证据区分及标题与工具区重叠断言的两项非阻塞 Warning 已在提交前补强。另有共享 Frame 内建页头与 `KioskPageHeader` 两套 API 并存的设计系统统一建议，不在本批扩范围。
- Antigravity 已重新授权并多次调用，但 Google Code Assist 返回地区限制或接口 timeout/EOF，没有生成有效模型报告；此结果不计为 APPROVE。

## 本地验证

- Kiosk typecheck、lint（0 error，4 条既有 Fast Refresh warning）、生产 build：PASS。
- Admin/Partner typecheck、lint、HTTP production build：PASS；shared/ui typecheck 与 UI fusion foundation：PASS。
- 新增静态 verify 与 Kiosk fusion shell/home/W2–W6/baseline/visual-unity：PASS；baseline lines 97.91%、branches 92.09%、functions 100%。
- W5 浏览器 18/18 PASS；W6 route surface 87/87 PASS；完整 `test:browser:fusion` PASS。
- 真实浏览器覆盖 1080×1920、390×844、390×700、1440×1024、1280×800、1024×768；未发现横向溢出。
- `git diff --check`：PASS。

以上仅为本地代码、构建与浏览器证据，不代表预生产、Windows 真机、打印/扫描、支付、短信、TRTC 或法务验收。
