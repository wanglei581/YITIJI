import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import {
  SCAN_DEVICE_HARD_LIFETIME_MS,
  SCAN_DEVICE_SWITCH_RENEW_WINDOW_MS,
  isScanDeviceSettingsEditableState,
  isScanDeviceState,
  isScanDeviceTask,
  isSwitchedToPanel,
  planScanDeviceReport,
  renewScanDeviceExpiry,
  resolveScanDeviceSettingsInput,
  type ScanDeviceColorMode,
  type ScanDeviceErrorCode,
  type ScanDeviceReportInput,
  type ScanDeviceSource,
  type ScanDeviceState,
} from './scan-device-protocol'
import { SCAN_TYPE_INSTRUCTIONS, timingSafeEqualHex, type ScanType } from './scan-tasks.service'

/** 回报与切换都靠条件更新（CAS）防并发；冲突后重读重判，最多这么多轮，仍冲突就如实 409。 */
const MAX_CAS_ATTEMPTS = 3

export interface ScanDeviceReportResult {
  scanTaskId: string
  deviceState: ScanDeviceState
  devicePageCount: number
  deviceErrorCode: ScanDeviceErrorCode | null
  /** 续期后的会话截止时间（不超过 hardExpiresAt）。 */
  expiresAt: string
}

export interface ScanSwitchToPanelResult {
  scanTaskId: string
  startMode: 'panel'
  expiresAt: string
  /** 面板扫描的操作步骤（与建会话时下发的同一份），一体机切换后直接显示。 */
  instructions: string[]
}

/** 改设置成功后的样子：回到 ready、0 页、无错误码（出错状态靠这一步清掉），来源 / 颜色是改完的值。 */
export interface ScanDeviceSettingsResult {
  scanTaskId: string
  startMode: 'device'
  source: ScanDeviceSource
  colorMode: ScanDeviceColorMode
  deviceState: 'ready'
  devicePageCount: 0
  deviceErrorCode: null
  /** 续期后的会话截止时间（至少 now + 10 分钟，不超过 hardExpiresAt）；幂等命中时是原来的值。 */
  expiresAt: string
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ error: { code, message } })
}

/**
 * 屏上扫描会话的三条云端写入口：终端程序回报进度（device-report）、用户改用面板扫描（switch-to-panel）、
 * 用户在放纸与设置屏换来源 / 颜色（device-settings）。
 *
 * 云端只记状态、管能力、管投递；实时指令走一体机到终端程序的本机通道，不在这里。
 * 回报的 409 都带原因码，终端程序据此决定是否中止：
 *   必须停扫   SCAN_DEVICE_TASK_CANCELLED / SCAN_DEVICE_TASK_ENDED / SCAN_DEVICE_SWITCHED_TO_PANEL /
 *              SCAN_DEVICE_CAPABILITY_DISABLED / SCAN_TASK_NOT_DEVICE / SCAN_DEVICE_TASK_NOT_ACKED
 *   仅此次回报被拒（会话还在）  SCAN_DEVICE_TRANSITION_INVALID / SCAN_DEVICE_PAGE_COUNT_DECREASED /
 *              SCAN_DEVICE_TASK_DELIVERING / SCAN_DEVICE_STATE_CHANGED
 */
