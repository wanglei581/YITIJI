import assert from 'node:assert/strict'
import test from 'node:test'
import { userMessageOf } from './userErrorMessage.ts'

function httpError(code: string, message: string, status = 400): Error {
  const error = new Error(message)
  error.name = 'ApiHttpError'
  return Object.assign(error, { code, status })
}

test('页面自己的 TypeError 用兜底句，不断言成网络故障', () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'items')")
  assert.equal(userMessageOf(error, '加载会员权益失败，请稍后重试'), '加载会员权益失败，请稍后重试')
})

test('Failed to fetch 的 TypeError 才是网络连接失败', () => {
  assert.equal(
    userMessageOf(new TypeError('Failed to fetch'), '加载失败，请稍后重试'),
    '网络连接失败，请检查网络后重试',
  )
  assert.equal(
    userMessageOf(new TypeError('Load failed'), '加载失败，请稍后重试'),
    '网络连接失败，请检查网络后重试',
  )
})

test('没有中文的普通 Error 用兜底句，手写中文 Error 原样', () => {
  assert.equal(userMessageOf(new Error('socket hang up'), '保存失败，请检查后重试'), '保存失败，请检查后重试')
  assert.equal(userMessageOf(new Error('请先选择终端'), '保存失败，请检查后重试'), '请先选择终端')
})

test('后端中文 message 原样，已登记码走码表', () => {
  assert.equal(
    userMessageOf(httpError('SOME_NEW_CODE', '该终端正在维护，请稍后再改'), '保存失败，请稍后重试'),
    '该终端正在维护，请稍后再改',
  )
  assert.equal(
    userMessageOf(httpError('ORDER_NOT_FOUND', 'missing'), '加载订单失败，请稍后重试'),
    '订单不存在',
  )
  assert.equal(
    userMessageOf(httpError('HTTP_400', 'Bad Request', 400), '保存失败，请检查后重试'),
    '保存失败，请检查后重试',
  )
})

test('后端返回的英文原文（如框架默认的 Forbidden resource）不透出，用兜底或状态码对应的中文', () => {
  const forbidden = Object.assign(new Error('Forbidden resource'), { name: 'ApiHttpError', code: 'HTTP_403', status: 403 })
  assert.equal(userMessageOf(forbidden, '没有权限执行这项操作'), '没有权限执行这项操作')
  const server = Object.assign(new Error('Internal server error'), { name: 'ApiHttpError', code: 'HTTP_500', status: 500 })
  assert.equal(userMessageOf(server, '兜底'), '服务暂时不可用，请稍后重试')
})
