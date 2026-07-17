/**
 * Multer 嵌套 multipart 字段防护验证。
 *
 * 覆盖：
 * 1. 全部 FileInterceptor 上传入口都声明 fieldNestingDepth: 0；
 * 2. 使用独立的 HTTP loopback 验证扁平字段可通过、嵌套字段被 Multer 拒绝。
 *
 * 不依赖正在运行的 API，也不触发任何外部服务。
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import ts from 'typescript'

const API_ROOT = path.resolve(__dirname, '..')
const SOURCE_ROOT = path.join(API_ROOT, 'src')

const EXPECTED_FILE_INTERCEPTORS = [
  { file: 'src/ai/ai.controller.ts', count: 1 },
  { file: 'src/content/content.controller.ts', count: 1 },
  { file: 'src/mock-interview/mock-interview.controller.ts', count: 1 },
  { file: 'src/scan-tasks/scan-tasks.controller.ts', count: 1 },
  { file: 'src/files/files.controller.ts', count: 2 },
  { file: 'src/upload-sessions/upload-sessions.controller.ts', count: 1 },
  { file: 'src/jobs/admin-fairs.controller.ts', count: 1 },
  { file: 'src/jobs/jobs.controller.ts', count: 2 },
] as const

type FileInterceptorCall = {
  file: string
  source: ts.SourceFile
  call: ts.CallExpression
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return null
}

function directPropertyAssignments(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment[] {
  return object.properties.filter(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === name,
  )
}

function objectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | null {
  const unwrapped = unwrapExpression(expression)
  return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : null
}

function isZero(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression)
  return ts.isNumericLiteral(unwrapped) && Number(unwrapped.text) === 0
}

function hasFieldNestingDepthLimit(call: ts.CallExpression): boolean {
  const options = call.arguments[1]
  const optionsObject = options && objectLiteral(options)
  if (!optionsObject) return false

  const limits = directPropertyAssignments(optionsObject, 'limits')
  if (limits.length !== 1) return false
  const limitsObject = objectLiteral(limits[0]!.initializer)
  if (!limitsObject) return false

  const fieldNestingDepth = directPropertyAssignments(limitsObject, 'fieldNestingDepth')
  return fieldNestingDepth.length === 1 && isZero(fieldNestingDepth[0]!.initializer)
}

function callLocation({ file, source, call }: FileInterceptorCall): string {
  const position = source.getLineAndCharacterOfPosition(call.getStart(source))
  return `${file}:${position.line + 1}:${position.character + 1}`
}

async function findFileInterceptorCalls(): Promise<FileInterceptorCall[]> {
  const sourceFiles = ts.sys.readDirectory(SOURCE_ROOT, ['.ts']).sort()
  const calls: FileInterceptorCall[] = []

  for (const filePath of sourceFiles) {
    const source = ts.createSourceFile(
      filePath,
      await readFile(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const file = path.relative(API_ROOT, filePath).split(path.sep).join('/')
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'FileInterceptor'
      ) {
        calls.push({ file, source, call: node })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  return calls
}

async function verifyStaticGuards(): Promise<void> {
  const failures: string[] = []
  const calls = await findFileInterceptorCalls()
  const expectedCounts = new Map<string, number>(
    EXPECTED_FILE_INTERCEPTORS.map(({ file, count }): [string, number] => [file, count]),
  )
  const actualCounts = new Map<string, number>()

  for (const call of calls) {
    actualCounts.set(call.file, (actualCounts.get(call.file) ?? 0) + 1)
    if (!hasFieldNestingDepthLimit(call.call)) {
      failures.push(`${callLocation(call)}: FileInterceptor 必须直接声明 limits.fieldNestingDepth: 0`)
    }
  }

  for (const expected of EXPECTED_FILE_INTERCEPTORS) {
    const actualCount = actualCounts.get(expected.file) ?? 0
    if (actualCount !== expected.count) {
      failures.push(`${expected.file}: 预期 ${expected.count} 处 FileInterceptor，实际 ${actualCount} 处`)
    }
  }

  for (const [file, count] of actualCounts) {
    if (!expectedCounts.has(file)) {
      failures.push(`${file}: 存在 ${count} 处未列入契约的 FileInterceptor`)
    }
  }

  if (calls.length !== 10) {
    failures.push(`全局 FileInterceptor: 预期 10 处，实际 ${calls.length} 处`)
  }

  assert.deepEqual(failures, [], `静态 multipart 防护契约失败:\n${failures.join('\n')}`)
  console.log('  PASS 静态核验：10 处 FileInterceptor 均设置 limits.fieldNestingDepth: 0')
}

function multipartBody(fieldName: string): { body: Buffer; contentType: string } {
  const boundary = `multipart-verify-${Date.now().toString(36)}`
  const body = Buffer.from([
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="${fieldName}"\r\n\r\n`,
    'value\r\n',
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="file"; filename="sample.txt"\r\n',
    'Content-Type: text/plain\r\n\r\n',
    'sample\r\n',
    `--${boundary}--\r\n`,
  ].join(''), 'utf8')
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

type MultipartResponse = {
  status: number
  multerErrorCode: string | null
}

async function sendMultipart(url: string, fieldName: string): Promise<MultipartResponse> {
  const { body, contentType } = multipartBody(fieldName)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
    },
    body: new Uint8Array(body),
  })
  return {
    status: response.status,
    multerErrorCode: response.headers.get('x-multer-test-error-code'),
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function verifyRuntimeGuard(): Promise<void> {
  const app = express()
  const upload = multer({ limits: { fieldNestingDepth: 0 } as { fieldNestingDepth: number; fileSize?: number } }).single('file')

  app.post('/upload', (req, res, next) => {
    upload(req, res, (error: unknown) => {
      if (error) return next(error)
      res.status(204).end()
    })
  })
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
      res.setHeader('X-Multer-Test-Error-Code', error.code)
    }
    res.status(400).end()
  })

  const server = createServer(app)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    assert.ok(address && typeof address !== 'string', 'loopback server 未返回端口')
    const url = `http://127.0.0.1:${address.port}/upload`

    const flat = await sendMultipart(url, 'meta')
    assert.equal(flat.status, 204, '扁平 multipart 字段必须通过')
    console.log('  PASS HTTP loopback：扁平 multipart 字段 -> 204')

    const nested = await sendMultipart(url, 'meta[nested]')
    assert.equal(nested.status, 400, '嵌套 multipart 字段必须被拒绝')
    assert.equal(nested.multerErrorCode, 'LIMIT_FIELD_NESTING', '嵌套字段必须由限深守卫拒绝')
    console.log('  PASS HTTP loopback：meta[nested] -> 400 (LIMIT_FIELD_NESTING)')
  } finally {
    await closeServer(server)
  }
}

async function main(): Promise<void> {
  console.log('=== Multer multipart 字段嵌套防护验证 ===')
  await verifyStaticGuards()
  await verifyRuntimeGuard()
  console.log('PASS: multipart 字段嵌套防护已验证')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
