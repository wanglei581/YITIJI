/* ============================================================================
   phone-relay.js · S11 手机接力 —— 视图、状态注册表与真实表单逻辑
   宿主 51-phone-relay.html，承接 /member/qr-login 与 /upload/phone 两条真实 route。

   这份文件里有两类代码，取证与迁移时要分清：
   ① 真前端逻辑（可以直接搬进 React）：手机号 11 位数字约束、验证码 6 位数字约束、
      **发码成功之前**验证码输入与确认按钮一律不可用、发码成功后才脱敏锁定并起倒计时、
      确认按钮的启用条件（同时要求「已成功发过码」与「服务端此刻还可能留着一条码」）、
      空文件拦截、扩展名白名单、
      浏览器给出的类型白名单与「类型 ↔ 扩展名」一致性预检、10MB 体积拦截、
      上传中与结果未知时禁止重复选择、成功后不可重复上传、会话失效后禁用选择。
   ② 原型演示推进（**不属于产品逻辑**）：提交之后从 send-loading→code-sent、
      confirming→confirmed、uploading→success 的定时切换。
      生产里这几步等的是服务端返回，本页不发任何请求。

   贯穿全文件的一条边界：手机端从头到尾没有拿到任何结果。
   扫码登录拿到的是 confirmed 一个字，登录态要一体机自己去 claim；
   手机上传拿到的是「系统收到了这个文件」，用不用要一体机上按确认。
   所以每一屏的最后一句都必须把人送回一体机，不能停在手机上。

   还有一条是这一轮补上的：**「发过码」和「现在有码可用」是两件事**，
   分别由 S.locked 与 S.hasUsableCode 表示。合成一个布尔量会漏掉一整条真实路径 ——
   验证码过期 / 被作废之后点「重新获取」，那一次请求同样可能被频控挡下，
   此时「发过码」仍然成立，但**一条能填的验证码都没有**。见 codeInputEnabled / canConfirm。

   这一轮补的是同一类问题的另一面：**页面上写着「稍后再试」，按钮就不能是马上能点的**。
   被频控挡下之后「什么时候才能再点」有两种完全不同的口径，必须分开做成两条真实约束：
     later（SMS_TOO_FREQUENT / IP / DEVICE / PROVIDER_RATE_LIMIT）
       → 本页自己拦住一段最短等待（S.retryGate，取正常重发间隔 60 秒）。
         这个秒数是**本页在倒数的**，不是系统还剩多久 —— 系统那个数本页读不到，
         所以文案只说「这是本页留的最短等待」，并且明说走完之后仍可能再被挡下。
     tomorrow（SMS_DAILY_LIMIT / PROVIDER_PHONE_DAILY_LIMIT）
       → 今天这个**号码**不能再发（S.dailyLimitedPhone），等多久都没用，
         换一个本人手机号才可能发出去 —— 所以它是绑号码的，不是绑时间的。
   两条都必须真的挡住 canSend：只把话写在屏幕上、按钮照旧能点，等于页面在骗人。
   见 sendBlockedBy / sendBlockHtml。

   还有两条同样重要：
   · 本页的校验是**手机端预检**，不是服务端校验的等价物。服务端 files/file-validation.ts
     按 MIME 白名单 + 扩展名一致性 + 空文件 + 体积重新检查一遍，最终结论以它为准。
     本页任何一处都不得写成「已经通过校验」。
   · **不确定就要说不确定**。请求发出去没收到结果、系统说正在处理、系统只回了一个失败 ——
     这三件事的下一步完全不同，页面必须分开写，不能一律劝用户「再试一次」。
   ========================================================================== */
(function () {
'use strict'

var qs = new URLSearchParams(location.search)
var CAPTURE = qs.get('capture') === '1'
var FLAT = qs.get('flat') === '1' || CAPTURE
var DEBUG = qs.get('debug') === '1'
/* 两个**只属于原型演示**的直达开关，生产没有对应物：
   ?cooldown=active  把重发冷却钉成固定 DEMO_COOLDOWN_REMAIN 秒，
                     让「重新获取还在倒计时」这一屏可直达、可重跑复现（真实交互路径
                     照旧走 startCountdown 的一秒一跳）。冷却只可能来自一次成功发码，
                     所以它同时意味着手机号已锁定。
   ?code=usable|none 直接指定「服务端此刻还有没有一条可用验证码」这个事实，
                     用来直达 send-limited 的两种真实处境：
                       code=usable —— 旧码没被消费（比如刚填错过一次），重发却被挡下；
                       code=none   —— 旧码已过期或已被作废，重发又被挡下（一条都没有）。 */
var COOLDOWN_ACTIVE = qs.get('cooldown') === 'active'
var CODE_FIXTURE = qs.get('code') === 'usable' ? 'usable' : (qs.get('code') === 'none' ? 'none' : null)
var root = document.documentElement
if (CAPTURE) root.setAttribute('data-capture', '1')
if (FLAT) root.setAttribute('data-flat', '1')
if (DEBUG) root.setAttribute('data-debug', '1')

var stage = document.getElementById('stage')
var flow = document.getElementById('flow')
var cta = document.getElementById('cta')
var rbSub = document.getElementById('rb-sub')
var rbTag = document.getElementById('rb-tag')
var footCopy = document.getElementById('foot-copy')
var footIc = document.getElementById('foot-ic')

/* ── 内联图标（零外部资源）────────────────────────────────────────────── */
var ICO = {
  monitor: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  shield: '<path d="M12 3l7.5 3v5.2c0 4.4-3 8.2-7.5 9.8-4.5-1.6-7.5-5.4-7.5-9.8V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.2l2.6 2.6L16.2 9"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.2M12 16.3v.2"/>',
  loader: '<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2L18 18M18 6l-2.8 2.8M8.8 15.2L6 18"/>',
  upload: '<path d="M12 16V4.5"/><path d="M7.5 9L12 4.5 16.5 9"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  file: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M7 7l1 13h8l1-13"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.4 2"/>',
  qr: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path d="M13.5 13.5h3v3h-3zM20.5 13.5v3M17.5 20.5h3M13.5 20.5h1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.2 2.6c-.6.2-.8.7-.8 1.3v.4M12 16.6v.2"/>',
  wait: '<circle cx="12" cy="12" r="9"/><path d="M8.5 8.2h7M8.5 15.8h7M9.6 8.2c0 2.2 2.4 2.9 2.4 3.8s-2.4 1.6-2.4 3.8M14.4 8.2c0 2.2-2.4 2.9-2.4 3.8s2.4 1.6 2.4 3.8"/>'
}
function svg (name, size) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' + (ICO[name] || '') + '</svg>'
}

/* ── 事实表：全部取自服务端源码，改动必须同步注释里的出处 ─────────────── */
var QR_TTL_SECONDS = 180          // member-qr-login.service.ts:14  QR_TICKET_TTL（票据**总**寿命）
var UPLOAD_TTL_SECONDS = 600      // upload-sessions.service.ts:87  SESSION_TTL_SECONDS = 10*60
var MAX_BYTES = 10 * 1024 * 1024  // upload-sessions.service.ts:90  MAX_SESSION_UPLOAD_BYTES
var SMS_COOLDOWN = 60             // member-auth.service.ts:29 COOLDOWN，成功回执里的 cooldownSeconds
/* 被频控挡下之后，本页自己拦住的最短重试间隔。**它不是服务端字段** ——
   频控回执里没有「还要等多久」，本页读不到那个数，也不许编一个。
   取值直接沿用上面那条已知常量（正常重发间隔 60 秒）：它是这条链路上唯一一个
   有出处的等待时长，用它就不必凭空造一个数，文案也能如实说清「这是本页留的等待」。
   它只负责一件事：让「稍后再试」这句话在按钮上真的成立。 */
var RETRY_GATE_SECONDS = SMS_COOLDOWN

/* 静态原型的字段演示值，**不属于产品逻辑**，界面上也不写「演示 / 测试 / 示例」这类词：
   · DEMO_DEVICE_LABEL 对应 QrLoginStatusResult.deviceLabel。生产由 status 接口返回，
     且**可能为空**（service 里是可选字段，create 时 cleanOptional 会把空串抹成 undefined），
     所以本页必须同时画得出「有名称」和「没名称」两种样子。
   · DEMO_QR_REMAINING 对应 QrLoginStatusResult.expiresInSeconds。注意它是**剩余**秒数
     （service.status() 现读 Redis TTL），不是 180：用户扫码、打开页面都要花时间，
     打开手机时不可能还剩满 3 分钟。取一个固定值是为了让 capture 逐字节可复现。 */
var DEMO_DEVICE_LABEL = '一体机 A03'
var DEMO_QR_REMAINING = 126
/* ?cooldown=active 用的固定冷却余额。倒计时在真实交互路径上照常一秒一秒走
   （startCountdown），但直达某一屏时如果让它跑起来，同一份源码每次截图都不一样。
   钉成一个固定值，「重新获取还在倒计时」这一屏才拍得出、也才重跑逐字节可复现。 */
var DEMO_COOLDOWN_REMAIN = 37

/* MIME → 允许的扩展名，与 file-validation.ts 的 MIME_EXTS 同表（只留手机端会遇到的几行）。
   服务端用它做「扩展名必须与声明类型一致」的防伪装校验，本页照抄同一张表做预检。 */
var MIME_EXTS = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp']
}
/* MIME → 用户能读懂的说法。原始 MIME 串是工程内部标识，进 DOM 就等于进截图，
   所以任何用户可见文案都只用这张表的右列，读不到就写「另一种格式」。 */
var MIME_LABEL = {
  'application/pdf': 'PDF 文档',
  'application/msword': 'Word 文档',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word 文档',
  'image/jpeg': 'JPG 图片',
  'image/png': 'PNG 图片',
  'image/webp': 'WEBP 图片'
}
function typeLabel (mime) { return MIME_LABEL[mime] || '另一种格式' }

/* ── 用途：只有服务端回执确认过的用途，才允许拿来说去向、格式和留存 ──────
   手机端拿到的 purpose 来自 URL fragment（buildPhoneUploadUrl 把 sessionId / token /
   purpose 写进 hash），**用户可以随手改掉**，所以它只是一个未经核对的提示。
   本表里的 noun / chips / target / retain 只在 S.confirmedPurpose 有值时才使用。 */
var PURPOSES = {
  resume_upload: {
    noun: '简历文件',
    label: '简历上传',
    chips: ['PDF', 'Word', 'JPG', 'PNG', 'WEBP'],
    target: '这份简历用于一体机发起的这一次上传，回一体机确认后才进入简历服务。',
    retain: '确认之后：已登录会员按简历类默认保存 <b>90 天</b>，可在一体机「我的文档」里改；未登录的临时上传按系统短期留存（<b>1 小时</b>）。',
    demo: { name: '我的简历-2026.pdf', size: 1.8 * 1024 * 1024, type: 'application/pdf' }
  },
  print_doc: {
    noun: '打印文件',
    label: '打印文件上传',
    chips: ['PDF', 'JPG', 'PNG'],
    target: '这份文件用于一体机发起的这一次上传，回一体机确认后才进入打印参数设置。',
    retain: '确认之后：按系统短期留存（<b>24 小时</b>）。打印完成不代表立刻删除，也不会长期留着。',
    demo: { name: '录用通知书.pdf', size: 640 * 1024, type: 'application/pdf' }
  },
  contract_upload: {
    noun: '合同文件',
    label: '合同上传',
    chips: ['PDF', 'Word', 'JPG', 'PNG', 'WEBP'],
    target: '这份合同用于一体机发起的这一次上传，回一体机确认后才进入合同审查。',
    retain: '确认之后：固定保留 <b>2 小时</b>，从你上传的那一刻起算，确认动作不会重置也不会延长；这一档由系统锁定，本人也改不了。',
    demo: { name: '劳动合同（待审）.pdf', size: 2.4 * 1024 * 1024, type: 'application/pdf' }
  },
  signature_image: {
    noun: '签名或印章图片',
    label: '签名 / 印章上传',
    chips: ['JPG', 'PNG'],
    blocked: true,
    target: '',
    retain: '',
    demo: { name: 'signature.png', size: 220 * 1024, type: 'image/png' }
  }
}

/* 上传前的**保守通用档**。
   为什么不按 fragment 里的 purpose 放行：那个值可以被改，改宽了就等于让手机端替服务端
   决定这次任务收什么。所以在服务端回执确认用途之前，一律按 CreateUploadSessionDto
   @IsIn 白名单里三个用途（resume_upload / print_doc / contract_upload）的**安全交集**取值：
     resume_upload   PDF / DOC / DOCX / JPG / PNG / WEBP（+ 服务端自产的 txt / md）
     print_doc       PDF / JPG / PNG
     contract_upload PDF / DOC / DOCX / JPG / PNG / WEBP
   交集 = PDF / JPG / PNG。体积取会话上限 10MB（比按用途的 20MB 更紧，先生效的是它）。
   代价要写在明处：真实用途若是简历或合同，Word 文档在本页会被挡下 —— 页面必须如实
   告诉用户「回一体机按那一步的说明操作」，不能让人对着灰按钮猜。
   一句话原则：**fragment 提示只能用来收紧，不能用来放宽。** */
var GENERIC = {
  noun: '文件',
  label: '手机上传',
  exts: ['pdf', 'jpg', 'jpeg', 'png'],
  mimes: ['application/pdf', 'image/jpeg', 'image/png'],
  chips: ['PDF', 'JPG', 'PNG']
}

