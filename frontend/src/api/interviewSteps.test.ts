import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_KEY_HEADER } from './client'
import {
  createInterviewStep,
  deleteInterviewStep,
  fetchInterviewSteps,
  updateInterviewStep,
} from './interviewSteps'
import type { InterviewStep, InterviewStepInput } from './types'

const BASE_URL = 'http://api.test.local:8000'

const SAMPLE_STEP: InterviewStep = {
  id: 1,
  company_id: 10,
  type: '一次面接',
  date: '2026-03-01',
  prep_status: '準備中',
  result: '未定',
  memo: null,
  is_deleted: false,
}

const SAMPLE_INPUT: InterviewStepInput = {
  type: '二次面接',
  date: null,
  prep_status: '準備中',
  result: '未定',
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

describe('選考ステップのAPI呼び出し', () => {
  it('一覧は GET /companies/{id}/interview-steps を叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_STEP])))

    await expect(fetchInterviewSteps('my-key', 10)).resolves.toEqual([SAMPLE_STEP])

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/companies/10/interview-steps`)
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('作成は POST /companies/{id}/interview-steps にJSONを送る', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(201, { ...SAMPLE_STEP, ...SAMPLE_INPUT })))

    await createInterviewStep('my-key', 10, SAMPLE_INPUT)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/companies/10/interview-steps`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(SAMPLE_INPUT)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers[API_KEY_HEADER]).toBe('my-key')
  })

  it('更新は PATCH /interview-steps/{id} にJSONを送り、warningを受け取れる', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(200, {
          ...SAMPLE_STEP,
          prep_status: '準備中',
          warning: '準備状況・結果の逆行の警告',
        }),
      ),
    )

    const result = await updateInterviewStep('my-key', 1, { ...SAMPLE_INPUT, prep_status: '準備中' })

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/interview-steps/1`)
    expect(init?.method).toBe('PATCH')
    expect(result.warning).toBe('準備状況・結果の逆行の警告')
  })

  it('削除は DELETE /interview-steps/{id} を叩き、204でも正常終了する', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(deleteInterviewStep('my-key', 1)).resolves.toBeUndefined()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/interview-steps/1`)
    expect(init?.method).toBe('DELETE')
  })
})
