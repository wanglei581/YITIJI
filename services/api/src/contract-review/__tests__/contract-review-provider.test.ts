import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ContractReviewProviderService,
  StrictFetchContractProviderTransport,
  loadContractProviderConfig,
  type ContractProviderApprovalGate,
  type ContractProviderTransport,
  type ContractProviderTransportRequest,
} from '../contract-review-provider.service'
import { CONTRACT_PROVIDER_MIN_TIMEOUT_MS } from '../contract-review-timing'

const deepseekEnv = {
  CONTRACT_REVIEW_PROVIDER: 'deepseek', CONTRACT_REVIEW_BASE_URL: 'https://api.deepseek.com/',
  CONTRACT_REVIEW_MODEL: 'deepseek-v4-pro', CONTRACT_REVIEW_API_KEY: 'test-contract-key-123456',
} as const

const validDraft = { findings: [{
  category: 'probation', priority: 'attention', title: '建议核实试用期', pageNumber: 1,
  excerpt: '试用期为六个月', explanation: '建议结合合同期限核实。', basisRef: null,
  verificationQuestion: '合同期限是多少？', uncertainty: '需核对原文。',
}] } as const

function wireBody(draft: unknown = validDraft): string { return JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }) }

function allowExact(): ContractProviderApprovalGate { return { assertApproved(config) {
  assert.deepEqual(config, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/', model: 'deepseek-v4-pro' })
} } }

test('loads only the two exact current domestic provider pairs', () => {
  assert.deepEqual(loadContractProviderConfig(deepseekEnv), deepseekEnvToConfig())
  assert.deepEqual(
    loadContractProviderConfig({
      CONTRACT_REVIEW_PROVIDER: 'qwen',
      CONTRACT_REVIEW_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      CONTRACT_REVIEW_MODEL: 'qwen-plus',
      CONTRACT_REVIEW_API_KEY: 'test-contract-key-123456',
    }),
    {
      provider: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      model: 'qwen-plus',
      apiKey: 'test-contract-key-123456',
    },
  )
})

test('rejects foreign, retired, mutable, and non-canonical provider endpoints', () => {
  const invalid = [
    ['claude', 'https://api.anthropic.com/', 'x'],
    ['deepseek', 'https://api.deepseek.com/v1/', 'deepseek-chat'],
    ['deepseek', 'not a url', 'deepseek-v4-pro'],
    ['deepseek', 'http://api.deepseek.com/', 'deepseek-v4-pro'],
    ['deepseek', 'https://user@api.deepseek.com/', 'deepseek-v4-pro'],
    ['deepseek', 'https://api.deepseek.com:443/', 'deepseek-v4-pro'],
    ['deepseek', 'https://api.deepseek.com/?x=1', 'deepseek-v4-pro'],
    ['deepseek', 'https://api.deepseek.com/#x', 'deepseek-v4-pro'],
    ['deepseek', 'https://api.deepseek.com./', 'deepseek-v4-pro'],
    ['deepseek', 'https://api.deepseek.com', 'deepseek-v4-pro'],
    ['deepseek', 'https://API.deepseek.com/', 'deepseek-v4-pro'],
    ['deepseek', 'https://api.deepseek.com/other/', 'deepseek-v4-pro'],
    ['deepseek', 'https://api.deepseek.com.evil.example/', 'deepseek-v4-pro'],
    ['deepseek', 'https://127.0.0.1/', 'deepseek-v4-pro'],
    ['deepseek', 'https://深度求索.example/', 'deepseek-v4-pro'],
    ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'],
  ] as const

  for (const [provider, baseUrl, model] of invalid) {
    assert.throws(
      () => loadContractProviderConfig({
        ...deepseekEnv,
        CONTRACT_REVIEW_PROVIDER: provider,
        CONTRACT_REVIEW_BASE_URL: baseUrl,
        CONTRACT_REVIEW_MODEL: model,
      }),
      /CONTRACT_PROVIDER_(?:NOT_ALLOWED|CONFIG_INVALID)/,
      `${provider} ${baseUrl} ${model}`,
    )
  }
})

test('requires own nonblank fields and a bounded dedicated API key without echoing it', () => {
  const inherited = Object.create(deepseekEnv) as Record<string, string>
  for (const env of [
    inherited,
    { ...deepseekEnv, CONTRACT_REVIEW_PROVIDER: ' ' },
    { ...deepseekEnv, CONTRACT_REVIEW_API_KEY: '' },
    { ...deepseekEnv, CONTRACT_REVIEW_API_KEY: 'short' },
    { ...deepseekEnv, CONTRACT_REVIEW_API_KEY: 'x'.repeat(513) },
  ]) {
    try {
      loadContractProviderConfig(env)
      assert.fail('expected config rejection')
    } catch (error) {
      assert.match(String(error), /CONTRACT_PROVIDER_(?:CONFIG_INVALID|API_KEY_INVALID)/)
      assert.doesNotMatch(String(error), /test-contract-key|x{20}/)
    }
  }
})

test('default approval rejects during initialization and transport is never called', () => {
  let calls = 0
  const transport: ContractProviderTransport = {
    async send() {
      calls += 1
      return { status: 200, redirected: false, body: wireBody() }
    },
  }
  assert.throws(
    () => new ContractReviewProviderService({ env: () => deepseekEnv, transport }),
    /CONTRACT_PROVIDER_NOT_APPROVED/,
  )
  assert.equal(calls, 0)
})

const invalidApprovalResults = [
  () => Promise.resolve(),
  () => Promise.reject(new Error('secret approval rejection')),
  () => ({ then: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('secret thenable')) }),
  () => true,
] as const

