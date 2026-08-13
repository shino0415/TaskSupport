import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_KEY_HEADER } from './client'
import { createCompany, deleteCompany, fetchCompanies, fetchCompany } from './companies'
import type { Company, CompanyInput } from './types'

const BASE_URL = 'http://api.test.local:8000'

const SAMPLE_COMPANY: Company = {
  id: 1,
  name: '株式会社サンプル',
  is_deleted: false,
}

const SAMPLE_INPUT: CompanyInput = {
  name: '合同会社テスト',
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

describe('企業のAPI呼び出し', () => {
  it('一覧は GET /companies を叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_COMPANY])))

    await expect(fetchCompanies('my-key')).resolves.toEqual([SAMPLE_COMPANY])

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/companies`)
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('詳細は GET /companies/{id} を叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, SAMPLE_COMPANY)))

    await expect(fetchCompany('my-key', 1)).resolves.toEqual(SAMPLE_COMPANY)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/companies/1`)
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('作成は POST /companies にJSONを送る', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(201, { ...SAMPLE_COMPANY, ...SAMPLE_INPUT })))

    await createCompany('my-key', SAMPLE_INPUT)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/companies`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(SAMPLE_INPUT)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers[API_KEY_HEADER]).toBe('my-key')
  })

  it('削除は DELETE /companies/{id} を叩き、204でも正常終了する', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(deleteCompany('my-key', 1)).resolves.toBeUndefined()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/companies/1`)
    expect(init?.method).toBe('DELETE')
  })
})
