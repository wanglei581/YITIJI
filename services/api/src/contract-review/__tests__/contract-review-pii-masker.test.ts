import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertNoHighConfidencePii, maskContractPages, maskContractText } from '../contract-review-pii-masker'

test('masks labeled parties and common PII while preserving legal facts', () => {
  const input = [
    {
      pageNumber: 1,
      text: [
        '甲方：北京海淀科技有限公司',
        '乙方：张三 身份证 370101199001011234 手机 +86 138-0013-8000',
        '银行卡 6222 0201 2345 6789 邮箱 zhang.san@example.com',
        '地址：北京市海淀区中关村大街88号',
        '统一社会信用代码：91110108MA01ABC123',
      ].join('\n'),
    },
    {
      pageNumber: 2,
      text: '张三在北京海淀科技有限公司的月薪为12000元，2026年8月1日起履行，同期3年，依据第19条。',
    },
  ] as const

  const output = maskContractPages(input)
  const joined = output.pages.map((page) => page.text).join('\n')

  assert.doesNotMatch(
    joined,
    /370101199001011234|138-0013-8000|6222 0201 2345 6789|zhang\.san@example\.com|91110108MA01ABC123|北京市海淀区中关村大街88号/u,
  )
  assert.equal(output.pages[0]!.text.match(/\[劳动者_1\]/u)?.[0], '[劳动者_1]')
  assert.equal(output.pages[1]!.text.match(/\[劳动者_1\]/u)?.[0], '[劳动者_1]')
  assert.equal(output.pages[0]!.text.match(/\[用人单位_1\]/u)?.[0], '[用人单位_1]')
  assert.equal(output.pages[1]!.text.match(/\[用人单位_1\]/u)?.[0], '[用人单位_1]')
  assert.match(output.pages[1]!.text, /12000元|2026年8月1日|3年|第19条/u)
  assert.deepEqual(output.partyFacts, {
    hasPartyA: true,
    hasPartyB: true,
    hasEmployer: true,
    hasWorker: true,
    hasUscc: true,
    hasBankAccount: true,
  })
  assert.deepEqual(input[0].text.includes('张三'), true)
  assert.deepEqual(Object.keys(output).sort(), ['pages', 'partyFacts'])
  assert.equal(JSON.stringify(output).includes('张三'), false)
})

test('normalizes separator variants to stable placeholders and numbers distinct entities', () => {
  const output = maskContractPages([
    {
      pageNumber: 1,
      text: '姓名：李四 证件：110105 1949 12 31 002X 电话：+86 139 1234 5678 银行卡：6214-8302-1234-5678',
    },
    {
      pageNumber: 2,
      text: '劳动者：王五 联系号码13912345678，证件110105-1949-12-31-002X，账号6214830212345678。',
    },
  ])

  assert.match(output.pages[0]!.text, /\[劳动者_1\]/u)
  assert.match(output.pages[1]!.text, /\[劳动者_2\]/u)
  assert.equal(output.pages.flatMap((page) => page.text.match(/\[身份证_1\]/gu) ?? []).length, 2)
  assert.equal(output.pages.flatMap((page) => page.text.match(/\[手机号_1\]/gu) ?? []).length, 2)
  assert.equal(output.pages.flatMap((page) => page.text.match(/\[银行卡_1\]/gu) ?? []).length, 2)
})

test('masks PII inside URL query values and handles emoji as UTF-16 input', () => {
  const output = maskContractPages([
    {
      pageNumber: 1,
      text: '😀核对 https://example.cn/check?phone=13800138000&id=370101199001011234&email=a%40b.com 邮箱 a@b.com',
    },
  ])
  assert.doesNotMatch(output.pages[0]!.text, /13800138000|370101199001011234|a(?:@|%40)b\.com/u)
  assert.match(output.pages[0]!.text, /^😀/u)
})

