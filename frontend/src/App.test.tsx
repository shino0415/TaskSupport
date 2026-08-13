import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import App from './App'
import { API_KEY_HEADER } from './api/client'
import { API_KEY_STORAGE_KEY } from './api/apiKeyStorage'
import type { Company, InterviewStep, Project, RunningWorkLog, Task } from './api/types'

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

const SAMPLE_COMPANY: Company = { id: 1, name: '株式会社サンプル', is_deleted: false }

const SAMPLE_TASK: Task = {
  id: 11,
  project_id: 1,
  name: '要件整理',
  status: '処理中',
  memo: null,
  is_deleted: false,
}

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

const SAMPLE_RUNNING_WORK_LOG: RunningWorkLog = {
  id: 1,
  task_id: SAMPLE_TASK.id,
  task_name: SAMPLE_TASK.name,
  project_id: SAMPLE_PROJECT.id,
  project_name: SAMPLE_PROJECT.name,
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

// App にはタスク管理画面（TasksPanel）も同居し、同じ /projects を独自に取得するため、
// 案件管理画面固有の表示確認は「案件管理」領域に絞って検証する。
function projectsRegion() {
  return screen.getByRole('region', { name: '案件管理' })
}

// 案件管理画面（ProjectsPanel）は「案件ページ」（/projects）上にあるため、
// その画面固有の疎通・エラー表示の確認はこのページを開いた状態でレンダリングする。
function renderProjectsPage() {
  window.history.pushState(null, '', '/projects')
  render(<App />)
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
  it('API Key未入力なら入力を促し、APIを呼ばない', () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)

    expect(screen.getByRole('heading', { name: '案件・選考トラッカー' })).toBeInTheDocument()
    expect(screen.getByText(/API Keyを入力すると/)).toBeInTheDocument()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('接続先（環境変数の値）を画面に表示する', () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)

    expect(screen.getByText(`接続先: ${BASE_URL}`)).toBeInTheDocument()
  })
})

describe('API Keyを入力しての疎通', () => {
  it('入力したキーで認証付きリクエストし、取得内容を表示する', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_PROJECT])))
    const user = userEvent.setup()

    renderProjectsPage()
    await user.type(screen.getByLabelText('API Key'), 'valid-key')
    await user.click(screen.getByRole('button', { name: '保存して接続' }))

    // 「案件ページ」にはタスク管理・稼働計測の各画面も同居し、同じ /projects や
    // 同型のレスポンスを独自に取得するため、案件管理画面固有の表示確認は
    // 「案件管理」領域に絞って検証する。
    expect(await within(projectsRegion()).findByText('ポートフォリオサイト制作')).toBeInTheDocument()
    expect(within(projectsRegion()).getByText('取得件数: 1 件')).toBeInTheDocument()
    const projectsCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => url === `${BASE_URL}/projects`)
    expect(projectsCall).toBeDefined()
    const [url, init] = projectsCall!
    expect(url).toBe(`${BASE_URL}/projects`)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers[API_KEY_HEADER]).toBe('valid-key')
  })

  it('入力したキーをsessionStorageに保持する', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))
    const user = userEvent.setup()

    renderProjectsPage()
    await user.type(screen.getByLabelText('API Key'), 'valid-key')
    await user.click(screen.getByRole('button', { name: '保存して接続' }))

    await waitFor(() =>
      expect(window.sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBe('valid-key'),
    )
    expect(window.localStorage.length).toBe(0)
  })

  it('保持済みのキーがあればリロード後も再入力なしで取得する', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_PROJECT])))

    renderProjectsPage()

    expect(await within(projectsRegion()).findByText('ポートフォリオサイト制作')).toBeInTheDocument()
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers[API_KEY_HEADER]).toBe('saved-key')
  })

  it('クリアすると保持したキーを破棄して未入力状態に戻る', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))
    const user = userEvent.setup()

    renderProjectsPage()
    await within(projectsRegion()).findByText('取得件数: 0 件')
    await user.click(screen.getByRole('button', { name: 'クリア' }))

    expect(window.sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull()
    expect(await screen.findByText(/API Keyを入力すると/)).toBeInTheDocument()
  })

  it('0件でも表示が破綻せず0件と分かる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    renderProjectsPage()

    expect(await within(projectsRegion()).findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(within(projectsRegion()).getByText('案件は0件です。')).toBeInTheDocument()
  })
})

