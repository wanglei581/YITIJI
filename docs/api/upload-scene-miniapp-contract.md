# 扫码上传与扫码登录：一体机屏上的码直达小程序

产品负责人 2026-09-08：「能不能通过微信扫码直接打开小程序，而不是一个网页」
「最后整个项目操作和小程序都是相关联的」。
2026-10-28 晚：「小程序当前的状态和问题，也要和一体机整套系统进行适配和打通……
而不是扫码出现一个单独的页面进行上传文件」。

## 现行做法（2026-10-29 起）

一体机屏上的手机码改成**普通链接、短码放在路径里**，用微信「扫普通链接二维码打开小程序」规则直达小程序；
同一张码用别的软件扫、或规则还没生效（小程序未发布）时，打开的是一体机网页，照样能传、能用短信确认登录。

| 用途 | 码的内容 | 微信规则（公众平台「开发管理 → 开发设置 → 扫普通链接二维码打开小程序」） | 网页兜底 |
|---|---|---|---|
| 传文件 | `https://<公网域名>/k/u/<sceneToken>` | `https://zyidai.cn/k/u/` → `pages/kiosk-send/kiosk-send` | `/k/u/:scene` 兑换后 replace 到 `/upload/phone#sessionId=…&token=…&purpose=…` |
| 扫码登录 | `https://<公网域名>/k/l/<ticketId>` | `https://zyidai.cn/k/l/` → `pages/kiosk-login/kiosk-login` | `/k/l/:ticketId` replace 到 `/member/qr-login?ticketId=…` |

- 为什么放路径不放 `#` 后面：官方规则只写了路径前缀匹配（规则以 `/` 结尾才匹配子路径）和 `?` 参数前缀匹配，
  没提 `#`；官方例子本身就是「业务参数放路径里」。码也从约 130 字符缩到约 45 字符，屏上更好扫。
- 进小程序后整条码在 `options.q`，`decodeURIComponent` 一次后交给 `apps/miniapp/utils/kiosk-qr.js` 认码型
  （新旧四种：`/k/u/`、`/k/l/`、旧网页码 `#sessionId=&token=`、旧登录码 `?ticketId=`）。两页互认对方的码，
  规则配错页也能走通。热启动时微信按 path「autoReLaunch」到对应页（官方《运行机制》），onLoad 照走。
- 一体机出码：`apps/kiosk/src/services/api/uploadSessions.ts` 的 `buildPhoneUploadQrUrl`（回执带合格场景码才出短链，
  旧后端回落长链）、`services/auth/memberQrLoginApi.ts` 的 `buildQrLoginUrl`。网页中转页
  `apps/kiosk/src/pages/upload/KioskCodeEntryPage.tsx`，现有两张手机页不改。
- 屏上说法：`apps/kiosk/src/copy/miniappLinkCopy.ts`（扫码说明只在后台「小程序已发布」开关为真时出现）。

### 规则上线顺序（产品负责人在微信公众平台做）

1. 小程序提审通过并**发布**（官方：小程序必须先发布代码才可以发布规则）。
2. 加上表两条规则，下载校验文件，放到 `https://zyidai.cn/k/u/<文件名>` 和 `https://zyidai.cn/k/l/<文件名>`
   （校验文件放在规则网址最后一级子目录下）。放法二选一：运维在 nginx 加 `location = /k/u/<文件名>` 精确返回；
   或把文件放进 `apps/kiosk/public/k/u/`、`apps/kiosk/public/k/l/` 随一体机前端发布。放好后
   `curl -i https://zyidai.cn/k/u/<文件名>` 核：200、`text/plain`、正文就是那串校验码（文件缺了 nginx 会回落 index.html，
   也是 200，所以一定看正文）。
3. 发布前的测试：每条规则最多 5 个测试链接、要填完整网址，只有管理员 / 开发者 / 体验成员扫到**一模一样**的链接才跳。
   一体机每次出的码都不同，所以发布前只能用固定测试链接验「扫了能跳进小程序这一页」（进页后显示「二维码已失效」
   是预期）；整条链用开发者工具以 `q=` 参数模拟入口验。