test('masks NFKC-compatible PII without normalizing unaffected text', () => {
  const input = [
    { pageNumber: 1, text: '标记Ａ；手机：１３８００１３８０００' },
    { pageNumber: 2, text: '身份证：３７０１０１１９９００１０１１２３４；证件：１１０１０５４９１２３１００２' },
    { pageNumber: 3, text: '银行卡：６２２２０２０１２３４５６７８９；账号：６２２２０２０１２３４５６７８９０１２' },
    { pageNumber: 4, text: '邮箱：Ａｌｉｃｅ＠Ｅｘａｍｐｌｅ．ｃｏｍ' },
    { pageNumber: 5, text: '统一社会信用代码：９１３５０２１１Ｍ０００１００Ｙ４３' },
  ] as const
  const snapshot = structuredClone(input)
  const output = maskContractPages(input)

  assert.equal(output.pages[0]!.text.startsWith('标记Ａ；'), true)
  assert.match(output.pages[0]!.text, /\[手机号_1\]/u)
  assert.match(output.pages[1]!.text, /\[身份证_1\].*\[身份证_2\]/u)
  assert.match(output.pages[2]!.text, /\[银行卡_1\].*\[银行卡_2\]/u)
  assert.match(output.pages[3]!.text, /\[邮箱_1\]/u)
  assert.match(output.pages[4]!.text, /\[统一社会信用代码_1\]/u)
  assert.deepEqual(output.pages.map((page) => page.pageNumber), [1, 2, 3, 4, 5])
  assert.deepEqual(input, snapshot)
})

test('masks DOB-separated identities before applying date protection', () => {
  for (const input of [
    '身份证号码：370101-1990-01-01-1234',
    '身份证号码：370101/1990/01/01/123X',
    '身份证号码：370101-1990年01月01日-1234',
    '身份证号码：３７０１０１－１９９０－０１－０１－１２３４',
  ]) {
    const output = maskContractPages([{ pageNumber: 1, text: input }])
    assert.equal(output.pages[0]!.text, '身份证号码：[身份证_1]')
  }
  for (const [prefix, date, suffix] of [
    ['身份证号码：370101-', '1990-01-01', '-1234'],
    ['身份证号码：370101/', '1990/01/01', '/123X'],
    ['身份证号码：370101-', '1990年01月01日', '-1234'],
    ['身份证号码：３７０１０１－', '１９９０年０１月０１日', '－１２３Ｘ'],
  ] as const) {
    for (let cut = 1; cut < date.length; cut += 1) {
      assert.throws(() => maskContractPages([
        { pageNumber: 1, text: `${prefix}${date.slice(0, cut)}` },
        { pageNumber: 2, text: date.slice(cut) },
        { pageNumber: 3, text: suffix },
      ]), /CONTRACT_PII_MASK_INCOMPLETE/)
    }
  }
})

