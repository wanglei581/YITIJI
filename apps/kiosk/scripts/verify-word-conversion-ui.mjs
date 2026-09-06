import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const kioskRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = join(kioskRoot, '../..')
const paths = {
  service: join(kioskRoot, 'src/services/api/documentConversion.ts'),
  resume: join(kioskRoot, 'src/pages/resume/ResumeSourcePage.tsx'),
  phone: join(kioskRoot, 'src/pages/upload/PhoneUploadPage.tsx'),
  printUpload: join(kioskRoot, 'src/pages/print/PrintUploadPage.tsx'),
  preview: join(kioskRoot, 'src/components/FileContentPreview.tsx'),
  printPreview: join(kioskRoot, 'src/pages/print/PrintPreviewPage.tsx'),
  miniapp: join(repoRoot, 'apps/miniapp/pages/resume-upload/resume-upload.js'),
  miniappWxml: join(repoRoot, 'apps/miniapp/pages/resume-upload/resume-upload.wxml'),
}

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readFileSync(path, 'utf8')]))
}

function collectFailures(files) {
  const failures = []
  const check = (ok, message) => { if (!ok) failures.push(message) }

  check(
    /const accept = wordConversionAvailable \? `\$\{BASE_ACCEPT\},\$\{WORD_ACCEPT\}` : BASE_ACCEPT/.test(files.resume),
    'resume-accept: 简历选择器必须仅在 wordConversionAvailable=true 时追加 Word accept',
  )
  const guardedPhoneResumeAccepts = files.phone.match(
    /accept: wordConversionAvailable \? `\$\{BASE_RESUME_ACCEPT\},\$\{WORD_ACCEPT\}` : BASE_RESUME_ACCEPT/g,
  ) ?? []
  check(guardedPhoneResumeAccepts.length === 2, 'phone-resume-accept: 手机中转简历/合同选择器必须各自仅在能力为真时追加 Word accept')
  check(
    /accept: wordConversionAvailable \? `\$\{BASE_PRINT_DOC_ACCEPT\},\$\{WORD_ACCEPT\}` : BASE_PRINT_DOC_ACCEPT/.test(files.phone),
    'phone-print-accept: 手机中转打印选择器必须仅在能力为真时追加 Word accept',
  )
  check(
    /const printAccept = wordConversionAvailable \? `\$\{PRINT_BASE_ACCEPT\},\$\{PRINT_WORD_ACCEPT\}` : PRINT_BASE_ACCEPT/.test(files.printUpload),
    'print-accept: 打印上传必须仅在能力为真时追加 Word accept',
  )

  for (const [key, content] of Object.entries({
    resume: files.resume,
    phone: files.phone,
    printUpload: files.printUpload,
    preview: files.preview,
    printPreview: files.printPreview,
    miniapp: `${files.miniapp}\n${files.miniappWxml}`,
  })) {
    check(content.includes('WORD_CONVERSION_UNAVAILABLE_COPY'), `${key}-reason: 能力关闭态必须显示 Word 转换未开放原因`)
  }
  check(
    files.printUpload.includes('`${WORD_CONVERSION_UNAVAILABLE_COPY}；支持 PDF、JPG、PNG'),
    'print-upload-closed-copy: 本机打印上传关闭态必须明确改传 PDF/图片',
  )
  for (const [key, content] of Object.entries({
    resume: files.resume,
    phone: files.phone,
    printUpload: files.printUpload,
    preview: files.preview,
    printPreview: files.printPreview,
    miniapp: `${files.miniapp}\n${files.miniappWxml}`,
  })) {
    check(content.includes('WORD_CONVERSION_DISCLOSURE'), `${key}-disclosure: 开放态必须显示复杂版式偏差提示`)
  }
  check(
    files.printUpload.includes('`支持 PDF、DOC、DOCX、JPG、PNG，单份不超过 ${PRINT_UPLOAD_MAX_MB}MB；${WORD_CONVERSION_DISCLOSURE}`'),
    'print-upload-open-copy: 本机打印上传开放态必须显示固定版式偏差提示',
  )

  check(
    /if \(sourceKind !== 'word' \|\| !capabilities\.wordToPdf \|\| !fileId\) return/.test(files.preview),
    'convert-guard: convert 调用前必须同时校验 Word 类型、wordToPdf=true 与 fileId',
  )
  const convertCall = files.preview.indexOf('void convertDocumentToPdf(fileId, token)')
  const guard = files.preview.indexOf("if (sourceKind !== 'word' || !capabilities.wordToPdf || !fileId) return")
  check(guard >= 0 && convertCall > guard, 'convert-order: convert 只能位于能力真值守卫之后')
  check(
    /if \(!res\.ok\)[\s\S]*notifySessionIfInvalid/.test(files.service),
    'api-errors: convert API 必须保留后端错误码并处理会话失效',
  )
  check(
    /cachedCapabilities[\s\S]*CAPABILITIES_TTL_MS/.test(files.service),
    'capability-cache: capabilities 必须有缓存，避免每个入口重复探测',
  )
  check(
    files.miniapp.includes(
      'const resumeExt = this.data.wordConversionAvailable\n      ? BASE_RESUME_EXT.concat(WORD_RESUME_EXT)\n      : BASE_RESUME_EXT\n    wx.chooseMessageFile',
    ),
    'miniapp-accept: 小程序能力关闭时 extension 必须只保留基础格式',
  )
  for (const [key, content] of Object.entries({
    resume: files.resume,
    phone: files.phone,
    printUpload: files.printUpload,
    miniapp: files.miniappWxml,
  })) {
    check(content.includes('aria-disabled'), `${key}-aria: Word 子能力关闭态必须带 aria-disabled`)
  }

  return failures
}

