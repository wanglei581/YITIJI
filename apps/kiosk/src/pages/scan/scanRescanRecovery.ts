import { ApiHttpError } from '../../services/api/httpAdapter'
import { errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'

/**
 * 扫描会话「创建失败之后说什么、那枚一次性重扫授权归谁」的纯判定。
 *
 * 从 ScanSettingsPage 抽出来的只有**无状态的那一半**：失败码 → 结论文案 + 两个布尔。
 * 副作用（恢复 / 丢弃授权、置状态、重发请求）仍然留在页面里，因为它们要读 ref、
 * 判代次、判是否已卸载 —— 那些是页面自己的生命周期，搬出来只会让两边都难读。
 */

/**
 * 服务端（或本机成对校验）判「这次安全重扫不作数」的四个码。
 *
 * 前三个来自 scan-tasks.service.ts：授权无效 / 已过期 / 已被消费（403）、
 * 授权正被并发处理或血缘已被占用（409）、只给了凭证没给原任务 id（400）。
 * 第四个来自本机 scanTasks.ts：拿到的是半对凭据，请求根本没发出去。
 * 四个的用户处置完全一样，所以合成一张表，页面不按码分叉。
 */
export const SCAN_RESCAN_REJECTION_CODES = new Set([
  'SCAN_RETRY_NOT_AUTHORIZED',
  'SCAN_RETRY_CONFLICT',
  'SCAN_RETRY_TASK_ID_MISSING',
  'SCAN_RESCAN_AUTHORITY_INCOMPLETE',
])

/**
 * 这个失败码是不是「服务端明确不认这次安全重扫」。
 *
 * 它是授权归属那条二选一的**唯一**判据：true → 永久丢弃（留着只会让下一次白发一个
 * 注定 403 的请求）；false → 原样放回（服务端那一半的消费在 $transaction 内部，
 * 限流与终端态检查更在事务之前就抛，所以那些码回来时服务端那枚授权原封没动）。
 */
export function isRescanRefusedByServer(code: string | undefined): boolean {
  return SCAN_RESCAN_REJECTION_CODES.has(code ?? '')
}

export interface SessionFailure {
  title: string
  description: string
}

/**
 * 带着「同一份材料」的意图进来，凭据却已经不在内存里 —— 这一屏说的话。
 *
 * **成因不止一个，所以措辞不能只说其中一个。** 已知两条，用户处置完全一样：
 *   · 整页重载（看门狗）：授权刻意只活在内存里，重载就没了，而登记里那笔意图还在；
 *   · 延迟取用：本页在等终端换票（`terminalSession === 'checking'`）的那一会儿，
 *     本地 15 分钟窗口走完，或者别处发生过一次清场，于是真正取用那一刻槽位已空。
 * 早先这里写死「已随本页重载消失」，第二条成因发生时就是一句假的诊断。
 *
 * 三件事必须都说到：为什么不能继续、本页**没有**替他改发普通重扫（否则同一张纸会
 * 撞上两小时的重复件拒收）、以及他现在能按哪一个。
 */
export const RESCAN_CREDENTIALS_LOST_FAILURE = {
  title: '安全重扫凭据已经不在本机',
  description: '你刚才选的是「同一份材料」重扫。那份凭据只存在页面内存里（不落存储，'
    + '换人清场也带不走）：本页重载过、或者它已经超过 15 分钟、或者中间清过场，'
    + '现在都取不到了，本机无法再向服务端申请放行。'
    + '本页不会替你改发一次普通重扫 —— 同一张纸走普通会话会被服务端按重复件拒收，'
    + '你会在机器前白等到会话过期。可以安全返回扫描首页，'
    + '或者按「重新开始一次扫描」建一个普通会话（那不是安全重扫，建议换一份材料）。',
} as const

/**
 * 服务端把这次安全重扫判为不作数（403 / 409 / 400）之后，这一屏说的话。
 *
 * 和上面那条的区别只在**是谁判的**：上面是本机取不到凭据，这条是凭据发出去了、
 * 服务端不认。用户处置一样，所以两条都必须给出同一个显式出路
 * （「重新开始一次扫描」），并且都必须把代价说清楚。
 *
 * 早先这条只说「请返回扫描首页重新开始一次扫描」，屏幕上却没有任何叫这个名字的按钮 ——
 * 唯一能按的是「安全返回扫描首页」，用户得自己走回选类型那一屏再来一遍。而这一屏
 * 最常见的来源恰恰是「上一场根本没走到取件」（服务端那种情况从不铸授权，必然 403），
 * 于是最常见的失败路径上，主行动是一个注定失败的按钮。
 */
export const RESCAN_REFUSED_FAILURE = {
  title: '安全重扫授权已失效',
  description: '服务端不认这次的安全重扫凭据（过期、已被用掉，或者上一场根本没走到取件'
    + '——那种情况服务端不会铸授权）。本页不会自动改用普通重扫。'
    + '你可以按「重新开始一次扫描」建一个普通会话：那不是同字节重扫，'
    + '如果放回去的还是同一张纸，服务端可能按重复件拒收（两小时内），'
    + '建议换一份材料或找工作人员；也可以安全返回扫描首页。',
} as const

export interface CreateFailureVerdict {
  failure: SessionFailure
  /** 服务端明确不认这次安全重扫：那枚授权已经没了，出路只剩显式的普通新会话。 */
  refusedRescan: boolean
  /** 连「服务端收没收到」都不知道（断网 / status 0）。 */
  outcomeUnknown: boolean
}

/**
 * 把一次创建失败翻译成「这一屏说什么」+ 两个布尔。纯函数，不碰任何状态。
 *
 * 分支顺序不能改：`outcomeUnknown` 必须排在最前面 —— 那一条说的是「服务端可能已经
 * 收到，结果未知」，与下面任何一条「服务端明确回了什么」都互斥。
 *
 * 每个分支的兜底文案都必须**与当前操作相关**：`userMessageOf` 只在错误码落在共享
 * 白名单里时才替换它，未知码一律落到兜底，那是用户真正会看到的那句话。
 */
export function classifyCreateFailure(error: unknown): CreateFailureVerdict {
  const code = errorCodeOf(error)
  const outcomeUnknown = error instanceof ApiHttpError && (error.code === 'NETWORK_ERROR' || error.status === 0)
  if (outcomeUnknown) {
    return {
      outcomeUnknown: true,
      refusedRescan: false,
      failure: {
        title: '无法确认扫描任务状态',
        description: '网络连接中断，无法确认服务端是否收到请求。为避免重复创建，本页不会自动重发 ——'
          + '要不要再发一次由你按。请检查网络后重试，或者返回扫描首页。',
      },
    }
  }
  /* 安全重扫被服务端拒了（过期 / 已被用掉 / 血缘被占 / 上一场根本没走到取件）。
   *
   * 这里**不自动改发一次普通创建**。普通创建本身不危险，但它会把用户支到面板前去扫
   * 同一张纸，而那份字节可能落在服务端的 2 小时去重窗口里 —— 文件投回来会被拒，任务
   * 停在 waiting 直到过期，用户在这台机器前白等十分钟，且全程没有任何提示。
   * 静默降级正是这条防线要挡的东西。
   *
   * 但「不自动降级」不等于「不给出路」：这一屏最常见的来源恰恰是上一场根本没走到取件
   * （服务端那种情况从不铸授权，必然 403），做成只能原路退回的死胡同，等于让最常见的
   * 失败路径上主行动注定失败。所以出路给出来、代价写清楚，按不按由用户决定。 */
  if (isRescanRefusedByServer(code)) {
    return {
      outcomeUnknown: false,
      refusedRescan: true,
      failure: {
        title: RESCAN_REFUSED_FAILURE.title,
        description: userMessageOf(error, RESCAN_REFUSED_FAILURE.description),
      },
    }
  }
  const failure = ((): SessionFailure => {
    if (code === 'SCAN_TERMINAL_BUSY') {
      return { title: '本机正在扫描中', description: userMessageOf(error, '请等待当前扫描任务完成后再试。') }
    }
    if (code === 'SCAN_TERMINAL_DISABLED') {
      return { title: '扫描功能已停用', description: userMessageOf(error, '请联系现场工作人员。') }
    }
    if (code === 'TERMINAL_SESSION_INVALID') {
      return {
        title: '终端安全校验失败',
        description: userMessageOf(error, '终端安全校验失败，请联系现场工作人员'),
      }
    }
    if (code === 'RATE_LIMITED' || (error instanceof ApiHttpError && error.status === 429)) {
      return { title: '请求过于频繁', description: userMessageOf(error, '请稍后再试。') }
    }
    return {
      title: '扫描任务未创建',
      description: userMessageOf(error, '服务端未能创建扫描会话。请返回重试，或联系现场工作人员。'),
    }
  })()
  return { outcomeUnknown: false, refusedRescan: false, failure }
}