test('rejects nonnumeric PII reconstructed across fragment boundaries', () => {
  const unsafe = [
    ['正文alice@exa', 'mple.com正文'],
    ['正文91110108M', 'A01ABC123正文'],
    ['姓', '名', '：', '张三正文'],
    ['用人单', '位', '：北京星辰科技有限公司'],
    ['地', '址：西湖1号'],
    ['正文Ａｌｉｃｅ＠Ｅｘａ', 'ｍｐｌｅ．ｃｏｍ正文'],
    ['正文９１１１０１０８Ｍ', 'Ａ０１ＡＢＣ１２３正文'],
    ['姓名：'],
    ['姓名：［劳动者＿１］', '　Ａｌｉｃｅ　Ｚｈａｎｇ'], ['用人单位：[用人单位_1]', '，北京星辰科技有限公司'], ['地址：[详细地址_1]', ' 西湖1号'], ['姓名：[劳动者_1]', '[张三_1]'], ['姓名：［劳动者＿１］', '［张三＿１］'],
  ]
  for (const fragments of unsafe) assert.throws(() => maskContractPages(
    fragments.map((text, index) => ({ pageNumber: index + 1, text })),
  ), /CONTRACT_PII_MASK_INCOMPLETE/)
  const chained = [['姓名：[劳动者_1]', ['[劳动者_2][劳动者_3]', '　Ａｌｉｃｅ　Ｚｈａｎｇ']], ['用人单位：[用人单位_1]', ['[用人单位_2]', '，北京星辰科技']], ['地址：[详细地址_1]', ['[详细地址_2]', ' 西湖1号']], ['身份证：[身份证_1]', ['[身份证_2]', '，３７０１０１１９９００１０１１２３４']], ['手机：[手机号_1]', ['[手机号_2]', ' 13800138000']], ['银行卡：[银行卡_1]', ['[银行卡_2]', '，６２２２０２０１２３４５６７８９']], ['邮箱：[邮箱_1]', ['[邮箱_2]', '　Ａｌｉｃｅ＠Ｅｘａｍｐｌｅ．ｃｏｍ']], ['统一社会信用代码：[统一社会信用代码_1]', ['[统一社会信用代码_2]', '，９１１１０１０８ＭＡ０１ＡＢＣ１２３']]] as const
  for (const [head, tail] of chained) assert.throws(() => assertNoHighConfidencePii([head, ...tail].map((text, index) => ({ pageNumber: index + 1, text }))), /CONTRACT_PII_MASK_INCOMPLETE/)
  const safe = ['劳动者应填写姓', '名并妥善保管邮箱。合同期限2026-08-01至2029-07-31。']
  const output = maskContractPages(safe.map((text, index) => ({ pageNumber: index + 1, text })))
  assert.deepEqual(output.pages.map((page) => page.text), safe)
  const masked = [
    '姓名：[劳动者_1]', '用人单位：[用人单位_1]', '地址：[详细地址_1]', '身份证：[身份证_1]',
    '手机：[手机号_1]', '银行卡：[银行卡_1]', '邮箱：[邮箱_1]', '统一社会信用代码：[统一社会信用代码_1]',
  ].flatMap((text) => [text, text.replace('[', '［').replace('_', '＿').replace('1', '１').replace(']', '］'), text.replace(/(\[[^_]+)_1\]/u, '$1_1]$1_2]')])
  for (const text of masked) for (let cut = 1; cut < text.length; cut += 1) {
    const fragments = [text.slice(0, cut), text.slice(cut)]
    assert.doesNotThrow(() => assertNoHighConfidencePii(fragments.map((value, index) => ({ pageNumber: index + 1, text: value }))))
  }
})

test('propagates normalized worker entities across pages with stable placeholders', () => {
  const input = [
    { pageNumber: 1, text: '姓名：Alice Zhang。' },
    { pageNumber: 2, text: '复核人：ALICE ZHANG；签字：Alice  Zhang。' },
    { pageNumber: 3, text: '姓名：张三。' },
    { pageNumber: 4, text: '复核人：张 三。' },
  ] as const
  const snapshot = structuredClone(input)
  const output = maskContractPages(input)

  assert.match(output.pages[0]!.text, /\[劳动者_1\]/u)
  assert.equal(output.pages[1]!.text.match(/\[劳动者_1\]/gu)?.length, 2)
  assert.match(output.pages[2]!.text, /\[劳动者_2\]/u)
  assert.match(output.pages[3]!.text, /\[劳动者_2\]/u)
  assert.deepEqual(input, snapshot)
})

test('handles candidate-dense input near the budget with bounded selection work', { timeout: 30_000 }, () => {
  const company = '北京星辰科技服务有限公司'.repeat(8)
  const entry = `用人单位：${company}\n`
  const input = entry.repeat(18_000)
  const startedAt = Date.now()
  const output = maskContractPages([{ pageNumber: 1, text: input }])

  assert.ok(input.length > 1_800_000)
  assert.equal(output.pages[0]!.text.includes(company), false)
  assert.equal(output.pages[0]!.text.match(/\[用人单位_1\]/gu)?.length, 18_000)
  assert.ok(Date.now() - startedAt < 20_000)
})

test('rejects projected oversized output before assembling 160k replacements', { timeout: 60_000 }, () => {
  const input = '13800138000 '.repeat(160_000)
  const startedAt = Date.now()

  assert.equal(input.length, 1_920_000)
  assert.throws(
    () => maskContractPages([{ pageNumber: 1, text: input }]),
    /CONTRACT_PII_MASK_OUTPUT_LIMIT/,
  )
  assert.ok(Date.now() - startedAt < 25_000)
})

