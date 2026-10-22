import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Assignment, Course } from '../api/types'
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

const ASSIGNMENT_A: Assignment = {
  id: 101,
  course_id: 1,
  name: '正規化レポート',
  status: '提出済み',
  deadline: '2026-11-01T23:59:00',
  submission_method: 'WebClass',
  memo: 'A4で2枚',
  is_deleted: false,
}

const ASSIGNMENT_B: Assignment = {
  id: 102,
  course_id: 1,
  name: '小テスト準備',
  status: '未着手',
  deadline: null,
  submission_method: null,
  memo: null,
  is_deleted: false,
}

/** 課題ステータスの逆行遷移を判定するための線形順序（バックエンドの状態遷移グラフを模す）。 */
const ASSIGNMENT_STATUS_ORDER = ['未着手', '取組中', '未提出', '提出済み']

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type FakeServer = {
  courses: Course[]
  assignments: Assignment[]
  requests: { method: string; url: string; body: unknown }[]
  /** 次の作成・更新リクエストに返すエラー（バリデーションエラー等の再現用）。 */
  nextWriteError: { status: number; detail: unknown } | null
}

/** 授業・課題のCRUDと課題ステータス逆行時のwarningを模した簡易APIサーバー
 * （削除は論理削除で、一覧から除外される）。 */
function setupFakeServer(courses: Course[], assignments: Assignment[] = []): FakeServer {
  const server: FakeServer = {
    courses: courses.map((c) => ({ ...c })),
    assignments: assignments.map((a) => ({ ...a })),
    requests: [],
    nextWriteError: null,
  }

  function assignmentWarning(before: Assignment, patch: Partial<Assignment>): string | null {
    if (patch.status === undefined || patch.status === before.status) {
      return null
    }
    const fromIndex = ASSIGNMENT_STATUS_ORDER.indexOf(before.status)
    const toIndex = ASSIGNMENT_STATUS_ORDER.indexOf(patch.status)
    if (fromIndex !== -1 && toIndex !== -1 && toIndex < fromIndex) {
      return `${before.status} から ${patch.status} への変更です。意図的な変更か確認してください。`
    }
    return null
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

    const courseAssignmentsMatch = /^\/courses\/(\d+)\/assignments$/.exec(url.pathname)
    if (courseAssignmentsMatch !== null) {
      const courseId = Number(courseAssignmentsMatch[1])
      if (!server.courses.some((c) => c.id === courseId && !c.is_deleted)) {
        return Promise.resolve(jsonResponse(404, { detail: 'Course not found' }))
      }
      if (method === 'GET') {
        return Promise.resolve(
          jsonResponse(
            200,
            server.assignments.filter((a) => a.course_id === courseId && !a.is_deleted),
          ),
        )
      }
      if (method === 'POST') {
        const created: Assignment = {
          id: Math.max(100, ...server.assignments.map((a) => a.id)) + 1,
          course_id: courseId,
          is_deleted: false,
          ...(body as Omit<Assignment, 'id' | 'course_id' | 'is_deleted'>),
        }
        server.assignments.push(created)
        return Promise.resolve(jsonResponse(201, created))
      }
    }

    const assignmentMatch = /^\/assignments\/(\d+)$/.exec(url.pathname)
    if (assignmentMatch !== null) {
      const target = server.assignments.find(
        (a) => a.id === Number(assignmentMatch[1]) && !a.is_deleted,
      )
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'Assignment not found' }))
      }
      if (method === 'PATCH') {
        const patch = body as Partial<Assignment>
        const warning = assignmentWarning(target, patch)
        Object.assign(target, patch)
        return Promise.resolve(jsonResponse(200, { ...target, warning }))
      }
      if (method === 'DELETE') {
        target.is_deleted = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
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
    expect(within(dialog).getByText('時限は1〜6の整数で入力してください。')).toBeInTheDocument()
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

describe('フォームの開き直し', () => {
  it('入力途中で閉じても、開き直すと新規登録は空欄・編集は対象の値に初期化され、前回のエラー表示も消える', async () => {
    setupFakeServer([COURSE_A, COURSE_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('データベース論')
    await user.click(screen.getByRole('button', { name: '新規登録' }))
    let dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('時限'), '0')
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))
    expect(within(dialog).getByText('授業名を入力してください。')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '新規登録' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/授業名/)).toHaveValue('')
    expect(within(dialog).getByLabelText('時限')).toHaveValue(null)
    expect(within(dialog).queryByText('授業名を入力してください。')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '授業「データベース論」を編集' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/授業名/)).toHaveValue('データベース論')
    await user.clear(within(dialog).getByLabelText(/授業名/))
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '授業「集中講義A」を編集' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/授業名/)).toHaveValue('集中講義A')
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