/* ── 状态注册表 ──────────────────────────────────────────────────────
   拆分依据只有一条：**用户能做的下一步不同，就必须是不同状态**。

   扫码登录（16 个）：
     missing-ticket  链接里没有票据             → 没有可重试的东西
     checking        正在读票据状态
     status-error    状态没读到（网络等原因）   → 可以再读一次
     ticket-expired  票据已经不能再确认         → 回一体机，重试没有意义
                     （承载 QR_LOGIN_NOT_FOUND / ALREADY_CLAIMED / ALREADY_CONFIRMED /
                       TICKET_INVALID：这四种在服务端都已不可能再 confirm 成功）
     ready           读到了，且带回一体机名称
     device-missing  读到了，但服务端没给名称   → 表单照常可用，只是不能显示是哪台
     send-loading    发码请求已发出，结果未回   → 全表单冻住，不允许再点
     send-error      发码明确失败（SMS_SEND_FAILED，短信通道没发出去）→ 可以直接重试
     send-limited    发码被频控挡下             → 按类型说「稍后」或「明天」，不报秒数
     code-sent       **发码确实成功**才进这里   → 此时才锁号、才起倒计时、才写「已发送」
     confirming      确认请求已发出，结果未回
     ── 验证码这一类失败拆成三个，因为**下一步完全不同**（verifySmsCodeForUser 三条分支）：
     confirm-code-invalid  SMS_CODE_INVALID：getAndDelIfEquals 回 'mismatched'，
                     **只有相等才删**，所以这一次比较**没有消费掉**那条验证码。
                     能断定的只有这一句 —— 它还剩多少有效期、还能再错几次，本页都读不到。
                     → 保留锁号与 hasUsableCode，只清错误输入，可以核对短信最新一条再填；
                       但文案不得承诺「它还能用」，也不得写「不用重新获取」。
                       重发按钮仍受 60 秒冷却约束。
     confirm-code-expired  SMS_CODE_EXPIRED：codeStatus 回 'missing'，验证码在服务端
                     已经不存在（超过 CODE_TTL=300 秒、已用过一次、或此前被作废）。
                     → hasUsableCode 置 false：清空输入并**禁用验证码输入框**，必须重新获取。
     confirm-code-locked   SMS_CODE_LOCKED：attempts 超过 VERIFY_MAX_ATTEMPTS=5，
                     服务端**主动 del 掉 codeKey 与 attemptKey**，当前验证码已被销毁。
                     → 同样 hasUsableCode 置 false、清空并禁用输入，必须重新获取；
                       这不是封号，重发成功后即可继续 —— 但重发本身也可能被频控挡下，
                       所以页面不得把「重新获取」写成一定拿得到。
     这三条都**不影响二维码票据**：confirm 之所以失败是短信这一侧，票据仍在它的
     180 秒寿命里，不得写成「二维码失效」。票据那一侧的失败走 ticket-expired。
     confirm-unknown 确认请求的结果**不确定**   → 不清验证码、不给盲重试，先回一体机看
     confirmed       服务端明确回了 confirmed

   手机上传（13 个）：
     invalid            链接缺 sessionId / token → 与「过期」无关，本页连是哪次上传都不知道
     idle / uploading / success
     upload-in-progress UPLOAD_SESSION_UPLOAD_IN_PROGRESS：同一个二维码上已经有一次上传
                        正在处理 → **不能**劝重选，只能等 + 回一体机核对
     outcome-unknown    请求发出去没拿到结果（断网 / 回执丢失）→ 既不能说收到了，
                        也不能说没收到；禁止盲目重传，回一体机确认或刷新
     empty-error        0 字节（服务端 FILE_EMPTY）
     too-large          超 10MB（服务端 FILE_TOO_LARGE）
     type-error         扩展名不在通用清单里
     content-type-error 浏览器给出的类型不被接受，或类型与扩展名对不上
     service-error      **服务端明确回了失败**：文件检查没过或存储没写成，
                        且会话已被退回可再传的状态（upload-sessions.service.ts:257）→ 可以重选
     session-expired    **服务端明确回了死码**：EXPIRED / NOT_PENDING / NOT_FOUND /
                        TOKEN_INVALID → 选择区禁用，只能回一体机刷新
     signature-blocked  诚实不可用（见 renderUpload） */
var QR_STATES = ['missing-ticket', 'checking', 'status-error', 'ticket-expired',
  'ready', 'device-missing', 'send-loading', 'send-error', 'send-limited',
  'code-sent', 'confirming', 'confirm-code-invalid', 'confirm-code-expired',
  'confirm-code-locked', 'confirm-unknown', 'confirmed']
var UPLOAD_STATES = ['invalid', 'idle', 'uploading', 'upload-in-progress', 'outcome-unknown',
  'empty-error', 'too-large', 'type-error', 'content-type-error',
  'service-error', 'session-expired', 'success', 'signature-blocked']

/* 共用同一屏表单的状态（其余状态各自整屏接管）。 */
var FORM_STATES = ['ready', 'device-missing', 'send-loading', 'send-error', 'send-limited',
  'code-sent', 'confirming', 'confirm-code-invalid', 'confirm-code-expired',
  'confirm-code-locked', 'confirm-unknown']

/* 验证码这一侧失败的三个状态。它们的共同点只有一条：二维码票据还在，
   失败发生在短信那一侧。共同点仅此而已 —— 下一步是分开的：
     invalid            这一次比较没有消费掉那条码 → hasUsableCode 保持 true；
     expired / locked   服务端已经没有那条码了     → 进入时把 hasUsableCode 打掉。
   注意「打掉」只是**进入这两个状态时的动作**，不是判据。判据一律读 S.hasUsableCode：
   从 confirm-code-expired 点「重新获取」又被频控挡下后，状态已经变成 send-limited，
   可这一页手上仍然一条码都没有 —— 按状态清单判就会在那里把输入框放开。 */
var CODE_FAIL_STATES = ['confirm-code-invalid', 'confirm-code-expired', 'confirm-code-locked']

/* ── 运行时状态 ──────────────────────────────────────────────────────── */
var S = {
  screen: 'qr-login',
  state: 'checking',
  hintedPurpose: null,      // URL fragment 里的 purpose：**未经核对的提示**，只能用来收紧
  confirmedPurpose: null,   // demoConfirmedPurpose：模拟服务端 UploadSessionStatusResponse.purpose
  deviceLabel: null,        // status.deviceLabel，可能没有 —— 没有就如实说没有，不编名字
  remain: null,             // status.expiresInSeconds：打开本页时读到的**剩余**秒数
  phone: '',
  code: '',
  /* locked 与 hasUsableCode 是**两件事**，这一轮把它们拆开了。
     locked        = 这一页确实成功发出过一次验证码 → 手机号锁定、脱敏回显、按钮写「重新获取」。
                     它一旦成立就只有换号 / 发码明确失败才会退回去。
     hasUsableCode = 服务端此刻**还可能**留着一条验证码 → 验证码输入框和确认按钮才允许启用。
                     它比 locked 严格得多，会被 expired / locked / send-error / 换号打掉。
     合成一个布尔量会漏掉这条真实路径：验证码过期后点「重新获取」又被频控挡下 ——
     locked 仍然成立，可一条能填的码都没有，页面却会把输入框和确认按钮放开。 */
  locked: false,
  hasUsableCode: false,
  cd: 0,                    // 重发倒计时（同样只有发码成功才起）；秒数来自成功回执，是服务端给的
  /* 下面两个是「被挡下之后什么时候才能再点」的两种真实口径，互不替代：
     retryGate         本页自己留的最短等待秒数（later 口径）。**不是**系统的剩余时间。
     dailyLimitedPhone 今天已经不能再发的那个号码（tomorrow 口径）。绑号码，不绑时间 ——
                       所以它只能靠换号解除，等多久都没用。 */
  retryGate: 0,
  dailyLimitedPhone: null,
  limitKind: 'later',       // send-limited 的两种口径：'later' 稍后 / 'tomorrow' 明天
  recheckTo: 'ready',       // 「重新检查」这一动作在演示里落到哪个状态
  timer: null,
  gateTimer: null,          // retryGate 的秒表，与 timer（重发冷却）分开，两者可能同时在走
  demoTimer: null,
  file: null,               // { name, size, ext, type } —— type 是浏览器自述的类型，可能为空串
  typeIssue: null,          // 'not-allowed' | 'mismatch'：content-type-error 的两种成因
  unknownType: false,       // 浏览器没给类型，本页只能按后缀预检
  errCode: null             // 失败时的详细错误码（演示值）。只留在这里：不上屏、不进 DOM/data-*
}

function clearTimers () {
  if (S.timer) { clearInterval(S.timer); S.timer = null }
  if (S.gateTimer) { clearInterval(S.gateTimer); S.gateTimer = null }
  if (S.demoTimer) { clearTimeout(S.demoTimer); S.demoTimer = null }
}

/* ── 工具 ────────────────────────────────────────────────────────────── */
/* 位数上限只由这里管，输入框上**不加** maxlength：maxlength 截的是原始字符，
   粘贴「138 0013 8000」会先被切成 11 个字符、再过滤掉空格，最后只剩 9 位数字。
   先过滤再截断才是对的（与 React 的 normalizeDigits 同口径）。 */
function digits (raw, max) { return String(raw).replace(/\D/g, '').slice(0, max) }
function maskPhone (p) { return p.length === 11 ? p.slice(0, 3) + '****' + p.slice(7) : p }
function fmtSize (b) {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB'
  return (b / (1024 * 1024)).toFixed(1) + ' MB'
}
function extOf (name) {
  var m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}
function extLabel (ext) {
  if (ext === 'doc' || ext === 'docx') return 'Word'
  if (ext === 'jpeg') return 'JPG'
  return ext ? ext.toUpperCase() : '未知格式'
}
function esc (s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  })
}
function tid (name) { return 'relay-' + name }

/* ── 片段构造 ────────────────────────────────────────────────────────── */
/* compact：已经核对过机器、或屏上正压着一条错误时，机器卡收成一行。
   这不是为了好看：390×844 上，整卡（约 300px）+ 错误条 + 三步条 + 表单叠起来会把
   「验证码填哪里」顶出首屏，用户读完错误原因却看不到下一步该点什么。 */
function devcard (o) {
  return '<section class="devcard" data-testid="' + tid('device-card') + '"' +
    (o.compact ? ' data-compact="1"' : '') +
    (o.unknown ? ' data-device="unknown"' : '') + '>' +
    '<span class="dev-glyph">' + svg('monitor', o.compact ? 24 : 30) + '</span>' +
    '<div class="dev-copy">' +
    '<h1 class="dev-name serif">' + o.name + '</h1>' +
    (o.desc ? '<p class="dev-desc">' + o.desc + '</p>' : '') +
    (o.chip ? '<span class="dev-chip">' + o.chip + '</span>' : '') +
    '</div>' +
    (o.note
      ? '<p class="dev-note"><span class="ic">' + svg(o.unknown ? 'help' : 'info', 16) + '</span><span>' + o.note + '</span></p>'
      : '') +
    '</section>'
}
function steps (items) {
  var out = '<ol class="steps" data-testid="' + tid('steps') + '">'
  for (var i = 0; i < items.length; i++) {
    if (i) out += '<li class="arrow" aria-hidden="true">›</li>'
    out += '<li><span class="no">' + (i + 1) + '</span><span class="tx">' + items[i] + '</span></li>'
  }
  return out + '</ol>'
}
function statecard (kind, icon, id, head, body, actions, spin) {
  return '<section class="statecard" data-kind="' + kind + '" data-testid="' + tid(id) + '"' +
    (kind === 'error' ? ' role="alert"' : ' role="status"') + '>' +
    '<span class="glyph' + (spin ? ' spin' : '') + '">' + svg(icon, 30) + '</span>' +
    '<h2 class="serif">' + head + '</h2><p>' + body + '</p>' +
    (actions ? '<div class="actions">' + actions + '</div>' : '') +
    '</section>'
}
/* 首屏错误条：**独立一块，排在机器卡正下方**，不塞进表单里。
   塞进表单的老写法在 390×844 上会被主按钮压住 —— 原因和下一步都得先看得见。 */