test('rejects numeric PII reconstructed across adjacent page boundaries', () => {
  const values = [
    ['138001', '38000'],
    ['370101199', '001011234'],
    ['11010549', '1231002'],
    ['62220201', '23456789'],
    ['622202012', '3456789012'],
  ] as const
  for (const [left, right] of values) {
    for (const [suffix, prefix] of [['', ''], ['，', ' \n']] as const) {
      assert.throws(
        () => maskContractPages([
          { pageNumber: 1, text: `正文${left}${suffix}` },
          { pageNumber: 2, text: `${prefix}${right}正文` },
        ]),
        /CONTRACT_PII_MASK_INCOMPLETE/,
      )
    }
  }
})

test('rejects long-separated and multi-fragment numeric PII with bounded state', () => {
  for (const spaces of [95, 1_000]) {
    assert.throws(() => maskContractPages([
      { pageNumber: 1, text: `正文138001${' '.repeat(spaces)}` },
      { pageNumber: 2, text: '38000正文' },
    ]), /CONTRACT_PII_MASK_INCOMPLETE/)
  }
  for (const fragments of [
    ['正文138', '0013', '8000正文'],
    ['正文138，', '；0013,', '、8000正文'],
  ]) {
    assert.throws(
      () => maskContractPages(fragments.map((text, index) => ({ pageNumber: index + 1, text }))),
      /CONTRACT_PII_MASK_INCOMPLETE/,
    )
  }
  assert.doesNotThrow(() => maskContractPages([
    { pageNumber: 1, text: '正文138条款' },
    { pageNumber: 2, text: '0013说明' },
    { pageNumber: 3, text: '8000元' },
  ]))
})

test('preserves complete ISO, slash, and Chinese date ranges across pages', () => {
  const samples = [
    ['合同期限自2026-08-01', '2029-07-31止。'],
    ['合同期限自2026/08/01至', '2029/07/31止。'],
    ['合同期限自2026年8月1日至', '2029年7月31日止。'],
    ['合同期限2026-08-01-2029-07-31止。'],
    ['合同期限2026-08-01 - 2029-07-31止。'],
    ['合同期限2026/08/01至2029/07/31止。'],
    ['合同期限2026年8月1日至2029年7月31日止。'],
  ]
  for (const fragments of samples) {
    const output = maskContractPages(fragments.map((text, index) => ({ pageNumber: index + 1, text })))
    assert.deepEqual(output.pages.map((page) => page.text), fragments)
    assert.equal(output.partyFacts.hasBankAccount, false)
  }
})

test('explicit bank labels override legal-date protection', () => {
  for (const input of [
    '银行卡：2026-08-01-2029-07-31',
    '银行卡：2026/08/01至2029/07/31',
    '银行卡：2026年8月1日至2029年7月31日',
  ]) {
    const output = maskContractPages([{ pageNumber: 1, text: input }])
    assert.equal(output.pages[0]!.text, '银行卡：[银行卡_1]')
  }
})

test('rejects excessive unique entities and normalized search work before propagation', { timeout: 10_000 }, () => {
  for (const count of [10_000, 40_000]) {
    const text = Array.from({ length: count }, (_, index) => `用人单位：主体${index}\n`).join('')
    const startedAt = Date.now()
    assert.throws(() => maskContractPages([{ pageNumber: 1, text }]), /CONTRACT_PII_MASK_ENTITY_LIMIT/)
    assert.ok(Date.now() - startedAt < 5_000)
  }
  const entities = Array.from({ length: 200 }, (_, index) => `用人单位：主体${index}\n`).join('')
  assert.throws(
    () => maskContractPages([{ pageNumber: 1, text: `${entities}${'正文'.repeat(30_000)}` }]),
    /CONTRACT_PII_MASK_ENTITY_LIMIT/,
  )
})

test('maskContractText is a single-page convenience wrapper', () => {
  const output = maskContractText('姓名：赵六，手机13800138000')
  assert.match(output.text, /\[劳动者_1\].*\[手机号_1\]/u)
  assert.equal(output.partyFacts.hasWorker, true)
})

test('masks legacy 15-digit identity values and overlapping labeled addresses', () => {
  const output = maskContractPages([{
    pageNumber: 1,
    text: '证件：110105 491231 002，通讯地址：北京市朝阳区建国路13800138000号',
  }])
  assert.doesNotMatch(output.pages[0]!.text, /110105|13800138000/u)
  assert.match(output.pages[0]!.text, /\[身份证_1\].*\[详细地址_1\]/u)
})