async function waitForDialogClosed() {
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

/** 課題一覧の表（「課題名」列を持つのはこの表のみ）。 */
function assignmentsTable() {
  return screen.getByRole('columnheader', { name: '課題名' }).closest('table')!
}

function assignmentRowOf(name: string) {
  return within(assignmentsTable()).getByText(name).closest('tr')!
}

async function showAssignments(user: ReturnType<typeof userEvent.setup>, courseName: string) {
  await screen.findByText(courseName)
  await user.click(screen.getByRole('button', { name: `授業「${courseName}」の課題を表示` }))
}

describe('課題一覧', () => {
  it('授業を選ぶと課題一覧を別途取得し、課題名・ステータス・提出期限・提出方法が分かる', async () => {
    // 授業一覧の取得件数（3件）と課題一覧の取得件数（2件）を区別できるよう授業は3件にする
    const server = setupFakeServer(
      [COURSE_A, COURSE_B, { ...COURSE_B, id: 3, name: '線形代数' }],
      [
        ASSIGNMENT_A,
        ASSIGNMENT_B,
        { ...ASSIGNMENT_A, id: 103, name: '削除済み課題', is_deleted: true },
        { ...ASSIGNMENT_A, id: 104, course_id: 2, name: '他授業の課題' },
      ],
    )
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')

    expect(await screen.findByText('課題（データベース論）')).toBeInTheDocument()
    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(
      server.requests.some((r) => r.method === 'GET' && r.url === '/courses/1/assignments'),
    ).toBe(true)
    const rowA = assignmentRowOf('正規化レポート')
    expect(within(rowA).getByText('提出済み')).toBeInTheDocument()
    expect(within(rowA).getByText('11/1 23:59')).toBeInTheDocument()
    expect(within(rowA).getByText('WebClass')).toBeInTheDocument()
    expect(within(rowA).getByText('A4で2枚')).toBeInTheDocument()
    // 任意項目が未設定の課題も表示が破綻しない
    const rowB = assignmentRowOf('小テスト準備')
    expect(within(rowB).getByText('未着手')).toBeInTheDocument()
    expect(within(rowB).getAllByText('-')).toHaveLength(3)
    expect(screen.queryByText('削除済み課題')).not.toBeInTheDocument()
    expect(screen.queryByText('他授業の課題')).not.toBeInTheDocument()
  })

  it('授業を選ぶまでは課題一覧を取得・表示しない', async () => {
    const server = setupFakeServer([COURSE_A], [ASSIGNMENT_A])

    renderPanel()
    await screen.findByText('データベース論')

    expect(screen.queryByRole('button', { name: '課題を追加' })).not.toBeInTheDocument()
    expect(server.requests.some((r) => r.url.includes('/assignments'))).toBe(false)
  })

  it('課題が0件の授業でも表示が破綻せず、0件であることが分かる', async () => {
    setupFakeServer([COURSE_A, COURSE_B], [ASSIGNMENT_A])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, '集中講義A')

    expect(await screen.findByText('課題は0件です。')).toBeInTheDocument()
    expect(screen.getByText('取得件数: 0 件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '課題を追加' })).toBeEnabled()
  })

  it('課題一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    setupFakeServer([COURSE_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('データベース論')
    vi.mocked(fetch).mockImplementationOnce(() =>
      Promise.resolve(jsonResponse(404, { detail: 'Course not found' })),
    )
    await showAssignments(user, 'データベース論')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('404')
    expect(alert).toHaveTextContent('Course not found')
  })

  it('選択中の授業を削除すると課題一覧の表示も閉じる', async () => {
    setupFakeServer([COURSE_A, COURSE_B], [ASSIGNMENT_A])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('正規化レポート')

    await user.click(screen.getByRole('button', { name: '授業「データベース論」を削除' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '削除する' }))

    expect(await screen.findByText('授業「データベース論」を削除しました。')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('正規化レポート')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '課題を追加' })).not.toBeInTheDocument()
  })
})

