import { formatDateTime } from '@ai-job-print/shared'
import type { ScreenSnapshotMetrics } from '@ai-job-print/shared'
import {
  SCREEN_HOSTING_OFF_NOTE,
  SCREEN_SOURCE_ENTRY_NOTE,
  ScreenAlertList,
  ScreenBarList,
  ScreenCard,
  ScreenGrid,
  ScreenKpi,
  ScreenMetricCard,
  ScreenMiniGrid,
  screenCount,
  screenFleetOnlineText,
  screenFleetScopeNote,
  screenReasonCopy,
  type ScreenBarItem,
} from '@ai-job-print/ui'
import { printCompletion, taskStatusLabel, taskStatusTone } from './metricLabels'

/**
 * 运营版（`?profile=ops`）：6 列 × 3 行共 12 块，与契约的
 * `ADMIN_OPS_METRIC_KEYS` 一一对应，块位照 docs/design/ops-screen-2026-09/02-ops-screen.html。
 *
 * 与原型不同的四处，都是「原型画了但契约给不出」，一律以契约为准：
 *   1. AI 成本卡的「输入 token / 输出 token / P95 延迟」——契约里是嵌套的
 *      `available:false`，三条都不画，改在脚注说明未接入。
 *   2. 「今日打印失败」的副行「2 个未核查退款」——契约只给 failed 一个数，删掉。
 *   3. 「同步成功率」的副行「17 个数据源」——契约没有数据源家数，改成批次口径。
 *   4. 成本这类混单位的量（元 / 次 / 毫秒）不塞进同一根条形轴，改用分项格；
 *      同一根轴上比 ¥38.7 和 4200ms 是没有意义的对比。
 *
 * 成功率为 null 表示窗口内没有分母。这时写「无调用」而不是 0%——
 * 0% 会被读成「全都失败了」。
 *
 * 招聘内容托管关闭（我们云上的默认部署）时是另一套卡片（hostingOff）：
 *   - 「待审内容」换成「机构待审政策」（托管 a 下管理员不审核，政策由运营机构自审）；
 *   - 「同步成功率」换成「打印完成率」（数据源不再同步岗位与招聘会，近 24 小时恒为 0 批）。
 *     选它而不是「今日 AI 调用」：AI 分项不在运营快照里，而任务流就在，打印完成率与今日失败并列最有用；
 *   - 「打开来源平台入口」「招聘会结构」换成一块「岗位类存量」（政务快照的内容计数），
 *     让运维看清托管关闭前留下、待清理的存量；
 *   - 「审核时效 / 按机构维度」整块是未接入说明且托管 a 下不审核，不再占位；
 *     实时告警、任务流、AI 成本各占半行长大。
 */

export type OpsStock = ScreenSnapshotMetrics['contentInventory'] | 'pending'

function rateLabel(total: number, unit: string): string {
  return `近 24 小时 · ${screenCount(total)} ${unit}`
}

/** 嵌套指标的接入方式。available:true 分支的 value 是 never，必须先判 false 再取 reason。 */
function nestedHowTo(metric: { available: boolean } & Partial<{ reason: string }>): string {
  return metric.available === false ? screenReasonCopy(metric.reason ?? '').howTo : ''
}

