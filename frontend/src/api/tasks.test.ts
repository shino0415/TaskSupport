import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_KEY_HEADER } from './client'
import { createTask, deleteTask, fetchTasks, updateTask } from './tasks'
import type { Task, TaskInput } from './types'

const BASE_URL = 'http://api.test.local:8000'

const SAMPLE_TASK: Task = {
  id: 1,
  project_id: 10,
  name: '要件整理',
  status: '処理中',
  memo: null,
  is_deleted: false,
}

const SAMPLE_INPUT: TaskInput = {
  name: '設計書作成',
  status: '未着手',
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

describe('タスクのAPI呼び出し', () => {
  it('一覧は GET /projects/{id}/tasks を叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_TASK])))

    await expect(fetchTasks('my-key', 10)).resolves.toEqual([SAMPLE_TASK])

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/10/tasks`)
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('作成は POST /projects/{id}/tasks にJSONを送る', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(201, { ...SAMPLE_TASK, ...SAMPLE_INPUT })))

    await createTask('my-key', 10, SAMPLE_INPUT)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/10/tasks`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(SAMPLE_INPUT)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers[API_KEY_HEADER]).toBe('my-key')
  })

  it('更新は PATCH /tasks/{id} にJSONを送り、warningを受け取れる', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(200, { ...SAMPLE_TASK, status: '未着手', warning: '逆行の警告' }),
      ),
    )

    const result = await updateTask('my-key', 1, { ...SAMPLE_INPUT, status: '未着手' })

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/tasks/1`)
    expect(init?.method).toBe('PATCH')
    expect(result.warning).toBe('逆行の警告')
  })

  it('削除は DELETE /tasks/{id} を叩き、204でも正常終了する', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(deleteTask('my-key', 1)).resolves.toBeUndefined()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/tasks/1`)
    expect(init?.method).toBe('DELETE')
  })
})
