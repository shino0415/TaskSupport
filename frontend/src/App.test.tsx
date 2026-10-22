import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import App from './App'
import { API_KEY_HEADER } from './api/client'
import { API_KEY_STORAGE_KEY } from './api/apiKeyStorage'
import type { Company, Course, InterviewStep, UpcomingAssignment } from './api/types'

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

const SAMPLE_COMPANY: Company = { id: 1, name: '株式会社サンプル', is_deleted: false }

const SAMPLE_STEP: InterviewStep = {
  id: 101,
  company_id: 1,
  type: '一次面接',
  date: '2026-09-01',
  prep_status: '準備中',
  result: '未定',
  memo: null,
  is_deleted: false,
}

const SAMPLE_UPCOMING_ASSIGNMENT: UpcomingAssignment = {
  id: 201,
  course_id: 1,
  name: '正規化レポート',
  status: '未提出',
  deadline: '2099-11-01T23:59:00',
  submission_method: 'WebClass',
  memo: null,
  is_deleted: false,
  course_name: 'データベース論',
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

function findOverviewRegion() {
  return screen.findByRole('region', { name: '横断一覧' })
}

function coursesRegion() {
  return screen.getByRole('region', { name: '授業管理' })
}

// 授業管理画面（CoursesPanel）は「授業ページ」（/courses）上にあるため、
// その画面固有の疎通・エラー表示の確認はこのページを開いた状態でレンダリングする。
// ページは遅延読み込みのため、授業管理画面が表示されるまで待ってから返す。
async function renderCoursesPage() {
  window.history.pushState(null, '', '/courses')
  render(<App />)
  await screen.findByRole('region', { name: '授業管理' })
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  window.sessionStorage.clear()
  // ルーティングのテストが遷移した後のURLを引きずらないよう、毎回トップに戻す
  window.history.pushState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  window.history.pushState(null, '', '/')
})

describe('初期画面', () => {
  it('API Key未入力なら入力を促し、APIを呼ばない', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)
    await findOverviewRegion()

    expect(screen.getByRole('heading', { name: '授業タスク・選考トラッカー' })).toBeInTheDocument()
    expect(screen.getByText(/API Keyを入力すると/)).toBeInTheDocument()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('接続先（環境変数の値）を画面に表示する', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)
    await findOverviewRegion()

    expect(screen.getByText(`接続先: ${BASE_URL}`)).toBeInTheDocument()
  })
})

describe('API Keyを入力しての疎通', () => {
  it('入力したキーで認証付きリクエストし、取得内容を表示する', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_COURSE])))
    const user = userEvent.setup()

    await renderCoursesPage()
    await user.type(screen.getByLabelText('API Key'), 'valid-key')
    await user.click(screen.getByRole('button', { name: '保存して接続' }))

    expect(await within(coursesRegion()).findByText('データベース論')).toBeInTheDocument()
    expect(within(coursesRegion()).getByText('取得件数: 1 件')).toBeInTheDocument()
    const coursesCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => url === `${BASE_URL}/courses`)
    expect(coursesCall).toBeDefined()
    const [url, init] = coursesCall!
    expect(url).toBe(`${BASE_URL}/courses`)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers[API_KEY_HEADER]).toBe('valid-key')
  })

  it('入力したキーをsessionStorageに保持する', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))
    const user = userEvent.setup()

    await renderCoursesPage()
    await user.type(screen.getByLabelText('API Key'), 'valid-key')
    await user.click(screen.getByRole('button', { name: '保存して接続' }))

    await waitFor(() =>
      expect(window.sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBe('valid-key'),
    )
    expect(window.localStorage.length).toBe(0)
  })

  it('保持済みのキーがあればリロード後も再入力なしで取得する', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_COURSE])))

    await renderCoursesPage()

    expect(await within(coursesRegion()).findByText('データベース論')).toBeInTheDocument()
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers[API_KEY_HEADER]).toBe('saved-key')
  })

  it('クリアすると保持したキーを破棄して未入力状態に戻る', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))
    const user = userEvent.setup()

    await renderCoursesPage()
    await within(coursesRegion()).findByText('取得件数: 0 件')
    await user.click(screen.getByRole('button', { name: 'クリア' }))

    expect(window.sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull()
    expect(await screen.findByText(/API Keyを入力すると/)).toBeInTheDocument()
  })

  it('保持済みのキーが入力欄に入った状態で表示され、クリアすると入力欄も空になる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))
    const user = userEvent.setup()

    await renderCoursesPage()
    await within(coursesRegion()).findByText('取得件数: 0 件')
    expect(screen.getByLabelText('API Key')).toHaveValue('saved-key')
    await user.click(screen.getByRole('button', { name: 'クリア' }))

    expect(screen.getByLabelText('API Key')).toHaveValue('')
  })

  it('0件でも表示が破綻せず0件と分かる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    await renderCoursesPage()

    expect(await within(coursesRegion()).findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(within(coursesRegion()).getByText('授業は0件です。')).toBeInTheDocument()
  })
})

