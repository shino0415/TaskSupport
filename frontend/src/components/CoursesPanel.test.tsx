import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Course } from '../api/types'
import { CoursesPanel } from './CoursesPanel'

const BASE_URL = 'http://api.test.local:8000'
const API_KEY = 'valid-key'

const COURSE_A: Course = {
  id: 1,
  name: 'データベース論',
  day_of_week: '月',
  period: 2,
  academic_year: 2026,
  term: '前期',
  memo: 'レポート多め',
  is_deleted: false,
}

const COURSE_B: Course = {
  id: 2,
  name: '集中講義A',
  day_of_week: null,
  period: null,
  academic_year: null,
  term: null,
  memo: null,
  is_deleted: false,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type FakeServer = {
  courses: Course[]
  requests: { method: string; url: string; body: unknown }[]
  /** 次の作成・更新リクエストに返すエラー（バリデーションエラー等の再現用）。 */
  nextWriteError: { status: number; detail: unknown } | null
}

/** 授業のCRUDを模した簡易APIサーバー（削除は論理削除で、一覧から除外される）。 */
function setupFakeServer(courses: Course[]): FakeServer {
  const server: FakeServer = {
    courses: courses.map((c) => ({ ...c })),
    requests: [],
    nextWriteError: null,
  }

  const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    server.requests.push({ method, url: `${url.pathname}${url.search}`, body })

    if ((method === 'POST' || method === 'PATCH') && server.nextWriteError !== null) {
      const error = server.nextWriteError
      server.nextWriteError = null
      return Promise.resolve(jsonResponse(error.status, { detail: error.detail }))
    }

    if (url.pathname === '/courses' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, server.courses.filter((c) => !c.is_deleted)))
    }
    if (url.pathname === '/courses' && method === 'POST') {
      const created: Course = {
        id: Math.max(0, ...server.courses.map((c) => c.id)) + 1,
        is_deleted: false,
        ...(body as Omit<Course, 'id' | 'is_deleted'>),
      }
      server.courses.push(created)
      return Promise.resolve(jsonResponse(201, created))
    }

    const match = /^\/courses\/(\d+)$/.exec(url.pathname)
    if (match !== null) {
      const target = server.courses.find((c) => c.id === Number(match[1]) && !c.is_deleted)
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'Course not found' }))
      }
      if (method === 'PATCH') {
        Object.assign(target, body)
        return Promise.resolve(jsonResponse(200, target))
      }
      if (method === 'DELETE') {
        target.is_deleted = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
    }

    return Promise.resolve(jsonResponse(404, { detail: 'Not Found' }))
  }

  vi.stubGlobal('fetch', vi.fn(handler))
  return server
}

function renderPanel() {
  return render(<CoursesPanel apiKey={API_KEY} />)
}

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole('option', { name: option }))
}

function rowOf(text: string) {
  return screen.getByText(text).closest('tr')!
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('授業一覧', () => {
  it('論理削除されていない授業が表示され、曜日・時限・年度・学期が分かる', async () => {
    setupFakeServer([COURSE_A, COURSE_B, { ...COURSE_A, id: 3, name: '削除済み授業', is_deleted: true }])

    renderPanel()

    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
    const rowA = rowOf('データベース論')
    expect(within(rowA).getByText('月')).toBeInTheDocument()
    expect(within(rowA).getByText('2限')).toBeInTheDocument()
    expect(within(rowA).getByText('2026年度')).toBeInTheDocument()
    expect(within(rowA).getByText('前期')).toBeInTheDocument()
    expect(within(rowA).getByText('レポート多め')).toBeInTheDocument()
    // 任意項目が未設定の授業も表示が破綻しない
    const rowB = rowOf('集中講義A')
    expect(within(rowB).getAllByText('-')).toHaveLength(5)
    expect(screen.queryByText('削除済み授業')).not.toBeInTheDocument()
  })

  it('0件の場合も表示が破綻せず、0件であることが分かる', async () => {
    setupFakeServer([])

    renderPanel()

    expect(await screen.findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(screen.getByText('授業は0件です。')).toBeInTheDocument()
  })

  it('一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))),
    )

    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('500')
  })

  it('API Keyが未入力ならAPIを呼ばない', () => {
    setupFakeServer([COURSE_A])

    render(<CoursesPanel apiKey="" />)

    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '新規登録' })).toBeDisabled()
  })
})

