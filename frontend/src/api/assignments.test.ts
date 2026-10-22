import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAssignment,
  deleteAssignment,
  fetchAssignments,
  updateAssignment,
} from './assignments'
import { API_KEY_HEADER } from './client'
import type { Assignment, AssignmentInput } from './types'

const BASE_URL = 'http://api.test.local:8000'

const SAMPLE_ASSIGNMENT: Assignment = {
  id: 101,
  course_id: 1,
  name: '正規化レポート',
  status: '未着手',
  deadline: '2026-11-01T23:59:00',
  submission_method: 'WebClass',
  memo: null,
  is_deleted: false,
}

const SAMPLE_INPUT: AssignmentInput = {
  name: 'ER図の作成',
  status: '取組中',
  deadline: '2026-11-10T09:30',
  submission_method: null,
  memo: null,
}

function stubFetch(impl: typeof fetch) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function lastCall() {
  const call = vi.mocked(fetch).mock.calls.at(-1)!
  return { url: call[0] as string, init: call[1] }
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('課題のAPI呼び出し', () => {
  it('一覧は GET /courses/{id}/assignments を叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_ASSIGNMENT])))

    await expect(fetchAssignments('my-key', 1)).resolves.toEqual([SAMPLE_ASSIGNMENT])

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/courses/1/assignments`)
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('作成は POST /courses/{id}/assignments にJSONを送る', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(201, { ...SAMPLE_ASSIGNMENT, ...SAMPLE_INPUT })))

    await createAssignment('my-key', 1, SAMPLE_INPUT)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/courses/1/assignments`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(SAMPLE_INPUT)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers[API_KEY_HEADER]).toBe('my-key')
  })

  it('更新は PATCH /assignments/{id} にJSONを送り、warningを含むレスポンスを返す', async () => {
    const response = { ...SAMPLE_ASSIGNMENT, ...SAMPLE_INPUT, warning: '逆行です' }
    stubFetch(() => Promise.resolve(jsonResponse(200, response)))

    await expect(updateAssignment('my-key', 101, SAMPLE_INPUT)).resolves.toEqual(response)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/assignments/101`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual(SAMPLE_INPUT)
  })

  it('削除は DELETE /assignments/{id} を叩き、204でも正常終了する', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(deleteAssignment('my-key', 101)).resolves.toBeUndefined()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/assignments/101`)
    expect(init?.method).toBe('DELETE')
  })
})
