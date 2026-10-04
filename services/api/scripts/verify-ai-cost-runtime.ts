type Check = (message: string) => void

/**
 * 运行时：改 AiProvider 接口后，**既有 provider 实现全部仍可调用**。
 *
 * AiProvider 是所有 AI 能力的公共接口。AI-COST-TRUTH 给四个 Output 类型加了
 * `usage?: AiUsageReport`。加成可选字段是为了让 mock + 5 个 stub 一行不改就继续编译；
 * 这里再从运行时证明它们真的还能构造和调用，而不是只靠 tsc 过了就算。
 */
export async function providerCompatRuntimeChecks(pass: Check, fail: Check): Promise<void> {
  const mods = await Promise.all([
    import('../src/ai/providers/mock.provider'),
    import('../src/ai/providers/claude.provider.stub'),
    import('../src/ai/providers/openai.provider.stub'),
    import('../src/ai/providers/qwen.provider.stub'),
    import('../src/ai/providers/zhipu.provider.stub'),
    import('../src/ai/providers/local.provider.stub'),
  ])
  const [mockMod, claudeMod, openaiMod, qwenMod, zhipuMod, localMod] = mods
  const providers = [
    ['mock', new mockMod.MockAiProvider()],
    ['claude', new claudeMod.ClaudeProvider()],
    ['openai', new openaiMod.OpenAiProvider()],
    ['qwen', new qwenMod.QwenProvider()],
    ['zhipu', new zhipuMod.ZhipuProvider()],
    ['local', new localMod.LocalAiProvider()],
  ] as const

  for (const [label, provider] of providers) {
    const ok = typeof provider.parseResume === 'function'
      && typeof provider.optimizeResume === 'function'
      && typeof provider.chatAssistant === 'function'
      && typeof provider.classifyIntent === 'function'
      && typeof provider.name === 'string'
    if (ok) pass(`provider 兼容: ${label} 仍满足 AiProvider 接口`)
    else fail(`provider 兼容: ${label} 不再满足 AiProvider 接口 —— 改接口破坏了既有实现`)
  }

  // mock provider 必须仍能真的跑完一次调用（stub 按设计抛 NotImplemented，不在此断言）
  const mock = new mockMod.MockAiProvider()
  try {
    const parsed = await mock.parseResume({
      fileId: 'verify-file', fileName: 'r.pdf', fileFormat: 'pdf', source: 'upload',
    })
    if (parsed.report) pass('provider 兼容: mock provider 仍可正常产出诊断报告')
    else fail('provider 兼容: mock provider 未产出报告')

    const chat = await mock.chatAssistant({ message: '你好' })
    if (chat.reply) pass('provider 兼容: mock provider 仍可正常对话')
    else fail('provider 兼容: mock provider 未产出回复')
  } catch (error) {
    fail(`provider 兼容: mock provider 调用抛错 —— ${error instanceof Error ? error.message : String(error)}`)
  }

  // mock 不打任何上游 → 成本确定为 0（「成本为 0」态），不得被算成「未采集」
  const { AiUsageAccumulator } = await import('../src/ai/ai-log.service')
  const report = new AiUsageAccumulator().toReport('mock')
  if (report.callCount === 0) pass('provider 兼容: 空累计器 callCount===0（表示未产生上游调用）')
  else fail('provider 兼容: 空累计器 callCount 应为 0')
}

/**
 * 运行时：「未采集 / 成本为 0 / 有成本」在接口层必须真的可区分。
 *
 * 静态断言只能证明类型里有 measuredCalls；证明不了聚合真的没把 null 吞成 0。
 * 这里落三条真实的 AiServiceLog，再回读 getUsage 断言三态各自的形状。
 *
 * ⚠️ 必须按**增量**断言，不能按绝对值。getUsage 聚合的是最近 24h 的**全表**，
 * 不只是本函数写的那三行。CI 两个 job 里 verify:career-plan 都紧邻在本门禁之前
 * 跑（且都没走 VERIFICATION_DATABASE_TARGET=isolated，共用同一个库），它会留下
 * 6 条 provider='llm:deepseek:stub' 的 careerPlan 行 —— 'stub' 命中
 * estimateCostCny 的 mock/stub 短路分支返回 0，于是这 6 条被如实记为
 * 「已采集，¥0」。绝对值断言 measuredCalls===0 因此在空库绿、在 CI 必红
 * （实测 {"cny":0,"calls":7,"measuredCalls":6}，7-6=1 正是本函数那条未采集行，
 * 说明实现是对的、断言的作用域错了）。
 *
 * 取前后差值既与库里既有数据无关，又把断言从 `>=1` / `===0` 收紧成精确增量，
 * 是**加强**而不是放宽 —— 三态诚实性（未采集绝不折叠成 ¥0）仍由
 * `careerPlan` 的 Δcalls===1 且 ΔmeasuredCalls===0 守住。
 */
