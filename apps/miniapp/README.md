# 职易达微信小程序

`apps/miniapp/` 是主项目唯一正式小程序源码。当前为原生微信小程序 `1.0.2` 收口候选，固定四个 Tab：

> 仓库外旧副本、临时导出目录和 `.worktrees/` 的外层目录都不是发布入口。Git worktree 只用于隔离分支，其内部仍以 `apps/miniapp/` 为固定工程路径。

- 首页
- AI百宝箱
- 求职
- 我的

## 当前真实能力

- 微信手机号一键登录与短信验证码降级登录
- 当前生效服务协议、隐私政策与一体机二维码登录确认
- 岗位、招聘会、企业、政策公开浏览（无数据时显示真实空态）
- 简历上传、解析、诊断、优化、岗位匹配、职业规划与模拟面试
- 本人简历、文档、AI 记录、打印订单、权益与通知读取
- 服务端打印价目和公开终端读取
- Order-only 待到机订单、10 位取件码和本地二维码展示（当前分支候选，尚未发布或真机验收）

材料包仍未完成；到机码核销和机端支付虽有本地代码候选，但未完成同一候选的受控发布、Windows 实际扫码器、支付和奔图出纸验收，不得宣称已上线。证件照、链接分析、静态会员套餐、模拟简历生成、扫码续传等没有后端闭环的入口未注册。

## 目录职责

| 目录 / 文件 | 唯一职责 | 允许依赖 |
|---|---|---|
| `app.js` / `app.json` / `app.wxss` | 应用生命周期、全局路由、全局样式 | `utils/`（如确有需要） |
| `custom-tab-bar/` | 四个一级 Tab 导航 | 已注册 Tab 路由 |
| `pages/<feature>/` | 单个页面功能，固定同名 `js/json/wxml/wxss` 四件套 | 本页目录、`utils/` |
| `utils/` | 跨页公共模块与纯函数 | 只能依赖 `utils/` |
| `scripts/` | 本地/CI 静态门禁 | 只读源码，不参与运行时打包 |
| `project.config.json` | 可入库的微信工程配置 | 不存放密钥或个人测试参数 |

`project.private.config.json` 只是微信开发者工具在本机生成的状态，已忽略，不属于正式源码。

## 功能与依赖地图

| 功能域 | 页面目录 | 直接公共依赖 |
|---|---|---|
| 入口与导航 | `home`、`ai`、`jobs`、`me`、`custom-tab-bar` | `auth`，其余通过注册路由跳转 |
| 登录与法务 | `launch`、`legal`、`privacy`、`settings`、`about`、`help` | `api` → `request`，`auth` → `storage` |
| AI 助手与记录 | `assistant`、`ai-records` | `api`、`storage` |
| 简历主链 | `resume-upload` → `resume-parse` → `resume-diagnose` → `resume-optimize` | `api`、`storage`、`normalize` |
| 岗位匹配与职业规划 | `job-fit`、`career-plan` | `api`、`auth`、`storage`、`normalize` |
| 模拟面试 | `interview-entry` → `interview-qa` → `interview-result` | `api`、`storage` |
| 公开信息 | `jobs`、`job-detail`、`companies`、`company-detail`、`fairs`、`fair-detail`、`policies`、`policy-detail` | `api`、`history`、`favorites` |
| 打印建单 | `print`、`documents`、`print-upload`、`print-preview`、`print-store`、`print-pay` | `api`、`auth`、`print-pricing` |
| 到机取件 | `orders` → `print-pickup` | `api`、`auth`、`pickup-qrcode`（纯本地编码） |
| 一体机协同 | `kiosk-login`、`usb-import` | `api`、`auth`；硬件执行属于 `apps/terminal-agent` |
| 本人资产 | `resumes`、`documents`、`orders`、`notifications`、`favorites`、`browse-history`、`membership` | `api`、`auth`、`storage`、`history`、`favorites` |

公共模块的依赖方向：

```text
api → request → config + storage
api → config + mock-data + normalize
auth / favorites / history → storage
normalize / print-pricing / pickup-qrcode / storage / config / mock-data → 无内部依赖
```

