# 扫码上传：从网页二维码切到小程序码

产品负责人 2026-09-08：「能不能通过微信扫码直接打开小程序，而不是一个网页」
「最后整个项目操作和小程序都是相关联的」。

一体机原先的扫码上传二维码编的是**网页地址**，形如
`https://<host>/m/upload#sessionId=…&token=…`。用户扫出来落在网页上：
不是主入口、拿不到小程序里的登录态、也没法复用小程序已有的页面。

## 现在缺的是哪一块

| 环节 | 状态 |
|---|---|
| 生成小程序码（`getwxacodeunlimit`） | ✅ 已合入 main（#968，`POST /api/v1/miniapp-code`） |
| 场景码签发 + 兑换（服务端） | ✅ 本次合入 |
| 一体机改成展示小程序码 | ⬜ 待做（本人 lane） |
| **小程序读 `scene` 并兑换** | ⬜ **待做（小程序 lane）** —— 全仓当前零处理 `scene` |

小程序那一半没做完之前，一体机**不要**切成小程序码：扫进去会落在
`pages/print-upload/print-upload` 而参数被忽略，等于给用户一条走不通的路
（CLAUDE.md §9「不伪造能力」）。

## 为什么不能把 sessionId + token 直接塞进 scene

微信 `getwxacodeunlimit` 的 `scene` 上限 **32 个可见字符**。
`sessionId` 是 32 位 hex，`uploadToken` 是 43 字符 base64url —— 单是 sessionId
就已经用满。所以扫码只能带一个短的不透明凭据，由服务端换回会话。

也**不能**直接拿 sessionId 当 scene。sessionId 今天可以出现在日志、监控、
错误上下文里；一旦它同时是上传凭据，那些历史日志会**追溯性地**变成凭据泄露。

## 接口

### 兑换场景码

```
POST /api/v1/upload-sessions/scene/resolve
Content-Type: application/json

{ "scene": "SNtynYMXmy7P4MSNE8uMi-yL" }
```

成功 200：

```json
{ "success": true, "data": {
  "sessionId": "3b11df71204546f987edf95409cefa49",
  "purpose": "print_doc",
  "mode": "temporary",
  "expiresAt": "2026-09-08T14:34:32.740Z",
  "uploadToken": "…"
}}
```

拿到 `uploadToken` 后，上传走**既有**端点，不需要新接口：

```
POST /api/v1/upload-sessions/:sessionId/files
form-data: uploadToken=<上一步的 uploadToken>, file=<文件>
```

### 四条必须知道的行为

1. **一次性。** 兑换靠 Redis `GETDEL` 原子完成。同一张码第二次兑换返回
   `UPLOAD_SCENE_UNUSABLE`。二维码被拍照传播也只有第一个人能用。
2. **兑换会轮换 `uploadToken`。** 兑换成功的那一刻，一体机侧原先发出的
   网页二维码**当场失效**。这是刻意的：服务端只存令牌哈希，换不回创建时那把明文，
   于是顺势换一把新的。
3. **失败一律是同一个错误码。** 格式错 / 查无此码 / 会话已过期 / 已被兑换，
   对外都是 `UPLOAD_SCENE_UNUSABLE`，文案「二维码已失效，请回到一体机重新生成」。
   区分原因对用户没有价值（补救动作一样），对探测者却是一台预言机。
   **小程序端不要试图按原因分支**，只需引导用户回一体机刷新。
4. **兑换不返回 `controlToken`。** 那是一体机侧的控制凭据（查状态、取消会话），
   手机端拿不到也不该拿到。

## 小程序侧需要做什么

```js
// pages/print-upload/print-upload.js
onLoad(options) {
  // 扫小程序码进来时，微信把 scene 放在 options.scene，且是 URL 编码过的
  const scene = options.scene ? decodeURIComponent(options.scene) : ''
  if (!scene) return this.setData({ state: 'no-scene' })
  // → POST /api/v1/upload-sessions/scene/resolve {scene}
  //   成功：拿 sessionId + uploadToken，走既有上传
  //   失败：一律显示「二维码已失效，请回到一体机重新生成」
}
```

注意：`getwxacodeunlimit` 生成的是**永久**小程序码，但只对**已发布**版本有效。
未发布时微信返回 `errcode 41030`（2026-09-08 对本项目 AppID 实测值）。
发布前可以把 `WECHAT_MINIAPP_ENV_VERSION` 设成 `trial` 走体验版验链路。

## 验证

`pnpm --filter @ai-job-print/api verify:upload-scene` —— 17 条断言。
有 `REDIS_URL` 时打真实 Redis（CI 即如此），没有时退到进程内 RESP 桩。
