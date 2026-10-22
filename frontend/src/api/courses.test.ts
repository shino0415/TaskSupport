import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_KEY_HEADER } from './client'
import { createCourse, deleteCourse, fetchCourses, updateCourse } from './courses'
import type { Course, CourseInput } from './types'

const BASE_URL = 'http://api.test.local:8000'

const SAMPLE_COURSE: Course = {
  id: 1,
  name: 'データベース論',
  day_of_week: '月',
  period: 2,
  academic_year: 2026,
  term: '前期',
  memo: null,
  is_deleted: false,
}

const SAMPLE_INPUT: CourseInput = {
  name: '線形代数',
  day_of_week: null,
  period: null,
  academic_year: 2026,
  term: '後期',
  memo: '教科書あり',
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

describe('授業のAPI呼び出し', () => {
  it('一覧は GET /courses を叩く', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_COURSE])))

    await expect(fetchCourses('my-key')).resolves.toEqual([SAMPLE_COURSE])

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/courses`)
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('作成は POST /courses にJSONを送る', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(201, { ...SAMPLE_COURSE, ...SAMPLE_INPUT })))

    await createCourse('my-key', SAMPLE_INPUT)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/courses`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(SAMPLE_INPUT)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers[API_KEY_HEADER]).toBe('my-key')
  })

  it('更新は PATCH /courses/{id} にJSONを送り、未設定の任意項目はnullで送る', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, { ...SAMPLE_COURSE, ...SAMPLE_INPUT })))

    await updateCourse('my-key', 1, SAMPLE_INPUT)

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/courses/1`)
    expect(init?.method).toBe('PATCH')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toEqual(SAMPLE_INPUT)
    expect(body.day_of_week).toBeNull()
  })

  it('削除は DELETE /courses/{id} を叩き、204でも正常終了する', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(deleteCourse('my-key', 1)).resolves.toBeUndefined()

    const { url, init } = lastCall()
    expect(url).toBe(`${BASE_URL}/courses/1`)
    expect(init?.method).toBe('DELETE')
  })
})
