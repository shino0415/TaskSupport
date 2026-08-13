import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_KEY_HEADER } from './client'
import {
  createProject,
  deleteProject,
  fetchProject,
  fetchProjects,
  updateProject,
} from './projects'
import type { Project, ProjectInput } from './types'

const BASE_URL = 'http://api.test.local:8000'

const SAMPLE_PROJECT: Project = {
  id: 1,
  name: 'ポートフォリオサイト制作',
  client_name: '株式会社サンプル',
  status: '契約中',
  reward: 120000,
  applied_date: '2026-08-01',
  deadline: null,
  platform: 'CrowdWorks',
  memo: null,
  is_deleted: false,
}

const SAMPLE_INPUT: ProjectInput = {
  name: 'LP制作',
  client_name: '株式会社テスト',
  status: '提案中',
  reward: 50000,
  applied_date: '2026-08-10',
  deadline: '2026-09-30',
  platform: 'CrowdWorks',
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

describe('案件のAPI呼び出し', () => {
  it('一覧はステータス未指定ならクエリを付けない', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_PROJECT])))

    await expect(fetchProjects('my-key')).resolves.toEqual([SAMPLE_PROJECT])

    expect(lastCall().url).toBe(`${BASE_URL}/projects`)
  })

  it('一覧はステータス指定時にstatusクエリで絞り込む', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    await fetchProjects('my-key', { status: '契約中' })

    expect(lastCall().url).toBe(`${BASE_URL}/projects?status=${encodeURIComponent('契約中')}`)
  })

  it('詳細は GET /projects/{id} を叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, SAMPLE_PROJECT)))

    await expect(fetchProject('my-key', 1)).resolves.toEqual(SAMPLE_PROJECT)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/1`)
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('作成は POST /projects にJSONを送る', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(201, { ...SAMPLE_PROJECT, ...SAMPLE_INPUT })))

    await createProject('my-key', SAMPLE_INPUT)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/projects`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(SAMPLE_INPUT)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers[API_KEY_HEADER]).toBe('my-key')
  })

  it('更新は PATCH /projects/{id} にJSONを送り、warningを受け取れる', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(200, { ...SAMPLE_PROJECT, status: '提案中', warning: '逆行の警告' }),
      ),
    )

    const result = await updateProject('my-key', 1, { ...SAMPLE_INPUT, status: '提案中' })

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/1`)
    expect(init?.method).toBe('PATCH')
    expect(result.warning).toBe('逆行の警告')
  })

  it('削除は DELETE /projects/{id} を叩き、204でも正常終了する', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(deleteProject('my-key', 1)).resolves.toBeUndefined()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/1`)
    expect(init?.method).toBe('DELETE')
  })
})