test('explicit labels mask unsuffixed employers, short addresses, and latin worker names', () => {
  const output = maskContractPages([{
    pageNumber: 1,
    text: '用人单位：北京星辰科技\n地址：西湖1号\n姓名：Alice Zhang',
  }])
  assert.doesNotMatch(output.pages[0]!.text, /北京星辰科技|西湖1号|Alice Zhang/u)
  assert.match(output.pages[0]!.text, /\[用人单位_1\]/u)
  assert.match(output.pages[0]!.text, /\[详细地址_1\]/u)
  assert.match(output.pages[0]!.text, /\[劳动者_1\]/u)
})

test('labeled value boundaries preserve each legal fact independently', () => {
  const output = maskContractPages([{
    pageNumber: 1,
    text: '地址：北京市朝阳区建国路88号 月薪12000元 合同期限3年 依据第19条。\n姓名：张三月薪12000元',
  }])
  const text = output.pages[0]!.text
  assert.match(text, /月薪12000元/u)
  assert.match(text, /合同期限3年/u)
  assert.match(text, /第19条/u)
  assert.match(text, /\[劳动者_1\]月薪12000元/u)
})

test('employer and address values keep embedded legal-looking words inside the entity', () => {
  const samples = [
    { input: '用人单位：北京合同管理有限公司', placeholder: '[用人单位_1]' },
    { input: '用人单位：上海工资宝科技有限公司', placeholder: '[用人单位_1]' },
    { input: '地址：北京市海淀区合同路88号', placeholder: '[详细地址_1]' },
    { input: '地址：深圳市依据大道8号', placeholder: '[详细地址_1]' },
  ] as const
  for (const sample of samples) {
    const output = maskContractPages([{ pageNumber: 1, text: sample.input }])
    assert.equal(output.pages[0]!.text, `${sample.input.slice(0, sample.input.indexOf('：') + 1)}${sample.placeholder}`)
  }
})

test('employer and address boundaries preserve each validated legal fact shape', () => {
  const output = maskContractPages([{
    pageNumber: 1,
    text: '地址：北京市朝阳区建国路88号 2026年8月1日 期限3年 基本工资12000元 薪资13000元 劳动报酬14000元 根据《劳动合同法》第十九条。',
  }])
  const text = output.pages[0]!.text
  assert.match(text, /2026年8月1日/u)
  assert.match(text, /期限3年/u)
  assert.match(text, /基本工资12000元/u)
  assert.match(text, /薪资13000元/u)
  assert.match(text, /劳动报酬14000元/u)
  assert.match(text, /根据《劳动合同法》第十九条/u)
})

test('fact-like prefixes with unsafe suffixes never create a partial mask', () => {
  const samples = [
    { input: '用人单位：北京 工资12000元科技有限公司', rawTail: '工资12000元科技有限公司' },
    { input: '地址：北京市海淀区 2026年8月1日路88号', rawTail: '2026年8月1日路88号' },
    { input: '地址：北京市海淀区 工资12000元至15000元科技园', rawTail: '工资12000元至15000元科技园' },
    { input: '地址：北京市海淀区 试用期3个月至6个月科技园', rawTail: '试用期3个月至6个月科技园' },
    { input: '地址：北京市海淀区 2026/08/01生效路88号', rawTail: '2026/08/01生效路88号' },
  ] as const
  for (const sample of samples) {
    try {
      const text = maskContractPages([{ pageNumber: 1, text: sample.input }]).pages[0]!.text
      assert.doesNotMatch(text, new RegExp(`\\]\\s+${sample.rawTail}`, 'u'))
      assert.equal(text.includes(sample.rawTail), false)
    } catch (error) {
      assert.match(String(error), /CONTRACT_PII_MASK_INCOMPLETE/)
    }
  }
})

test('preserves every supported Chinese legal fact shape after a sensitive field', () => {
  const output = maskContractPages([{
    pageNumber: 1,
    text: '地址：北京市朝阳区建国路88号 劳动报酬人民币壹万元/月 期限三年 试用期六个月 工作地点为海淀区 根据《劳动合同法》第十九条 第十九条。',
  }])
  const text = output.pages[0]!.text
  assert.match(text, /劳动报酬人民币壹万元\/月/u)
  assert.match(text, /期限三年/u)
  assert.match(text, /试用期六个月/u)
  assert.match(text, /工作地点为海淀区/u)
  assert.match(text, /根据《劳动合同法》第十九条/u)
  assert.match(text, /\s第十九条。/u)
})