describe('エラー表示', () => {
  it('認証エラー時はAPI Keyが原因と分かるメッセージを表示する', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'wrong-key')
    stubFetch(() => Promise.resolve(jsonResponse(401, { detail: 'Invalid or missing API Key' })))

    renderProjectsPage()

    const alert = await within(projectsRegion()).findByRole('alert')
    expect(alert).toHaveTextContent('401')
    expect(alert).toHaveTextContent('API Key')
  })

  it('通信失敗時は接続先・CORSの確認を促すメッセージを表示する', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    renderProjectsPage()

    const alert = await within(projectsRegion()).findByRole('alert')
    expect(alert).toHaveTextContent(BASE_URL)
    expect(alert).toHaveTextContent('CORS')
  })

  it('接続先が未設定なら環境変数の設定不足と分かるメッセージを表示する', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    renderProjectsPage()

    expect(await within(projectsRegion()).findByRole('alert')).toHaveTextContent(
      'VITE_API_BASE_URL',
    )
  })

  it('再読み込みで復旧できる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    let shouldFail = true
    stubFetch(() =>
      shouldFail
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(jsonResponse(200, [SAMPLE_PROJECT])),
    )
    const user = userEvent.setup()

    renderProjectsPage()
    await within(projectsRegion()).findByRole('alert')

    shouldFail = false
    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    expect(await screen.findByText('ポートフォリオサイト制作')).toBeInTheDocument()
    expect(within(projectsRegion()).queryByRole('alert')).not.toBeInTheDocument()
  })
})

/** 横断一覧からの遷移確認用に、案件・タスク・企業・選考ステップ・進行中稼働ログを一通り揃えた簡易APIサーバー。 */
function stubRoutingFetch() {
  stubFetch((input: RequestInfo | URL) => {
    const pathname = new URL(String(input)).pathname
    if (pathname === '/projects') {
      return Promise.resolve(jsonResponse(200, [SAMPLE_PROJECT]))
    }
    if (pathname === `/projects/${String(SAMPLE_PROJECT.id)}`) {
      return Promise.resolve(jsonResponse(200, SAMPLE_PROJECT))
    }
    if (pathname === `/projects/${String(SAMPLE_PROJECT.id)}/tasks`) {
      return Promise.resolve(jsonResponse(200, [SAMPLE_TASK]))
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
    if (pathname === '/work-logs/running') {
      return Promise.resolve(jsonResponse(200, [SAMPLE_RUNNING_WORK_LOG]))
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
    await within(overviewRegion()).findByText('一次面接')
    await user.click(
      within(overviewRegion()).getByRole('link', { name: '企業「株式会社サンプル」の詳細へ' }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('企業詳細（ID: 1）')).toBeInTheDocument()
    expect(await within(dialog).findByText('株式会社サンプル')).toBeInTheDocument()
  })

  it('進行中の稼働ログの「案件の詳細」から、対応する案件の詳細画面へ辿れる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    const user = userEvent.setup()

    render(<App />)
    await within(overviewRegion()).findByText('要件整理')
    await user.click(
      within(overviewRegion()).getByRole('link', {
        name: '案件「ポートフォリオサイト制作」の詳細へ',
      }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('案件詳細（ID: 1）')).toBeInTheDocument()
    expect(await within(dialog).findByText('CrowdWorks')).toBeInTheDocument()
  })

  it('進行中の稼働ログの「タスクの詳細」から、対応するタスクの詳細画面（タスク管理）へ辿れる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    const user = userEvent.setup()

    render(<App />)
    await within(overviewRegion()).findByText('要件整理')
    await user.click(
      within(overviewRegion()).getByRole('link', { name: 'タスク「要件整理」の詳細へ' }),
    )

    const tasksRegion = screen.getByRole('region', { name: 'タスク管理' })
    expect(await within(tasksRegion).findByText('取得件数: 1 件')).toBeInTheDocument()
    const highlightedRow = within(tasksRegion).getByText('要件整理').closest('tr')!
    expect(highlightedRow).toHaveAttribute('aria-current', 'true')
    expect(within(highlightedRow).getByText('対象のタスク')).toBeInTheDocument()
  })
})

function navBar() {
  return screen.getByRole('navigation', { name: 'ページナビゲーション' })
}

describe('画面構成の分割とナビゲーション', () => {
  it('アプリを開くと横断一覧画面が表示される', () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)

    expect(overviewRegion()).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '案件管理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '選考管理' })).not.toBeInTheDocument()
  })

  it('ナビゲーションバーはどの画面でも表示され、クリックで案件ページ・選考ページへ切り替えられる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    const user = userEvent.setup()

    render(<App />)
    expect(navBar()).toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '案件ページ' }))
    expect(await screen.findByRole('region', { name: '案件管理' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'タスク管理' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '稼働計測・時給換算' })).toBeInTheDocument()
    expect(navBar()).toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '選考ページ' }))
    expect(await screen.findByRole('region', { name: '選考管理' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '案件管理' })).not.toBeInTheDocument()
    expect(navBar()).toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '横断一覧' }))
    expect(overviewRegion()).toBeInTheDocument()
  })

  it('「案件ページ」「選考ページ」は固有のURLを持ち、直接開いても同じ画面が表示される', () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()

    window.history.pushState(null, '', '/projects')
    const { unmount } = render(<App />)
    expect(screen.getByRole('region', { name: '案件管理' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'タスク管理' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '稼働計測・時給換算' })).toBeInTheDocument()
    unmount()

    window.history.pushState(null, '', '/companies')
    render(<App />)
    expect(screen.getByRole('region', { name: '選考管理' })).toBeInTheDocument()
  })

  it('存在しないURLを開いても画面が壊れず横断一覧に案内される', () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    window.history.pushState(null, '', '/no-such-page')
    render(<App />)

    expect(overviewRegion()).toBeInTheDocument()
  })

  it('ブラウザの「戻る」「進む」操作でも対応するページが表示される', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    const user = userEvent.setup()

    render(<App />)
    expect(overviewRegion()).toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '案件ページ' }))
    expect(await screen.findByRole('region', { name: '案件管理' })).toBeInTheDocument()

    await user.click(within(navBar()).getByRole('link', { name: '選考ページ' }))
    expect(await screen.findByRole('region', { name: '選考管理' })).toBeInTheDocument()

    window.history.back()
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '案件管理' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('region', { name: '選考管理' })).not.toBeInTheDocument()

    window.history.forward()
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '選考管理' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('region', { name: '案件管理' })).not.toBeInTheDocument()
  })
})