describe('エラー表示', () => {
  it('認証エラー時はAPI Keyが原因と分かるメッセージを表示する', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'wrong-key')
    stubFetch(() => Promise.resolve(jsonResponse(401, { detail: 'Invalid or missing API Key' })))

    await renderCoursesPage()

    const alert = await within(coursesRegion()).findByRole('alert')
    expect(alert).toHaveTextContent('401')
    expect(alert).toHaveTextContent('API Key')
  })

  it('通信失敗時は接続先・CORSの確認を促すメッセージを表示する', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    await renderCoursesPage()

    const alert = await within(coursesRegion()).findByRole('alert')
    expect(alert).toHaveTextContent(BASE_URL)
    expect(alert).toHaveTextContent('CORS')
  })

  it('接続先が未設定なら環境変数の設定不足と分かるメッセージを表示する', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    await renderCoursesPage()

    expect(await within(coursesRegion()).findByRole('alert')).toHaveTextContent(
      'VITE_API_BASE_URL',
    )
  })

  it('再読み込みで復旧できる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    let shouldFail = true
    stubFetch(() =>
      shouldFail
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(jsonResponse(200, [SAMPLE_COURSE])),
    )
    const user = userEvent.setup()

    await renderCoursesPage()
    await within(coursesRegion()).findByRole('alert')

    shouldFail = false
    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    expect(await screen.findByText('データベース論')).toBeInTheDocument()
    expect(within(coursesRegion()).queryByRole('alert')).not.toBeInTheDocument()
  })
})

/** 画面遷移の確認用に、授業・企業・選考ステップを一通り揃えた簡易APIサーバー。 */
function stubRoutingFetch() {
  stubFetch((input: RequestInfo | URL) => {
    const pathname = new URL(String(input)).pathname
    if (pathname === '/courses') {
      return Promise.resolve(jsonResponse(200, [SAMPLE_COURSE]))
    }
    if (pathname === '/companies') {
      return Promise.resolve(jsonResponse(200, [SAMPLE_COMPANY]))
    }
    if (pathname === `/companies/${String(SAMPLE_COMPANY.id)}`) {
      return Promise.resolve(jsonResponse(200, SAMPLE_COMPANY))
    }
    if (pathname === '/interview-steps/upcoming') {
      return Promise.resolve(jsonResponse(200, [SAMPLE_STEP]))
    }
    if (pathname === '/assignments/upcoming') {
      return Promise.resolve(jsonResponse(200, [SAMPLE_UPCOMING_ASSIGNMENT]))
    }
    if (pathname === `/courses/${String(SAMPLE_COURSE.id)}/assignments`) {
      const { course_name: _courseName, ...assignment } = SAMPLE_UPCOMING_ASSIGNMENT
      return Promise.resolve(jsonResponse(200, [assignment]))
    }
    return Promise.resolve(jsonResponse(404, { detail: 'Not Found' }))
  })
}

// 横断一覧（OverviewPanel）の一覧
function overviewRegion() {
  return screen.getByRole('region', { name: '横断一覧' })
}

describe('横断一覧からの画面遷移', () => {
  it('選考ステップの「企業の詳細」から、対応する企業の詳細画面へ辿れる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    const user = userEvent.setup()

    render(<App />)
    await within(await findOverviewRegion()).findByText('一次面接')
    await user.click(
      within(overviewRegion()).getByRole('link', { name: '企業「株式会社サンプル」の詳細へ' }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('企業詳細（ID: 1）')).toBeInTheDocument()
    expect(await within(dialog).findByText('株式会社サンプル')).toBeInTheDocument()
  })
})