export function OpsGrid({ metrics, hostingOff = false, stock }: { metrics: ScreenSnapshotMetrics; hostingOff?: boolean; stock?: OpsStock }) {
  // 托管关闭时第二、三行各两块，半行宽；托管开启时三块，各占 4 列
  const wide: 4 | 6 = hostingOff ? 6 : 4
  return (
    <ScreenGrid layout="ops">
      <ScreenMetricCard
        title="在网终端"
        metric={metrics.terminalsOnline}
        span={2}
        foot={
          metrics.terminalsOnline?.available
            ? `设备机队投影，响应带在线判定窗口秒数。${screenFleetScopeNote(metrics.terminalsOnline.value, '')}。`
            : ''
        }
        render={(value) => {
          const text = screenFleetOnlineText(value)
          return (
            <ScreenKpi
              value={text.value}
              unit={text.unit}
              label={`${value.onlineWindowSeconds} 秒内有心跳${value.truncated ? '（分母为样本台数）' : ''}`}
            />
          )
        }}
      />

      <ScreenMetricCard
        title="进行中打印"
        metric={metrics.printInProgress}
        span={2}
        foot="打印任务按状态分组的当前值，不是窗口累计。"
        render={(value) => (
          <ScreenKpi
            value={screenCount(value.total)}
            unit="个"
            label={`排队 ${screenCount(value.queued)} · 打印中 ${screenCount(value.printing)}`}
          />
        )}
      />

      <ScreenMetricCard
        title="今日打印失败"
        metric={metrics.printFailedToday}
        span={2}
        foot="按 Asia/Shanghai 自然日统计转入失败的事件次数，不是当前失败任务存量。退款与否需到订单页逐单核查。"
        render={(value) => (
          <ScreenKpi
            value={screenCount(value.failed)}
            unit="次"
            tone={value.failed > 0 ? 'error' : 'normal'}
            label={value.failed > 0 ? '请到打印扫描运维页逐单核查' : '今日无失败事件'}
          />
        )}
      />

      {hostingOff ? (
        <ScreenMetricCard
          title="机构待审政策"
          metric={metrics.pendingReview}
          span={2}
          foot="政策 pending + reviewing 的服务端计数。政策由运营机构在本平台自行审核发布，管理员只保留紧急下架。"
          render={(value) => (
            <ScreenKpi
              value={screenCount(value.policies)}
              unit="条"
              tone={value.policies > 0 ? 'warn' : 'normal'}
              label="运营机构自行审核"
            />
          )}
        />
      ) : (
        <ScreenMetricCard
          title="待审内容"
          metric={metrics.pendingReview}
          span={2}
          foot="四类内容 pending + reviewing 的服务端计数，非前端截断后统计。"
          render={(value) => (
            <ScreenKpi
              value={screenCount(value.total)}
              unit="条"
              tone={value.total > 0 ? 'warn' : 'normal'}
              label={`岗位 ${value.jobs} · 招聘会 ${value.fairs} · 政策 ${value.policies} · 企业 ${value.companies}`}
            />
          )}
        />
      )}

      <ScreenMetricCard
        title="AI 成功率"
        metric={metrics.aiSuccessRate24h}
        span={2}
        foot="AI 日志只有成功 / 失败两态，没有「降级」态：本平台的模型调用不做静默兜底。"
        render={(value) =>
          value.successRate === null ? (
            <ScreenKpi value="近 24 小时无 AI 调用" label="没有分母，因此不给百分比" labelMuted />
          ) : (
            <ScreenKpi
              value={value.successRate.toFixed(1)}
              unit="%"
              tone={value.successRate < 90 ? 'warn' : 'normal'}
              label={rateLabel(value.total, '次调用')}
            />
          )
        }
      />

      {hostingOff ? (
        <ScreenMetricCard
          title="打印完成率"
          metric={metrics.taskFlow24h}
          span={2}
          foot="已完成 ÷（已完成 + 失败），只看近 24 小时里已经结束的打印任务；排队、打印中、取消不进分母。分母少于 5 不给百分比。"
          render={(value) => {
            const c = printCompletion(value.printByStatus)
            return c.rate === null ? (
              <ScreenKpi value="样本不足" label={`近 24 小时已结束 ${screenCount(c.finished)} 个任务，不给百分比`} labelMuted />
            ) : (
              <ScreenKpi
                value={c.rate.toFixed(1)}
                unit="%"
                tone={c.rate < 90 ? 'warn' : 'normal'}
                // 完成数已在任务流里写过，这里只跟分母（每屏一个数只出现一次）
                label={rateLabel(c.finished, '个已结束任务')}
              />
            )
          }}
        />
      ) : (
        <ScreenMetricCard
          title="同步成功率"
          metric={metrics.syncSuccessRate24h}
          span={2}
          foot="同步日志全局聚合，部分失败按失败计。逐源明细见数据接入通道页。"
          render={(value) =>
            value.successRate === null ? (
              <ScreenKpi value="近 24 小时无同步批次" label="没有分母，因此不给百分比" labelMuted />
            ) : (
              <ScreenKpi
                value={value.successRate.toFixed(1)}
                unit="%"
                tone={value.successRate < 90 ? 'warn' : 'normal'}
                label={rateLabel(value.total, '个批次')}
              />
            )
          }
        />
      )}

      <ScreenMetricCard
        title="实时告警"
        tag="派生 · 无历史"
        metric={metrics.alertsRealtime}
        span={wide}
        tall
        foot="告警由当前状态实时派生、不落表，因此没有历史与平均修复时长。需要 MTTR 要先建告警事件表。"
        render={(value) => (
          <ScreenAlertList
            rows={value.items.map((item, index) => ({
              key: `${item.type}-${item.terminalCode ?? 'none'}-${item.occurredAt}-${index}`,
              severity: item.severity,
              text: item.terminalCode ? `${item.terminalCode} ${item.title}` : item.title,
              time: formatDateTime(item.occurredAt, { style: 'time', fallback: '--:--' }),
            }))}
            firingCount={value.firingCount}
            listedCount={value.listedCount}
            truncated={value.truncated}
            emptyText="当前没有正在发生的告警"
          />
        )}
      />

      <ScreenMetricCard
        title="任务流"
        tag="近 24 小时"
        metric={metrics.taskFlow24h}
        span={wide}
        tall
        foot="打印任务与扫描任务按状态分组，窗口为近 24 小时滚动窗。已完成含免费单。"
        render={(value) => {
          const rows: ScreenBarItem[] = [
            ...Object.entries(value.printByStatus).map(([status, count]) => ({
              label: taskStatusLabel(status),
              value: count,
              tone: taskStatusTone(status),
            })),
            ...Object.entries(value.scanByStatus)
              .filter(([status]) => status === 'completed')
              .map(([, count]) => ({ label: '扫描完成', value: count, tone: 'primary' as const })),
          ].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
          return <ScreenBarList items={rows} emptyText="近 24 小时没有打印或扫描任务" />
        }}
      />

      {hostingOff ? (
        stock === 'pending' ? (
          <ScreenCard
            title="岗位类存量"
            tag="托管关闭后不再审核发布"
            span={6}
            foot="取自政务快照的内容计数，正在取数。"
          >
            <p className="ops-empty">正在取数…</p>
          </ScreenCard>
        ) : (
          <ScreenMetricCard
            title="岗位类存量"
            tag="托管关闭后不再审核发布"
            metric={stock}
            span={6}
            foot={<>托管关闭前留下的岗位、招聘会、企业资料：仍在库里，不再审核发布，也不对外展示；清理前按这里核对。{SCREEN_HOSTING_OFF_NOTE}。</>}
            render={(value) => (
              <ScreenMiniGrid
                compact
                items={[
                  { value: screenCount(value.jobsPublished), label: '岗位 · 在架存量', hint: `待审 ${screenCount(value.jobsPending)}` },
                  { value: screenCount(value.fairsPublished), label: '招聘会 · 在架存量', hint: `待审 ${screenCount(value.fairsPending)}` },
                  { value: screenCount(value.companiesPublished), label: '企业资料 · 在架存量', hint: `待审 ${screenCount(value.companiesPending)}` },
                  { value: screenCount(value.jobsPending + value.fairsPending + value.companiesPending), label: '待审存量合计', hint: '不再进入审核' },
                ]}
              />
            )}
          />
        )
      ) : (
        <>
          <ScreenMetricCard
            title="打开来源平台入口"
            tag="近 30 日 · Top 5"
            metric={metrics.sourceEntryOpensTop}
            span={4}
            tall
            foot={<>{SCREEN_SOURCE_ENTRY_NOTE}行为日志保留 30 天，故无累计值。</>}
            render={(value) => (
              <ScreenBarList
                items={value.items.map((item) => ({ label: item.sourceName, value: item.count }))}
                emptyText={`近 30 日没有${value.copy}的记录`}
              />
            )}
          />

          <ScreenMetricCard
            title="招聘会结构"
            tag={
              metrics.fairStructure?.available
                ? `进行中 ${screenCount(metrics.fairStructure.value.ongoingFairs)} 场`
                : undefined
            }
            metric={metrics.fairStructure}
            span={4}
            foot="结构数直接来自招聘会子表，只统计进行中的场次。"
            render={(value) => (
              <ScreenMiniGrid
                compact
                items={[
                  { value: screenCount(value.companies), label: '参展企业', hint: '进行中场次合计' },
                  { value: screenCount(value.zones), label: '展区', hint: '已配置导览' },
                  { value: screenCount(value.publishedMaterials), label: '活动资料', hint: '已发布可打印' },
                  value.materialPrintCount.available
                    ? { value: screenCount(value.materialPrintCount.value), label: '资料打印量', hint: '累计' }
                    : { label: '资料打印量', unavailableReason: value.materialPrintCount.reason },
                ]}
              />
            )}
          />
        </>
      )}

      <ScreenMetricCard
        title="AI 成本与用量"
        tag="近 24 小时"
        metric={metrics.aiCost24h}
        span={wide}
        foot={
          metrics.aiCost24h?.available ? (
            <>
              成本为按单价估算，<b>不是账单</b>。未计量调用在计量开始前或缺计费字段，单独列出而不摊进成本。
              token 用量与 P95 延迟未接入：
              {nestedHowTo(metrics.aiCost24h.value.tokenTotals)}
              {nestedHowTo(metrics.aiCost24h.value.p95LatencyMs)}
            </>
          ) : (
            ''
          )
        }
        render={(value) => (
          <ScreenMiniGrid
            compact
            items={[
              { value: `¥${value.estimatedCostCny.toFixed(2)}`, label: '估算成本', hint: '按单价估算' },
              { value: screenCount(value.measuredCalls), label: '已计量调用', hint: '进入成本口径' },
              { value: screenCount(value.unmeasuredCalls), label: '未计量调用', hint: '不摊进成本' },
              value.avgLatencyMs === null
                ? { value: '无成功调用', label: '平均延迟', hint: '窗口内没有可计延迟的成功调用' }
                : { value: `${screenCount(value.avgLatencyMs)}ms`, label: '平均延迟', hint: '仅统计成功调用' },
            ]}
          />
        )}
      />

      {hostingOff ? null : (
        <ScreenMetricCard
          title="审核时效 / 按机构维度"
          metric={metrics.reviewSlaAndOrgDimension}
          span={4}
          foot=""
          render={() => null}
        />
      )}
    </ScreenGrid>
  )
}