test('rejects every non-undefined approval result during construction', () => {
  for (const result of invalidApprovalResults) {
    const gate = { assertApproved: () => result() } as unknown as ContractProviderApprovalGate
    assert.throws(
      () => new ContractReviewProviderService({ env: () => deepseekEnv, approvalGate: gate }),
      /CONTRACT_PROVIDER_NOT_APPROVED/,
    )
  }
})

test('rejects every non-undefined approval result before each review without transport', async () => {
  for (const result of invalidApprovalResults) {
    let approvals = 0
    let calls = 0
    const gate = {
      assertApproved: () => (++approvals === 1 ? undefined : result()),
    } as unknown as ContractProviderApprovalGate
    const service = new ContractReviewProviderService({
      env: () => deepseekEnv,
      approvalGate: gate,
      transport: { async send() { calls += 1; return { status: 200, redirected: false, body: wireBody() } } },
    })
    await assert.rejects(() => service.review(maskedInput()), /CONTRACT_PROVIDER_NOT_APPROVED/)
    assert.equal(calls, 0)
  }
})

test('revalidates config and exact approval before every call', async () => {
  let env: Record<string, string | undefined> = { ...deepseekEnv }
  let approved = true
  let calls = 0
  const gate: ContractProviderApprovalGate = {
    assertApproved(config) {
      if (!approved || config.provider !== 'deepseek' || config.model !== 'deepseek-v4-pro') {
        throw new Error('CONTRACT_PROVIDER_NOT_APPROVED')
      }
    },
  }
  const service = new ContractReviewProviderService({
    env: () => env,
    approvalGate: gate,
    transport: {
      async send() {
        calls += 1
        return { status: 200, redirected: false, body: wireBody() }
      },
    },
  })
  approved = false
  await assert.rejects(() => service.review(maskedInput()), /CONTRACT_PROVIDER_NOT_APPROVED/)
  assert.equal(calls, 0)

  approved = true
  env = { ...deepseekEnv, CONTRACT_REVIEW_BASE_URL: 'https://api.deepseek.com/v1/' }
  await assert.rejects(() => service.review(maskedInput()), /CONTRACT_PROVIDER_NOT_ALLOWED/)
  assert.equal(calls, 0)
})