@Injectable()
export class ScanDeviceSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: TerminalCapabilitiesService,
  ) {}

  /**
   * 终端程序回报一次屏上扫描进度。守卫（终端身份）在 controller。
   * 只收：device 任务、属于本终端、已 ACK、waiting 且未过期、scan_device 仍 available、转移表允许。
   * 每次收下续期 expiresAt = min(max(expiresAt, now + 3 分钟), hardExpiresAt)，并写 deviceUpdatedAt。
   */
  async report(
    terminalId: string,
    scanTaskId: string,
    input: ScanDeviceReportInput,
  ): Promise<ScanDeviceReportResult> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const now = new Date()
      const task = await this.prisma.scanTask.findUnique({ where: { id: scanTaskId } })
      // 不属于本终端的任务与不存在同一个答复：不向别的终端泄露任务是否存在。
      if (!task || task.terminalId !== terminalId) {
        throw new NotFoundException({
          error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' },
        })
      }

      if (!isScanDeviceTask(task)) {
        if (isSwitchedToPanel(task)) {
          conflict('SCAN_DEVICE_SWITCHED_TO_PANEL', '用户已改用面板扫描，请停止屏上扫描')
        }
        conflict('SCAN_TASK_NOT_DEVICE', '该扫描任务不是屏上扫描')
      }
      if (task.status === 'cancelled') {
        conflict('SCAN_DEVICE_TASK_CANCELLED', '扫描任务已取消，请停止屏上扫描')
      }
      if (task.status !== 'waiting' && task.status !== 'matched') {
        conflict('SCAN_DEVICE_TASK_ENDED', '扫描任务已结束，请停止屏上扫描')
      }
      if (task.status === 'waiting' && task.expiresAt.getTime() <= now.getTime()) {
        conflict('SCAN_DEVICE_TASK_ENDED', '扫描任务已过期，请停止屏上扫描')
      }
      if (!task.deliveryAckedAt) {
        conflict('SCAN_DEVICE_TASK_NOT_ACKED', '扫描任务尚未确认，不能回报屏上扫描进度')
      }

      const capability = await this.capabilities.scanDeviceAvailability(terminalId)
      if (!capability.available) {
        conflict('SCAN_DEVICE_CAPABILITY_DISABLED', '本机屏上扫描已被关闭，请停止屏上扫描')
      }

      if (task.status === 'matched') {
        // 文件正在投递（waiting → matched 之后）。网络重试迟到的同状态回报当作重复，原样应答，
        // 不写库、不续期；其余回报此刻没有意义，如实拒绝。
        if (input.state !== task.deviceState) {
          conflict('SCAN_DEVICE_TASK_DELIVERING', '文件正在投递，暂不接受新的屏上扫描回报')
        }
        return this.toReportResult(task, task.expiresAt)
      }

      // 续期上限：建会话起最多 30 分钟。已经到了上限就不再收回报（不给过期的会话续命）。
      const hardExpiresAt =
        task.hardExpiresAt ?? new Date(task.createdAt.getTime() + SCAN_DEVICE_HARD_LIFETIME_MS)
      if (hardExpiresAt.getTime() <= now.getTime()) {
        conflict('SCAN_DEVICE_TASK_ENDED', '屏上扫描会话已达最长时限，请停止屏上扫描')
      }

      const plan = planScanDeviceReport(task, input)
      const expiresAt = renewScanDeviceExpiry({ expiresAt: task.expiresAt, hardExpiresAt, now })

      const updated = await this.prisma.scanTask.updateMany({
        where: {
          id: task.id,
          terminalId,
          startMode: 'device',
          status: 'waiting',
          deliveryAckedAt: { not: null },
          expiresAt: { gt: now },
          deviceState: task.deviceState,
          devicePageCount: task.devicePageCount,
        },
        data: {
          deviceState: plan.deviceState,
          devicePageCount: plan.devicePageCount,
          deviceErrorCode: plan.deviceErrorCode,
          deviceUpdatedAt: now,
          expiresAt,
        },
      })
      if (updated.count === 1) {
        return {
          scanTaskId: task.id,
          deviceState: plan.deviceState,
          devicePageCount: plan.devicePageCount,
          deviceErrorCode: plan.deviceErrorCode,
          expiresAt: expiresAt.toISOString(),
        }
      }
      // 读与写之间有人改了这一行（取消、改用面板、另一条回报）：重读重判。
    }
    conflict('SCAN_DEVICE_STATE_CHANGED', '扫描任务状态刚刚发生变化，请按最新状态重新回报')
  }

  /**
   * 用户在屏上扫描出错或不想用屏上方式时「改用面板扫描」：同一个会话原地切回面板。
   *
   * 会话、控制令牌、ACK 原样保留；**不触发也不检查终端静默期**（走取消重建会吃 90 秒静默期，
   * 这是单独做这条接口的原因）。之后 current-lease 按面板任务给，watcher 照常能投。
   * 截止时间续到 min(max(expiresAt, now + 10 分钟), hardExpiresAt)：用户在屏上试了很久再切，
   * 不至于只剩一两分钟去面板上操作（仍不超过 hardExpiresAt）。
   * 只在 device 任务、还没投递文件时允许；重复调用幂等（第二次不再写库、不再续期）。
   * 权限照 DELETE：控制令牌必须正确；调用方带了会员身份时必须就是会话所有者。
   */
  async switchToPanel(
    scanTaskId: string,
    endUserId: string | null,
    controlToken: string | undefined,
  ): Promise<ScanSwitchToPanelResult> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const now = new Date()
      const task = await this.prisma.scanTask.findUnique({ where: { id: scanTaskId } })
      if (!task) {
        throw new NotFoundException({
          error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' },
        })
      }
      this.assertControlAccess(task, endUserId, controlToken, '无权切换该扫描任务')

      const alreadySwitched = isSwitchedToPanel(task)
      if (!isScanDeviceTask(task) && !alreadySwitched) {
        conflict('SCAN_TASK_NOT_DEVICE', '该扫描任务不是屏上扫描，无需切换')
      }
      if (task.status === 'matched' || task.status === 'completed' || task.fileId) {
        conflict('SCAN_DEVICE_ALREADY_DELIVERED', '文件已经交付，不能再改用面板扫描')
      }
      if (task.status !== 'waiting' || task.expiresAt.getTime() <= now.getTime()) {
        conflict('SCAN_TASK_NOT_ACTIVE', '扫描任务已结束，不能再改用面板扫描')
      }
      if (alreadySwitched) return this.toSwitchResult(task, task.expiresAt)

      // 截止时间续到至少 now + 10 分钟（不超过 hardExpiresAt）。已经到了 hardExpiresAt 的会话没有可续的了，如实拒绝。
      const hardExpiresAt =
        task.hardExpiresAt ?? new Date(task.createdAt.getTime() + SCAN_DEVICE_HARD_LIFETIME_MS)
      if (hardExpiresAt.getTime() <= now.getTime()) {
        conflict('SCAN_TASK_NOT_ACTIVE', '屏上扫描会话已达最长时限，不能再改用面板扫描')
      }
      const expiresAt = renewScanDeviceExpiry({
        expiresAt: task.expiresAt,
        hardExpiresAt,
        now,
        windowMs: SCAN_DEVICE_SWITCH_RENEW_WINDOW_MS,
      })

      const switched = await this.prisma.scanTask.updateMany({
        where: {
          id: task.id,
          startMode: 'device',
          status: 'waiting',
          fileId: null,
          expiresAt: { gt: now },
        },
        data: {
          startMode: 'panel',
          deviceState: 'aborted',
          deviceErrorCode: null,
          deviceUpdatedAt: now,
          expiresAt,
        },
      })
      if (switched.count === 1) return this.toSwitchResult(task, expiresAt)
      // 读与写之间有人改了这一行（刚好投递、取消、过期）：重读重判。
    }
    conflict('SCAN_DEVICE_STATE_CHANGED', '扫描任务状态刚刚发生变化，请刷新后再试')
  }

  /**
   * 用户在放纸与设置屏换来源 / 颜色（例如出错屏「进纸器里没有纸」→「改用玻璃台」）：同一个会话原地改，
   * 不取消重建。取消重建会吃终端静默期（建会话与 ACK 都查，默认 90 秒），用户白等；这里**不检查也不触发静默期**。
   *
   * 只在这些条件下改（不满足一律 409，带原因码）：
   *   SCAN_TASK_NOT_DEVICE            不是屏上扫描（面板任务、已改用面板的都算）
   *   SCAN_DEVICE_ALREADY_DELIVERED   文件已经交付（matched / completed / 有 fileId）
   *   SCAN_TASK_NOT_ACTIVE            会话已取消 / 过期 / 结束，或已到 hardExpiresAt
   *   SCAN_DEVICE_SETTINGS_LOCKED     deviceState 不是 ready / error（正在扫或已收到页，先停下再换；aborted 也不行）
   *   SCAN_DEVICE_CAPABILITY_DISABLED scan_device 已被关
   *   SCAN_DEVICE_STATE_CHANGED       读与写之间被改了 3 轮仍对不上
   * 权限照 DELETE / switch-to-panel：控制令牌必须正确；调用方带了会员身份时必须就是会话所有者。
   *
   * 改什么：写 deviceSource / deviceColorMode（没给的保持原值）；deviceState 回到 ready、deviceErrorCode 清空、
   * devicePageCount 归 0、写 deviceUpdatedAt；expiresAt 续到 min(max(expiresAt, now + 10 分钟), hardExpiresAt)。
   * 会话、控制令牌、ACK 原样保留。出错状态（error）只有经这个用户动作才会回到 ready，不进终端程序回报转移表
   * （见 scan-device-protocol.ts 的状态转移表注释）；之后终端程序下一次回报 scanning 走 ready → scanning。
   * 幂等：要改的值与现值相同、且已是 ready 无错误码 0 页时，原样返回，不写库、不续期。
   * 并发：条件更新（CAS）把读到的 deviceState / 来源 / 颜色一并写进 where，读写之间有人改了就重读重判，最多 3 轮。
   */
  async updateDeviceSettings(
    scanTaskId: string,
    endUserId: string | null,
    controlToken: string | undefined,
    rawInput: { source?: unknown; colorMode?: unknown },
  ): Promise<ScanDeviceSettingsResult> {
    // 字段组合不合法一律 400，先于任何数据库访问（与建会话一致）。
    const input = resolveScanDeviceSettingsInput(rawInput)
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const now = new Date()
      const task = await this.prisma.scanTask.findUnique({ where: { id: scanTaskId } })
      if (!task) {
        throw new NotFoundException({
          error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' },
        })
      }
      this.assertControlAccess(task, endUserId, controlToken, '无权修改该扫描任务的设置')

      if (!isScanDeviceTask(task)) {
        conflict('SCAN_TASK_NOT_DEVICE', '该扫描任务不是屏上扫描，没有可改的屏上扫描设置')
      }
      if (task.status === 'matched' || task.status === 'completed' || task.fileId) {
        conflict('SCAN_DEVICE_ALREADY_DELIVERED', '文件已经交付，不能再修改扫描设置')
      }
      if (task.status !== 'waiting' || task.expiresAt.getTime() <= now.getTime()) {
        conflict('SCAN_TASK_NOT_ACTIVE', '扫描任务已结束，不能再修改扫描设置')
      }
      // 没有可续的了就如实拒绝：已经到了 hardExpiresAt 的会话不能靠改设置续命。
      const hardExpiresAt =
        task.hardExpiresAt ?? new Date(task.createdAt.getTime() + SCAN_DEVICE_HARD_LIFETIME_MS)
      if (hardExpiresAt.getTime() <= now.getTime()) {
        conflict('SCAN_TASK_NOT_ACTIVE', '屏上扫描会话已达最长时限，不能再修改扫描设置')
      }
      const state: ScanDeviceState = isScanDeviceState(task.deviceState) ? task.deviceState : 'ready'
      if (!isScanDeviceSettingsEditableState(state)) {
        conflict(
          'SCAN_DEVICE_SETTINGS_LOCKED',
          state === 'aborted'
            ? '屏上扫描已中止，不能再修改扫描设置'
            : '正在扫描或已经收到页，请先停下再修改扫描设置',
        )
      }
      const capability = await this.capabilities.scanDeviceAvailability(task.terminalId)
      if (!capability.available) {
        conflict('SCAN_DEVICE_CAPABILITY_DISABLED', '本机屏上扫描已被关闭，请改用面板扫描')
      }

      const source = (input.source ?? task.deviceSource) as ScanDeviceSource
      const colorMode = (input.colorMode ?? task.deviceColorMode) as ScanDeviceColorMode
      if (
        source === task.deviceSource &&
        colorMode === task.deviceColorMode &&
        task.deviceState === 'ready' &&
        task.deviceErrorCode === null &&
        task.devicePageCount === 0
      ) {
        return this.toSettingsResult(task.id, source, colorMode, task.expiresAt)
      }

      const expiresAt = renewScanDeviceExpiry({
        expiresAt: task.expiresAt,
        hardExpiresAt,
        now,
        windowMs: SCAN_DEVICE_SWITCH_RENEW_WINDOW_MS,
      })
      const updated = await this.prisma.scanTask.updateMany({
        where: {
          id: task.id,
          startMode: 'device',
          status: 'waiting',
          fileId: null,
          expiresAt: { gt: now },
          // 读到的 ready / error 与来源、颜色一并钉死：这几个值是响应的依据，读写之间被改了就重读重判。
          deviceState: task.deviceState,
          deviceSource: task.deviceSource,
          deviceColorMode: task.deviceColorMode,
        },
        data: {
          deviceSource: source,
          deviceColorMode: colorMode,
          deviceState: 'ready',
          deviceErrorCode: null,
          devicePageCount: 0,
          deviceUpdatedAt: now,
          expiresAt,
        },
      })
      if (updated.count === 1) return this.toSettingsResult(task.id, source, colorMode, expiresAt)
      // 读与写之间有人改了这一行（终端程序刚好回报 scanning、刚好投递、取消、过期）：重读重判。
    }
    conflict('SCAN_DEVICE_STATE_CHANGED', '扫描任务状态刚刚发生变化，请刷新后再试')
  }

  /**
   * 控制令牌必须正确（会员 + 游客一视同仁；历史行 controlTokenHash 为 null 一律拒绝）；
   * 调用方带了会员身份（非 null）时必须就是会话所有者。会员登出后身份为 null，凭令牌仍可操作，与 DELETE 一致。
   */
  private assertControlAccess(
    task: { controlTokenHash: string | null; endUserId: string | null },
    endUserId: string | null,
    controlToken: string | undefined,
    message: string,
  ): void {
    if (!task.controlTokenHash || !controlToken || !timingSafeEqualHex(controlToken, task.controlTokenHash)) {
      throw new ForbiddenException({ error: { code: 'SCAN_TASK_FORBIDDEN', message } })
    }
    if (endUserId !== null && task.endUserId && task.endUserId !== endUserId) {
      throw new ForbiddenException({ error: { code: 'SCAN_TASK_FORBIDDEN', message } })
    }
  }

  private toSettingsResult(
    scanTaskId: string,
    source: ScanDeviceSource,
    colorMode: ScanDeviceColorMode,
    expiresAt: Date,
  ): ScanDeviceSettingsResult {
    return {
      scanTaskId,
      startMode: 'device',
      source,
      colorMode,
      deviceState: 'ready',
      devicePageCount: 0,
      deviceErrorCode: null,
      expiresAt: expiresAt.toISOString(),
    }
  }

  private toReportResult(
    task: { id: string; deviceState: string | null; devicePageCount: number; deviceErrorCode: string | null },
    expiresAt: Date,
  ): ScanDeviceReportResult {
    return {
      scanTaskId: task.id,
      deviceState: task.deviceState as ScanDeviceState,
      devicePageCount: task.devicePageCount,
      deviceErrorCode: task.deviceErrorCode as ScanDeviceErrorCode | null,
      expiresAt: expiresAt.toISOString(),
    }
  }

  private toSwitchResult(task: { id: string; scanType: string }, expiresAt: Date): ScanSwitchToPanelResult {
    return {
      scanTaskId: task.id,
      startMode: 'panel',
      expiresAt: expiresAt.toISOString(),
      instructions: SCAN_TYPE_INSTRUCTIONS[task.scanType as ScanType] ?? [],
    }
  }
}