function runNormal() {
  const failures = collectFailures(sources())
  if (failures.length) {
    console.error('Word conversion UI gate failed:')
    for (const failure of failures) console.error(`  FAIL ${failure}`)
    process.exit(1)
  }
  console.log('Word conversion UI gate passed:')
  console.log('  PASS 三处 accept 仅在 capabilities.wordToPdf=true 时追加 DOC/DOCX')
  console.log('  PASS 关闭态原因与开放态版式偏差提示均存在')
  console.log('  PASS convert 仅在 Word + capability true + fileId 条件下调用')
  console.log('  PASS 小程序 extension 同样 fail-closed')
}

const mutations = [
  {
    name: 'resume-accept',
    path: paths.resume,
    from: 'const accept = wordConversionAvailable ? `${BASE_ACCEPT},${WORD_ACCEPT}` : BASE_ACCEPT',
    to: 'const accept = `${BASE_ACCEPT},${WORD_ACCEPT}`',
    expected: 'resume-accept:',
  },
  {
    name: 'phone-resume-accept',
    path: paths.phone,
    from: 'accept: wordConversionAvailable ? `${BASE_RESUME_ACCEPT},${WORD_ACCEPT}` : BASE_RESUME_ACCEPT',
    to: 'accept: `${BASE_RESUME_ACCEPT},${WORD_ACCEPT}`',
    expected: 'phone-resume-accept:',
  },
  {
    name: 'phone-print-accept',
    path: paths.phone,
    from: 'accept: wordConversionAvailable ? `${BASE_PRINT_DOC_ACCEPT},${WORD_ACCEPT}` : BASE_PRINT_DOC_ACCEPT',
    to: 'accept: `${BASE_PRINT_DOC_ACCEPT},${WORD_ACCEPT}`',
    expected: 'phone-print-accept:',
  },
  {
    name: 'print-accept',
    path: paths.printUpload,
    from: 'const printAccept = wordConversionAvailable ? `${PRINT_BASE_ACCEPT},${PRINT_WORD_ACCEPT}` : PRINT_BASE_ACCEPT',
    to: 'const printAccept = `${PRINT_BASE_ACCEPT},${PRINT_WORD_ACCEPT}`',
    expected: 'print-accept:',
  },
  {
    name: 'closed-reason',
    path: paths.printUpload,
    from: '${WORD_CONVERSION_UNAVAILABLE_COPY}；支持 PDF、JPG、PNG',
    to: 'Word 状态未知；支持 PDF、JPG、PNG',
    expected: 'print-upload-closed-copy:',
  },
  {
    name: 'open-disclosure',
    path: paths.printUpload,
    from: '`支持 PDF、DOC、DOCX、JPG、PNG，单份不超过 ${PRINT_UPLOAD_MAX_MB}MB；${WORD_CONVERSION_DISCLOSURE}`',
    to: '`支持 PDF、DOC、DOCX、JPG、PNG，单份不超过 ${PRINT_UPLOAD_MAX_MB}MB；转换后请检查`',
    expected: 'print-upload-open-copy:',
  },
  {
    name: 'convert-guard',
    path: paths.preview,
    from: "if (sourceKind !== 'word' || !capabilities.wordToPdf || !fileId) return",
    to: "if (sourceKind !== 'word' || !fileId) return",
    expected: 'convert-guard:',
  },
  {
    name: 'miniapp-accept',
    path: paths.miniapp,
    from: '? BASE_RESUME_EXT.concat(WORD_RESUME_EXT)\n      : BASE_RESUME_EXT',
    to: '? BASE_RESUME_EXT.concat(WORD_RESUME_EXT)\n      : BASE_RESUME_EXT.concat(WORD_RESUME_EXT)',
    expected: 'miniapp-accept:',
  },
]

function runMutationTest() {
  for (const mutation of mutations) {
    const original = readFileSync(mutation.path, 'utf8')
    if (!original.includes(mutation.from)) {
      console.error(`Mutation setup failed (${mutation.name}): source snippet not found`)
      process.exit(1)
    }
    try {
      writeFileSync(mutation.path, original.replace(mutation.from, mutation.to))
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
      const output = `${result.stdout}\n${result.stderr}`
      if (result.status === 0 || !output.includes(mutation.expected)) {
        console.error(`Mutation was not caught (${mutation.name})`)
        console.error(output.trim())
        process.exitCode = 1
        return
      }
      console.log(`  PASS mutation caught: ${mutation.name}`)
    } finally {
      writeFileSync(mutation.path, original)
    }
  }
  console.log(`Mutation test passed: ${mutations.length} assertions failed on demand and sources were restored`)
}

if (process.argv.includes('--mutation-test')) runMutationTest()
else runNormal()