test('comma-separated employer and address continuations are fully masked', () => {
  const samples = [
    { input: '用人单位：北京星辰科技，上海月光科技', raw: ['北京星辰科技', '上海月光科技'] },
    { input: '地址：北京市海淀区中关村88号，北京市朝阳区建国路99号', raw: ['北京市海淀区中关村88号', '北京市朝阳区建国路99号'] },
    { input: '地址：北京市海淀区中关村88号，3号楼2单元', raw: ['北京市海淀区中关村88号', '3号楼2单元'] },
  ] as const
  for (const sample of samples) {
    const text = maskContractPages([{ pageNumber: 1, text: sample.input }]).pages[0]!.text
    assert.equal(text.includes(sample.raw[0]), false)
    assert.equal(text.includes(sample.raw[1]), false)
  }
})

for (const fact of [
  '2026年8月1日起履行',
  '自2026年8月1日起履行',
  '2026-08-01生效',
  '2026年8月1日至2029年7月31日',
  '每月工资壹万元',
  '月薪12000-15000元',
  '工资12,000元',
  '薪资1.2万元',
  '工资12000元至15000元',
  '合同期限3-5年',
  '试用期3个月至6个月',
  '期限三年至五年',
  '工作地点为北京市 海淀区',
  '2026-08-01 - 2029-07-31',
  '2026/08/01生效',
] as const) {
  test(`preserves expanded legal fact independently: ${fact}`, () => {
    const output = maskContractPages([{
      pageNumber: 1,
      text: `地址：北京市朝阳区建国路88号 ${fact}。`,
    }])
    assert.equal(output.pages[0]!.text.includes(fact), true)
  })
}

test('ordinary legal prose mentioning PII nouns is not treated as a labeled value', () => {
  const input = [
    { pageNumber: 1, text: '甲方不得扣押乙方身份证件。' },
    { pageNumber: 2, text: '劳动者应妥善保管身份证 和银行卡。' },
    { pageNumber: 3, text: '工资通过银行账户 发放。' },
    { pageNumber: 4, text: '电子邮箱 可用于发送工资单。' },
    { pageNumber: 5, text: '联系电话 由劳动者自愿填写。' },
  ] as const
  const output = maskContractPages(input)
  assert.deepEqual(output.pages, input)
})

test('does not infer an employer from bare company-like natural language', () => {
  const input = [
    { pageNumber: 1, text: '劳动者毕业于北京大学' },
    { pageNumber: 2, text: '月薪一万元由北京大学支付' },
  ] as const
  const output = maskContractPages(input)
  assert.equal(output.pages[0]!.text, input[0].text)
  assert.equal(output.pages[1]!.text, input[1].text)
})