页面之间不相互 `require`；共享逻辑进 `utils/`，跨页跳转只使用 `app.json` 已注册路由。当前运行时为零 npm 第三方依赖；如需新增，必须同时更新 `package.json`、本表和微信构建验证，不得把第三方源码散落复制到页面目录。`utils/pickup-qrcode.js` 中经改编的 QR 编码核心已在文件头完整保留 MIT 许可和归属，不是未登记的 npm 依赖。

## 跨端边界

```text
小程序 pages → utils/api → utils/request → https://zyidai.cn/api/v1
                                                    ↓
                                              services/api
                                                    ↓
                                    订单 / 取件码 / 打印任务
                                                    ↓
                    apps/kiosk 现场核销 → apps/terminal-agent 本机硬件执行
```

- 小程序不直连数据库、打印机、扫码器或 Terminal Agent；所有业务请求经 `utils/api` 门面和服务端 API。
- Kiosk 负责现场交互与核销，Terminal Agent 负责 Windows 本机硬件；硬件逻辑不复制到小程序。
- 取件二维码仅是后端 10 位取件码的本地图形编码，不是新订单、新令牌或云端二维码服务。

## 本地打开

微信开发者工具 → 导入项目 → 只选择本目录 `apps/miniapp`。

- 仓库内 `project.config.json` 使用已注册的正式 AppID；AppID 是公开工程标识，秘钥和私有配置仍严禁入库。
- 正式发布前须在微信公众平台配置 `https://zyidai.cn` 的 request/uploadFile/downloadFile 合法域名。
- 不使用微信云开发；API 统一走 `utils/request.js` 和 `utils/api.js`。

## 离线门禁

```bash
pnpm --dir apps/miniapp verify:static
```

门禁覆盖 JSON、43 个注册页面四件套、目录分类、依赖方向/循环依赖、发布包排除脚本、四 Tab、路由、JavaScript 语法、CommonJS 导入、事件处理器、dataset、图标、微信/短信登录、真实退出、合规文案、取件二维码、mock 默认关闭和密钥残留。

自 2026-09-02 起，`verify:static` 末尾追加 `verify-miniapp-api-contract.mjs`（见下节）。

## 小程序 lane 独立作业协议

小程序和主仓其他功能长期并行开发。这一节规定两条 lane 怎么共处，**它约束的是所有 lane，不只是小程序 lane**。

### 为什么需要它

小程序是原生 JavaScript，跨 `apps/miniapp` → `services/api` 的 91 个调用**没有任何类型检查**。
别的 lane 在 `services/api` 里改名、挪走或删掉一个路由时，小程序不会编译失败——
它会在用户手里静默 404。口头约定挡不住这个，所以做成了门禁。

### 作业位置

| | 位置 |
|---|---|
| 小程序 lane 工作区 | `/Users/wanglei/AI求职打印服务终端-miniapp`（worktree，分支 `claude/miniapp-lane`） |
| 微信开发者工具指向 | 上面那个 worktree 的 `apps/miniapp` |
| 主 checkout | **小程序 lane 一律不碰**，包括不切分支、不 stash、不提交 |

主 checkout 长期跑着别的任务且带大量未提交改动；在那里动小程序等于直接踩对方的在制品。

### 文件归属

| 路径 | 归属 | 规则 |
|---|---|---|
| `apps/miniapp/**` | 小程序 lane 独占 | 其他 lane 需要改动时，先确认没有跨端在制品 |
| `services/api/src/**` | 共享 | 小程序 lane **只加不改**：可以新增端点，不得改动既有端点的路径、方法或响应形状 |
| `packages/shared/**` | 共享 | 同上，只加不改 |
| `apps/kiosk/**` | 其他 lane 为主 | 小程序 lane 只在到机码核销这条跨端链上参与 |
| `docs/progress/*.md` | 共享，冲突高发 | 小程序 lane 只在专属小节**末尾追加**，不重排全文；对方有未提交改动时直接跳过，改在本 README 记录 |
| `.github/workflows/**` | 共享，风险最高 | 小程序 lane 默认不改。坏 YAML 会让所有在跑的 PR 一起变红（CLAUDE.md §14.0）；确需改动时单独提 PR 并先跑 `pnpm verify:repository-integrity` |

小程序侧的门禁全部挂在 `apps/miniapp/package.json` 的 `verify:static` 链上，
CI 已经在跑这条链，**因此新增小程序门禁不需要动 `ci.yml`**。

### 契约门禁

```bash
pnpm --dir apps/miniapp verify:api-contract   # 校验
pnpm --dir apps/miniapp contract:update       # 小程序新增调用后重新生成快照
```