test('sends only masked JSON data with json_object mode and returns a typed draft', async () => {
  let captured: ContractProviderTransportRequest | undefined
  const service = new ContractReviewProviderService({
    env: () => deepseekEnv,
    approvalGate: allowExact(),
    transport: {
      async send(request) {
        captured = request
        return { status: 200, redirected: false, body: wireBody() }
      },
    },
  })

  const result = await service.review(maskedInput())
  assert.deepEqual(result, validDraft)
  assert.equal(captured?.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(captured?.apiKey, deepseekEnv.CONTRACT_REVIEW_API_KEY)
  assert.equal(captured?.payload.model, 'deepseek-v4-pro')
  assert.equal(captured?.payload.temperature, 0)
  assert.deepEqual(captured?.payload.response_format, { type: 'json_object' })
  assert.equal(captured?.payload.messages[0]?.role, 'system')
  assert.equal(captured?.payload.messages[1]?.role, 'user')
  assert.doesNotMatch(JSON.stringify(captured?.payload), /370101199001011234|张三/u)
  assert.equal(Object.prototype.hasOwnProperty.call(captured?.payload ?? {}, 'tools'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(captured?.payload ?? {}, 'tool_choice'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(captured?.payload ?? {}, 'functions'), false)
  const masked = [
    '姓名：[劳动者_1]', '用人单位：[用人单位_1]', '地址：[详细地址_1]', '身份证：[身份证_1]',
    '手机：[手机号_1]', '银行卡：[银行卡_1]', '邮箱：[邮箱_1]', '统一社会信用代码：[统一社会信用代码_1]',
  ].flatMap((text) => [text, text.replace('[', '［').replace('_', '＿').replace('1', '１').replace(']', '］'), text.replace(/(\[[^_]+)_1\]/u, '$1_1]$1_2]')])
  for (const text of masked) for (let cut = 1; cut < text.length; cut += 1) {
    const pages = [text.slice(0, cut), text.slice(cut)].map((value, index) => ({ pageNumber: index + 1, text: value }))
    assert.deepEqual(await service.review({ ...maskedInput(), pages }), validDraft)
  }
})

test('returns the approved provider identity from the same config snapshot used for review', async () => {
  let reads = 0
  const service = new ContractReviewProviderService({
    env: () => {
      reads += 1
      return deepseekEnv
    },
    approvalGate: allowExact(),
    transport: {
      async send(request) {
        assert.equal(request.payload.model, 'deepseek-v4-pro')
        return { status: 200, redirected: false, body: wireBody() }
      },
    },
  })

  const beforeReview = reads
  const reviewed = await service.reviewWithIdentity(maskedInput())
  assert.equal(reads, beforeReview + 1)
  assert.deepEqual(reviewed, {
    identity: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/',
      model: 'deepseek-v4-pro',
    },
    draft: validDraft,
  })
})

test('rejects raw PII, malformed pages, and request budgets before transport', async () => {
  let calls = 0
  const service = approvedService(async () => {
    calls += 1
    return { status: 200, redirected: false, body: wireBody() }
  })
  await assert.rejects(
    () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text: '身份证370101199001011234' }] }),
    /CONTRACT_PROVIDER_INPUT_INVALID/,
  )
  await assert.rejects(
    () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text: '姓名：张三，试用期六个月' }] }),
    /CONTRACT_PROVIDER_INPUT_INVALID/,
  )
  await assert.rejects(
    () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text: '姓名：Alice Zhang' }] }),
    /CONTRACT_PROVIDER_INPUT_INVALID/,
  )
  assert.equal(calls, 0)
  await assert.rejects(
    () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text: '用人单位：北京星辰科技' }] }),
    /CONTRACT_PROVIDER_INPUT_INVALID/,
  )
  assert.equal(calls, 0)
  await assert.rejects(
    () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text: '地址：西湖1号' }] }),
    /CONTRACT_PROVIDER_INPUT_INVALID/,
  )
  assert.equal(calls, 0)
  await assert.rejects(
    () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text: '用人单位：[用人单位_1]合同管理有限公司' }] }),
    /CONTRACT_PROVIDER_INPUT_INVALID/,
  )
  assert.equal(calls, 0)
  for (const text of [
    '用人单位：[用人单位_1] 北京星辰科技',
    '地址：[详细地址_1] 西湖1号',
    '姓名：[劳动者_1] Alice Zhang',
  ]) {
    await assert.rejects(
      () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text }] }),
      /CONTRACT_PROVIDER_INPUT_INVALID/,
    )
    assert.equal(calls, 0)
  }
  for (const [left, right] of [
    ['138001，', ' 38000'],
    ['370101199', '001011234'],
    ['11010549，', ' 1231002'],
    ['62220201', '23456789'],
    ['622202012，', ' 3456789012'],
  ] as const) {
    await assert.rejects(
      () => service.review({ ...maskedInput(), pages: [
        { pageNumber: 1, text: `正文${left}` }, { pageNumber: 2, text: `${right}正文` },
      ] }),
      /CONTRACT_PROVIDER_INPUT_INVALID/,
    )
    assert.equal(calls, 0)
  }
  for (const fragments of [
    ['姓名：'],
    [`正文138001${' '.repeat(1_000)}`, '38000正文'],
    ['正文138，', '；0013,', '、8000正文'],
    ['身份证号码：370101-1990年', '01月01日-', '1234'],
    ['身份证号码：３７０１０１－１９９０年', '０１月０１日－', '１２３Ｘ'],
    ['正文alice@exa', 'mple.com正文'], ['正文91110108M', 'A01ABC123正文'],
    ['姓', '名', '：', '张三正文'], ['用人单', '位', '：北京星辰科技有限公司'],
    ['正文Ａｌｉｃｅ＠Ｅｘａ', 'ｍｐｌｅ．ｃｏｍ正文'], ['正文９１１１０１０８Ｍ', 'Ａ０１ＡＢＣ１２３正文'],
    ['姓名：［劳动者＿１］', '[劳动者_2][劳动者_3]　Ａｌｉｃｅ　Ｚｈａｎｇ'], ['用人单位：[用人单位_1]', '[用人单位_2]，北京星辰科技有限公司'], ['地址：[详细地址_1]', '[详细地址_2] 西湖1号'], ['身份证：[身份证_1]', '[身份证_2]，３７０１０１１９９００１０１１２３４'],
    ['手机：[手机号_1]', '[手机号_2] 13800138000'], ['银行卡：[银行卡_1]', '[银行卡_2]，６２２２０２０１２３４５６７８９'], ['邮箱：[邮箱_1]', '[邮箱_2]　Ａｌｉｃｅ＠Ｅｘａｍｐｌｅ．ｃｏｍ'], ['统一社会信用代码：[统一社会信用代码_1]', '[统一社会信用代码_2]，９１１１０１０８ＭＡ０１ＡＢＣ１２３'], ['姓名：[劳动者_1]', '[张三_1]'], ['姓名：［劳动者＿１］', '［张三＿１］'],
  ]) {
    await assert.rejects(() => service.review({ ...maskedInput(), pages: fragments.map(
      (text, index) => ({ pageNumber: index + 1, text }),
    ) }), /CONTRACT_PROVIDER_INPUT_INVALID/)
    assert.equal(calls, 0)
  }
  for (const text of [
    '用人单位：[用人单位_1]，上海月光科技',
    '地址：[详细地址_1]，3号楼2单元',
  ]) {
    await assert.rejects(
      () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text }] }),
      /CONTRACT_PROVIDER_INPUT_INVALID/,
    )
    assert.equal(calls, 0)
  }
  for (const text of [
    '手机：１３８００１３８０００',
    '身份证：３７０１０１１９９００１０１１２３４',
    '身份证号码：370101-1990-01-01-1234',
    '身份证号码：３７０１０１－１９９０年０１月０１日－１２３Ｘ',
    '银行卡：６２２２０２０１２３４５６７８９０１',
    '邮箱：Ａｌｉｃｅ＠Ｅｘａｍｐｌｅ．ｃｏｍ',
    '统一社会信用代码：９１３５０２１１Ｍ０００１００Ｙ４３',
  ]) {
    await assert.rejects(
      () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text }] }),
      /CONTRACT_PROVIDER_INPUT_INVALID/,
    )
    assert.equal(calls, 0)
  }
  await assert.rejects(
    () => service.review({ ...maskedInput(), pages: [{ pageNumber: 2, text: '正文' }] }),
    /CONTRACT_PROVIDER_INPUT_INVALID/,
  )
  await assert.rejects(
    () => service.review({ ...maskedInput(), pages: [{ pageNumber: 1, text: 'x'.repeat(500_001) }] }),
    /CONTRACT_PROVIDER_INPUT_LIMIT/,
  )
  assert.equal(calls, 0)
})

