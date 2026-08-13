import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_KEY_HEADER } from './client'
import { fetchHourlyRate } from './hourlyRate'
import type { HourlyRate } from './types'

const BASE_URL = 'http://api.test.local:8000'

const SAMPLE_HOURLY_RATE: HourlyRate = {
  project_id: 1,
  reward: 10000,
  total_work_hours: 2,
  hourly_rate: 5000,
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

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('時給換算のAPI呼び出し', () => {
  it('GET /projects/{id}/hourly-rate を叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, SAMPLE_HOURLY_RATE)))

    await expect(fetchHourlyRate('my-key', 1)).resolves.toEqual(SAMPLE_HOURLY_RATE)

    const call = vi.mocked(fetch).mock.calls.at(-1)!
    const [url, init] = call
    expect(url).toBe(`${BASE_URL}/projects/1/hourly-rate`)
    expect(init?.method ?? 'GET').toBe('GET')
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers[API_KEY_HEADER]).toBe('my-key')
  })

  it('hourly_rateがnullの応答もそのまま受け取れる', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(200, { project_id: 1, reward: 10000, total_work_hours: 0, hourly_rate: null }),
      ),
    )

    const result = await fetchHourlyRate('my-key', 1)

    expect(result.hourly_rate).toBeNull()
    expect(result.total_work_hours).toBe(0)
  })
})
