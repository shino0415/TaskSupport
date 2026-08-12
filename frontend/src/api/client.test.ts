import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_KEY_HEADER, apiRequest } from './client'
import { ApiError, toDisplayMessage } from './errors'

const BASE_URL = 'http://api.test.local:8000'

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

describe('apiRequest', () => {
  it('環境変数の接続先とX-API-Keyヘッダーを使ってリクエストする', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [{ id: 1 }])))

    const result = await apiRequest<{ id: number }[]>('/projects', 'my-key')

    expect(result).toEqual([{ id: 1 }])
    const mock = vi.mocked(fetch)
    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0]!
    expect(url).toBe(`${BASE_URL}/projects`)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers[API_KEY_HEADER]).toBe('my-key')
  })

  it('接続先URLの末尾スラッシュは取り除かれる', async () => {
    vi.stubEnv('VITE_API_BASE_URL', `${BASE_URL}/`)
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    await apiRequest('/projects', 'my-key')

    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(`${BASE_URL}/projects`)
  })

  it('接続先が未設定なら設定不備として扱い、fetchしない', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    const error = await apiRequest('/projects', 'my-key').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('config')
    expect(toDisplayMessage(error)).toContain('VITE_API_BASE_URL')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('API Keyが未入力ならリクエストせず認証エラーにする', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    const error = await apiRequest('/projects', '  ').catch((e: unknown) => e)

    expect((error as ApiError).kind).toBe('unauthorized')
    expect(toDisplayMessage(error)).toContain('API Key')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('401は認証エラーと分かるメッセージにする', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse(401, { detail: 'Invalid or missing API Key' })),
    )

    const error = await apiRequest('/projects', 'wrong-key').catch((e: unknown) => e)

    expect((error as ApiError).kind).toBe('unauthorized')
    expect((error as ApiError).status).toBe(401)
    expect(toDisplayMessage(error)).toContain('401')
    expect(toDisplayMessage(error)).toContain('API Key')
  })

  it('401以外のエラーはステータスとdetailを含むメッセージにする', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(404, { detail: 'Project not found' })))

    const error = await apiRequest('/projects/999', 'my-key').catch((e: unknown) => e)

    expect((error as ApiError).kind).toBe('http')
    expect((error as ApiError).status).toBe(404)
    expect(toDisplayMessage(error)).toContain('404')
    expect(toDisplayMessage(error)).toContain('Project not found')
  })

  it('通信失敗は接続先とCORSの確認を促すメッセージにする', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    const error = await apiRequest('/projects', 'my-key').catch((e: unknown) => e)

    expect((error as ApiError).kind).toBe('network')
    const message = toDisplayMessage(error)
    expect(message).toContain(BASE_URL)
    expect(message).toContain('CORS')
  })

  it('JSONとして解釈できない応答はその旨を伝える', async () => {
    stubFetch(() => Promise.resolve(new Response('<html></html>', { status: 200 })))

    const error = await apiRequest('/projects', 'my-key').catch((e: unknown) => e)

    expect((error as ApiError).kind).toBe('invalidResponse')
  })

  it('204はボディを解釈せずに正常終了する', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(apiRequest('/projects/1', 'my-key', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})