function alertblock (tone, icon, id, head, body) {
  return '<section class="alertblock" data-tone="' + tone + '" data-testid="' + tid(id) + '"' +
    (tone === 'error' ? ' role="alert"' : ' role="status"') + '>' +
    '<span class="ic">' + svg(icon, 22) + '</span>' +
    '<div><b>' + head + '</b><span>' + body + '</span></div>' +
    '</section>'
}
function notice (tone, icon, html, id) {
  return '<p class="notice" data-tone="' + tone + '" data-testid="' + tid(id) + '"' +
    (tone === 'error' ? ' role="alert"' : ' role="status"') + '>' +
    '<span class="ic">' + svg(icon, 18) + '</span><span>' + html + '</span></p>'
}
function facts (items) {
  var out = '<div class="facts" data-testid="' + tid('facts') + '">'
  for (var i = 0; i < items.length; i++) {
    out += '<div class="fact"><div class="fk">' + items[i][0] + '</div><div class="fv">' + items[i][1] + '</div></div>'
  }
  return out + '</div>'
}
function chips (list, tone) {
  var out = '<div class="chips">'
  for (var i = 0; i < list.length; i++) {
    out += '<span class="chip"' + (tone ? ' data-tone="' + tone + '"' : '') + '>' + list[i] + '</span>'
  }
  return out + '</div>'
}
function primaryBtn (id, label, disabled, aria) {
  return '<button type="button" class="btn primary" data-testid="' + tid(id) + '"' +
    (disabled ? ' aria-disabled="true"' : '') +
    (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>'
}
function ghostBtn (id, label) {
  return '<button type="button" class="btn ghost" data-testid="' + tid(id) + '">' + label + '</button>'
}

/* ══ 扫码登录 ═══════════════════════════════════════════════════════════ */
var QR_STEPS = ['核对这台机器', '手机号验证', '回一体机继续']

/* 时限口径：显示的是**打开本页时**服务端给的剩余秒数，不自己走秒 ——
   本页不再向服务端要新值，走一个假秒表只会让人以为它是实时的。
   总寿命 180 秒同屏写出来，才不会被读成「打开手机后还有完整 3 分钟」。 */
function qrExpiryChip () {
  if (S.remain == null) return ''
  return '打开本页时剩余 <b>' + S.remain + ' 秒</b> · 自一体机生成起共 ' + QR_TTL_SECONDS + ' 秒'
}

/* 发码这一步的三条硬规则（真前端逻辑，迁移时照搬）：
   ① 只有服务端明确回了成功，才 locked、才起倒计时、才写「已发送」；
   ② 没成功发过码时，验证码输入框与确认按钮一律不可用 —— 没有码可填，
      让人填一串数字再告诉他「验证码不正确」是在骗人；
   ③ 发码请求在途（send-loading）时整张表单冻住，不允许再点。 */
function codeInputEnabled () {
  /* 唯一判据是 hasUsableCode，不是 locked，也不是「当前状态在不在某张清单里」。
     按状态清单判会漏掉这一条：expired / locked 之后点「重新获取」被频控挡下，
     状态已经跑到 send-limited，可服务端那条码依然不存在 —— 输入框必须继续禁着。 */
  if (!S.hasUsableCode) return false
  return S.state !== 'confirming' && S.state !== 'send-loading' && S.state !== 'confirm-unknown'
}
/* 按钮上写的是「获取验证码」还是「重新获取」，由**发过码没有**决定。
   抽出来是为了让按钮、提示条、失败原因三处永远用同一个说法 ——
   提示条写「去点重新获取」而按钮上写着「获取验证码」，用户就得自己猜是不是同一个东西。 */
function sendVerb () { return S.locked ? '重新获取' : '获取验证码' }

/* 发码按钮为什么不能点：**只有一个判据函数**，按钮的可点状态、按钮上的字、
   旁边的解释条、确认按钮的失败原因全部读它，不许各写各的。
   返回 null 表示现在可以点。四条挡下的理由互不相同，所以必须分开返回：
     busy        请求在途 / 结果未知 —— 这一屏整个冻住
     cooldown    上一次**发码成功**给的 60 秒重发间隔，秒数有出处（回执里的 cooldownSeconds）
     retry-gate  这一次被频控挡下后，本页自己留的最短等待。秒数是本页的，不是系统的
     daily-limit 这个号码今天不能再发。它绑的是号码不是时间 —— 等下去不会变，换号才可能
     phone       还没填满 11 位
   顺序即优先级：先冻住，再看两种「要等」，最后才是「换号才行」和「号码没填全」。
   daily-limit 放在 phone 之前，是因为号码填全了却仍然不能发时，
   用户最需要看到的是「这个号码今天不行」，而不是一句「请先填手机号」。 */
function sendBlockedBy () {
  if (S.state === 'confirming' || S.state === 'send-loading' || S.state === 'confirm-unknown') return 'busy'
  if (S.cd > 0) return 'cooldown'
  if (S.retryGate > 0) return 'retry-gate'
  /* 只挡住**那一个**号码。换成另一个本人手机号就该放行 —— 每日上限是按号码计的，
     把它做成「整页禁发」会把一条真实可用的恢复路径堵死。 */
  if (S.dailyLimitedPhone && S.phone === S.dailyLimitedPhone) return 'daily-limit'
  if (!S.locked && S.phone.length !== 11) return 'phone'
  return null
}
function canSend () { return sendBlockedBy() === null }
function canConfirm () {
  /* 两个事实都要成立，缺一不可：
     ① locked        —— 这一页确实成功发出过一次验证码；
     ② hasUsableCode —— 那条码此刻**还可能**在服务端。
     少了 ②，send-error / expired / locked 之后重发被挡下时，页面会放行一次必然失败的确认。
     confirm-code-invalid 之所以仍可确认，是因为那一次比较没有消费掉验证码，
     ② 依然成立 —— 不是因为页面替服务端保证了「它还没过期」。 */
  if (!S.locked || !S.hasUsableCode) return false
  if (S.state === 'confirming' || S.state === 'send-loading' || S.state === 'confirm-unknown') return false
  return S.phone.length === 11 && S.code.length === 6
}
/* 按钮上的字必须自己说清「现在是哪一种不能点」，不能一律留着「重新获取」再靠灰色暗示。
   两种「要等」都显示秒数，但含义不同，所以 aria-label 分开写：
   冷却那个数是系统给的，最短等待那个数是本页自己的。 */
function sendLabel () {
  if (S.state === 'send-loading') return '发送中…'
  var blocked = sendBlockedBy()
  if (blocked === 'cooldown') return S.cd + ' 秒'
  if (blocked === 'retry-gate') return S.retryGate + ' 秒'
  if (blocked === 'daily-limit') return '今天不能发'
  return sendVerb()
}
function sendLabelAria () {
  if (S.state === 'send-loading') return '正在发送验证码'
  var blocked = sendBlockedBy()
  if (blocked === 'cooldown') return '重新获取验证码，还需等待 ' + S.cd + ' 秒'
  if (blocked === 'retry-gate') {
    return '暂时不能' + sendVerb() + '，本页留的最短等待还剩 ' + S.retryGate + ' 秒'
  }
  if (blocked === 'daily-limit') return '这个手机号今天不能再获取验证码，换一个本人手机号才能继续'
  return S.locked ? '重新获取验证码' : '获取短信验证码'
}
function confirmReason () {
  if (S.state === 'confirming') return '请等待系统返回结果，本页不会提前显示成功。'
  if (S.state === 'send-loading') return '正在发送验证码，请稍候。'
  if (S.phone.length !== 11) return '请先填写 11 位手机号。'
  /* 「去点获取验证码 / 重新获取」在那个按钮点不动的时候是一句废话，所以每一支都要先
     把「它现在为什么点不动」接上去。四种理由的下一步各不相同，一律读同一个 sendBlockedBy，
     不在这里另写一套判断 —— 两处各判各的，正是文案和按钮会分家的起点。 */
  var blocked = sendBlockedBy()
  if (!S.locked) {
    if (blocked === 'cooldown' || blocked === 'retry-gate') {
      return '还没有获取过验证码；「' + sendVerb() + '」现在也点不动，等按钮上的倒计时走完再点。'
    }
    if (blocked === 'daily-limit') {
      return '还没有获取过验证码；这个号码今天已经不能再获取，换一个本人手机号才拿得到。'
    }
    return '请先点「获取验证码」，收到短信后再填。'
  }
  /* 发过码、但手上这条已经没了。理由必须指向「重新获取」那个按钮，而且**不能**顺口保证
     下一次一定拿得到 —— 重新获取本身也会被频控挡下，那正是这一支要说清的处境。 */
  if (!S.hasUsableCode) {
    var waiting = blocked === 'cooldown' || blocked === 'retry-gate'
      ? '按钮还在倒计时，等它走完再点。'
      : (blocked === 'daily-limit' ? '这个号码今天已经不能再获取，换一个本人手机号才拿得到新的一条。' : '')
    if (S.state === 'send-limited') {
      return waiting
        ? '现在没有可以填的验证码，' + waiting
        : '现在没有可以填的验证码，刚才这次' + sendVerb() + '被系统挡下了，可以再点一次「' + sendVerb() + '」试试。'
    }
    if (S.state === 'confirm-code-locked') return '这条验证码已被作废，请点上面的「重新获取」拿一条新的。' + waiting
    if (S.state === 'confirm-code-expired') return '这条验证码已经过期或不存在，请点上面的「重新获取」拿一条新的。' + waiting
    return '现在没有可以填的验证码，请先点上面的「重新获取」。' + waiting
  }
  /* invalid 只能说到「这次错误没有用掉那条码」为止：还剩多少有效期、还能再错几次，
     本页都读不到，所以不写「不用重新获取」这种保证。 */
  if (S.state === 'confirm-code-invalid' && S.code.length !== 6) {
    return '请核对短信里最新的一条验证码后重新填写；它仍有有效期和尝试次数限制。'
  }
  if (S.code.length !== 6) return '请填写收到的 6 位验证码。'
  return '确认后手机端就结束了，登录要回一体机上完成。'
}

/* 发码按钮点不动时，「什么时候 / 怎么才能再点」必须写在按钮旁边。
   只灰掉按钮不写理由，用户唯一能得到的信息就是「坏了」。
   两条口径的下一步是**不同的动作**，所以分成两条写：
     retry-gate  等 —— 等的是本页留的最短间隔，按钮上倒数的就是它；
     daily-limit 换号 —— 等没有用，今天这个号码就是不行。
   第三条是恢复：等待走完之后要明说「现在可以再点了」，
   否则屏幕上还留着「稍后再试」而按钮已经能点，两边就对不上了。
   这一块单独成容器，是为了能在**不重绘整张表单**的前提下换内容：
   用户正在手机号输入框里改号码，整屏重绘会把光标和焦点一起弄丢。 */
function sendBlockHtml () {
  var blocked = sendBlockedBy()
  if (blocked === 'retry-gate') {
    return notice('warn', 'wait', '现在不能' + sendVerb() + '：本页按正常重发间隔留了 <b>' +
      RETRY_GATE_SECONDS + ' 秒</b>最短等待，按钮上倒数的就是这个数。' +
      '系统那边还要多久，本页看不到，也不会编一个给你。等按钮能点了可以再试一次，' +
      '那一次仍然可能再被挡下。', 'qr-retry-gate-notice')
  }
  if (blocked === 'daily-limit') {
    return notice('warn', 'ban', '这个手机号今天不能再获取验证码，等下去也不会变。' +
      (S.locked
        ? '点上面的「更换」，改成另一个本人手机号就可以继续。'
        : '把上面的手机号改成另一个本人手机号就可以继续。') +
      '不方便换号就回一体机换其他登录方式，或请现场工作人员协助。', 'qr-daily-limit-notice')
  }
  /* 限流屏上按钮还在走重发冷却的那一支：这个秒数和上面那个不是一回事 ——
     它来自上一次**发码成功**的回执，是系统给的数，本页照实转述即可。
     只在 send-limited 上写：code-sent / confirming 那一屏已经有「已发送…60 秒后可重新获取」，
     再来一条就是同一件事说两遍。 */
  if (blocked === 'cooldown' && S.state === 'send-limited') {
    return notice('calm', 'clock', '按钮上倒数的是上一次成功发码之后的 <b>' + SMS_COOLDOWN +
      ' 秒</b>重发间隔，这个数是系统给的。它走完之后本页才会再判断能不能重新获取。',
    'qr-cooldown-notice')
  }
  /* 只在「刚才确实被挡下过、现在又能点了」这一刻出现：屏上那条限流说明还在，
     必须有一句话告诉用户它已经过去了，不然人不敢点。 */
  if (S.state === 'send-limited' && !blocked) {
    return notice('calm', 'info', '最短等待已经走完，现在可以再点一次「' + sendVerb() + '」。' +
      '本页不能保证这一次就发得出去，仍然可能再被挡下。', 'qr-retry-ready-notice')
  }
  return ''
}
/* display:contents（见 phone-relay.css .sendblock）：空的时候不占位、也不吃 .formcard 的 gap。 */
function sendBlock () {
  return '<div class="sendblock" data-testid="' + tid('qr-send-block') + '">' + sendBlockHtml() + '</div>'
}

function qrForm () {
  var busy = S.state === 'confirming' || S.state === 'send-loading'
  var frozen = S.state === 'confirm-unknown'
  var out = '<section class="formcard" data-testid="' + tid('qr-form') + '">'

  /* 手机号：发码成功前可改，完整号码只在输入框里供本人核对；发码成功后锁定为脱敏回显 ——
     手机可能被人凑过来看，填完之后 11 位号码不继续留在屏上。
     锁定后输入框已经不存在，标题就不能再挂 for="qr-phone"（指向不存在的控件是悬空
     label，读屏跳过去会落空），改成普通标题 + 回显区 aria-labelledby 指回来。 */
  if (S.locked) {
    out += '<span class="f-label" id="qr-phone-lock-label">手机号</span>' +
      '<div class="lockrow" role="group" aria-labelledby="qr-phone-lock-label" data-testid="' + tid('qr-phone-locked') + '">' +
      '<span class="ic">' + svg('lock', 20) + '</span>' +
      '<span class="num" data-testid="' + tid('qr-phone-masked') + '">+86 ' + maskPhone(S.phone) + '</span>' +
      '<button type="button" class="changebtn" data-act="change-phone" data-testid="' + tid('qr-change-phone') + '"' +
      (busy || frozen ? ' aria-disabled="true"' : '') + ' aria-label="更换手机号并重新获取验证码">更换</button>' +
      '</div>'
  } else {
    out += '<label class="f-label" for="qr-phone">手机号</label>' +
      '<div class="field">' +
      '<span class="prefix" aria-hidden="true">+86</span>' +
      '<input class="input" id="qr-phone" data-testid="' + tid('qr-phone-input') + '" type="tel" ' +
      'inputmode="numeric" autocomplete="tel" placeholder="请输入本人手机号" ' +
      'value="' + esc(S.phone) + '"' + (busy ? ' disabled' : '') + ' aria-label="手机号，11 位数字">' +
      '</div>'
  }

  var codeOff = !codeInputEnabled()
  /* 占位符要说清「现在为什么不能填」：已经锁号但那条码在服务端已经不存在时，
     还写「6 位验证码」等于请人往一个不通的地方填。 */
  var codeHolder = S.hasUsableCode ? '6 位验证码'
    : (S.locked ? '请先重新获取' : '先获取验证码')
  out += '<label class="f-label" for="qr-code">验证码</label>' +
    '<div class="coderow">' +
    '<div class="field"><span class="ic">' + svg('shield', 20) + '</span>' +
    '<input class="input" id="qr-code" data-testid="' + tid('qr-code-input') + '" type="tel" ' +
    'inputmode="numeric" autocomplete="one-time-code" placeholder="' +
    codeHolder + '" ' +
    'value="' + esc(S.code) + '"' + (codeOff ? ' disabled' : '') + ' aria-label="短信验证码，6 位数字"></div>' +
    '<button type="button" class="sendbtn" data-act="send-code" data-testid="' + tid('qr-send-code') + '"' +
    (canSend() ? '' : ' aria-disabled="true"') + ' aria-label="' + sendLabelAria() + '">' +
    '<span data-testid="' + tid('qr-send-code-text') + '">' + sendLabel() + '</span></button>' +
    '</div>'
  out += sendBlock()

  /* 「已发送」这句话只在**发码成功过、且那条码还没被服务端销毁**时出现。
     send-error / send-limited 都没有成功发出，这时候还写「已发送」就是页面在替服务端撒谎。 */
  if (S.hasUsableCode && ['code-sent', 'ready', 'device-missing', 'confirming'].indexOf(S.state) >= 0) {
    out += notice('ok', 'check', '验证码已发送至 <b>' + maskPhone(S.phone) + '</b>，' +
      SMS_COOLDOWN + ' 秒后可重新获取。', 'qr-sent-notice')
  }
  if (!S.locked && ['ready', 'device-missing'].indexOf(S.state) >= 0) {
    out += notice('calm', 'info', '还没有获取验证码，验证码输入和确认按钮现在都不能用。', 'qr-not-sent-notice')
  }
  /* 这一条就是拆分 locked / hasUsableCode 要露出来的那种处境：发过码，但手上一条都没有，
     而重新获取这次又被挡下。不写这句，用户只会看见两个灰控件，猜不到为什么。 */
  if (S.state === 'send-limited' && S.locked && !S.hasUsableCode) {
    out += notice('warn', 'ban', '现在没有可以填的验证码：旧的那条已经不能用，这次重新获取又被挡下，' +
      '所以验证码输入和确认按钮暂时都不可用。', 'qr-no-usable-code-notice')
  }
  /* 反过来：旧码本来没被消费（比如刚填错过一次），重发被挡下时它仍然可以再试，
     但本页读不到它还剩多少有效期 —— 只说「可以再核对一次」，不承诺它一定还有效。 */
  if (S.state === 'send-limited' && S.hasUsableCode) {
    out += notice('calm', 'info', '之前收到的那条验证码可以再核对一次；本页看不到它还剩多少有效期，' +
      '也不能保证它一定还有效。', 'qr-old-code-notice')
  }
  if (S.state === 'send-loading') {
    out += notice('calm', 'loader', '正在请求发送验证码，请不要重复点击。', 'qr-send-loading-notice')
  }
  if (S.state === 'confirming') {
    out += notice('calm', 'loader', '正在确认，请不要关闭本页。', 'qr-confirming-notice')
  }
  out += '</section>'
  return out
}

/* 表单屏顶部的错误条：谁先看见、看见什么，全在这里定。 */
function qrAlert () {
  var st = S.state
  if (st === 'send-error') {
    /* SMS_SEND_FAILED：短信通道明确没发出去。服务端在这条路径上会把刚生成的验证码和
       冷却一起删掉（member-auth.service.ts 的 catch 分支），所以之前那条码也不能用了，
       必须重新获取；也正因为冷却被删了，这一步可以马上重试。 */
    return alertblock('error', 'alert', 'qr-alert-send-error', '验证码没有发出去',
      '短信通道这次没能把验证码发出来。你之前收到过的验证码也已经作废，需要重新获取一次；' +
      '现在就可以再点「获取验证码」。')
  }
  if (st === 'send-limited') {
    /* 频控有两档口径，用户的下一步不同，所以必须分开写。
       不写「还要等多少秒」：冷却是在上一次请求时开始计的，本页读不到它还剩多久，
       报一个具体秒数就是编造。
       还要再分一层：这次被挡下时，手上到底有没有一条能填的码。
       expired / locked 之后来的那一支是「一条都没有」，不说清就等于让人对着灰控件猜。 */
    var noCode = S.locked && !S.hasUsableCode
      ? '你手上那条验证码已经不能用了，这次重新获取又被挡下，所以现在没有可以填的验证码。'
      : ''
    /* 错误条说的是**已经发生过的事**，它不随倒计时和输入框变化，所以措辞必须两头都成立：
       tomorrow 一支点名是哪个号码（换号之后这句话对那个号码依然成立，不会变成假话），
       later 一支只说「被拦住了，还要等多久看按钮」，把会变的部分交给按钮和它下面那条说明。
       号码脱敏显示：手机可能被人凑过来看，屏幕上不多留一遍 11 位。 */
    var limitedNum = maskPhone(S.dailyLimitedPhone || S.phone)
    return S.limitKind === 'tomorrow'
      ? alertblock('warn', 'clock', 'qr-alert-send-limited', '这个号码今天不能再获取验证码了',
        limitedNum + ' 今天的验证码次数已经用完，请明天再试。' + noCode +
        '这一条等下去不会变，所以「' + sendVerb() + '」对这个号码已经不能点；' +
        '急着办可以换一个本人手机号，或者回一体机请现场工作人员协助。')
      : alertblock('warn', 'clock', 'qr-alert-send-limited', '现在获取得太频繁了',
        '刚刚已经请求过，或者当前网络、当前这台手机的请求太密集，系统暂时没有再发。' + noCode +
        '现在不能马上重试：「' + sendVerb() + '」已经被本页拦住，还要等多久、什么时候能再点，' +
        '按钮上和它下面那条说明写着。系统那边还要多久，本页看不到，不给你报一个假的秒数。')
  }
  /* 短信验证码这一侧的失败拆成三条。三条都**不**代表二维码作废（票据那一侧的失败走
     ticket-expired），但三条的下一步互不相同，所以不能压成一句「验证码不正确或已过期」。 */
  if (st === 'confirm-code-invalid') {
    /* SMS_CODE_INVALID：getAndDelIfEquals 只在**相等**时才删，回 'mismatched' 说明
       这一次比较**没有消费掉**那条验证码。能断定的只有这一句 ——
       它还剩多少有效期、还能再错几次，回执里都没有，本页读不到。
       所以下一步写成「可以核对最新一条再填」，不写「它还能用 / 不用重新获取」。 */
    return alertblock('error', 'alert', 'qr-alert-confirm-code-invalid', '验证码不正确',
      '刚才填的这条不对，输入框已经清空。这次错误没有用掉你收到的验证码，' +
      '可以核对短信里最新的一条再填一次。但验证码有有效期，也有尝试次数上限，' +
      '继续失败或者已经过期时就得重新获取。这张二维码没有因此作废。')
  }
  if (st === 'confirm-code-expired') {
    /* SMS_CODE_EXPIRED：codeStatus === 'missing'，服务端已经没有这条码了。
       重填同一条只会再失败一次，所以必须把人指向「重新获取」。 */
    return alertblock('warn', 'clock', 'qr-alert-confirm-code-expired', '这条验证码已经不能用了',
      '它可能已经超过有效期，也可能已经用过一次。重填同一条不会通过，' +
      '请点下面的「重新获取」拿一条新的再确认。这张二维码没有因此作废。')
  }
  if (st === 'confirm-code-locked') {
    /* SMS_CODE_LOCKED：尝试次数超过上限，服务端**主动删掉**了这条验证码。
       与 expired 的差别在成因和用户的疑虑（会不会被封号），所以分开写。 */
    return alertblock('warn', 'lock', 'qr-alert-confirm-code-locked', '验证码试得太多次了',
      '为了防止有人逐个猜码，系统已经把这条验证码作废，输入框也已清空。' +
      '请点下面的「重新获取」拿一条新的再确认。这张二维码没有因此作废。')
  }
  if (st === 'confirm-unknown') {
    /* 请求发出去了，结果没回来（断网、切后台、回执丢失）。
       这时候页面**不知道**服务端到底确认了没有，所以：
         · 不清空验证码 —— 清了就等于替用户断定「刚才那次没成」；
         · 不给「再确认一次」—— 盲重试要么撞上已确认（服务端回 409），
           要么在用户以为失败时其实早就成了；
         · 先把人送回一体机看屏幕，那边才有真结果；
         · 留一个明确的自查动作：重新读一次这张二维码的状态。 */
    return alertblock('warn', 'help', 'qr-alert-confirm-unknown', '这次确认有没有成功，本页不知道',
      '请求已经发出去了，但没有拿到明确结果，可能是网络中断，也可能是结果没能传回这一页。' +
      '不要在这里反复点确认 —— 先回一体机看屏幕，那边显示的才是真结果。')
  }
  return ''
}

/* 表单屏底部的主操作。它现在挂在页面底部的固定操作位（不再是滚动区里的吸底块），
   所以无论上面有多长的错误说明，都不会压住正文。 */
function qrCta () {
  if (FORM_STATES.indexOf(S.state) < 0) return ''
  if (S.state === 'confirm-unknown') {
    /* 这一屏**不渲染确认按钮**：结果未知时，页面能提供的唯一负责任动作是「再查一次状态」。 */
    return primaryBtn('qr-recheck-cta', '重新检查这张二维码', false, '重新检查这张二维码的状态') +
      '<p class="reason" data-testid="' + tid('qr-confirm-reason') + '">' +
      '本页不会替你再提交一次确认。先回一体机看屏幕最快。</p>'
  }
  var busy = S.state === 'confirming'
  return primaryBtn('qr-confirm', busy ? '确认中…' : '确认本次登录请求', !canConfirm(), '确认本次一体机登录请求') +
    '<p class="reason" data-testid="' + tid('qr-confirm-reason') + '">' + confirmReason() + '</p>'
}

function renderQr () {
  var st = S.state
  var out = ''

  if (st === 'missing-ticket') {
    out += devcard({
      name: '尚未识别一体机', unknown: true,
      desc: '这个链接缺少必要的登录信息，本页无法确认你要登录哪台机器。'
    })
    /* 真实实现里 ticketId 为空时**没有**重试按钮 —— 没有票据可查，重试只会再失败一次。 */
    out += statecard('warn', 'qr', 'qr-state-missing-ticket', '这个链接不能用来登录',
      '请回到一体机，在屏幕上重新生成二维码后再扫一次。二维码不要转发给别人。')
    out += '<div class="grow"></div>'
    out += facts([
      ['为什么', '登录信息只在扫码时由一体机生成，转发或收藏的旧链接可能不完整。'],
      ['怎么办', '回一体机点「手机扫码登录」，用手机相机重新扫屏幕上的二维码。']
    ])
    return out
  }

  if (st === 'checking') {
    out += devcard({
      name: '正在识别一体机', unknown: true,
      desc: '正在核对这个二维码是否还有效，请稍候。'
    })
    out += statecard('info', 'loader', 'qr-state-checking', '正在检查二维码',
      '还没确认这台机器之前，这一页不会让你填手机号。', '', true)
    out += '<div class="grow"></div>'
    return out
  }

  if (st === 'status-error') {
    out += devcard({
      name: '尚未识别一体机', unknown: true,
      desc: '二维码状态这次没读到，本页还不知道它是否有效。'
    })
    out += statecard('error', 'alert', 'qr-state-status-error', '二维码状态读取失败',
      '可能只是网络没连上。可以先重试一次；仍然失败就回一体机刷新二维码。',
      ghostBtn('qr-recheck', '重新检查二维码'))
    out += '<div class="grow"></div>'
    out += facts([
      ['先试这个', '点上面的「重新检查二维码」再读一次；网络恢复后通常就能继续。'],
      ['时限', '二维码自一体机生成起共 <b>' + QR_TTL_SECONDS + ' 秒</b>，到期只能在一体机上重新生成。'],
      ['安全', '本页不显示二维码里的登录信息。']
    ])
    return out
  }

  if (st === 'ticket-expired') {
    /* 承载 QR_LOGIN_NOT_FOUND / ALREADY_CLAIMED / ALREADY_CONFIRMED / TICKET_INVALID。
       这四种在服务端都不可能再 confirm 成功，所以**不给重试按钮** —— 与 status-error
       的区别就在这里：那边是「没读到，可能只是网络」，这边是「读到了，已经不能用」。
       当前 React 对所有错误一律给「重新检查二维码」，迁移时按本设计拆开。 */
    out += devcard({
      name: S.deviceLabel ? esc(S.deviceLabel) : '这台一体机', unknown: !S.deviceLabel,
      desc: '这台机器上的这张二维码，已经不能再用来确认登录了。'
    })
    out += statecard('warn', 'qr', 'qr-state-ticket-expired', '这个二维码不能再确认了',
      '它可能已经超时，也可能已经被一体机领取或已经确认过。请先回一体机看屏幕上的结果。')
    out += '<div class="grow"></div>'
    out += facts([
      ['怎么办', '先看一体机屏幕：已经登录就直接在一体机上继续；没有登录就在一体机上重新生成二维码，再扫一次。'],
      ['为什么没有重试', '这张二维码在系统里已经不能再确认，在手机上重试只会再失败一次。'],
      ['安全', '不要用别人转发给你的链接或二维码登录。']
    ])
    return out
  }

  if (st === 'confirmed') {
    out += devcard({
      name: S.deviceLabel ? esc(S.deviceLabel) : '刚才那台一体机', unknown: !S.deviceLabel,
      desc: '你在手机上的确认已经提交，手机这边到此为止，接下来看这台机器的屏幕。'
    })
    /* 手机端只拿到 confirmed 一个字。一体机要先轮询到 confirmed，再自己调 claim 才算登录；
       claim 会失败（ScanQrLoginPanel 的 catch 分支会清掉二维码要求重扫）。
       手机无从知道那一步的结果 —— 既不能写「登录成功」，也不能写「一体机会自己完成登录」，
       只能把人送回一体机看屏幕上的结果。 */
    out += statecard('done', 'check', 'qr-state-confirmed', '已确认，请回一体机继续',
      '手机这一步只做了「确认」。一体机还要继续校验并领取这次确认，能不能进入账号以一体机屏幕上的结果为准。')
    out += '<div class="grow"></div>'
    out += facts([
      ['手机端做了什么', '完成了手机号验证，并确认了本次一体机登录请求。'],
      ['手机端没做什么', '没有在手机上登录，也没有把账号带到手机浏览器里；这一页不代表一体机已经登录。'],
      ['回一体机之后', '按一体机屏幕上的结果继续；如果没有进入账号，就在一体机上重新生成二维码再扫一次。'],
      ['离开之前', '在一体机上办完事记得点退出登录，公共设备不要留登录态。']
    ])
    return out
  }

  /* ready / device-missing / send-* / code-sent / confirming / confirm-code-* /
     confirm-unknown 共用同一屏表单。
     device-missing 不是错误：status 读到了、票据有效，只是服务端这次没带机器名称
     （deviceLabel 是可选字段）。所以表单照常可用，只是不许编一个名字填上去。 */
  var alertHtml = qrAlert()
  var unknownDevice = !S.deviceLabel
  /* 已经发过码、或屏上正压着一条错误时，机器卡收成一行：核对机器是发码之前的事，
     之后再占 300px 只会把错误原因和验证码输入一起挤出首屏。 */
  var compact = S.locked || !!alertHtml
  out += devcard({
    name: unknownDevice ? '一体机名称未提供' : esc(S.deviceLabel),
    unknown: unknownDevice,
    compact: compact,
    desc: compact
      ? (unknownDevice ? '这次登录请求没带机器名称。' : '正在为这台机器确认登录。')
      : (unknownDevice
        ? '这次登录请求里没有机器名称，本页无法显示是哪一台。'
        : '这台一体机正在请求登录你的账号。'),
    chip: qrExpiryChip(),
    note: compact ? '' : (unknownDevice
      ? '请核对面前一体机屏幕上的二维码，确认就是你刚才亲手扫的那一张，再往下填。'
      : '请核对：这个名称和你面前这台机器一致，二维码也是你刚才亲手扫的那一张。')
  })
  out += alertHtml
  out += steps(QR_STEPS)
  out += qrForm()
  out += '<div class="grow"></div>'

  if (S.state === 'confirm-unknown') {
    out += facts([
      ['第一步', '回一体机看屏幕：已经进入账号就直接在一体机上继续办事。'],
      ['为什么不重试', '刚才那次确认可能已经生效。在手机上反复点确认，只会让你更难判断到底成没成。'],
      ['验证码', '页面保留了你刚才填的验证码，本页不会自动清空，也不会替你再提交一次。'],
      ['重新检查之后', '可能显示这张二维码已经不能再确认（多半是那次确认已经生效或已被一体机领取），也可能回到填验证码这一步（说明那次确认没送到）。'],
      ['一体机上没登录', '在一体机上重新生成二维码，再扫一次。']
    ])
    return out
  }
  /* 三条验证码失败各自的事实表。共用一张表就等于又把它们压回一个状态：
     invalid 的下一步在输入框里，expired / locked 的下一步在「重新获取」按钮上。 */
  if (S.state === 'confirm-code-invalid') {
    out += facts([
      ['下一步', '核对短信里最新的一条验证码，在上面重新填一次，再点确认。'],
      ['这次错误的影响', '这一次比较没有用掉你收到的验证码，它不会因为填错就被系统销毁。'],
      ['但不保证还能用', '它还剩多少有效期、还能再错几次，本页都看不到。再次提示已过期或已被作废时，就必须重新获取。'],
      ['二维码还在', '填错验证码不会让这张二维码失效；只要它还在有效期内，确认就能继续。'],
      ['别反复试', '同一条验证码试得太多次会被系统作废；那之后只能重新获取，而重新获取也可能被暂时挡下。']
    ])
    return out
  }
  if (S.state === 'confirm-code-expired' || S.state === 'confirm-code-locked') {
    var locked = S.state === 'confirm-code-locked'
    out += facts([
      ['下一步', '点上面的「重新获取」；按钮如果还在倒计时，等它走完再点。收到新的一条后填进去再确认。'],
      ['可能还要再等', '重新获取本身也可能被系统暂时挡下（发得太频繁、或今天次数用完）。真被挡下时，这一页会照实说明，不会假装已经发出。'],
      ['为什么不能重填', locked
        ? '这条验证码已经被系统作废，再填一次同样不会通过。'
        : '这条验证码在系统里已经不存在了，再填一次同样不会通过。'],
      [locked ? '为什么会这样' : '可能的原因', locked
        ? '同一条验证码连续填错太多次。这是防止有人逐个猜码的保护，不是封号，也不影响你的账号。'
        : '超过了验证码的有效期，或者这条码之前已经用过一次。'],
      ['二维码还在', '这张二维码没有因此作废；但它有自己的时限，来不及就回一体机重新生成。'],
      ['一直收不到短信', '回一体机在屏幕上换其他登录方式，或请现场工作人员协助。']
    ])
    return out
  }
  if (S.state === 'send-limited') {
    out += facts([
      ['为什么会这样', '为了防止短信被滥用，系统对同一个号码、同一个网络、同一台手机都设了频率上限。'],
      /* 「还要等多久」和「怎么才能恢复」是两件事，两种口径的答案正好相反：
         tomorrow 等没有用，只能换号；later 只能等，换号也不一定管用（限的可能是网络或这台手机）。
         两条都不许把系统的剩余时间说成一个具体的数 —— 本页读不到它。 */
      ['还要等多久', S.limitKind === 'tomorrow'
        ? '系统那边到明天才会放开，本页看不到具体时间；等在这一页没有意义。'
        : '系统那边还要多久，本页看不到，不会给你一个编出来的秒数。本页自己留了 <b>' +
          RETRY_GATE_SECONDS + ' 秒</b>最短等待，按钮上倒数的是这个数；它走完只是允许你再试一次，不代表一定发得出去。'],
      ['怎么才能恢复', S.limitKind === 'tomorrow'
        ? '换一个本人手机号，' + (S.locked ? '点上面的「更换」改号，' : '直接改上面的手机号，') +
          '就能马上重新获取；这个号码今天不用再试了。'
        : '等按钮可以点了再点一次「' + sendVerb() + '」。换号不一定管用 —— 被限的可能是当前网络或这台手机，不只是这个号码。'],
      ['之前的验证码', S.locked && !S.hasUsableCode
        ? '手上那条已经不能用了，现在一条可填的都没有，只能等「重新获取」可以点了再拿一条新的。'
        : '如果刚才收到过一条，可以再核对一次；本页看不到它还剩多少有效期，也不能保证它一定还有效。'],
      ['实在等不了', '回一体机在屏幕上换其他登录方式，或请现场工作人员协助。']
    ])
    return out
  }
  out += facts([
    ['这一步做什么', '完成手机号验证，并确认本次一体机登录请求。'],
    ['只确认这一台', '只确认你刚才亲手扫的那台机器；别人转发或代扫的二维码不要确认。'],
    ['确认之后', '登录动作在一体机上完成，手机不会登录，也不会保存你的账号。'],
    ['手机号', '完整号码只在填写时出现在输入框里供本人核对；获取验证码后锁定并改为脱敏显示。系统中加密存储。']
  ])
  return out
}

/* ══ 手机上传 ═══════════════════════════════════════════════════════════ */
var UP_STEPS = ['选手机里的文件', '系统接收', '回一体机确认']

/* 选择区永远用**保守通用档**：真实用途要等服务端回执才知道，
   在那之前放宽 accept 等于让 URL 里一个可改的值决定这次会话能收什么。 */
function acceptAttr () {
  return GENERIC.exts.map(function (e) { return '.' + e }).join(',')
}
/* mode: 'ready' 可选 | 'busy' 本页正在上传 | 'wait' 系统里已有一次上传在处理
        | 'unknown' 结果未知，不许盲传 | 'dead' 二维码已失效，不能再传 */
function picker (mode) {
  var off = mode !== 'ready'
  var head = mode === 'busy' ? '正在上传，请稍候'
    : mode === 'wait' ? '这个二维码上已有一次上传在处理'
      : mode === 'unknown' ? '这次上传的结果还不确定'
        : mode === 'dead' ? '这个二维码不能再上传了'
          : '选择手机里的文件'
  var hint = mode === 'busy' ? '这次上传结束前不能再选别的文件。'
    : mode === 'wait' ? '同一个二维码同一时间只处理一次上传，请稍候，不要重复选择文件。'
      : mode === 'unknown' ? '在弄清上一次到底成没成之前，本页不让你再传一份。'
        : mode === 'dead' ? '请回一体机重新生成上传二维码，再用新的二维码选择文件。'
          : '支持 ' + GENERIC.chips.join(' / ') + '，单个不超过 <b>10MB</b>；选中后立即开始上传。本页只做基本预检，最终以系统检查为准。'
  var pill = mode === 'busy' ? '上传中' : mode === 'wait' ? '处理中'
    : mode === 'unknown' ? '暂不可选' : mode === 'dead' ? '不可用' : '选择文件'
  var icon = mode === 'busy' ? 'loader' : mode === 'wait' ? 'wait'
    : mode === 'unknown' ? 'help' : mode === 'dead' ? 'ban' : 'upload'
  return '<label class="picker" data-mode="' + mode + '" data-testid="' + tid('upload-picker') + '"' +
    (off ? ' aria-disabled="true"' : '') + '>' +
    '<input type="file" class="sr-only" id="up-file" data-testid="' + tid('upload-file-input') + '" ' +
    'accept="' + acceptAttr() + '"' + (off ? ' disabled' : '') +
    ' aria-label="选择要上传的文件">' +
    '<span class="ic">' + svg(icon, 30) + '</span>' +
    '<b>' + head + '</b>' +
    '<span class="hint">' + hint + '</span>' +
    '<span class="pill">' + pill + '</span>' +
    '</label>'
}
function filebox (removable, tone, noteHtml) {
  var out = '<section class="filebox" data-testid="' + tid('upload-filebox') + '">' +
    '<div class="fb-head">本次文件<span>' + (S.file ? '1 个 · 上限 1 个' : '0 个') + '</span></div>'
  if (S.file) {
    out += '<div class="filerow" data-testid="' + tid('upload-file-row') + '">' +
      '<span class="fi">' + svg('file', 20) + '</span>' +
      '<span class="meta"><b>' + esc(S.file.name) + '</b>' +
      '<small>' + fmtSize(S.file.size) + ' · ' + extLabel(S.file.ext) + '</small></span>' +
      (removable
        ? '<button type="button" class="rmbtn" data-act="remove-file" data-testid="' + tid('upload-remove') +
          '" aria-label="移除已选择的文件">' + svg('trash', 20) + '</button>'
        : '<button type="button" class="rmbtn" aria-disabled="true" data-testid="' + tid('upload-remove') +
          '" aria-label="当前不能移除这个文件">' + svg('trash', 20) + '</button>') +
      '</div>'
  } else {
    out += '<div class="empty" data-testid="' + tid('upload-empty') + '">尚未选择文件</div>'
  }
  if (noteHtml) out += '<p class="pg-note" data-tone="' + (tone || 'calm') + '">' +
    '<span class="ic">' + svg(tone === 'error' ? 'alert' : tone === 'warn' ? 'help' : 'info', 16) + '</span><span>' + noteHtml + '</span></p>'
  return out + '</section>'
}
function progress (head, right, fill, tone, note) {
  return '<section class="progress" data-testid="' + tid('upload-progress') + '" role="status">' +
    '<div class="pg-head"><b>' + head + '</b><span>' + right + '</span></div>' +
    '<div class="track"><i data-fill="' + fill + '"></i></div>' +
    '<p class="pg-note" data-tone="' + tone + '"><span class="ic">' +
    svg(tone === 'error' ? 'alert' : tone === 'warn' ? 'help' : tone === 'ok' ? 'check' : 'shield', 16) +
    '</span><span>' + note + '</span></p>' +
    '</section>'
}
/* 去处行：服务端回执确认用途之前，只说「这一次上传」，不说是哪一步。
   fragment 里的 purpose 只作为**未确认提示**露出来，并当场说明它不决定任何事 ——
   它可以被随手改掉，页面按它决定去向、留存或格式，就是把一个可改的值当成事实。 */
function targetRow () {
  if (S.confirmedPurpose) {
    return '<p class="target" data-testid="' + tid('upload-target') + '" data-confirmed="1">' +
      '<span class="ic">' + svg('monitor', 20) + '</span><span>' +
      PURPOSES[S.confirmedPurpose].target + '</span></p>'
  }
  var hint = S.hintedPurpose && PURPOSES[S.hintedPurpose] && !PURPOSES[S.hintedPurpose].blocked
    ? '<span class="unsure">链接里写着这次可能是「' + PURPOSES[S.hintedPurpose].label +
      '」。本页无法核对这句话，也不按它决定任何事。</span>'
    : ''
  return '<p class="target" data-testid="' + tid('upload-target') + '" data-confirmed="0">' +
    '<span class="ic">' + svg('monitor', 20) + '</span><span>' +
    '这份文件用于一体机发起的这一次上传。具体是哪一步、允许哪些格式、留多久，' +
    '以系统对这次上传的核对结果为准。' + hint + '</span></p>'
}
/* 时限口径：手机端拿到的只有 sessionId / token / purpose 三个参数（buildPhoneUploadUrl
   的 fragment），**没有 expiresAt** —— 本页无从知道已经过去多久。所以只能写「自一体机
   生成起 10 分钟内有效」这条不变的事实，绝不能写成「还剩 10 分钟」。

   删除口径（改过两轮，按 upload-sessions.service.ts 重新对过）：
   cleanupAbandonedFile 不是一个到点就跑的定时任务，它只在**一体机那边发生动作**时被调用 ——
   getStatus 读到会话已过期、confirm 撞上已过期、或者一体机上点了取消（:173 / :282 / :335）。
   而且它有一条提前 return：文件已经绑到会员（endUserId 或 ownerType==='user'）就直接跳过，
   那份文件改按自己的留存策略走。所以两句话都不能写：
     ·「二维码 10 分钟到期 = 文件已经被删掉」是假的；
     ·「按短期留存期限清理」也是假的 —— 它读起来像一个有期限的承诺，可事实上
       清理只在别人来动这个会话时才可能发生，没人来动就一直不发生。
   本页因此只写站得住的三件事：没确认的文件不会进入本次任务、不会进入会员资料；
   系统按短期留存策略处理，后续状态核对或取消时**可能**触发清理；到期不等于已经删掉。
   不给具体秒数，也不给具体删除时点。 */
function retainFacts () {
  var rows = [
    ['链接时限', '这个二维码自<b>一体机生成起 ' + UPLOAD_TTL_SECONDS / 60 + ' 分钟</b>内有效；本页看不到已经过去多久，来不及就回一体机重新生成。'],
    ['没去确认', '没有在一体机上确认的文件，<b>不会</b>进入本次任务，也不会进入你的会员资料；系统按短期留存策略处理，后续状态核对或取消时可能触发清理。'],
    ['到期不等于已删除', '二维码到期只说明这个链接不能再用来上传，<b>不等于</b>这份文件当场就被删掉。']
  ]
  /* 留存时长按用途分档，所以**只有服务端确认了用途才能写具体数字**。
     没确认就写「90 天 / 24 小时 / 2 小时」，等于让 URL 里一个可改的值替系统承诺留存。 */
  rows.push(S.confirmedPurpose
    ? ['确认之后', PURPOSES[S.confirmedPurpose].retain]
    : ['确认之后', '按系统核定的用途留存，时长以一体机上那一步的说明为准；系统给出结果之前，本页不显示具体时长。'])
  if (!S.confirmedPurpose) {
    rows.push(['其他格式', '在系统核对用途之前，本页只放行 <b>PDF / JPG / PNG</b>。要传 Word 或其他格式，请回一体机按那一步屏幕上的说明操作。'])
  }
  return facts(rows)
}
/* 浏览器没给类型时的如实说明：可以继续，但不能顺口承诺一定能传成功。 */
function unknownTypeNote () {
  return S.unknownType
    ? '手机没有告诉本页这个文件的类型，本页只能按文件名后缀预检；能不能收下以系统的检查结果为准。'
    : ''
}

function renderUpload () {
  var st = S.state
  var out = ''

  if (st === 'signature-blocked') {
    /* 诚实不可用：CreateUploadSessionDto 的 @IsIn 白名单不含 signature_image，
       一体机根本发不出这个用途的会话，所以这里不能画成「可以传，只是失败了」。
       链接里那个用途本来就是未经核对的提示 —— 但提示可以用来**关**，不能用来**开**：
       既然系统当前不可能开出这种会话，就一律拦死，不留任何成功路径。
       出路只许写已验证存在的那一条：SignStampPage 第 2 步的「本机上传」
       （accept="image/jpeg,image/png"，走 kioskUploadFile）。同一步里的签名画布当前
       还是预留区（那一页自己写着「触屏手写将在校准后开放」），把印章放进扫描仪盖章
       这条链路在代码里根本不存在 —— 两条都未验证，不得写进用户可见文案。 */
    out += statecard('warn', 'ban', 'upload-state-signature-blocked', '签名 / 印章暂不支持手机上传',
      '请回到一体机，在「签名盖章」的第 2 步用「本机上传」选一张已有的 JPG / PNG 图片。')
    out += '<div class="grow"></div>'
    out += facts([
      ['为什么不可用', '手机上传当前只接受 <b>简历 / 打印文件 / 合同</b>，签名与印章不在其中，系统不会为它开出上传链接。'],
      ['不是你的问题', '不是文件格式不对，也不是网络问题，换张图或换台手机都不会变。'],
      ['现场怎么办', '回一体机在「签名盖章」的第 2 步点<b>本机上传</b>，选一张已有的 JPG / PNG 图片。'],
      ['还是不行', '返回上一步，或请现场工作人员协助；本页没有别的上传方式可试。']
    ])
    return out
  }

  if (st === 'invalid') {
    /* invalid **只**表示链接本身不成立：缺 sessionId / token。
       它和「过期 / 已用过」不是一回事 —— 那些走 session-expired。
       注意：链接里的用途读不懂**不算**链接坏了。用途本来就只是提示，
       真值在服务端；因为一个提示词不认识就把整条链路判死，是本页越权。 */
    out += statecard('warn', 'alert', 'upload-state-invalid', '这个链接不能用来上传',
      '链接里缺少必要信息，本页不知道该把文件发到哪一次上传。请回到一体机，在屏幕上重新生成上传二维码。')
    out += '<div class="grow"></div>'
    out += facts([
      ['常见原因', '链接是转发或收藏来的，里面的信息不完整；也可能复制时被截断了。'],
      ['和过期无关', '本页连这次要发到哪里都没读到，所以不是「二维码超时」那种情况。'],
      ['怎么办', '回一体机，在需要上传的那一步重新生成二维码，用手机相机扫屏幕上的码。']
    ])
    return out
  }

  if (st === 'success') {
    /* 只等于 status: uploaded。这一屏能证明的仅仅是「系统收到了这个文件」——
       没有确认、没有进任务、没有开始打印或简历处理，也不代表它会被留下来。
       这一屏不渲染选择区 —— 一张二维码只收一个文件，成功之后不能再传第二个。
       用途也是在**这一刻**才第一次确定：uploadFile 的回执体是
       UploadSessionStatusResponse，里面带着服务端存的 purpose。
       用户可见文案里不出现「服务端」「上传会话」这类工程词：它们是内部说法，
       对着手机屏幕的人读不出下一步，只会以为文件已经到位了。
       另外也不再断言「一体机上还没有出现这份文件」—— 一体机屏幕上此刻显示什么，
       本页同样看不到，那是另一台设备的状态。只说这份文件还没进入本次任务。 */
    var cfg = PURPOSES[S.confirmedPurpose] || null
    out += '<section class="donecard" data-testid="' + tid('upload-state-success') + '" role="status">' +
      '<span class="glyph">' + svg('check', 26) + '</span>' +
      '<b>已收到</b>' +
      '<span>系统已收到这份文件，请回一体机确认使用。手机这一页可以关掉了。</span>' +
      '</section>'
    if (cfg) {
      out += notice('ok', 'info', '系统核对后确认：这次上传用于<b>' + cfg.label + '</b>。', 'upload-purpose-confirmed')
    }
    out += filebox(false, 'ok',
      '它<b>尚未进入本次任务</b>，也没有开始打印或简历处理；是否使用由你在一体机上确认。')
    out += '<div class="grow"></div>'
    out += retainFacts()
    return out
  }

  if (st === 'session-expired') {
    /* EXPIRED / NOT_PENDING / NOT_FOUND / TOKEN_INVALID：服务端已经不会再收这个会话的文件，
       所以选择区必须禁用 —— 留着可点只会让人一次次白试。
       但**不能**顺口说「文件没发出去」：NOT_PENDING 的意思恰恰是这个二维码之前已经用过，
       那一次很可能是成功的。本页看不到那边的结果，只能把人送回一体机核对。 */
    out += targetRow()
    out += picker('dead')
    out += filebox(false, 'error',
      '系统没有接收<b>刚才这一次</b>上传。如果这个二维码之前已经被用过一次，那一次是否成功，本页看不到。')
    out += progress('这次没有被接收', '需回一体机', 'error', 'error',
      '这个二维码已经失效或已经用过了，本页不能再发送文件。')
    out += '<div class="grow"></div>'
    out += facts([
      ['常见原因', '二维码自一体机生成起 <b>' + UPLOAD_TTL_SECONDS / 60 + ' 分钟</b>内有效，超时就不能再用；一张二维码也只接收一个文件，已经用过就不能再传。'],
      ['先做这个', '回一体机看屏幕：那边已经收到文件就直接确认使用，不用再传一遍。'],
      ['一体机上没有', '在一体机上重新生成上传二维码，再用新的二维码选择文件。'],
      ['你手机里的文件', '没有任何变化，本页也没有删除它。']
    ])
    return out
  }

  if (st === 'upload-in-progress') {
    /* UPLOAD_SESSION_UPLOAD_IN_PROGRESS：服务端的上传锁还在别人（或上一次请求）手上
       （upload-sessions.service.ts 的 setNxEx 锁，UPLOAD_LOCK_TTL_SECONDS = 30）。
       这条**不能**劝用户重选：正在处理的那一次可能马上就成功，
       这时候再塞一份进来，只会让「一体机上到底该确认哪一份」变得更难说清。 */
    out += targetRow()
    out += picker('wait')
    out += filebox(false, 'calm',
      '系统正在处理这个二维码上的一次上传。那一次会不会成功，本页还不知道。')
    out += progress('系统正在处理', '请稍候', 'busy', 'calm',
      '请稍等片刻，不要重复选择文件；处理结果以一体机屏幕上的显示为准。')
    out += '<div class="grow"></div>'
    out += facts([
      ['为什么不能重选', '同一个二维码同一时间只处理一次上传，系统已经在处理了。'],
      ['现在做什么', '稍等片刻，然后回一体机看屏幕：收到文件就直接在一体机上确认使用。'],
      ['一直没动静', '回一体机看屏幕；需要的话在一体机上重新生成上传二维码。'],
      ['链接时限', '二维码自<b>一体机生成起 ' + UPLOAD_TTL_SECONDS / 60 + ' 分钟</b>内有效。']
    ])
    return out
  }

  if (st === 'outcome-unknown') {
    /* 请求发出去了，但没拿到结果（断网、切后台、回执丢失）。
       两句话都不能说：不能说「已经收到」，也不能说「没有收到」。
       所以这一屏禁用选择区 —— 盲目重传的代价是一体机上出现两份、用户更难判断；
       正确的下一步只有一个：回一体机看那边的真实状态。 */
    out += targetRow()
    out += picker('unknown')
    out += filebox(false, 'warn',
      '这份文件有没有被系统接收，本页<b>不知道</b>：既不能说已经接收，也不能说没有接收。')
    out += progress('结果未知', '需回一体机核对', 'unknown', 'warn',
      '网络中断、或者结果没能传回这一页时会这样。请回一体机看屏幕上的结果。')
    out += '<div class="grow"></div>'
    out += facts([
      ['第一步', '回一体机看屏幕：那边已经收到文件，就直接在一体机上确认使用。'],
      ['不要反复重传', '万一刚才那次其实成功了，再传一份只会让人分不清这次任务用的是哪一份。'],
      ['一体机上没有', '在一体机上刷新或重新生成上传二维码，再用新的二维码选一次文件。'],
      ['你手机里的文件', '没有任何变化，本页也没有删除它。']
    ])
    return out
  }

  if (st === 'service-error') {
    /* **服务端明确回了失败**才走这条：文件检查没过，或存储没写成。
       服务端在 files.upload 抛错时会把会话从 uploading 退回 pending
       （upload-sessions.service.ts:257），所以原链接**可能**仍然可用 —— 只说可能：
       那一步是 best-effort（带 .catch），而且二维码本身还有时限。
       注意这里**不包含**网络中断：那种情况没有服务端结论，走 outcome-unknown。 */
    out += targetRow()
    out += picker('ready')
    out += filebox(true, 'error',
      '系统明确回了失败：这次上传没有被接收。可能是系统对这个文件的检查没通过，也可能是存储没写成。')
    out += progress('系统未接收，可以重试', '可重新选择', 'error', 'error',
      '系统已经把这个二维码退回到可以再传一次的状态，原链接<b>可能</b>还能继续用；本页无法保证它一定还有效。')
    out += '<div class="grow"></div>'
    out += facts([
      ['再试一次', '重新选择文件即可；如果换个文件就好了，多半是刚才那份系统不接受。'],
      ['和断网不同', '这一条是系统明确说了「没收下」。如果是网络断开或没拿到结果，本页会告诉你「结果未知」，那种情况不要重复发送。'],
      ['连着失败', '别在这里反复试。回一体机看屏幕上的结果，需要的话在一体机上重新生成二维码。'],
      ['链接时限', '二维码自<b>一体机生成起 ' + UPLOAD_TTL_SECONDS / 60 + ' 分钟</b>内有效。']
    ])
    return out
  }

  out += targetRow()
  out += steps(UP_STEPS)

  if (st === 'uploading') {
    out += picker('busy')
    out += filebox(false, 'calm', unknownTypeNote())
    out += progress('正在上传，请稍候…', '请勿关闭本页', 'busy', 'calm',
      '上传完成只表示系统收到了文件，还需要你回一体机确认才会被使用。')
  } else if (st === 'empty-error') {
    out += picker('ready')
    out += filebox(true, 'error',
      '这个文件是 <b>0 字节</b>，没有内容，本页没有把它发出去。请确认文件是否下载完整，或者换一个文件。')
    out += progress('文件为空，未上传', '未发送', 'error', 'error',
      '这是手机端的预检，系统没有收到这份文件。')
  } else if (st === 'too-large') {
    out += picker('ready')
    out += filebox(true, 'error',
      '这个文件 <b>' + (S.file ? fmtSize(S.file.size) : '') + '</b>，超过单个 <b>10MB</b> 的上限，没有发出去。请压缩后再选一次。')
    out += progress('文件太大，未上传', '未发送', 'error', 'error',
      '体积是在手机上就拦下的，系统没有收到这份文件。')
  } else if (st === 'type-error') {
    out += picker('ready')
    out += filebox(true, 'error',
      '这份' + (S.file ? extLabel(S.file.ext) : '文件') + '不在本页现在能发送的格式里，没有发出去。')
    out += '<div class="sect">现在能发送的格式</div>' + chips(GENERIC.chips)
    out += progress('格式不支持，未上传', '未发送', 'error', 'error',
      '系统还没有告诉本页这次上传的真实用途，所以只放行三种通用格式；要传别的格式请回一体机按那一步的说明操作。')
  } else if (st === 'content-type-error') {
    /* 两种成因分开写：类型本身不被接受，和「类型与后缀对不上」。
       后者对应服务端的 FILE_EXT_MISMATCH（防 .exe 伪装成 image/png）。
       原始类型标识是工程内部串，只用 MIME_LABEL 的中文说法，不上屏。 */
    var label = S.file && S.file.type ? typeLabel(S.file.type) : '另一种格式'
    out += picker('ready')
    out += filebox(true, 'error', S.typeIssue === 'mismatch'
      ? '这个文件的后缀是 <b>.' + (S.file ? esc(S.file.ext) : '') + '</b>，手机却把它认成了<b>' + label + '</b>。两者对不上，系统会因此拒收，本页先拦下了。'
      : '手机把这个文件认成了<b>' + label + '</b>，不在本页现在能发送的格式里，没有把它发出去。')
    out += '<div class="sect">现在能发送的格式</div>' + chips(GENERIC.chips)
    out += progress('文件类型不匹配，未上传', '未发送', 'error', 'error',
      '这是手机端的预检，不能代替系统检查；请换一个文件，或用原始格式重新导出一次。')
  } else {
    out += picker('ready')
    out += filebox(false, 'calm', '')
    out += progress('等待选择文件', '自生成起 ' + UPLOAD_TTL_SECONDS / 60 + ' 分钟内有效', 'idle', 'calm',
      '本页只做这一次上传，不会登录你的账号，也读不到手机里的其他文件。')
  }

  out += '<div class="grow"></div>'
  out += retainFacts()
  return out
}

/* ══ 渲染与事件 ═════════════════════════════════════════════════════════ */
function chromeCopy () {
  if (S.screen === 'qr-login') {
    rbSub.textContent = S.state === 'ticket-expired'
      ? '手机确认登录 · 需回一体机重新生成'
      : S.state === 'confirm-unknown'
        ? '手机确认登录 · 结果需回一体机核对'
        : '手机确认登录 · 确认后回一体机'
    rbTag.textContent = S.state === 'ticket-expired'
      ? '需回一体机'
      : S.state === 'confirm-unknown' ? '结果待核对' : '登录接力'
    footIc.innerHTML = svg('shield', 16)
    footCopy.innerHTML = '本页只做这一次登录确认，不读取手机里的其他信息；手机号在系统中加密存储，完整号码只在输入框内供本人核对，获取验证码后改为脱敏显示。'
    return
  }

  /* 不可用 / 已失效 / 结果未知的状态不能沿用上传壳层文案：这些路径已经发不出文件，
     顶栏再写「传完回一体机确认」、页脚再写「一次性上传链接」，
     等于整屏其他位置仍在承诺一个做不到的上传。 */
  if (S.state === 'signature-blocked') {
    rbSub.textContent = '签名 / 印章 · 手机端不可用'
    rbTag.textContent = '需回一体机'
    footIc.innerHTML = svg('ban', 16)
    footCopy.innerHTML = '本页当前没有可用的上传入口，也不会发送任何文件；签名 / 印章图片请回一体机在原步骤上传。'
    return
  }
  if (S.state === 'invalid' || S.state === 'session-expired') {
    rbSub.textContent = S.state === 'invalid' ? '上传链接不可用' : '手机上传 · 需回一体机重新生成'
    rbTag.textContent = '需回一体机'
    footIc.innerHTML = svg('ban', 16)
    footCopy.innerHTML = '本页当前不能再发送文件；请回一体机重新生成上传二维码后再扫一次。'
    return
  }
  if (S.state === 'outcome-unknown') {
    rbSub.textContent = '手机上传 · 结果需回一体机核对'
    rbTag.textContent = '结果待核对'
    footIc.innerHTML = svg('help', 16)
    footCopy.innerHTML = '本页没有拿到这次上传的结果，既不代表已接收，也不代表未接收；请回一体机看屏幕上的状态。'
    return
  }
  /* 用途只有在服务端回执确认之后才写进顶栏。之前一律写通用说法：
     顶栏是整屏最像「系统结论」的位置，不能拿一个可改的 URL 值去填。 */
  var confirmed = S.confirmedPurpose ? PURPOSES[S.confirmedPurpose] : null
  rbSub.textContent = confirmed
    ? confirmed.label + ' · 请回一体机确认'
    : '手机上传 · 传完回一体机确认'
  rbTag.textContent = S.state === 'upload-in-progress' ? '处理中' : '上传接力'
  footIc.innerHTML = svg('shield', 16)
  footCopy.innerHTML = '本页使用一次性上传链接，不会登录你的账号；这次上传的用途、允许格式和留存时长以系统核对结果为准。'
}

function render () {
  stage.setAttribute('data-screen', S.screen)
  stage.setAttribute('data-state', S.state)
  /* 每一态一个唯一且稳定的钩子。data-screen / data-state 保持原样不动 ——
     它们是两个正交维度，取证与断言按维度筛选时还要用；这里额外给出的是
     「屏 + 态」合成的单一选择器，省得每次都写两个属性选择器串起来。 */
  stage.setAttribute('data-testid', 'relay-' + S.screen + '-' + S.state)
  /* data-* 只写**已确认**的事实：URL fragment 里的 purpose 是未经核对的提示，
     写进 data-purpose 就等于把它固定成结论（截图、取证、断言都会照着读）。 */
  if (S.screen === 'qr-login') {
    stage.setAttribute('data-purpose', 'none')
    stage.setAttribute('data-purpose-confirmed', '0')
  } else {
    stage.setAttribute('data-purpose', S.confirmedPurpose || 'unconfirmed')
    stage.setAttribute('data-purpose-confirmed', S.confirmedPurpose ? '1' : '0')
  }
  chromeCopy()
  flow.innerHTML = S.screen === 'qr-login' ? renderQr() : renderUpload()
  cta.innerHTML = S.screen === 'qr-login' ? qrCta() : ''
  bind()
  if (DEBUG) renderPanel()
}

function setState (next, keepTimers) {
  if (!keepTimers) { if (S.demoTimer) { clearTimeout(S.demoTimer); S.demoTimer = null } }
  S.state = next
  render()
}

/* 倒计时：只在**发码成功**之后起。capture 模式钉死在一个固定值，
   让同一份源码重跑的截图逐字节相同。 */
function startCountdown () {
  if (S.timer) { clearInterval(S.timer); S.timer = null }
  S.cd = SMS_COOLDOWN
  if (CAPTURE) return
  S.timer = setInterval(function () {
    S.cd = Math.max(0, S.cd - 1)
    syncQrControls()
    if (S.cd === 0) { clearInterval(S.timer); S.timer = null }
  }, 1000)
}

/* 被频控挡下之后本页自己留的最短等待。它和上面那个冷却是**两个秒表**：
   冷却的数来自一次成功发码的回执，这个数是本页自己定的（见 RETRY_GATE_SECONDS）。
   合用一个字段会让「系统说的」和「本页说的」混成一个，文案就再也说不清了。
   capture 模式同样只钉值不走秒，保证同一份源码重跑的截图逐字节相同。 */
function startRetryGate () {
  S.retryGate = RETRY_GATE_SECONDS
  runRetryGate()
}
function runRetryGate () {
  if (S.gateTimer) { clearInterval(S.gateTimer); S.gateTimer = null }
  if (CAPTURE || S.retryGate <= 0) return
  S.gateTimer = setInterval(function () {
    S.retryGate = Math.max(0, S.retryGate - 1)
    syncQrControls()
    if (S.retryGate === 0) { clearInterval(S.gateTimer); S.gateTimer = null }
  }, 1000)
}
/* 只在**这次等待已经没有意义**时调用：发码成功（改由冷却接管），
   或服务端明确回了 SMS_SEND_FAILED —— 那条路径把冷却也一起删了，页面写着「现在就可以再点」，
   这时还留着一道本页自己的闸门，就是屏幕和按钮又对不上。 */
function stopRetryGate () {
  S.retryGate = 0
  if (S.gateTimer) { clearInterval(S.gateTimer); S.gateTimer = null }
}

/* 打字和走秒时只同步会变的那几处，不整屏重绘 —— 重绘会把输入焦点和光标位置一起弄丢。
   发码按钮的字、可点状态、旁边的解释条、确认按钮的失败原因，四处读的都是同一组判据，
   所以必须一起更新：改一个手机号就可能同时改掉按钮上的字和下面那条提示。 */
function syncQrControls () {
  var send = document.querySelector('[data-testid="' + tid('qr-send-code') + '"]')
  var sendText = document.querySelector('[data-testid="' + tid('qr-send-code-text') + '"]')
  var confirm = document.querySelector('[data-testid="' + tid('qr-confirm') + '"]')
  var reason = document.querySelector('[data-testid="' + tid('qr-confirm-reason') + '"]')
  var block = document.querySelector('[data-testid="' + tid('qr-send-block') + '"]')
  if (sendText) sendText.textContent = sendLabel()
  if (send) {
    send.setAttribute('aria-label', sendLabelAria())
    if (canSend()) send.removeAttribute('aria-disabled')
    else send.setAttribute('aria-disabled', 'true')
  }
  if (confirm) {
    if (canConfirm()) confirm.removeAttribute('aria-disabled')
    else confirm.setAttribute('aria-disabled', 'true')
  }
  if (reason && S.state !== 'confirm-unknown') reason.textContent = confirmReason()
  /* 这一块里没有可点的东西，换 innerHTML 不需要重新绑事件。 */
  if (block) block.innerHTML = sendBlockHtml()
}

function bind () {
  var phone = document.getElementById('qr-phone')
  if (phone) {
    phone.addEventListener('input', function () {
      var v = digits(phone.value, 11)
      if (v !== phone.value) phone.value = v
      S.phone = v
      syncQrControls()
    })
  }
  var code = document.getElementById('qr-code')
  if (code) {
    code.addEventListener('input', function () {
      var v = digits(code.value, 6)
      if (v !== code.value) code.value = v
      S.code = v
      syncQrControls()
    })
  }
  var file = document.getElementById('up-file')
  if (file) file.addEventListener('change', onPickFile)

  var acts = flow.querySelectorAll('[data-act]')
  for (var i = 0; i < acts.length; i++) acts[i].addEventListener('click', onAct)

  var send = document.querySelector('[data-testid="' + tid('qr-send-code') + '"]')
  if (send) send.addEventListener('click', onSendCode)
  var confirm = document.querySelector('[data-testid="' + tid('qr-confirm') + '"]')
  if (confirm) confirm.addEventListener('click', onConfirm)
  var recheck = document.querySelector('[data-testid="' + tid('qr-recheck') + '"]')
  if (recheck) recheck.addEventListener('click', function () { runRecheck('ready') })
  var recheckCta = document.querySelector('[data-testid="' + tid('qr-recheck-cta') + '"]')
  if (recheckCta) recheckCta.addEventListener('click', function () { runRecheck('ticket-expired') })
}

/* 「重新检查」= 再读一次这张二维码的状态（生产里就是 status 那一次读取）。
   两个入口落点不同，因为出发点不同：
     status-error  → 上一次连状态都没读到，重读成功就回到可填表单的 ready；
     confirm-unknown → 真实世界有三种落点：已确认 / 已被领取 / 仍然待确认。
       演示固定走 ticket-expired，因为它的文案对三种成因都成立（超时、已领取、已确认过），
       不会把「成功了」这个结论替服务端说出去；另外两种落点在演示面板里可直接到达。 */
function runRecheck (target) {
  S.recheckTo = target
  setState('checking')
  demoAfter(900, function () {
    S.deviceLabel = DEMO_DEVICE_LABEL
    S.remain = target === 'ticket-expired' ? null : DEMO_QR_REMAINING
    setState(target)
  })
}

function onAct (e) {
  var el = e.currentTarget
  if (el.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return }
  var act = el.getAttribute('data-act')
  if (act === 'change-phone') {
    /* 换号 = 之前那次发码对新号码毫无意义，回到「还没发过码」：
       locked 与 hasUsableCode **一起**清掉，再清验证码、停倒计时。
       只清 locked 不清 hasUsableCode，会让新号码继承上一号「有码可填」的假事实。 */
    S.locked = false
    S.hasUsableCode = false
    S.code = ''
    S.cd = 0
    if (S.timer) { clearInterval(S.timer); S.timer = null }
    /* 换号**不**撤销这两条，理由不同，但都是「换号改变不了的事实」：
       · retryGate：稍后口径限的可能是当前网络或这台手机，换个号码不一定就放行；
       · dailyLimitedPhone：它记的是**哪个号码**今天不能再发。留着它，用户把旧号码
         原样填回来时页面仍然拦得住 —— 清掉就等于假装那条上限没发生过。
       所以 sendBlockedBy 会继续读它们，直到等待走完 / 号码真的换成另一个。 */
    setState(S.deviceLabel ? 'ready' : 'device-missing')
    var p = document.getElementById('qr-phone')
    if (p) p.focus()
  } else if (act === 'remove-file') {
    S.file = null
    S.errCode = null
    S.typeIssue = null
    S.unknownType = false
    setState('idle')
  }
}

/* 发码：**先进在途态，成功回执才锁号起倒计时**。
   演示分支（不属于产品逻辑）按手机号末四位分叉，对应四条真实回执：
     ...0000 → send-error   （SMS_SEND_FAILED：短信通道没发出去，验证码与冷却都被删）
     ...1111 → send-limited （稍后：SMS_TOO_FREQUENT / IP / DEVICE / PROVIDER_RATE_LIMIT）
     ...2222 → send-limited （明天：SMS_DAILY_LIMIT / PROVIDER_PHONE_DAILY_LIMIT）
     其他    → 成功（sent:true, cooldownSeconds:60, expiresInSeconds:300） */
function onSendCode (e) {
  e.preventDefault()
  if (!canSend()) return
  var tail = S.phone.slice(-4)
  setState('send-loading')
  demoAfter(900, function () {
    if (tail === '0000') {
      /* 服务端这条路径把刚写进去的验证码和冷却一起删了，等于「一条都没有」：
         locked 与 hasUsableCode 一起退回未发码状态，
         否则页面会留着一个不存在的码让人去填。 */
      S.errCode = 'SMS_SEND_FAILED'
      S.locked = false
      S.hasUsableCode = false
      S.code = ''
      S.cd = 0
      /* 这一屏明写着「现在就可以再点」，所以本页那道最短等待也必须一起撤掉，
         否则文案和按钮当场对不上。 */
      stopRetryGate()
      setState('send-error')
      return
    }
    if (tail === '1111' || tail === '2222') {
      /* 频控挡下时 locked 与 hasUsableCode **都不改**，因为这次请求什么都没改变：
         之前真发出过一条、它也还没被服务端销毁 → hasUsableCode 仍是 true，可以接着填；
         之前那条已经过期或被作废（expired / locked 来的）→ 仍是 false，
         输入框和确认按钮必须继续禁着 —— 这一条正是拆分 locked / hasUsableCode 的理由。
         两种情况页面都不替服务端下新结论。
         但**这次点击必须留下一个真实后果**：屏幕上写着「稍后再试 / 明天再试」，
         按钮却马上又能点，那就是页面在自己拆自己的台。两种口径落成两种不同的约束： */
      S.errCode = tail === '2222' ? 'SMS_DAILY_LIMIT' : 'SMS_TOO_FREQUENT'
      S.limitKind = tail === '2222' ? 'tomorrow' : 'later'
      if (S.limitKind === 'tomorrow') {
        /* 每日上限是按号码计的：只钉住这一个号码，换成另一个本人手机号仍然能发。
           这里**不起**最短等待 —— 起了就等于暗示「等一会儿这个号码还能发」，那是假的。 */
        S.dailyLimitedPhone = S.phone
        stopRetryGate()
      } else {
        /* 稍后口径限的可能是号码、网络或这台手机，本页分不清，所以拦的是**这一页**，
           换号也不解除；能给的唯一诚实承诺是「至少等这么久，然后可以再试一次」。 */
        startRetryGate()
      }
      setState('send-limited')
      return
    }
    S.errCode = null
    S.locked = true
    S.hasUsableCode = true
    /* 发成功了，本页那道最短等待就没有意义了：接下来由回执给的 60 秒冷却接管。 */
    stopRetryGate()
    startCountdown()
    setState('code-sent')
    var c = document.getElementById('qr-code')
    if (c) c.focus()
  })
}

/* 确认：同样先进在途态。演示分支对应五条真实分叉：
     000000 → confirm-code-invalid （SMS_CODE_INVALID：那条码没被销毁，重填即可）
     333333 → confirm-code-expired （SMS_CODE_EXPIRED：码已不存在，必须重新获取）
     444444 → confirm-code-locked  （SMS_CODE_LOCKED：尝试过多，码已被销毁，必须重新获取）
     111111 → ticket-expired       （票据这边已经不能再确认）
     222222 → confirm-unknown      （请求发出去了，结果没回来）
   前三条都**保留** S.locked 与 S.remain：失败在短信那一侧，
   「已经成功发过码」和「二维码还有效」这两个事实都没有被推翻。
   但 hasUsableCode 只有 invalid 保留：expired / locked 那条码已经不在服务端了。 */
function onConfirm (e) {
  e.preventDefault()
  if (!canConfirm()) return
  var code = S.code
  setState('confirming')
  demoAfter(1100, function () {
    if (code === '000000') {
      /* 只清错误输入。不解锁、不动 hasUsableCode、不清倒计时 ——
         这一次比较没有消费掉那条码，用户下一步是核对最新一条再填。
         注意：保留 hasUsableCode 只是「服务端没有因为这次错误销毁它」，
         **不是**页面断定它还没过期，文案里也不许那样写。 */
      S.errCode = 'SMS_CODE_INVALID'; S.code = ''; setState('confirm-code-invalid')
    } else if (code === '333333') {
      /* 这两条码在服务端已经没有了（一个过期/不存在，一个被尝试闸主动 del 掉），
         所以 hasUsableCode 必须打掉：输入框与确认按钮一起禁用，直到重新发码成功。 */
      S.errCode = 'SMS_CODE_EXPIRED'; S.code = ''; S.hasUsableCode = false; setState('confirm-code-expired')
    } else if (code === '444444') {
      S.errCode = 'SMS_CODE_LOCKED'; S.code = ''; S.hasUsableCode = false; setState('confirm-code-locked')
    } else if (code === '111111') {
      S.errCode = 'QR_LOGIN_NOT_FOUND'; S.remain = null; setState('ticket-expired')
    } else if (code === '222222') {
      /* 结果未知：这条码到底有没有被消费，本页**不知道**，所以 hasUsableCode 不动。
         这一屏本来就整个冻住（codeInputEnabled / canConfirm 都会因状态返回 false），
         不需要、也不该在这里替服务端下一个结论。 */
      S.errCode = 'NETWORK_ERROR'; setState('confirm-unknown')  // 验证码**不清空**
    } else {
      /* 确认成功 = getAndDelIfEquals 相等并删掉了那条码，它已经被消费。 */
      S.errCode = null; S.hasUsableCode = false; setState('confirmed')
    }
  })
}

function onPickFile (e) {
  var input = e.currentTarget
  /* 这几种状态下不允许再选文件：正在传、已成功、系统里已有一次在处理、
     结果未知、二维码已死、链接不成立、用途被拦死。 */
  if (['uploading', 'success', 'upload-in-progress', 'outcome-unknown',
    'session-expired', 'invalid', 'signature-blocked'].indexOf(S.state) >= 0) {
    input.value = ''
    return
  }
  var f = input.files && input.files[0]
  input.value = ''
  if (!f) return
  acceptFile({ name: f.name, size: f.size, ext: extOf(f.name), type: f.type || '' })
}

/* 真前端预检：空文件、体积、后缀白名单、浏览器给出的类型白名单与「类型 ↔ 后缀」一致性。
   拦下的文件一个字节都不发出去。
   三条边界必须同时守住：
   ① 这只是手机端预检。服务端 file-validation.ts 拿真实字节按同样几项重新检查一遍，
      过了这里不等于过了那里 —— 所有文案都不许写成「校验通过」。
   ② 浏览器不给类型（f.type 为空串，安卓部分文件管理器、部分 WebView 都会这样）时
      不能一律拦死，那会把正常文件挡在门外；按后缀继续，但要如实说明只做了后缀预检。
   ③ 白名单一律用 GENERIC（三个受支持用途的交集），不用 URL 里那个可改的 purpose。
      放宽的代价是「服务端会拒」，收紧的代价只是「让用户回一体机」—— 后者可挽回。
   本页的检查顺序不代表服务端顺序，服务端会重新检查每一项。 */
function acceptFile (meta) {
  S.file = meta
  S.errCode = null
  S.typeIssue = null
  S.unknownType = !meta.type
  if (!(meta.size > 0)) { setState('empty-error'); return }
  if (meta.size > MAX_BYTES) { setState('too-large'); return }
  if (GENERIC.exts.indexOf(meta.ext) < 0) { setState('type-error'); return }
  if (meta.type) {
    if (GENERIC.mimes.indexOf(meta.type) < 0) { S.typeIssue = 'not-allowed'; setState('content-type-error'); return }
    var allowed = MIME_EXTS[meta.type]
    if (allowed && allowed.indexOf(meta.ext) < 0) { S.typeIssue = 'mismatch'; setState('content-type-error'); return }
  }
  setState('uploading')
  /* 演示分支（不属于产品逻辑）：按文件名关键词分叉，对应四条真实回执 /
     一条无回执。生产里这几步等的是 uploadFile 的返回或异常。 */
  var name = meta.name.toLowerCase()
  demoAfter(1400, function () {
    if (name.indexOf('busy') >= 0) { S.errCode = 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS'; setState('upload-in-progress'); return }
    if (name.indexOf('unknown') >= 0) { S.errCode = 'NETWORK_ERROR'; setState('outcome-unknown'); return }
    if (name.indexOf('fail') >= 0) { S.errCode = 'FILE_MIME_NOT_ALLOWED'; setState('service-error'); return }
    if (name.indexOf('expired') >= 0) { S.errCode = 'UPLOAD_SESSION_EXPIRED'; setState('session-expired'); return }
    confirmPurposeFromServer(demoServerPurpose())
    setState('success')
  })
}

/* 服务端回执里的用途，是本页唯一可信的用途来源。
   今天只有一处回执带得回它：POST /upload-sessions/:id/files 成功时返回的
   UploadSessionStatusResponse.purpose。GET /upload-sessions/:id 也带 purpose，
   但那条要 x-upload-session-control header，而手机端 fragment 里只有
   sessionId / token / purpose（buildPhoneUploadUrl），拿不到控制令牌 ——
   所以明确失败的回执**同样不会**让本页知道真实用途，那些状态一律保持未确认口径。
   函数留成通用入口：将来哪条回执带回 purpose，就在那里调它一次。 */
function confirmPurposeFromServer (purpose) {
  S.confirmedPurpose = PURPOSES[purpose] && !PURPOSES[purpose].blocked ? purpose : null
}
/* 演示用：让三种用途的成功屏都能拍到。生产里这个值来自回执体，与 fragment 无关。 */
function demoServerPurpose () {
  return S.hintedPurpose && PURPOSES[S.hintedPurpose] && !PURPOSES[S.hintedPurpose].blocked
    ? S.hintedPurpose : 'resume_upload'
}

function demoAfter (ms, fn) {
  if (S.demoTimer) clearTimeout(S.demoTimer)
  if (CAPTURE) return   // 取证模式不自行推进，状态一律由 ?state= 指定
  S.demoTimer = setTimeout(function () { S.demoTimer = null; fn() }, ms)
}

/* ══ 原型演示面板（不属于产品逻辑）═════════════════════════════════════ */
function link (label, params) {
  var u = new URLSearchParams(qs.toString())
  for (var k in params) { if (params[k] == null) u.delete(k); else u.set(k, params[k]) }
  return '<a href="?' + u.toString() + '">' + label + '</a>'
}
function renderPanel () {
  var panel = document.getElementById('demo-panel')
  if (!panel) return
  /* 数量直接从注册表算，不再手写 —— 手写的那个数在状态拆分后必然先过期。 */
  var h = '<h4>QR-LOGIN 状态（' + QR_STATES.length + '）</h4>'
  QR_STATES.forEach(function (st) {
    h += link(st, { screen: 'qr-login', state: st, limit: null, cooldown: null, code: null })
  })
  h += link('send-limited · 明天口径', {
    screen: 'qr-login', state: 'send-limited', limit: 'tomorrow', cooldown: null, code: null
  })
  /* 「手上还有没有一条可用验证码」是和状态**正交**的一个事实，所以单列一组入口：
     不这样列，send-limited 的两种真实处境就只能靠交互一步步走出来，截图拍不到。 */
  h += '<h4>手上有没有可用验证码</h4>'
  h += link('send-limited · 旧码可能还在', { screen: 'qr-login', state: 'send-limited', code: 'usable', cooldown: null, limit: null })
  h += link('send-limited · 旧码已作废（一条都没有）', { screen: 'qr-login', state: 'send-limited', code: 'none', cooldown: null, limit: null })
  h += '<h4>冷却固定 ' + DEMO_COOLDOWN_REMAIN + ' 秒（cooldown=active）</h4>'
  h += link('send-limited · 冷却中', { screen: 'qr-login', state: 'send-limited', cooldown: 'active', code: null, limit: null })
  CODE_FAIL_STATES.forEach(function (st) {
    h += link(st + ' · 冷却中', { screen: 'qr-login', state: st, cooldown: 'active', code: null, limit: null })
  })
  h += '<h4>PHONE-UPLOAD 状态（' + UPLOAD_STATES.length + '）</h4>'
  UPLOAD_STATES.forEach(function (st) {
    h += link(st, { screen: 'phone-upload', state: st, cooldown: null, code: null })
  })
  h += '<h4>成功屏的系统确认用途</h4>'
  Object.keys(PURPOSES).forEach(function (p) {
    h += link(p, {
      screen: 'phone-upload', purpose: p, cooldown: null, code: null,
      state: PURPOSES[p].blocked ? 'signature-blocked' : 'success'
    })
  })
  h += '<h4>链接里的用途提示（未确认）</h4>'
  h += link('resume_upload · idle', { screen: 'phone-upload', purpose: 'resume_upload', state: 'idle' })
  h += link('print_doc · idle', { screen: 'phone-upload', purpose: 'print_doc', state: 'idle' })
  h += link('无 purpose · idle', { screen: 'phone-upload', purpose: null, state: 'idle' })
  h += '<h4>模式</h4>' + link('flat=1', { flat: '1' }) + link('capture=1', { capture: '1' }) + link('关闭调试', { debug: null })
  panel.innerHTML = h
}
var tab = document.getElementById('demo-tab')
if (tab) tab.addEventListener('click', function () {
  root.setAttribute('data-panel', root.getAttribute('data-panel') === '1' ? '0' : '1')
})

/* ══ 启动 ══════════════════════════════════════════════════════════════ */
function boot () {
  var screen = qs.get('screen')
  S.screen = screen === 'phone-upload' ? 'phone-upload' : 'qr-login'
  /* ?purpose= 在演示里替代生产的 URL fragment（location.hash）。
     它进的是 hintedPurpose —— **未确认提示**，不进 confirmedPurpose，也不进 data-*。 */
  var purpose = qs.get('purpose')
  S.hintedPurpose = purpose && PURPOSES[purpose] ? purpose : null
  S.limitKind = qs.get('limit') === 'tomorrow' ? 'tomorrow' : 'later'

  var want = qs.get('state')
  var list = S.screen === 'qr-login' ? QR_STATES : UPLOAD_STATES
  S.state = list.indexOf(want) >= 0 ? want : (S.screen === 'qr-login' ? 'checking' : 'idle')

  /* signature_image 没有可成功的路径：链接里标着它，就一律收敛到不可用态。
     这是「提示只能收紧」的唯一用法 —— 拦死不需要核对，放行才需要。 */
  if (S.screen === 'phone-upload' && S.hintedPurpose === 'signature_image') S.state = 'signature-blocked'
  if (S.screen === 'phone-upload' && S.state === 'signature-blocked') S.hintedPurpose = 'signature_image'

  /* 演示用的预置数据：让每个状态一进来就是可读的。
     deviceLabel / remain 对应 status 接口的两个字段：
     识别完成之前（missing-ticket / checking / status-error）两个都没有，界面照实留空；
     device-missing 只缺名称，不缺时限；ticket-expired 的票据已不可用，不再显示剩余秒数。 */
  if (S.screen === 'qr-login') {
    var codeFail = CODE_FAIL_STATES.indexOf(S.state) >= 0
    /* 三个 confirm-code-* 都是「确认请求已经发出去过」才可能到达的状态，
       所以票据一定已经识别过，剩余秒数也照常显示 —— 二维码没有因此作废。 */
    var identified = codeFail || ['ready', 'send-loading', 'send-error', 'send-limited', 'code-sent',
      'confirming', 'confirm-unknown', 'confirmed', 'ticket-expired'].indexOf(S.state) >= 0
    S.deviceLabel = identified ? DEMO_DEVICE_LABEL : null
    S.remain = codeFail || ['ready', 'device-missing', 'send-loading', 'send-error', 'send-limited',
      'code-sent', 'confirming', 'confirm-unknown'].indexOf(S.state) >= 0
      ? DEMO_QR_REMAINING : null

    /* locked 只给**发码确实成功过**的状态。send-loading / send-error 都还没有成功回执，
       所以它们保持未锁定：号码可改、验证码不可填、确认不可点。
       send-limited 默认取未锁定这一支画面（最常见的是第一次就被频控挡下）。
       三个 confirm-code-* 一律 locked：能走到确认失败，就说明这一页确实成功发过码，
       这个事实不因验证码填错、过期或被作废而消失。 */
    S.locked = codeFail || ['code-sent', 'confirming', 'confirm-unknown', 'confirmed'].indexOf(S.state) >= 0
    /* hasUsableCode 比 locked 严格：只有「发过码，且服务端那条还没被销毁」才为 true。
         code-sent / confirming / confirm-unknown → 那条码没有理由已经消失；
         confirm-code-invalid                     → 这次比较没消费掉它，仍可能在；
         confirm-code-expired / -locked           → 服务端已经没有它了；
         confirmed                                → 已经被 getAndDelIfEquals 用掉。 */
    S.hasUsableCode = ['code-sent', 'confirming', 'confirm-unknown',
      'confirm-code-invalid'].indexOf(S.state) >= 0
    /* 三个 confirm-code-* 的输入框都是空的（服务端明确回了失败，页面已清空），
       倒计时也留在 0：这一屏最该被看清的就是「现在能不能重新获取」。 */
    if (S.state === 'code-sent' || S.state === 'confirming') S.cd = SMS_COOLDOWN
    /* confirming 与 confirm-unknown 的验证码**留在页面上**：
       前者正在等结果，后者的规矩就是不替用户清空。 */
    if (S.state === 'confirming' || S.state === 'confirm-unknown') S.code = '648213'

    /* ?code= 覆盖（只属于演示）：直接把「手上有没有一条可用验证码」这个事实钉住。
       它同时置 locked —— 这两支说的都是「已经成功发过码之后」的处境。 */
    if (CODE_FIXTURE === 'usable') { S.locked = true; S.hasUsableCode = true }
    if (CODE_FIXTURE === 'none') { S.locked = true; S.hasUsableCode = false }
    /* ?cooldown=active（只属于演示）：把冷却钉成固定秒数，让「重新获取还在倒计时」
       这一屏在 confirm-code-* 与 send-limited 上都能直达、都能重跑复现。
       它**不改** hasUsableCode —— 冷却只说明上一次发码成功过，
       不说明那条码现在还在。 */
    if (COOLDOWN_ACTIVE && (codeFail || S.state === 'send-limited')) {
      S.locked = true
      S.cd = DEMO_COOLDOWN_REMAIN
    }
    /* 号码回显：已锁定的状态一定有号码；发码在途 / 明确失败 / 被频控挡下这三种
       虽然没锁号，但用户确实已经填过号，输入框里照实留着。 */
    if (S.locked || ['send-loading', 'send-error', 'send-limited'].indexOf(S.state) >= 0) {
      S.phone = '13800138000'
    }
    /* 直达 send-limited 时，**挡下这次发码的那条约束也必须一起直达**。
       少了这一步，直达出来的这一屏就会写着「稍后再试 / 明天再试」而按钮照旧能点，
       点下去还能一路走到 code-sent —— 屏幕上的话和页面的行为是反的。
       两种口径落成两种不同的事实，和交互路径（onSendCode）用的是同一组字段：
         tomorrow → 钉住这个**号码**：等下去不变，改成另一个本人手机号才放行；
         later    → 起一道本页自己的最短等待：只能等，等完可以再试一次。
       注意要放在号码回填之后：tomorrow 钉的就是屏幕上这一个号码。 */
    if (S.state === 'send-limited') {
      if (S.limitKind === 'tomorrow') S.dailyLimitedPhone = S.phone
      else S.retryGate = RETRY_GATE_SECONDS
    }
  } else {
    var demoCfg = PURPOSES[S.hintedPurpose] || PURPOSES.resume_upload
    if (['uploading', 'upload-in-progress', 'outcome-unknown'].indexOf(S.state) >= 0) S.file = demoFile(demoCfg)
    if (S.state === 'success') {
      S.file = demoFile(demoCfg)
      /* 成功屏是本页唯一拿到服务端用途的地方，用它模拟回执体里的 purpose。 */
      confirmPurposeFromServer(demoServerPurpose())
    }
    if (S.state === 'too-large') S.file = { name: demoCfg.demo.name, size: 14.6 * 1024 * 1024, ext: extOf(demoCfg.demo.name), type: demoCfg.demo.type }
    if (S.state === 'empty-error') S.file = { name: '简历（下载未完成）.pdf', size: 0, ext: 'pdf', type: 'application/pdf' }
    if (S.state === 'type-error') S.file = { name: '简历扫描件.zip', size: 3.1 * 1024 * 1024, ext: 'zip', type: 'application/zip' }
    if (S.state === 'content-type-error') {
      S.file = { name: '简历照片.png', size: 1.2 * 1024 * 1024, ext: 'png', type: 'application/pdf' }
      S.typeIssue = 'mismatch'
    }
    if (S.state === 'service-error') { S.file = demoFile(demoCfg); S.errCode = 'FILE_MIME_NOT_ALLOWED' }
    if (S.state === 'session-expired') { S.file = demoFile(demoCfg); S.errCode = 'UPLOAD_SESSION_EXPIRED' }
    if (S.state === 'upload-in-progress') S.errCode = 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS'
    if (S.state === 'outcome-unknown') S.errCode = 'NETWORK_ERROR'
  }

  clearTimers()
  render()
  /* clearTimers 会把秒表一起停掉，所以最短等待的秒表只能在这之后起。
     直达时它同样一秒一秒真走 —— 等它走完，按钮才真的能点（capture 模式钉住不走）。 */
  runRetryGate()

  /* 演示串场：checking 是过程态，非取证模式下自动走到 ready，不然一进页面就卡在转圈。 */
  if (S.screen === 'qr-login' && S.state === 'checking') {
    demoAfter(1200, function () { S.deviceLabel = DEMO_DEVICE_LABEL; S.remain = DEMO_QR_REMAINING; setState('ready') })
  }
}
function demoFile (cfg) {
  return { name: cfg.demo.name, size: cfg.demo.size, ext: extOf(cfg.demo.name), type: cfg.demo.type }
}
boot()
})();