describe('授業の新規登録', () => {
  it('曜日・学期を選択式で、時限・年度を入力して登録でき、一覧に反映される', async () => {
    const server = setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('授業は0件です。')
    await user.click(screen.getByRole('button', { name: '新規登録' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/授業名/), '線形代数')
    await selectOption(user, '曜日', '水')
    await user.type(within(dialog).getByLabelText('時限'), '3')
    await user.type(within(dialog).getByLabelText('年度'), '2026')
    await selectOption(user, '学期', '後期')
    await user.type(within(dialog).getByLabelText('メモ'), '教科書あり')
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))

    expect(await screen.findByText('授業を登録しました。')).toBeInTheDocument()
    const post = server.requests.find((r) => r.method === 'POST')
    expect(post?.url).toBe('/courses')
    expect(post?.body).toEqual({
      name: '線形代数',
      day_of_week: '水',
      period: 3,
      academic_year: 2026,
      term: '後期',
      memo: '教科書あり',
    })
    const row = await waitFor(() => rowOf('線形代数'))
    expect(within(row).getByText('水')).toBeInTheDocument()
    expect(within(row).getByText('3限')).toBeInTheDocument()
    expect(within(row).getByText('2026年度')).toBeInTheDocument()
    expect(within(row).getByText('後期')).toBeInTheDocument()
  })

  it('授業名だけで登録でき、任意項目はnullで送られる', async () => {
    const server = setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('授業は0件です。')
    await user.click(screen.getByRole('button', { name: '新規登録' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/授業名/), 'オンデマンド講義')
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))

    expect(await screen.findByText('オンデマンド講義')).toBeInTheDocument()
    expect(server.requests.find((r) => r.method === 'POST')?.body).toEqual({
      name: 'オンデマンド講義',
      day_of_week: null,
      period: null,
      academic_year: null,
      term: null,
      memo: null,
    })
  })

  it('授業名が未入力・時限が不正なら送信せず項目ごとのメッセージを表示する', async () => {
    const server = setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('授業は0件です。')
    await user.click(screen.getByRole('button', { name: '新規登録' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('時限'), '0')
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))

    expect(within(dialog).getByText('授業名を入力してください。')).toBeInTheDocument()
    expect(within(dialog).getByText('時限は1以上の整数で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'POST')).toBe(false)
  })

  it('APIが返したバリデーションエラーをダイアログ内に表示し、入力内容を保持する', async () => {
    const server = setupFakeServer([])
    server.nextWriteError = {
      status: 422,
      detail: [{ loc: ['body', 'name'], msg: 'String should have at least 1 character' }],
    }
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('授業は0件です。')
    await user.click(screen.getByRole('button', { name: '新規登録' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/授業名/), '線形代数')
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('422')
    expect(alert).toHaveTextContent('String should have at least 1 character')
    expect(within(dialog).getByLabelText(/授業名/)).toHaveValue('線形代数')
  })
})

describe('授業の編集', () => {
  it('既存の値が入った状態で編集でき、結果が一覧に反映される', async () => {
    const server = setupFakeServer([COURSE_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('データベース論')
    await user.click(screen.getByRole('button', { name: '授業「データベース論」を編集' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('授業を編集（ID: 1）')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/授業名/)).toHaveValue('データベース論')
    expect(within(dialog).getByLabelText('時限')).toHaveValue(2)
    expect(within(dialog).getByLabelText('年度')).toHaveValue(2026)

    await selectOption(user, '曜日', '金')
    await user.clear(within(dialog).getByLabelText('時限'))
    await user.type(within(dialog).getByLabelText('時限'), '4')
    await selectOption(user, '学期', '未設定')
    await user.click(within(dialog).getByRole('button', { name: '更新する' }))

    expect(await screen.findByText('授業を更新しました。')).toBeInTheDocument()
    const patch = server.requests.find((r) => r.method === 'PATCH')
    expect(patch?.url).toBe('/courses/1')
    expect(patch?.body).toEqual({
      name: 'データベース論',
      day_of_week: '金',
      period: 4,
      academic_year: 2026,
      term: null,
      memo: 'レポート多め',
    })
    await waitFor(() => expect(within(rowOf('データベース論')).getByText('4限')).toBeInTheDocument())
    const row = rowOf('データベース論')
    expect(within(row).getByText('金')).toBeInTheDocument()
    expect(within(row).queryByText('前期')).not.toBeInTheDocument()
  })

  it('更新時にAPIがエラーを返すとダイアログ内に表示する', async () => {
    const server = setupFakeServer([COURSE_A])
    server.nextWriteError = { status: 404, detail: 'Course not found' }
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('データベース論')
    await user.click(screen.getByRole('button', { name: '授業「データベース論」を編集' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '更新する' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('404')
    expect(alert).toHaveTextContent('Course not found')
  })
})

describe('授業の削除', () => {
  it('確認後に削除でき、削除後は一覧に表示されなくなる', async () => {
    const server = setupFakeServer([COURSE_A, COURSE_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('データベース論')
    await user.click(screen.getByRole('button', { name: '授業「データベース論」を削除' }))

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('授業「データベース論」を削除します。よろしいですか？'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))

    expect(await screen.findByText('授業「データベース論」を削除しました。')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('取得件数: 1 件')).toBeInTheDocument())
    expect(screen.queryByRole('cell', { name: 'データベース論' })).not.toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'DELETE' && r.url === '/courses/1')).toBe(
      true,
    )
  })

  it('削除に失敗すると原因が分かるメッセージを表示する', async () => {
    setupFakeServer([COURSE_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('データベース論')
    vi.mocked(fetch).mockImplementationOnce(() =>
      Promise.resolve(jsonResponse(404, { detail: 'Course not found' })),
    )
    await user.click(screen.getByRole('button', { name: '授業「データベース論」を削除' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '削除する' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('404')
    expect(alert).toHaveTextContent('Course not found')
  })
})