4. 小程序发布后点「发布」规则；真机扫一体机屏上的码确认直达小程序之后，再在管理员后台打开「小程序已发布」开关
   （一体机屏上的说法跟着换）。顺序不能反：开关先开、规则没生效，屏上说「打开小程序」却打开网页。

## 接口

### 兑换场景码

```
POST /api/v1/upload-sessions/scene/resolve
Content-Type: application/json

{ "scene": "SNtynYMXmy7P4MSNE8uMi-yL" }
```

成功 201（Nest `@Post` 默认）：

```json
{ "success": true, "data": {
  "sessionId": "3b11df71204546f987edf95409cefa49",
  "purpose": "print_doc",
  "mode": "temporary",
  "expiresAt": "2026-09-08T14:34:32.740Z",
  "uploadToken": "…"
}}
```

拿到 `uploadToken` 后两条路递文件，回执同形（`status=uploaded`、`file.fileId`、`sessionId`、`purpose`）：

```
POST /api/v1/upload-sessions/:sessionId/files          （手机里的文件，免登录）
form-data: uploadToken=<上一步的 uploadToken>, file=<文件>

POST /api/v1/upload-sessions/:sessionId/member-file    （小程序会员「我的文档」里已有的文件，要会员登录）
{ "uploadToken": "<上一步的 uploadToken>", "fileId": "<我的文档里的文件 id>" }
```

### 五条必须知道的行为

1. **会话有效期内可重复兑换（2026-10-29 起）。** 会话还在等文件（pending）时，同一张码可以
   兑换多次，每次拿到**同一把** `uploadToken`（服务端用 `FILE_SIGNING_SECRET` 从 sessionId + scene 派生，仍只存哈希）。
   原因：同一张码可能先被网页兑换、再被小程序兑换，或同一人重扫，一次性兑换会让码当场变死码；
   线上网页码本来就把 uploadToken 明文放在码里，可重复兑换并不降低安全等级。
   几个人拿到同一把令牌时，谁先上传成功会话就收下谁的那份，其余人再传是
   `UPLOAD_SESSION_NOT_PENDING`（第一份还在落地、正持锁时，后来者可能先拿到 `UPLOAD_SESSION_UPLOAD_IN_PROGRESS`）；
   会话一旦收到文件、一体机确认、过期或作废，再兑换就是 `UPLOAD_SCENE_UNUSABLE`。
   「能上传」的准确条件是：会话还没收下文件——pending，或上一次上传中断、停在 uploading 且没有收据（可续传）。
   兑换的只读快路径不加锁：可能读到 pending 后会话才变成 uploaded，这时照样回出令牌，但上传要重新拿锁、重读状态，
   拿这把令牌再传只会得到 `UPLOAD_SESSION_NOT_PENDING`，不能换掉已收下的那份（verify-upload-scene 有受控交错用例）。
2. **第一次兑换会换掉创建会话时发给一体机的 `uploadToken`。** 那把令牌在第一次兑换后作废
   （一体机自己从不用它上传；还带着它的旧网页二维码也随之失效）。之后再兑换不再改令牌。
3. **失败对外是同一个错误码。** 格式错 / 查无此码 / 会话已收到文件、已过期或已作废，
   都是 `UPLOAD_SCENE_UNUSABLE`（服务端 message 是「二维码已失效，请回到一体机重新生成」；两端页面不显示它，统一显示「二维码已失效或已使用，请回到一体机刷新二维码。」）。
   区分原因对用户没有价值，对探测者却是一台预言机。例外照实写：超过 32 字符的 scene 在 DTO 层就回校验错误；
   Redis 或密钥故障是服务端错误（5xx）；同一单正被另一个请求写（第一次兑换或正在上传）时，已经兑换过的码走只读路径
   直接拿到令牌，第一次兑换会有界重试约 2 秒再取锁，仍取不到才回 `UPLOAD_SCENE_UNUSABLE`。
   **客户端不按原因分支**：`UPLOAD_SCENE_UNUSABLE` 不给重试；没回应、超时、429、5xx 可以给「重试」再兑换一次。