test('accepts ordinary legal prose with PII nouns in model findings', async () => {
  const passages = [
    '甲方不得扣押乙方身份证件。',
    '劳动者应妥善保管身份证 和银行卡。',
    '工资通过银行账户 发放。',
    '电子邮箱 可用于发送工资单。',
    '联系电话 由劳动者自愿填写。',
  ]
  for (const passage of passages) {
    const draft = { findings: [{ ...validDraft.findings[0], explanation: passage }] }
    const service = approvedService(async () => ({ status: 200, redirected: false, body: wireBody(draft) }))
    assert.equal((await service.review(maskedInput())).findings[0]!.explanation, passage)
  }
})

test('fails closed without retry or fallback for transport and response failures', async () => {
  const responses = [
    { status: 500, redirected: false, body: 'secret upstream error' },
    { status: 200, redirected: true, body: wireBody() },
    { status: 200, redirected: false, body: '' },
    { status: 200, redirected: false, body: 'x'.repeat(512 * 1024 + 1) },
    { status: 200, redirected: false, body: '{bad json' },
    { status: 200, redirected: false, body: JSON.stringify({ choices: [] }) },
    { status: 200, redirected: false, body: JSON.stringify({ choices: [{ message: { content: '```json\n{}\n```' } }] }) },
  ]
  for (const response of responses) {
    let calls = 0
    const service = approvedService(async () => {
      calls += 1
      return response
    })
    await assert.rejects(
      () => service.review(maskedInput()),
      (error: unknown) => {
        assert.match(String(error), /CONTRACT_PROVIDER_(?:TRANSPORT_FAILED|RESPONSE_INVALID|RESPONSE_TOO_LARGE)/)
        assert.doesNotMatch(String(error), /secret upstream error|bad json/)
        return true
      },
    )
    assert.equal(calls, 1)
  }

  let calls = 0
  const networkFailure = approvedService(async () => {
    calls += 1
    throw new Error('socket exposed secret body')
  })
  await assert.rejects(() => networkFailure.review(maskedInput()), /CONTRACT_PROVIDER_TRANSPORT_FAILED/)
  assert.equal(calls, 1)
})