describe('締切が近い課題からの画面遷移', () => {
  it('課題の項目から、授業ページで該当授業の課題一覧が開いた状態へ辿れる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    const user = userEvent.setup()

    render(<App />)
    const assignmentsSection = within(await findOverviewRegion()).getByRole('region', {
      name: '締切が近い課題',
    })
    await within(assignmentsSection).findByText('正規化レポート')
    await user.click(
      within(assignmentsSection).getByRole('link', {
        name: '課題「正規化レポート」の授業「データベース論」の課題一覧へ',
      }),
    )

    expect(window.location.pathname).toBe('/courses/1')
    expect(await within(coursesRegion()).findByText('課題（データベース論）')).toBeInTheDocument()
    expect(await within(coursesRegion()).findByText('正規化レポート')).toBeInTheDocument()
    expect(within(navBar()).getByRole('link', { name: '授業ページ' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('授業を指定したURLを直接開いても、該当授業の課題一覧が開いた状態で表示される', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    window.history.pushState(null, '', '/courses/1')

    render(<App />)
    await screen.findByRole('region', { name: '授業管理' })

    expect(await within(coursesRegion()).findByText('課題（データベース論）')).toBeInTheDocument()
    expect(await within(coursesRegion()).findByText('正規化レポート')).toBeInTheDocument()
  })
})

function navBar() {
  return screen.getByRole('navigation', { name: 'ページナビゲーション' })
}

describe('画面構成の分割とナビゲーション', () => {
  it('アプリを開くと横断一覧画面が表示される', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)

    expect(await findOverviewRegion()).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '授業管理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '選考管理' })).not.toBeInTheDocument()
  })

  it('ナビゲーションバーに「案件ページ」は無く、どの画面でも表示され、クリックで授業ページ・選考ページへ切り替えられる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    const user = userEvent.setup()

    render(<App />)
    expect(navBar()).toBeInTheDocument()
    expect(within(navBar()).queryByRole('link', { name: '案件ページ' })).not.toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '授業ページ' }))
    expect(await screen.findByRole('region', { name: '授業管理' })).toBeInTheDocument()
    expect(await within(coursesRegion()).findByText('データベース論')).toBeInTheDocument()
    expect(navBar()).toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '選考ページ' }))
    expect(await screen.findByRole('region', { name: '選考管理' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '授業管理' })).not.toBeInTheDocument()
    expect(navBar()).toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '横断一覧' }))
    expect(await findOverviewRegion()).toBeInTheDocument()
  })

  it('「授業ページ」「選考ページ」は固有のURLを持ち、直接開いても同じ画面が表示される', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()

    window.history.pushState(null, '', '/courses')
    const { unmount } = render(<App />)
    expect(await screen.findByRole('region', { name: '授業管理' })).toBeInTheDocument()
    expect(
      within(navBar()).getByRole('link', { name: '授業ページ' }),
    ).toHaveAttribute('aria-current', 'page')
    unmount()

    window.history.pushState(null, '', '/companies')
    render(<App />)
    expect(await screen.findByRole('region', { name: '選考管理' })).toBeInTheDocument()
  })

  it('存在しないURLを開いても画面が壊れず横断一覧に案内される', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    window.history.pushState(null, '', '/no-such-page')
    render(<App />)

    expect(await findOverviewRegion()).toBeInTheDocument()
  })

  it('ブラウザの「戻る」「進む」操作でも対応するページが表示される', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    const user = userEvent.setup()

    render(<App />)
    expect(await findOverviewRegion()).toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '授業ページ' }))
    expect(await screen.findByRole('region', { name: '授業管理' })).toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '選考ページ' }))
    expect(await screen.findByRole('region', { name: '選考管理' })).toBeInTheDocument()

    window.history.back()
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '授業管理' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('region', { name: '選考管理' })).not.toBeInTheDocument()

    window.history.forward()
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '選考管理' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('region', { name: '授業管理' })).not.toBeInTheDocument()
  })
})

// ページ分割後も、横断一覧のリンク先URL（/companies/:id）を
// クリックを介さず直接開いた場合に同じ詳細が表示されることを検証する。
// BrowserRouterは現在のlocationを初期状態として描画するため、この手順は
// 「URLを直接開く」操作・「再読み込みする」操作のいずれとも同一の初期描画過程をたどる
// （「画面構成の分割とナビゲーション」describeの「直接開いても同じ画面が表示される」と同じ考え方）。
describe('詳細ダイアログへのディープリンク（新しいページ構成でのURL直接オープン）', () => {
  it('企業詳細のURLを直接開くと、選考ページ上に対応する企業詳細ダイアログが開いた状態で表示される', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    window.history.pushState(null, '', '/companies/1')

    render(<App />)

    // ダイアログが開くとMUIが背景をaria-hiddenにするため、背景側の要素は
    // hidden: true を指定して（アクセシビリティツリー上は非表示のまま）存在のみ確認する。
    expect(
      await screen.findByRole('region', { name: '選考管理', hidden: true }),
    ).toBeInTheDocument()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('企業詳細（ID: 1）')).toBeInTheDocument()
    expect(await within(dialog).findByText('株式会社サンプル')).toBeInTheDocument()
  })
})

