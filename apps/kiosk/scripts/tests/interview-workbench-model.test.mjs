import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(join(root, 'src/pages/interview/interviewWorkbenchModel.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'interviewWorkbenchModel.ts',
})
const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
const model = await import(dataUrl)

test('parseInterviewStage only accepts the five workbench stages', () => {
  assert.equal(model.parseInterviewStage('setup'), 'setup')
  assert.equal(model.parseInterviewStage('session'), 'session')
  assert.equal(model.parseInterviewStage('report'), 'report')
  assert.equal(model.parseInterviewStage('tips'), 'tips')
  assert.equal(model.parseInterviewStage('reports'), 'reports')
  assert.equal(model.parseInterviewStage('preview'), null)
  assert.equal(model.parseInterviewStage(null), null)
})

test('URL is intent: requested stage wins even without authorization', () => {
  assert.equal(model.resolveInterviewView({ requested: 'session', storedStage: 'setup' }), 'session')
  assert.equal(model.resolveInterviewView({ requested: 'report', storedStage: null }), 'report')
})

test('missing stage rehydrates from stored stage, else setup', () => {
  assert.equal(model.resolveInterviewView({ requested: null, storedStage: 'tips' }), 'tips')
  assert.equal(model.resolveInterviewView({ requested: null, storedStage: null }), 'setup')
})

test('session and report still need a real handle to be authorized', () => {
  assert.equal(model.isInterviewStageAuthorized('setup', false, false), true)
  assert.equal(model.isInterviewStageAuthorized('tips', false, false), true)
  assert.equal(model.isInterviewStageAuthorized('reports', false, false), true)
  assert.equal(model.isInterviewStageAuthorized('session', false, false), false)
  assert.equal(model.isInterviewStageAuthorized('session', true, false), true)
  assert.equal(model.isInterviewStageAuthorized('report', false, false), false)
  assert.equal(model.isInterviewStageAuthorized('report', false, true), true)
})