test('strictly validates exact draft keys, enums, lengths, counts, and page numbers', async () => {
  const invalidDrafts: unknown[] = [
    {},
    { ...validDraft, extra: true },
    { findings: 'nope' },
    { findings: Array.from({ length: 101 }, () => validDraft.findings[0]) },
    { findings: [{ ...validDraft.findings[0], extra: true }] },
    { findings: [{ ...validDraft.findings[0], category: 'fake' }] },
    { findings: [{ ...validDraft.findings[0], priority: 'safe' }] },
    { findings: [{ ...validDraft.findings[0], title: '' }] },
    { findings: [{ ...validDraft.findings[0], excerpt: 'x'.repeat(501) }] },
    { findings: [{ ...validDraft.findings[0], pageNumber: 2 }] },
    { findings: [{ ...validDraft.findings[0], charStart: 0 }] },
    { findings: [{ ...validDraft.findings[0], explanation: '请联系13800138000核实' }] },
    { findings: [{ ...validDraft.findings[0], title: '370101-1990年', excerpt: '01月01日-', explanation: '1234' }] },
    { findings: [{ ...validDraft.findings[0], explanation: '身份证号码：３７０１０１－１９９０年０１月０１日－１２３Ｘ' }] },
    { findings: [{ ...validDraft.findings[0], title: 'alice@exa', excerpt: 'mple.com' }] },
    { findings: [{ ...validDraft.findings[0], title: '91110108M', excerpt: 'A01ABC123' }] },
    { findings: [{ ...validDraft.findings[0], title: '姓', excerpt: '名：', explanation: '张三正文' }] },
    { findings: [{ ...validDraft.findings[0], title: 'Ａｌｉｃｅ＠Ｅｘａ', excerpt: 'ｍｐｌｅ．ｃｏｍ' }] },
  ]
  for (const draft of invalidDrafts) {
    const service = approvedService(async () => ({ status: 200, redirected: false, body: wireBody(draft) }))
    await assert.rejects(() => service.review(maskedInput()), /CONTRACT_PROVIDER_RESPONSE_INVALID/)
  }
})