// ページ分割後も、横断一覧の各リンク先URL（/companies/:id・/projects/:id・/tasks/:id/:id）を
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
    expect(screen.getByRole('region', { name: '選考管理', hidden: true })).toBeInTheDocument()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('企業詳細（ID: 1）')).toBeInTheDocument()
    expect(await within(dialog).findByText('株式会社サンプル')).toBeInTheDocument()
  })

  it('案件詳細のURLを直接開くと、案件ページ上に対応する案件詳細ダイアログが開いた状態で表示される', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    window.history.pushState(null, '', '/projects/1')

    render(<App />)

    // ダイアログが開くとMUIが背景をaria-hiddenにするため、背景側の要素は
    // hidden: true を指定して（アクセシビリティツリー上は非表示のまま）存在のみ確認する。
    expect(screen.getByRole('region', { name: '案件管理', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'タスク管理', hidden: true })).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: '稼働計測・時給換算', hidden: true }),
    ).toBeInTheDocument()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('案件詳細（ID: 1）')).toBeInTheDocument()
    expect(await within(dialog).findByText('CrowdWorks')).toBeInTheDocument()
  })

  it('タスク詳細のURLを直接開くと、案件ページのタスク管理で対象タスクが分かる状態で表示される', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubRoutingFetch()
    window.history.pushState(null, '', `/tasks/${String(SAMPLE_PROJECT.id)}/${String(SAMPLE_TASK.id)}`)

    render(<App />)

    expect(screen.getByRole('region', { name: '案件管理' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '稼働計測・時給換算' })).toBeInTheDocument()
    const tasksRegion = screen.getByRole('region', { name: 'タスク管理' })
    expect(await within(tasksRegion).findByText('取得件数: 1 件')).toBeInTheDocument()
    const highlightedRow = within(tasksRegion).getByText('要件整理').closest('tr')!
    expect(highlightedRow).toHaveAttribute('aria-current', 'true')
    expect(within(highlightedRow).getByText('対象のタスク')).toBeInTheDocument()
  })
})