`scripts/verify-miniapp-api-contract.mjs` 从 `utils/api.js` 抽出小程序真实发起的
`(method, path)`，从 `services/api/src` 的控制器装饰器算出后端真实提供的路由，
和 `scripts/api-contract.json` 快照比对，报四类问题：

| 类型 | 含义 | 谁该修 |
|---|---|---|
| `BROKEN` | 快照承诺可用、后端已无对应路由 | **改动 `services/api` 的那条 lane**——你拆了小程序 |
| `UNDECLARED` | 小程序新调了端点但没进快照 | 小程序 lane：跑 `contract:update`，并确认后端确实提供 |
| `STALE` | 后端已补上，豁免该删了 | 补上端点的那条 lane：跑 `contract:update` |
| `NOREASON` | 豁免没写真实原因 | 谁加的豁免谁写清楚 |

匹配按路径段进行，后端的参数段（`@Post(':scope/revoke')`）能命中小程序写死的
字面量段（`/me/ai-consents/job_ai/revoke`）；小程序传变量的段只能命中后端同样是
参数的段。三种破坏（`BROKEN` / `UNDECLARED` / `STALE`）都做过反向测试，确认能红。

`knownMissing` 是已知缺口豁免，**每条必须写清原因，不接受空理由**；后端一旦补上，
门禁会主动要求把豁免删掉，防止豁免长草。

微信开发者工具 Stable 2.01.2510290 已用正式 AppID 完成普通编译；本次取件页二维码和 10 位码已在模拟器正常渲染，控制台 0 error，仅有基础库 HarmonyOS 兼容提示。这不等于已上传、真机手机号能力通过或 M2 跨端打印闭环完成。

## 开发者工具自动化探针（`scripts/devtools-probe.mjs`）

**不是门禁**——需要开发者工具在本机运行，所以不进 CI、不挂 `verify:static` 链。
它是「人要看一眼」时的替代手段。

2026-09-03 这一轮用它抓出 **15 处版式缺陷，没有一处是 111 条静态门禁报的，
也没有一处目测能发现**。静态门禁覆盖逻辑、合规文案、数据契约；**能不能显示出来它一概不知道**。

```bash
# automator 是开发期工具，**不要装进 apps/miniapp**（dependencies 必须为空，有门禁盯着）
mkdir -p /tmp/mp && cd /tmp/mp && npm i miniprogram-automator

cd apps/miniapp
MP_AUTOMATOR=/tmp/mp/node_modules/miniprogram-automator \
  node scripts/devtools-probe.mjs \
    --route /pages/store-select/store-select \
    --data '{"loading":false,"stores":[...]}' \
    --measure '.actionbar .btn' \
    --canvas radar \
    --shot /tmp/a.png
```

`--measure` 会对每个盒子断言「右缘不超出视口」，超出即 **exit 1**；
`--canvas` 用 `getImageData` 数非空像素占比，几乎全空即 **exit 1**。

### 六个坑（都踩过，别再踩）

1. **`cli auto` 执行完就退出**，端口随之关闭 —— 必须和探针在同一进程里活着，分两次调用会连不上。
2. **`page.setData()` 挂死超时** —— 改用 `evaluate` 里 `getCurrentPages()` 拿实例再 setData。
3. **`screenshot()` 抓不到 canvas 原生层** —— WXML 能截、画布内容截不到。
   验画布用 `getImageData()`（机器可断言）或 `toDataURL()` 导出。
4. **`cli auto` 会附到已开着的窗口** —— IDE 里开着别的项目时，自动化连的是那个，
   路由全报 `getPageMetaByWebviewId is null`。看日志里的 `✔ Using AppID:` 确认。
5. **模拟器改不了宽度** —— 验窄屏规则的办法是临时把 `@media` 断点改宽、量完复原。
6. **注入要按页面真实的 data 形状** —— `self-explore` 的雷达读 `result.dims` 不是顶层 `dims`，
   灌错位置会静默不画，还以为是产品 bug。

### automator 的解析方式

它是 CommonJS（`main: ./out/index`，无扩展名），**ESM 裸 import 和 `NODE_PATH` 都解析不到**。
脚本内用 `createRequire` 走 CJS 解析，`MP_AUTOMATOR` 给安装目录即可。