test('rejects PII reconstructed across response fields or findings', async () => {
  const separators = {
    ...validDraft.findings[0], title: '，', excerpt: '；', explanation: '、',
    verificationQuestion: ',', uncertainty: '',
  }
  const drafts = [
    { findings: [{ ...validDraft.findings[0], title: '138001', excerpt: '38000' }] },
    { findings: [{ ...validDraft.findings[0], title: '138', excerpt: '0013', explanation: '8000' }] },
    { findings: [
      { ...validDraft.findings[0], uncertainty: '138001' },
      { ...validDraft.findings[0], title: '38000' },
    ] },
    { findings: [
      { ...separators, uncertainty: '138' }, { ...separators, title: '0013' }, { ...separators, title: '8000' },
    ] },
    { findings: [{ ...separators, uncertainty: '用人单' }, { ...separators, title: '位：北京星辰科技有限公司' }] },
    { findings: [{ ...validDraft.findings[0], title: '姓名：[劳动者_1]', excerpt: '[劳动者_2]', explanation: '张三' }] }, { findings: [{ ...validDraft.findings[0], verificationQuestion: '姓名：[劳动者_1]', uncertainty: '[张三_1]' }] }, { findings: [{ ...validDraft.findings[0], verificationQuestion: '姓名：［劳动者＿１］', uncertainty: '［张三＿１］' }] },
  ]
  for (const draft of drafts) {
    const service = approvedService(async () => ({ status: 200, redirected: false, body: wireBody(draft) }))
    await assert.rejects(() => service.review(maskedInput()), /CONTRACT_PROVIDER_RESPONSE_INVALID/)
  }
})

test('strict fetch transport sets redirect error and aborts on timeout without real network', async () => {
  let init: RequestInit | undefined
  const fetchTransport = new StrictFetchContractProviderTransport(async (_input, nextInit) => {
    init = nextInit
    return new Response(wireBody(), { status: 200 })
  })
  const response = await fetchTransport.send(fakeTransportRequest())
  assert.equal(response.status, 200)
  assert.equal(init?.redirect, 'error')
  assert.ok(init?.signal instanceof AbortSignal)

  const timedOut = new StrictFetchContractProviderTransport(
    async (_input, nextInit) => new Promise((_resolve, reject) => {
      nextInit?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }),
    1,
  )
  // 超时不再塌成 TRANSPORT_FAILED —— 两者含义完全不同，混在一起正是
  // 2026-08-17 生产排查了整晚的直接原因（网络实测完好，其实是自己 abort 的）。
  await assert.rejects(() => timedOut.send(fakeTransportRequest()), /CONTRACT_PROVIDER_TIMEOUT/)

  const oversized = new StrictFetchContractProviderTransport(async () => new Response('x'.repeat(512 * 1024 + 1)))
  await assert.rejects(() => oversized.send(fakeTransportRequest()), /CONTRACT_PROVIDER_TRANSPORT_FAILED/)
})

function deepseekEnvToConfig() {
  return {
    provider: 'deepseek' as const,
    baseUrl: 'https://api.deepseek.com/' as const,
    model: 'deepseek-v4-pro' as const,
    apiKey: 'test-contract-key-123456',
  }
}

function maskedInput() {
  return {
    pages: [{ pageNumber: 1, text: '乙方：[劳动者_1]，试用期为六个月。' }],
    partyFacts: {
      hasPartyA: false,
      hasPartyB: true,
      hasEmployer: false,
      hasWorker: true,
      hasUscc: false,
      hasBankAccount: false,
    },
  } as const
}

function approvedService(send: ContractProviderTransport['send']) {
  return new ContractReviewProviderService({
    env: () => deepseekEnv,
    approvalGate: allowExact(),
    transport: { send },
  })
}

function fakeTransportRequest(): ContractProviderTransportRequest {
  return {
    url: 'https://api.deepseek.com/chat/completions',
    apiKey: 'test-contract-key-123456',
    payload: {
      model: 'deepseek-v4-pro',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: '{}' },
      ],
    },
    // 超时现在逐次请求携带（按合同页数伸缩），不再是 transport 构造时的常量。
    timeoutMs: CONTRACT_PROVIDER_MIN_TIMEOUT_MS,
  }
}