4. **兑换不返回 `controlToken`。** 那是一体机侧的控制凭据（查状态、取消会话），手机端拿不到也不该拿到。
5. **`member-file` 只收本人「我的文档」里列得出的文件**，与 `GET /me/documents` 同一套资格（合同审查会话专用文件、
   签名图等不在列表里的一律同一个 404 `FILE_NOT_FOUND`，不回显 fileId）；落进这一单的是匿名副本，会话作废、过期只删副本。
   一体机登录着另一个会员（会话 mode=member 且会员不是本人）时读文件之前就拒：403 `UPLOAD_SESSION_MEMBER_MISMATCH`，
   免得别人的文件在一体机确认后归档进当前登录者的文件库。超过 10MB：400 `FILE_TOO_LARGE`。

### 旁人拍码抢传：风险与防线（触屏版总指挥 10/29 要求写明）

大厅里人多、无人值守，屏上的码可能被旁人拍下。可重复兑换后，旁人在这单等文件期间也能往里传（现网网页码本来如此）。防线：
① 只有 pending 时能兑换和上传，一张码只收一份；② 一体机「已收到」屏显示文件名和大小，本人在一体机上确认后才进入后续流程，
不是自己的可以取消。来源（会话状态 `file.source`：`miniapp_documents` / `miniapp` / `web`，按入口和微信小程序固定的
Referer 判定，只作提示、可被伪造）与「不是你传的文件？请点『取消』，再重新扫码。」由 `miniappLinkCopy.ts` 的
`uploadedFileSourceLine`、`notYourFileHint` 给出，面板里的显示由触屏版第四包接（2026-10-29 时 main 上的面板还没显示这两行）；
③ 兑换、两种上传都按来访 IP 每分钟 20 次限流，场景码 144 位随机；④ 会话 10 分钟过期。
说明两点：场景码放在路径里，会出现在反代访问日志里（旧网页码的令牌在 `#` 后面，不进日志），但它只在这单等文件的 10 分钟内有用；
限流按真实来访 IP 计取决于部署的反代可信跳数（`TRUST_PROXY_HOPS` 一类配置），上线前要在实际反代后核一次。

## 旧的小程序码入口（保留，不再是主路）

服务端出码 `POST /api/v1/miniapp/code`（`getwxacodeunlimit`）与小程序读 `options.scene` 仍可用。
`scene` 上限 32 个可见字符，所以码里只能带一个短的不透明凭据，由服务端换回会话；也不能直接拿 sessionId 当 scene
（sessionId 会出现在日志、监控里，一旦同时是上传凭据，历史日志会追溯性地变成凭据泄露）。
小程序码只对已发布版本有效，未发布时微信回 `errcode 41030`（2026-09-08 实测）；它对别的扫码软件也没有出路，
所以一体机改走普通链接码（上一节），不展示小程序码。

## 验证

- `pnpm --filter @ai-job-print/api verify:upload-scene`（真实 Redis；没有 `REDIS_URL` 时退到进程内 RESP 桩）。
- `pnpm --filter @ai-job-print/api verify:upload-sessions`（含 `verify-upload-sessions-member-file.ts`）。
- 小程序：`apps/miniapp` 的 `verify:page-lifecycle`（kiosk-qr、kiosk-login-confirm、kiosk-send-receipt、kiosk-send-docs）。
- 一体机：`verify:kiosk-support-contact`（kiosk-code-link、miniapp-link-copy）、浏览器用例 `tests/visual/kiosk-code-entry-fusion-w5.spec.ts`。

## #974 实施时确认的三条（写进来免得下一个人重踩）

1. **`UPLOAD_SCENE_UNUSABLE` 不要给「重试」按钮。** 它说明会话已收到文件、过期、作废或码不对，
   重试必然再失败一次，只会让用户以为是网络抖动。此时唯一有效的动作是回一体机刷新二维码。
   （2026-10-29 起兑换可重复：请求没拿到响应的网络失败，重新兑换是安全的，同一张码换回的还是同一把令牌。）
2. **小程序内扫码（相机）走的是另一条入口。** `kiosk-login` 扫到的可能是登录码，也可能是上传码，
   要按码型分流（现由 `utils/kiosk-qr.js` 统一认）。
3. **旧网页上传码的参数在 fragment 里，不是 query。** 一体机旧版 `buildPhoneUploadUrl` 用的是 `url.hash`
   （`#sessionId=..&token=..`），用 `[?&]` 匹配不到；新码把短码放在路径里，避开了这个问题。