describe('廃止した旧案件系の画面', () => {
  it.each(['/projects', '/projects/1', '/tasks/1/11'])(
    '旧案件系のURL（%s）を開いても画面が壊れず横断一覧に案内され、廃止済みAPIを呼ばない',
    async (path) => {
      window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
      stubRoutingFetch()
      window.history.pushState(null, '', path)

      render(<App />)

      expect(await findOverviewRegion()).toBeInTheDocument()
      expect(window.location.pathname).toBe('/')
      expect(await within(overviewRegion()).findByText('一次面接')).toBeInTheDocument()
      const requestedPaths = vi
        .mocked(fetch)
        .mock.calls.map(([input]) => new URL(String(input)).pathname)
      expect(requestedPaths.filter((p) => /^\/(projects|tasks|work-logs)(\/|$)/.test(p))).toEqual(
        [],
      )
    },
  )

  it('トップページに「計測中の作業」「進行中の稼働ログ」は無く、「直近の選考ステップ」は表示される', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()

    render(<App />)

    expect(await within(await findOverviewRegion()).findByText('一次面接')).toBeInTheDocument()
    expect(within(overviewRegion()).getByText('予定の近い選考ステップ')).toBeInTheDocument()
    expect(screen.queryByText(/計測中の作業|進行中の稼働ログ/)).not.toBeInTheDocument()
    const requestedPaths = vi
      .mocked(fetch)
      .mock.calls.map(([input]) => new URL(String(input)).pathname)
    expect(requestedPaths.filter((p) => /^\/(projects|tasks|work-logs)(\/|$)/.test(p))).toEqual(
      [],
    )
  })
})

describe('URLパラメータのid検証', () => {
  const INVALID_IDS = [
    '0',
    '-1',
    '1.5',
    '1e2',
    '0x10',
    'abc',
    '9007199254740992',
    '9'.repeat(25),
    '9'.repeat(400),
  ]

  function requestedPaths(): string[] {
    return vi
      .mocked(fetch)
      .mock.calls.map(([input]) => new URL(String(input)).pathname)
  }

  it.each(INVALID_IDS)(
    '授業を指定したURLのidが正の整数でない（%s）場合、そのidでAPIを呼ばずに授業ページへ案内する',
    async (invalidId) => {
      window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
      stubRoutingFetch()
      window.history.pushState(null, '', `/courses/${invalidId}`)

      render(<App />)
      await screen.findByRole('region', { name: '授業管理' })

      expect(await within(coursesRegion()).findByText('データベース論')).toBeInTheDocument()
      expect(window.location.pathname).toBe('/courses')
      expect(within(coursesRegion()).queryByText('課題（データベース論）')).not.toBeInTheDocument()
      expect(requestedPaths().filter((path) => path.startsWith('/courses/'))).toEqual([])
    },
  )

  it.each(INVALID_IDS)(
    '企業を指定したURLのidが正の整数でない（%s）場合、そのidでAPIを呼ばずに選考ページへ案内する',
    async (invalidId) => {
      window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
      stubRoutingFetch()
      window.history.pushState(null, '', `/companies/${invalidId}`)

      render(<App />)

      const region = await screen.findByRole('region', { name: '選考管理' })
      expect(await within(region).findByText('株式会社サンプル')).toBeInTheDocument()
      expect(window.location.pathname).toBe('/companies')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(requestedPaths().filter((path) => path.startsWith('/companies/'))).toEqual([])
    },
  )
})

describe('ページの遅延読み込み', () => {
  it.each([
    ['/', '横断一覧'],
    ['/courses', '授業管理'],
    ['/companies', '選考管理'],
  ])('ページ（%s）のコードを読み込んでいる間はスピナーを表示し、読み込み後にページを表示する', async (path, regionName) => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    window.history.pushState(null, '', path)
    // 遅延読み込みしたページはモジュール単位でキャッシュされるため、
    // 未読み込みの状態を再現するようAppをモジュールごと読み込み直す
    vi.resetModules()
    const { default: FreshApp } = await import('./App')

    render(<FreshApp />)

    expect(screen.getByRole('progressbar', { name: 'ページを読み込み中' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: regionName })).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'ページナビゲーション' })).toBeInTheDocument()

    expect(await screen.findByRole('region', { name: regionName })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { name: 'ページを読み込み中' })).not.toBeInTheDocument()
  })
})