test('bank labels win overlap classification and all page/input structure is immutable', () => {
  const input = [
    { pageNumber: 1, text: '银行卡：622202012345678901' },
    { pageNumber: 2, text: '账号：6214-8302-1234-5678' },
    { pageNumber: 3, text: '银行账户：62148302123456789' },
    { pageNumber: 4, text: '银行账号：6214830212345678901' },
  ] as const
  const snapshot = structuredClone(input)
  const output = maskContractPages(input)
  assert.match(output.pages[0]!.text, /\[银行卡_1\]/u)
  assert.doesNotMatch(output.pages[0]!.text, /\[身份证_/u)
  assert.match(output.pages[1]!.text, /\[银行卡_2\]/u)
  assert.match(output.pages[2]!.text, /\[银行卡_3\]/u)
  assert.match(output.pages[3]!.text, /\[银行卡_4\]/u)
  assert.equal(output.pages.length, 4)
  assert.deepEqual(output.pages.map((page) => page.pageNumber), [1, 2, 3, 4])
  assert.deepEqual(input, snapshot)
  assert.equal(output.partyFacts.hasBankAccount, true)
  assert.equal(Object.isFrozen(output.partyFacts), true)
})

test('fails closed for malformed, non-canonical, or over-limit pages', () => {
  for (const pages of [
    [],
    [{ pageNumber: 2, text: '正文' }],
    [{ pageNumber: 1, text: '正文' }, { pageNumber: 3, text: '续页' }],
    [{ pageNumber: 1.5, text: '正文' }],
    [{ pageNumber: 1, text: 'Cafe\u0301' }],
    [{ pageNumber: 1, text: '一\r\n二' }],
    [{ pageNumber: 1, text: 123 }],
  ]) {
    assert.throws(() => maskContractPages(pages as never), /CONTRACT_PII_MASK_INVALID/)
  }
  assert.throws(
    () => maskContractPages(Array.from({ length: 51 }, (_, index) => ({ pageNumber: index + 1, text: '' }))),
    /CONTRACT_PII_MASK_INPUT_LIMIT/,
  )
  assert.throws(
    () => maskContractPages([{ pageNumber: 1, text: 'x'.repeat(2_000_001) }]),
    /CONTRACT_PII_MASK_INPUT_LIMIT/,
  )
  assert.throws(
    () => maskContractPages([{ pageNumber: 1, text: 'x'.repeat(500_001) }]),
    /CONTRACT_PII_MASK_OUTPUT_LIMIT/,
  )
  assert.doesNotThrow(() => maskContractPages([{ pageNumber: 1, text: 'x'.repeat(500_000) }]))
})

test('fails closed when a high-confidence value survives an overlapping or malformed pattern', () => {
  assert.throws(
    () => maskContractPages([{ pageNumber: 1, text: '身份证：3701011990010112345' }]),
    /CONTRACT_PII_MASK_INCOMPLETE/,
  )
  assert.throws(
    () => maskContractPages([{ pageNumber: 1, text: '银行卡 abc-def' }]),
    /CONTRACT_PII_MASK_INCOMPLETE/,
  )
})

// ============================================================
// 2026-08-17 生产故障回归：检测器比遮盖器宽 ⇒ analyze 阶段 100% 失败
//
// 失败任务耗时 152–483ms，而该机器一次真实模型调用要 31–82s —— 根本没到模型。
// 卡点是 assertNoHighConfidencePii：`联系电话` / `传真` / `账号` / `证件`
// 这些标签检测侧全都认识，但座机、400 热线、传真、<16 位账号遮盖侧都不认，
// 「数量词」还被当成残留值 ⇒ 抛 CONTRACT_PII_MASK_INCOMPLETE。
//
// 下面三条**两个方向都验**：既要求不再误杀，也要求真实 PII 仍然遮得掉。
// 只验「不再报错」会退化成把检测器关掉。
// ============================================================

test('masks landline, hotline, fax and short account numbers behind their labels', () => {
  for (const [input, expected] of [
    ['联系电话：021-62345678', '联系电话：[手机号_1]'],
    ['联系电话：02162345678', '联系电话：[手机号_1]'],
    ['联系电话：400-800-8888', '联系电话：[手机号_1]'],
    ['联系电话：4008008888', '联系电话：[手机号_1]'],
    ['电话：010-1234567转8080', '电话：[手机号_1]'],
    ['传真：021-62345679', '传真：[手机号_1]'],
    ['传真号码：021-62345679', '传真号码：[手机号_1]'],
    ['账号：622202123456', '账号：[银行卡_1]'],
    ['账号 622202123456', '账号 [银行卡_1]'],
    ['银行账户：12345678', '银行账户：[银行卡_1]'],
  ] as const) {
    assert.equal(maskContractPages([{ pageNumber: 1, text: input }]).pages[0]!.text, expected)
  }
})

test('quantities after a PII label are not treated as residual PII', () => {
  for (const input of [
    '入职需提交证件2份',
    '身份证复印件1份',
    '需提交证件 2 份',
    '证件3张、银行卡1张',
  ]) {
    const output = maskContractPages([{ pageNumber: 1, text: input }])
    assert.equal(output.pages[0]!.text, input)
  }
})

test('a full contract with landline, fax and quantities masks every real PII value', () => {
  const text = [
    '劳动合同书',
    '甲方：上海示例科技有限公司',
    '统一社会信用代码：91310000MA1FL1234X',
    '联系电话：021-62345678',
    '传真：021-62345679',
    '乙方：张三',
    '身份证：110101199003072316',
    '手机号：13812345678',
    '邮箱：zhangsan@example.com',
    '账号：622202123456',
    '入职需提交证件2份，身份证复印件1份。',
    '月薪为8000元，合同期限为3年。',
  ].join('\n')

  // 方向一：不再误杀。
  const masked = maskContractPages([{ pageNumber: 1, text }]).pages[0]!.text

  // 方向二：真实 PII 一个都不许留下。
  for (const secret of [
    '021-62345678', '021-62345679', '110101199003072316', '13812345678',
    'zhangsan@example.com', '622202123456', '91310000MA1FL1234X',
    '张三', '上海示例科技有限公司',
  ]) {
    assert.equal(masked.includes(secret), false, `未遮盖：${secret}`)
  }

  // 法律事实与数量词必须原样保留，否则模型读到的是残缺合同。
  for (const kept of ['月薪为8000元', '合同期限为3年', '证件2份', '身份证复印件1份']) {
    assert.equal(masked.includes(kept), true, `被误删：${kept}`)
  }
})

test('fax and contact-number labels are mask-only and never widen the fail-closed surface', () => {
  // `传真` / `联系号码` 本来就不在 LOOSE_VALUE_LABEL 里 —— 它们不是本次故障的
  // 触发源，只是**泄漏**（传真号原样送进模型）。因此只补遮盖、不补检测：
  // 补检测会让 `传真：N/A` 这类内容开始抛 CONTRACT_PII_MASK_INCOMPLETE，
  // 等于用一个新的线上失败去换一个并不存在的失败。
  for (const input of ['传真：N/A', '传真：待补充', '联系号码：N/A', '传真号码：暂无']) {
    assert.equal(maskContractPages([{ pageNumber: 1, text: input }]).pages[0]!.text, input)
  }
  // 但真实传真号必须被遮掉（修复前是原样泄漏给模型的）。
  assert.equal(
    maskContractPages([{ pageNumber: 1, text: '传真：021-62345679' }]).pages[0]!.text,
    '传真：[手机号_1]',
  )
})

test('every detected label has a masker: detection labels are a subset of masking labels', () => {
  // 故障的性质是「检测比遮盖宽」。这条守卫把不变量钉死：
  // 表里每个标签，后面跟着该类别的真实 PII 时，遮盖必须成功（不抛）
  // 且产出**检测侧期待的那一类**占位符。两侧再漂移这条就红。
  for (const [label, sample, category] of [
    ['身份证号', '110101199003072316', '身份证'],
    ['证件号码', '110101199003072316', '身份证'],
    ['手机号', '13812345678', '手机号'],
    ['联系电话', '021-62345678', '手机号'],
    ['联系号码', '13812345678', '手机号'],
    ['传真号码', '021-62345679', '手机号'],
    ['传真号', '021-62345679', '手机号'],
    ['传真', '021-62345679', '手机号'],
    ['银行卡号', '6222021234567890123', '银行卡'],
    ['银行账号', '6222021234567890123', '银行卡'],
    ['账户号', '622202123456', '银行卡'],
    ['电子邮箱', 'a@example.com', '邮箱'],
    ['邮箱地址', 'a@example.com', '邮箱'],
    ['统一社会信用代码', '91310000MA1FL1234X', '统一社会信用代码'],
    ['银行卡', '6222021234567890123', '银行卡'],
    ['银行账户', '6222021234567890123', '银行卡'],
    ['账号', '622202123456', '银行卡'],
    ['账户', '622202123456', '银行卡'],
    ['身份证', '110101199003072316', '身份证'],
    ['证件', '110101199003072316', '身份证'],
    ['手机', '13812345678', '手机号'],
    ['电话', '021-62345678', '手机号'],
    ['邮箱', 'a@example.com', '邮箱'],
  ] as const) {
    const text = `${label}：${sample}`
    const output = maskContractPages([{ pageNumber: 1, text }])
    assert.equal(output.pages[0]!.text, `${label}：[${category}_1]`, `标签 ${label} 未同源`)
  }
})