describe('横断一覧からの遷移（授業を指定して開く）', () => {
  it('指定した授業が選ばれ、その授業の課題一覧が表示された状態で開く', async () => {
    const server = setupFakeServer([COURSE_A, COURSE_B], [ASSIGNMENT_A, ASSIGNMENT_B])

    render(<CoursesPanel apiKey={API_KEY} initialSelectedCourseId={COURSE_A.id} />)

    expect(await screen.findByText('課題（データベース論）')).toBeInTheDocument()
    expect(await screen.findByText('正規化レポート')).toBeInTheDocument()
    expect(screen.getByText('小テスト準備')).toBeInTheDocument()
    expect(server.requests).toContainEqual({
      method: 'GET',
      url: '/courses/1/assignments',
      body: undefined,
    })
    const selectedRow = screen.getByRole('button', { name: '授業「データベース論」を編集' })
      .closest('tr')!
    expect(selectedRow).toHaveClass('Mui-selected')
  })

  it('指定した授業が存在しない場合も画面は壊れず、課題一覧の取得失敗が分かる', async () => {
    setupFakeServer([COURSE_A])

    render(<CoursesPanel apiKey={API_KEY} initialSelectedCourseId={999} />)

    expect(await screen.findByText('データベース論')).toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('404')
  })
})

