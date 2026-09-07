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
  documentsPage: join(kioskRoot, 'src/pages/profile/me/MyDocumentsPage.tsx'),
  documentsConvert: join(kioskRoot, 'src/pages/profile/me/components/DocumentConvertAction.tsx'),
  miniappDocuments: join(repoRoot, 'apps/miniapp/pages/documents/documents.js'),
  miniappDocumentsWxml: join(repoRoot, 'apps/miniapp/pages/documents/documents.wxml'),
  miniappDocumentsHelpers: join(repoRoot, 'apps/miniapp/pages/documents/documents-helpers.js'),
  miniappApi: join(repoRoot, 'apps/miniapp/utils/api.js'),
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
  check(
    files.documentsPage.includes('<DocumentConvertAction'),
    'documents-entry: 我的文档必须接线 DocumentConvertAction，不得把转 PDF 堆进主文件',
  )
  check(
    files.documentsConvert.includes('WORD_CONVERSION_UNAVAILABLE_COPY'),
    'documents-reason: 我的文档转 PDF 关闭态必须显示 Word 转换未开放原因',
  )
  check(
    files.documentsConvert.includes('WORD_CONVERSION_DISCLOSURE'),
    'documents-disclosure: 我的文档转 PDF 开放态必须显示复杂版式偏差提示',
  )
  check(
    /if \(!available \|\| converting \|\| busy\) return/.test(files.documentsConvert),
    'documents-convert-guard: convert 调用前必须校验 wordToPdf 与忙碌态',
  )
  const docsConvertCall = files.documentsConvert.indexOf('await convertDocumentToPdf(fileId, token)')
  const docsGuard = files.documentsConvert.indexOf('if (!available || converting || busy) return')
  check(docsGuard >= 0 && docsConvertCall > docsGuard, 'documents-convert-order: convert 只能位于能力真值守卫之后')
  check(
    files.documentsConvert.includes('useRemainingSeconds') && files.documentsConvert.includes('formatRemainingSeconds'),
    'documents-expiry: 转换结果必须展示有效期倒计时',
  )
  check(
    files.documentsPage.includes('DOCUMENT_NOT_REPRINTABLE_COPY') && files.documentsPage.includes('aria-disabled={reprintBlocked || undefined}'),
    'documents-reprintable: reprintable=false 必须 aria-disabled 并写明仅可查看不可打印',
  )
  check(
    files.documentsConvert.includes('onPreview(result.fileId)')
      && files.documentsConvert.includes('onPrint(result.fileId)')
      && files.documentsConvert.includes('打印这份 PDF')
      && files.documentsPage.includes('onPreview=')
      && files.documentsPage.includes('onPrint=')
      && files.documentsPage.includes('documentForConvertedPdf'),
    'documents-convert-result-actions: 转换结果卡必须把既有预览/打印处理器接到派生 PDF',
  )
  check(
    files.documentsConvert.includes('链接已过期，请在列表里重新打开'),
    'documents-convert-expired: 结果卡链接过期必须提示回列表重新打开',
  )
  check(
    files.documentsPage.includes('reprintable={isDocumentReprintable(doc)}'),
    'documents-convert-reprintable: 结果卡打印键必须按转换前记录的 reprintable 判定',
  )
  check(
    files.miniappApi.includes("request(`/files/${encodeURIComponent(fileId)}/convert`") && files.miniappApi.includes('needAuth: true'),
    'miniapp-convert-api: 小程序必须新增 needAuth 的 convertDocumentToPdf',
  )
  check(
    `${files.miniappDocuments}\n${files.miniappDocumentsWxml}\n${files.miniappDocumentsHelpers}`.includes('WORD_CONVERSION_UNAVAILABLE_COPY'),
    'miniapp-documents-reason: 小程序我的文档关闭态必须显示 Word 转换未开放原因',
  )
  check(
    `${files.miniappDocuments}\n${files.miniappDocumentsWxml}\n${files.miniappDocumentsHelpers}`.includes('WORD_CONVERSION_DISCLOSURE'),
    'miniapp-documents-disclosure: 小程序我的文档开放态必须显示复杂版式偏差提示',
  )
  check(
    `${files.miniappDocuments}\n${files.miniappDocumentsWxml}\n${files.miniappDocumentsHelpers}`.includes('该报告仅可查看，不可打印'),
    'miniapp-documents-reprintable: 小程序 reprintable=false 必须写明仅可查看不可打印',
  )
  check(
    files.miniappDocumentsWxml.includes('打开 PDF')
      && files.miniappDocuments.includes('this.previewDoc(result.fileId)')
      && files.miniappDocuments.includes("this.reprintDoc({ currentTarget: { dataset: { id: result.fileId } } })"),
    'miniapp-convert-result-actions: 小程序结果卡必须复用 previewDoc 与 reprintDoc',
  )
  check(
    files.miniappDocumentsWxml.includes('链接已过期，请在列表里重新打开'),
    'miniapp-convert-expired: 小程序结果卡链接过期必须提示回列表重新打开',
  )
  check(
    files.miniappDocumentsHelpers.includes('reprintable: isDocumentReprintable(sourceFile)'),
    'miniapp-convert-reprintable: 小程序结果卡打印必须按转换前记录的 reprintable 判定',
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
  {
    name: 'documents-convert-guard',
    path: paths.documentsConvert,
    from: 'if (!available || converting || busy) return',
    to: 'if (converting || busy) return',
    expected: 'documents-convert-guard:',
  },
  {
    name: 'documents-reprintable',
    path: paths.documentsPage,
    from: 'aria-disabled={reprintBlocked || undefined}',
    to: 'aria-disabled={undefined}',
    expected: 'documents-reprintable:',
  },
  {
    name: 'documents-convert-result-actions',
    path: paths.documentsConvert,
    from: 'onClick={() => { if (previewBlocked) return; onPreview(result.fileId) }}',
    to: 'onClick={() => { if (previewBlocked) return }}',
    expected: 'documents-convert-result-actions:',
  },
  {
    name: 'miniapp-convert-result-actions',
    path: paths.miniappDocuments,
    from: 'this.previewDoc(result.fileId)',
    to: 'this.previewDoc(item.id)',
    expected: 'miniapp-convert-result-actions:',
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