export async function costTriStateRuntimeChecks(
  pass: Check, fail: Check,
  prisma: { aiServiceLog: { deleteMany: (a: unknown) => Promise<unknown> } },
  aiLog: import('../src/ai/ai-log.service').AiLogService,
): Promise<void> {
  const since = new Date()
  await new Promise((r) => setTimeout(r, 5))

  const before = await aiLog.getUsage('AiServiceLog')

  // ① 有成本：真实厂商标签 + token → 可定价
  aiLog.record({
    taskId: null, provider: 'llm:deepseek:deepseek-chat', operation: 'contractReview',
    latencyMs: 10, status: 'success',
    tokenUsage: { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 },
  })
  // ② 未采集：打到模型了但上游没回 usage → 成本必须留空
  aiLog.record({
    taskId: null, provider: 'llm:deepseek:deepseek-chat', operation: 'careerPlan',
    latencyMs: 10, status: 'success',
  })
  // ③ 成本为 0：mock provider 压根不打上游 → 0 是实测
  aiLog.record({
    taskId: null, provider: 'mock', operation: 'jobMatch',
    latencyMs: 10, status: 'success',
  })
  await aiLog.flush()

  const usage = await aiLog.getUsage('AiServiceLog')

  // 同一条 getUsage 聚合路径的前后差值 —— 断言的仍是 getUsage 的三态聚合行为，
  // 没有绕开它去直接读表（绕开就等于不再验「聚合有没有把 null 吞成 0」）。
  function deltaOf(operation: 'contractReview' | 'careerPlan' | 'jobMatch') {
    const a = usage.costByOperation[operation]
    const b = before.costByOperation[operation]
    return {
      cny: Math.round((a.cny - b.cny) * 10_000) / 10_000,
      calls: a.calls - b.calls,
      measuredCalls: a.measuredCalls - b.measuredCalls,
    }
  }

  const measured = deltaOf('contractReview')
  if (measured.calls === 1 && measured.measuredCalls === 1 && measured.cny > 0) {
    pass('三态运行时: 有成本 → Δ measuredCalls===1 且 Δcny>0（真实厂商标签可定价）')
  } else {
    fail(`三态运行时: 有成本态错误 —— Δ${JSON.stringify(measured)}`)
  }

  const uncollected = deltaOf('careerPlan')
  if (uncollected.calls === 1 && uncollected.measuredCalls === 0) {
    pass('三态运行时: 未采集 → Δcalls===1 但 Δ measuredCalls===0（未被吞成 ¥0）')
  } else {
    fail(`三态运行时: 未采集态错误 —— Δ${JSON.stringify(uncollected)}；未采集被当成 0 会让付费调用显示免费`)
  }

  const zero = deltaOf('jobMatch')
  if (zero.calls === 1 && zero.measuredCalls === 1 && zero.cny === 0) {
    pass('三态运行时: 成本为 0 → Δ measuredCalls===1 且 Δcny===0（与「未采集」形状不同）')
  } else {
    fail(`三态运行时: 成本为 0 态错误 —— Δ${JSON.stringify(zero)}`)
  }

  // 「未采集」与「成本为 0」必须真的长得不一样，否则三态形同虚设
  if (uncollected.measuredCalls !== zero.measuredCalls) {
    pass('三态运行时: 未采集 与 成本为 0 在接口层可区分')
  } else {
    fail('三态运行时: 未采集 与 成本为 0 形状相同 —— 前端无法诚实展示')
  }

  const unmeasuredDelta = usage.unmeasuredCalls - before.unmeasuredCalls
  if (unmeasuredDelta === 1) pass('三态运行时: 顶层 unmeasuredCalls 已计数（总成本自曝是下限）')
  else fail(`三态运行时: 顶层 unmeasuredCalls 未计数 —— Δ${unmeasuredDelta}，应为 1`)

  if (/^\d{4}-\d{2}-\d{2}$/u.test(usage.costCollectionSince)) {
    pass(`三态运行时: costCollectionSince 有效（${usage.costCollectionSince}）`)
  } else {
    fail(`三态运行时: costCollectionSince 非法 —— ${usage.costCollectionSince}`)
  }

  await prisma.aiServiceLog.deleteMany({
    where: { createdAt: { gte: since }, operation: { in: ['contractReview', 'careerPlan', 'jobMatch'] } },
  })
}