describe('課題の新規追加', () => {
  it('提出期限（日付と時刻）・提出方法を入力して追加でき、一覧に反映される', async () => {
    const server = setupFakeServer([COURSE_A])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('課題は0件です。')
    await user.click(screen.getByRole('button', { name: '課題を追加' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('課題を新規追加')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/課題名/), 'ER図の作成')
    await selectOption(user, 'ステータス', '取組中')
    fireEvent.change(within(dialog).getByLabelText('提出期限'), {
      target: { value: '2026-11-10T09:30' },
    })
    await selectOption(user, '提出方法', '紙')
    await user.type(within(dialog).getByLabelText('メモ'), '手書き可')
    await user.click(within(dialog).getByRole('button', { name: '追加する' }))

    expect(await screen.findByText('課題を追加しました。')).toBeInTheDocument()
    const post = server.requests.find((r) => r.method === 'POST')
    expect(post?.url).toBe('/courses/1/assignments')
    expect(post?.body).toEqual({
      name: 'ER図の作成',
      status: '取組中',
      deadline: '2026-11-10T09:30',
      submission_method: '紙',
      memo: '手書き可',
    })
    const row = await waitFor(() => assignmentRowOf('ER図の作成'))
    expect(within(row).getByText('取組中')).toBeInTheDocument()
    expect(within(row).getByText('11/10 09:30')).toBeInTheDocument()
    expect(within(row).getByText('紙')).toBeInTheDocument()
  })

  it('課題名だけで追加でき、ステータスは未着手・任意項目はnullで送られる', async () => {
    const server = setupFakeServer([COURSE_A])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('課題は0件です。')
    await user.click(screen.getByRole('button', { name: '課題を追加' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/課題名/), '期末レポート')
    await user.click(within(dialog).getByRole('button', { name: '追加する' }))

    await waitFor(() => expect(assignmentRowOf('期末レポート')).toBeInTheDocument())
    expect(server.requests.find((r) => r.method === 'POST')?.body).toEqual({
      name: '期末レポート',
      status: '未着手',
      deadline: null,
      submission_method: null,
      memo: null,
    })
  })

  it('課題名が未入力なら送信せず項目ごとのメッセージを表示する', async () => {
    const server = setupFakeServer([COURSE_A])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('課題は0件です。')
    await user.click(screen.getByRole('button', { name: '課題を追加' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '追加する' }))

    expect(within(dialog).getByText('課題名を入力してください。')).toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'POST')).toBe(false)
  })

  it('APIが返したエラーをダイアログ内に表示し、入力内容を保持する', async () => {
    const server = setupFakeServer([COURSE_A])
    server.nextWriteError = {
      status: 422,
      detail: [{ loc: ['body', 'deadline'], msg: 'Input should not have timezone info' }],
    }
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('課題は0件です。')
    await user.click(screen.getByRole('button', { name: '課題を追加' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/課題名/), 'ER図の作成')
    await user.click(within(dialog).getByRole('button', { name: '追加する' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('422')
    expect(alert).toHaveTextContent('Input should not have timezone info')
    expect(within(dialog).getByLabelText(/課題名/)).toHaveValue('ER図の作成')
  })
})

describe('課題の編集', () => {
  it('既存の値が入った状態で各項目を編集でき、結果が一覧に反映される', async () => {
    const server = setupFakeServer([COURSE_A], [ASSIGNMENT_B])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('小テスト準備')
    await user.click(screen.getByRole('button', { name: '課題「小テスト準備」を編集' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('課題を編集（ID: 102）')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/課題名/)).toHaveValue('小テスト準備')
    await user.clear(within(dialog).getByLabelText(/課題名/))
    await user.type(within(dialog).getByLabelText(/課題名/), '第3回小テスト準備')
    await selectOption(user, 'ステータス', '未提出')
    fireEvent.change(within(dialog).getByLabelText('提出期限'), {
      target: { value: '2026-11-05T13:00' },
    })
    await selectOption(user, '提出方法', 'その他')
    await user.click(within(dialog).getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('課題を更新しました。')).toBeInTheDocument()
    const patch = server.requests.find((r) => r.method === 'PATCH')
    expect(patch?.url).toBe('/assignments/102')
    expect(patch?.body).toEqual({
      name: '第3回小テスト準備',
      status: '未提出',
      deadline: '2026-11-05T13:00',
      submission_method: 'その他',
      memo: null,
    })
    const row = await waitFor(() => assignmentRowOf('第3回小テスト準備'))
    expect(within(row).getByText('未提出')).toBeInTheDocument()
    expect(within(row).getByText('11/5 13:00')).toBeInTheDocument()
    expect(within(row).getByText('その他')).toBeInTheDocument()
  })

  it('提出期限・提出方法を未設定に戻すとnullで送られる', async () => {
    const server = setupFakeServer([COURSE_A], [ASSIGNMENT_A])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('正規化レポート')
    await user.click(screen.getByRole('button', { name: '課題「正規化レポート」を編集' }))

    const dialog = await screen.findByRole('dialog')
    // 秒が0の提出期限は分までの値として入力欄に入る
    expect(within(dialog).getByLabelText('提出期限')).toHaveValue('2026-11-01T23:59')
    fireEvent.change(within(dialog).getByLabelText('提出期限'), { target: { value: '' } })
    await selectOption(user, '提出方法', '未設定')
    await user.click(within(dialog).getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    expect(server.requests.find((r) => r.method === 'PATCH')?.body).toMatchObject({
      deadline: null,
      submission_method: null,
    })
    await waitFor(() =>
      expect(within(assignmentRowOf('正規化レポート')).getAllByText('-')).toHaveLength(2),
    )
  })

  it('ステータスの逆行時はAPIの警告を表示しつつ、更新自体は成立する', async () => {
    setupFakeServer([COURSE_A], [ASSIGNMENT_A])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('正規化レポート')
    await user.click(screen.getByRole('button', { name: '課題「正規化レポート」を編集' }))
    await selectOption(user, 'ステータス', '取組中')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    const alert = await screen.findByText(/意図的な変更か確認してください/)
    expect(alert).toHaveTextContent('提出済み から 取組中 への変更です')
    expect(alert).toHaveTextContent('変更は保存されています')
    await waitFor(() =>
      expect(within(assignmentRowOf('正規化レポート')).getByText('取組中')).toBeInTheDocument(),
    )
  })

  it('更新時にAPIがエラーを返すとダイアログ内に表示する', async () => {
    const server = setupFakeServer([COURSE_A], [ASSIGNMENT_B])
    server.nextWriteError = { status: 404, detail: 'Assignment not found' }
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('小テスト準備')
    await user.click(screen.getByRole('button', { name: '課題「小テスト準備」を編集' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '更新する' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('404')
    expect(alert).toHaveTextContent('Assignment not found')
  })
})

describe('課題の削除', () => {
  it('確認後に削除でき、削除後は一覧に表示されなくなる', async () => {
    const server = setupFakeServer([COURSE_A], [ASSIGNMENT_A, ASSIGNMENT_B])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('正規化レポート')
    await user.click(screen.getByRole('button', { name: '課題「正規化レポート」を削除' }))

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('課題「正規化レポート」を削除します。よろしいですか？'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))

    expect(await screen.findByText('課題「正規化レポート」を削除しました。')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(assignmentsTable()).queryByText('正規化レポート')).not.toBeInTheDocument(),
    )
    expect(within(assignmentsTable()).getByText('小テスト準備')).toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'DELETE' && r.url === '/assignments/101')).toBe(
      true,
    )
  })

  it('最後の課題を削除すると0件の表示になる', async () => {
    setupFakeServer([COURSE_A], [ASSIGNMENT_B])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('小テスト準備')
    await user.click(screen.getByRole('button', { name: '課題「小テスト準備」を削除' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '削除する' }))

    expect(await screen.findByText('課題は0件です。')).toBeInTheDocument()
  })

  it('削除に失敗すると原因が分かるメッセージを表示する', async () => {
    setupFakeServer([COURSE_A], [ASSIGNMENT_B])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('小テスト準備')
    vi.mocked(fetch).mockImplementationOnce(() =>
      Promise.resolve(jsonResponse(404, { detail: 'Assignment not found' })),
    )
    await user.click(screen.getByRole('button', { name: '課題「小テスト準備」を削除' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '削除する' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('404')
    expect(alert).toHaveTextContent('Assignment not found')
  })
})

describe('入力値の上限・範囲', () => {
  const NAME_32 = 'あ'.repeat(32)
  const MEMO_1000 = 'm'.repeat(1000)

  async function openCourseCreateForm(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText('授業は0件です。')
    await user.click(screen.getByRole('button', { name: '新規登録' }))
    return screen.findByRole('dialog')
  }

  it('授業名・メモの上限超過、時限・年度の範囲外は送信せず項目ごとに示す', async () => {
    const server = setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    const dialog = await openCourseCreateForm(user)
    fireEvent.change(within(dialog).getByLabelText(/授業名/), { target: { value: `${NAME_32}あ` } })
    fireEvent.change(within(dialog).getByLabelText('メモ'), { target: { value: `${MEMO_1000}m` } })
    await user.type(within(dialog).getByLabelText('時限'), '7')
    await user.type(within(dialog).getByLabelText('年度'), '1999')
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))

    expect(within(dialog).getByText('授業名は32文字以内で入力してください。')).toBeInTheDocument()
    expect(within(dialog).getByText('メモは1000文字以内で入力してください。')).toBeInTheDocument()
    expect(within(dialog).getByText('時限は1〜6の整数で入力してください。')).toBeInTheDocument()
    expect(within(dialog).getByText('年度は2000〜2100の整数で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'POST')).toBe(false)
  })

  it('時限0・年度2101も範囲外として送信しない', async () => {
    const server = setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    const dialog = await openCourseCreateForm(user)
    await user.type(within(dialog).getByLabelText(/授業名/), '線形代数')
    await user.type(within(dialog).getByLabelText('時限'), '0')
    await user.type(within(dialog).getByLabelText('年度'), '2101')
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))

    expect(within(dialog).getByText('時限は1〜6の整数で入力してください。')).toBeInTheDocument()
    expect(within(dialog).getByText('年度は2000〜2100の整数で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'POST')).toBe(false)
  })

  it('上限ちょうどの授業名・メモと、時限6・年度2100は送信でき保存される', async () => {
    const server = setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    const dialog = await openCourseCreateForm(user)
    fireEvent.change(within(dialog).getByLabelText(/授業名/), { target: { value: NAME_32 } })
    fireEvent.change(within(dialog).getByLabelText('メモ'), { target: { value: MEMO_1000 } })
    await user.type(within(dialog).getByLabelText('時限'), '6')
    await user.type(within(dialog).getByLabelText('年度'), '2100')
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))

    expect(await screen.findByText('授業を登録しました。')).toBeInTheDocument()
    expect(server.requests.find((r) => r.method === 'POST')?.body).toEqual({
      name: NAME_32,
      day_of_week: null,
      period: 6,
      academic_year: 2100,
      term: null,
      memo: MEMO_1000,
    })
    const row = await waitFor(() => rowOf(NAME_32))
    expect(within(row).getByText('6限')).toBeInTheDocument()
    expect(within(row).getByText('2100年度')).toBeInTheDocument()
  })

  it('時限1・年度2000は送信でき保存される', async () => {
    const server = setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    const dialog = await openCourseCreateForm(user)
    await user.type(within(dialog).getByLabelText(/授業名/), '線形代数')
    await user.type(within(dialog).getByLabelText('時限'), '1')
    await user.type(within(dialog).getByLabelText('年度'), '2000')
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))

    expect(await screen.findByText('授業を登録しました。')).toBeInTheDocument()
    expect(server.requests.find((r) => r.method === 'POST')?.body).toMatchObject({
      period: 1,
      academic_year: 2000,
    })
    const row = await waitFor(() => rowOf('線形代数'))
    expect(within(row).getByText('1限')).toBeInTheDocument()
    expect(within(row).getByText('2000年度')).toBeInTheDocument()
  })

  it('授業の編集でも上限超過・範囲外は送信しない', async () => {
    const server = setupFakeServer([COURSE_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('データベース論')
    await user.click(screen.getByRole('button', { name: '授業「データベース論」を編集' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/授業名/), { target: { value: `${NAME_32}あ` } })
    await user.clear(within(dialog).getByLabelText('年度'))
    await user.type(within(dialog).getByLabelText('年度'), '2101')
    await user.click(within(dialog).getByRole('button', { name: '更新する' }))

    expect(within(dialog).getByText('授業名は32文字以内で入力してください。')).toBeInTheDocument()
    expect(within(dialog).getByText('年度は2000〜2100の整数で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'PATCH')).toBe(false)
  })

  it('課題名・メモの上限超過は送信せず項目ごとに示し、上限ちょうどなら送信でき保存される', async () => {
    const server = setupFakeServer([COURSE_A])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await screen.findByText('課題は0件です。')
    await user.click(screen.getByRole('button', { name: '課題を追加' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/課題名/), { target: { value: `${NAME_32}あ` } })
    fireEvent.change(within(dialog).getByLabelText('メモ'), { target: { value: `${MEMO_1000}m` } })
    await user.click(within(dialog).getByRole('button', { name: '追加する' }))

    expect(within(dialog).getByText('課題名は32文字以内で入力してください。')).toBeInTheDocument()
    expect(within(dialog).getByText('メモは1000文字以内で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'POST')).toBe(false)

    fireEvent.change(within(dialog).getByLabelText(/課題名/), { target: { value: NAME_32 } })
    fireEvent.change(within(dialog).getByLabelText('メモ'), { target: { value: MEMO_1000 } })
    await user.click(within(dialog).getByRole('button', { name: '追加する' }))

    expect(await screen.findByText('課題を追加しました。')).toBeInTheDocument()
    expect(server.requests.find((r) => r.method === 'POST')?.body).toMatchObject({
      name: NAME_32,
      memo: MEMO_1000,
    })
    await waitFor(() => expect(assignmentRowOf(NAME_32)).toBeInTheDocument())
  })

  it('課題の編集でも上限超過は送信しない', async () => {
    const server = setupFakeServer([COURSE_A], [ASSIGNMENT_A])
    const user = userEvent.setup()

    renderPanel()
    await showAssignments(user, 'データベース論')
    await user.click(await screen.findByRole('button', { name: '課題「正規化レポート」を編集' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('メモ'), { target: { value: `${MEMO_1000}m` } })
    await user.click(within(dialog).getByRole('button', { name: '更新する' }))

    expect(within(dialog).getByText('メモは1000文字以内で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'PATCH')).toBe(false)
  })
})
