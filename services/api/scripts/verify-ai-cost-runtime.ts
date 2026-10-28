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


/** 物理用量测试：只记录可证明的成功段，金额始终留空。 */
export async function voiceUsageRuntimeChecks(pass: Check, fail: Check, aiLog: import('../src/ai/ai-log.service').AiLogService): Promise<void> {
  const { wavDuration } = await import('../src/asr/wav-duration')
  const wav = Buffer.alloc(48)
  wav.write('RIFF', 0); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(2, 24); wav.writeUInt32LE(4, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(4, 40)
  const valid = wavDuration(wav)
  if (valid.complete && valid.audioSeconds === 1 && !wavDuration(wav.subarray(0, 47)).complete && !wavDuration(Buffer.from('not wav')).complete) pass('语音用量: 合法 WAV 及截断、非 WAV')
  else fail('语音用量: WAV 合法及损坏判断错误')
  const { AiController } = await import('../src/ai/ai.controller')
  const { MockInterviewController } = await import('../src/mock-interview/mock-interview.controller')
  const recorded: Array<{ voiceUsage?: { audioSeconds?: number | null; complete: boolean } }> = []
  const fakeAsr = { activeProviderName: 'test', recognizeWav: async () => ({ ok: true, text: 'ok' }) }
  const log = { record: (entry: { voiceUsage?: { audioSeconds?: number | null; complete: boolean } }) => recorded.push(entry) }
  const controller = new AiController(...(Array.from({ length: AiController.length }, () => ({})) as never[]))
  Object.assign(controller, { asr: fakeAsr, logService: log, audit: { write: async () => undefined }, publicQuota: { consume: async () => ({ keys: ['k'] }), rollback: async () => undefined }, jwt: {}, redis: {}, prisma: {} })
  const interview = new MockInterviewController({ getSession: async () => ({}) } as never, fakeAsr as never, {} as never, {} as never, {} as never, {} as never, log as never)
  const file = (buffer: Buffer) => ({ buffer }) as Express.Multer.File
  const req = { headers: {} } as never
  const entrances = [
    (buffer: Buffer) => controller.transcribeResumeVoice(file(buffer), req),
    (buffer: Buffer) => controller.transcribeAssistantVoice(file(buffer), req),
    (buffer: Buffer) => interview.transcribe('test', file(buffer), req),
  ]
  for (const [index, run] of entrances.entries()) {
    const start = recorded.length
    try {
      await run(wav)
      await run(wav.subarray(0, 47))
      await run(Buffer.from('not wav')).catch(() => undefined)
      const rows = recorded.slice(start)
      if (rows[0]?.voiceUsage?.audioSeconds === 1 && rows[0].voiceUsage.complete && rows[1]?.voiceUsage?.audioSeconds === null && !rows[1].voiceUsage.complete && (index < 2 ? rows.length === 2 : rows[2]?.voiceUsage?.audioSeconds === null && !rows[2].voiceUsage.complete)) pass(`语音用量: ASR 入口 ${index + 1} 合法、损坏、非 WAV`)
      else fail(`语音用量: ASR 入口 ${index + 1} 用量错误`)
    } catch (error) { fail(`语音用量: ASR 入口 ${index + 1} 异常 ${String(error)}`) }
  }
  const { TtsService, splitForTts } = await import('../src/mock-interview/asr/tts.service')
  const oldId = process.env['TENCENT_TTS_SECRET_ID'], oldKey = process.env['TENCENT_TTS_SECRET_KEY'], oldProvider = process.env['TTS_PROVIDER']
  process.env['TENCENT_TTS_SECRET_ID'] = 'test'; process.env['TENCENT_TTS_SECRET_KEY'] = 'test'; process.env['TTS_PROVIDER'] = 'tencent'
  try {
    const service = new TtsService()
    const sent: string[] = []
    ;(service as unknown as { synthesizeSegment: (text: string) => Promise<Buffer | null> }).synthesizeSegment = async (text) => {
      sent.push(text)
      return sent.length === 2 ? null : Buffer.from('audio')
    }
    const input = '中文 & 特殊字符。' + '测'.repeat(100)
    const result = await service.synthesize(input)
    const expected = splitForTts(input)
    if (!result.ok && sent.length === 2 && result.voiceUsage?.segments === expected.length && result.voiceUsage.succeededSegments === 1 && result.voiceUsage.succeededChars === Array.from(sent[0]!).length && result.voiceUsage.textChars === sent.reduce((n, part) => n + Array.from(part).length, 0) && !result.voiceUsage.complete) pass('语音用量: 中文特殊字符、分段与部分失败')
    else fail('语音用量: TTS 分段或部分失败计数错误')
    ;(service as unknown as { synthesizeSegment: (text: string) => Promise<Buffer | null> }).synthesizeSegment = async () => Buffer.from('audio')
    const success = await service.synthesize(input)
    if (success.ok && success.voiceUsage?.complete && success.voiceUsage.succeededSegments === expected.length && success.voiceUsage.succeededChars === expected.reduce((n, part) => n + Array.from(part).length, 0)) pass('语音用量: 全部合成成功的字符和段数')
    else fail('语音用量: 全部成功的字符或段数错误')

  } finally {
    if (oldId === undefined) delete process.env['TENCENT_TTS_SECRET_ID']; else process.env['TENCENT_TTS_SECRET_ID'] = oldId
    if (oldKey === undefined) delete process.env['TENCENT_TTS_SECRET_KEY']; else process.env['TENCENT_TTS_SECRET_KEY'] = oldKey
    if (oldProvider === undefined) delete process.env['TTS_PROVIDER']; else process.env['TTS_PROVIDER'] = oldProvider
  }
  const before = await aiLog.getUsage('test')
  aiLog.record({ taskId: null, operation: 'voiceTranscribe', provider: 'asr:test', latencyMs: 1, status: 'success', voiceUsage: valid })
  // 失败的识别即使带完整时长也不计入：供应方是否计费不明，宁可少算不多算
  aiLog.record({ taskId: null, operation: 'voiceTranscribe', provider: 'asr:test', latencyMs: 1, status: 'failed', voiceUsage: valid })
  aiLog.record({ taskId: null, operation: 'voiceSynthesize', provider: 'tts:test', latencyMs: 1, status: 'failed', voiceUsage: { textChars: 8, succeededChars: 3, segments: 2, succeededSegments: 1, complete: false, rule: 'v1' } })
  await aiLog.flush()
  const after = await aiLog.getUsage('test')
  if (after.voiceUsageTotals.asrSeconds - before.voiceUsageTotals.asrSeconds === 1 && after.voiceUsageTotals.asrCallsWithUsage - before.voiceUsageTotals.asrCallsWithUsage === 1 && after.voiceUsageTotals.ttsChars - before.voiceUsageTotals.ttsChars === 3 && after.unmeasuredCalls - before.unmeasuredCalls === 3 && after.tokenUsageTotals.totalTokens === before.tokenUsageTotals.totalTokens) pass('语音用量: 落库回读、部分成功聚合、token 与费用未受影响')
  else fail('语音用量: 落库聚合或 token / 费用不符合预期')
}
