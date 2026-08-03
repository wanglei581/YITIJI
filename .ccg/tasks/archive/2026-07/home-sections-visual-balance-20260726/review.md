# 首页招聘会与打印扫描视觉平衡终审

日期：2026-07-26
范围：`2f57ee41^..27117c67`
结论：`APPROVE`（Critical=0，Warning=0）

## 审查参与

- 内部规格审查：Critical=0，Warning=0。
- 内部代码质量审查：Critical=0，Warning=0。
- Antigravity reviewer：99/100，Critical=0，Warning=0，`APPROVE`。
- Claude reviewer：Critical=0，Warning=0，`APPROVE`。

## 审查纠偏

1. 首轮发现手机仍被 1080×1920 舞台缩小，物理触控目标不足；改为首页响应态关闭舞台缩放，但保持 host/scaler/stage DOM 同构。
2. 首轮发现禁用态继承 `opacity: .55` 导致文字对比度不足；移动首页改为不透明中性禁用态。
3. 连续断点审查发现 421–760px 与手机横屏回退；关键移动规则迁到 `.kiosk-home-mobile`，补齐横屏条件。
4. 规格审查发现打印扫描五卡 70/80px 不等高；统一为 80px。
5. 质量审查发现 932×430 旋转态未覆盖、reduced-motion 漏掉分组标题和继续任务按钮；均通过独立 RED→GREEN 批次修复。
6. Claude 终审发现固定 `height <= 760` 可能受移动浏览器地址栏高度变化影响；横屏条件改为 `width <= 960 && width > height`，并锁定 932×800 mobile、800×932 staged。

## 最终验证证据

- 浏览器：390×844、390×700、430×932、760×1024、844×390、932×430、932×800、800×932、1024×768、1080×1920。
- 移动壳：stage fit `off`、`transform:none`、打印扫描五卡 80px；staged 壳：1024×768 scale=0.4、1080×1920 scale=1。
- 旋转：390×844 → 844×390 → 390×844，`main.scrollTop=1367.5` 保持。
- 入口：招聘会 3 项、打印扫描 3 个可用入口进入原路由；2 个 disabled 入口不跳转。
- 首页真实内容：百宝箱、智慧校园、合规提示保留。
- 静态门禁：首页窄屏、首页原型、fusion home、fusion shell、active nav、视觉统一、百宝箱、智慧校园全部通过。
- 工程门禁：Kiosk typecheck 通过；lint 0 error、4 条既有 Fast Refresh warning；显式生产环境 build 通过；`git diff --check` 通过。

## 非阻断 Info

- `KioskShell` 与 `KioskStageFit` 各调用一次 `useKioskStageFit`，存在重复视口监听的可选性能去重空间；当前无卡顿、功能或视觉回归证据，不扩展本批范围。
- 本地浏览器、静态门禁和生产构建只证明本地候选质量，不代表预生产、Windows 真机、打印机或扫描仪验收完成。
