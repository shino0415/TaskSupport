import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_KEY_HEADER } from './client'
import type { WorkLog } from './types'
import { deleteWorkLog, fetchWorkLogs, startWorkLog, stopWorkLog } from './workLogs'

const BASE_URL = 'http://api.test.local:8000'

const SAMPLE_WORK_LOG: WorkLog = {
  id: 1,
  task_id: 10,
  started_at: '2026-08-13T10:00:00',
  ended_at: null,
  memo: null,
  is_deleted: false,
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

describe('稼働ログのAPI呼び出し', () => {
  it('一覧は GET /tasks/{id}/work-logs を叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_WORK_LOG])))

    await expect(fetchWorkLogs('my-key', 10)).resolves.toEqual([SAMPLE_WORK_LOG])

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/tasks/10/work-logs`)
    expect(init?.method ?? 'GET').toBe('GET')
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers[API_KEY_HEADER]).toBe('my-key')
  })

  it('計測開始は POST /tasks/{id}/work-logs/start を、ボディなしで叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(201, SAMPLE_WORK_LOG)))

    await expect(startWorkLog('my-key', 10)).resolves.toEqual(SAMPLE_WORK_LOG)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/tasks/10/work-logs/start`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  it('計測終了は PATCH /work-logs/{id}/stop を叩く', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse(200, { ...SAMPLE_WORK_LOG, ended_at: '2026-08-13T11:00:00' })),
    )

    const result = await stopWorkLog('my-key', 1)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/work-logs/1/stop`)
    expect(init?.method).toBe('PATCH')
    expect(result.ended_at).toBe('2026-08-13T11:00:00')
  })

  it('削除は DELETE /work-logs/{id} を叩き、204でも正常終了する', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(deleteWorkLog('my-key', 1)).resolves.toBeUndefined()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/work-logs/1`)
    expect(init?.method).toBe('DELETE')
  })
})
