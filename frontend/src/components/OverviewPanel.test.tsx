import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'

import type { Company, InterviewStep, RunningWorkLog } from '../api/types'
import { OverviewPanel } from './OverviewPanel'

const BASE_URL = 'http://api.test.local:8000'
const API_KEY = 'valid-key'

const COMPANY_A: Company = { id: 1, name: '株式会社サンプル', is_deleted: false }
const COMPANY_B: Company = { id: 2, name: '合同会社テスト', is_deleted: false }

const STEP_A: InterviewStep = {
  id: 101,
  company_id: 1,
  type: '一次面接',
  date: '2026-03-01',
  prep_status: '準備中',
  result: '未定',
  memo: '初回面接',
  is_deleted: false,
}

const STEP_B: InterviewStep = {
  id: 102,
  company_id: 2,
  type: '書類選考',
  date: null,
  prep_status: '完了',
  result: '通過',
  memo: null,
  is_deleted: false,
}

const RUNNING_A: RunningWorkLog = {
  id: 1,
  task_id: 11,
  task_name: '要件整理',
  project_id: 21,
  project_name: 'ポートフォリオサイト制作',
  started_at: '2026-08-13T10:00:00',
  ended_at: null,
  memo: null,
  is_deleted: false,
}

const RUNNING_B: RunningWorkLog = {
  id: 2,
  task_id: 12,
  task_name: 'LPワイヤーフレーム',
  project_id: 22,
  project_name: 'LP制作',
  started_at: '2026-08-13T11:00:00',
  ended_at: null,
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
  companies: Company[]
  upcomingSteps: InterviewStep[]
  runningWorkLogs: RunningWorkLog[]
  requests: { method: string; url: string }[]
}

/** upcoming選考ステップ・企業一覧・進行中稼働ログ・計測終了までを模した簡易APIサーバー。 */
function setupFakeServer(
  companies: Company[],
  upcomingSteps: InterviewStep[],
  runningWorkLogs: RunningWorkLog[],
): FakeServer {
  const server: FakeServer = {
    companies: companies.map((c) => ({ ...c })),
    upcomingSteps: upcomingSteps.map((s) => ({ ...s })),
    runningWorkLogs: runningWorkLogs.map((w) => ({ ...w })),
    requests: [],
  }

  const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    server.requests.push({ method, url: `${url.pathname}${url.search}` })

    if (url.pathname === '/interview-steps/upcoming' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, server.upcomingSteps))
    }

    if (url.pathname === '/companies' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, server.companies))
    }

    if (url.pathname === '/work-logs/running' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, server.runningWorkLogs))
    }

    const stopMatch = /^\/work-logs\/(\d+)\/stop$/.exec(url.pathname)
    if (stopMatch !== null && method === 'PATCH') {
      const id = Number(stopMatch[1])
      const target = server.runningWorkLogs.find((w) => w.id === id)
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'WorkLog not found' }))
      }
      target.ended_at = '2026-08-13T12:00:00'
      server.runningWorkLogs = server.runningWorkLogs.filter((w) => w.id !== id)
      return Promise.resolve(
        jsonResponse(200, {
          id: target.id,
          task_id: target.task_id,
          started_at: target.started_at,
          ended_at: target.ended_at,
          memo: target.memo,
          is_deleted: target.is_deleted,
        }),
      )
    }

    return Promise.resolve(jsonResponse(404, { detail: 'Not Found' }))
  }

  vi.stubGlobal('fetch', vi.fn(handler))
  return server
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<OverviewPanel apiKey={API_KEY} />} />
        <Route
          path="/companies/:companyId"
          element={<RouteMarker label="企業詳細ページ" paramName="companyId" />}
        />
        <Route
          path="/projects/:projectId"
          element={<RouteMarker label="案件詳細ページ" paramName="projectId" />}
        />
        <Route
          path="/tasks/:projectId/:taskId"
          element={<RouteMarker label="タスク詳細ページ" paramName="taskId" />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

/** リンク遷移先に到達したことを確認するための簡易マーカー画面（実際の詳細画面の代わり）。 */
function RouteMarker({ label, paramName }: { label: string; paramName: string }) {
  const params = useParams()
  return (
    <div>
      {label}: {params[paramName]}
    </div>
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('予定の近い選考ステップ', () => {
  it('選考ステップ一覧が表示され、企業名・種別・予定日が分かる', async () => {
    setupFakeServer([COMPANY_A, COMPANY_B], [STEP_A, STEP_B], [])

    renderPanel()

    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(screen.getByText('株式会社サンプル')).toBeInTheDocument()
    expect(screen.getByText('一次面接')).toBeInTheDocument()
    expect(screen.getByText('2026-03-01')).toBeInTheDocument()
    expect(screen.getByText('合同会社テスト')).toBeInTheDocument()
    expect(screen.getByText('書類選考')).toBeInTheDocument()
    // STEP_Bは予定日が未設定のため「未定」と表示される（行に絞って確認）
    const stepBRow = screen.getByText('書類選考').closest('tr')!
    expect(within(stepBRow).getByText('未定')).toBeInTheDocument()
  })

  it('0件の場合も表示が破綻せず、0件であることが分かる', async () => {
    setupFakeServer([], [], [])

    renderPanel()

    // 選考ステップ・進行中稼働ログとも0件のため「取得件数: 0 件」が2箇所に出る
    expect(await screen.findAllByText('取得件数: 0 件')).toHaveLength(2)
    expect(screen.getByText('予定の近い選考ステップは0件です。')).toBeInTheDocument()
  })

  it('企業一覧の取得に失敗しても選考ステップは表示され、企業名の代わりに企業IDが表示される', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const pathname = new URL(String(input)).pathname
        if (pathname === '/interview-steps/upcoming') {
          return Promise.resolve(jsonResponse(200, [STEP_A]))
        }
        if (pathname === '/companies') {
          return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
        }
        return Promise.resolve(jsonResponse(200, []))
      }),
    )

    renderPanel()

    expect(await screen.findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(screen.getByText('企業ID: 1')).toBeInTheDocument()
    expect(
      screen.getByText(/企業名の取得に失敗したため、選考ステップの企業名は企業IDで表示します。/),
    ).toBeInTheDocument()
  })

  it('選考ステップ一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const pathname = new URL(String(input)).pathname
        if (pathname === '/interview-steps/upcoming') {
          return Promise.resolve(jsonResponse(401, { detail: 'Invalid or missing API Key' }))
        }
        if (pathname === '/work-logs/running') {
          // 進行中稼働ログ側を0件にすると案内Alertと衝突するため非0件にしておく
          return Promise.resolve(jsonResponse(200, [RUNNING_A]))
        }
        return Promise.resolve(jsonResponse(200, []))
      }),
    )

    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('401')
    expect(alert).toHaveTextContent('API Key')
  })

  it('「企業の詳細」から対応する企業の詳細画面へ辿れる', async () => {
    setupFakeServer([COMPANY_A, COMPANY_B], [STEP_A, STEP_B], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(screen.getByRole('link', { name: '企業「合同会社テスト」の詳細へ' }))

    expect(await screen.findByText(`企業詳細ページ: ${String(COMPANY_B.id)}`)).toBeInTheDocument()
  })
})

describe('進行中の稼働ログ', () => {
  it('進行中の稼働ログ一覧が表示され、案件・タスクが分かる', async () => {
    setupFakeServer([], [], [RUNNING_A, RUNNING_B])

    renderPanel()

    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(screen.getByText('ポートフォリオサイト制作')).toBeInTheDocument()
    expect(screen.getByText('要件整理')).toBeInTheDocument()
    expect(screen.getByText('LP制作')).toBeInTheDocument()
    expect(screen.getByText('LPワイヤーフレーム')).toBeInTheDocument()
  })

  it('0件の場合も表示が破綻せず、0件であることが分かる', async () => {
    setupFakeServer([], [], [])

    renderPanel()

    expect(await screen.findByText('進行中の稼働ログは0件です。')).toBeInTheDocument()
  })

  it('計測を終了でき、終了後は一覧に表示されなくなる', async () => {
    const server = setupFakeServer([COMPANY_A], [STEP_A], [RUNNING_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('要件整理')

    await user.click(
      screen.getByRole('button', {
        name: '「ポートフォリオサイト制作」「要件整理」の計測を終了',
      }),
    )

    expect(
      await screen.findByText('「ポートフォリオサイト制作」「要件整理」の計測を終了しました。'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText('進行中の稼働ログは0件です。')).toBeInTheDocument(),
    )
    expect(screen.queryByText('要件整理')).not.toBeInTheDocument()
    expect(
      server.requests.some((r) => r.method === 'PATCH' && r.url === '/work-logs/1/stop'),
    ).toBe(true)
  })

  it('進行中の稼働ログ一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const pathname = new URL(String(input)).pathname
        if (pathname === '/work-logs/running') {
          return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
        }
        if (pathname === '/interview-steps/upcoming') {
          // 選考ステップ側を0件にすると案内Alertと衝突するため非0件にしておく
          return Promise.resolve(jsonResponse(200, [STEP_A]))
        }
        return Promise.resolve(jsonResponse(200, []))
      }),
    )

    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('500')
  })

  it('「案件の詳細」「タスクの詳細」から対応する案件・タスクの詳細画面へ辿れる', async () => {
    setupFakeServer([], [], [RUNNING_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('要件整理')

    await user.click(screen.getByRole('link', { name: '案件「ポートフォリオサイト制作」の詳細へ' }))
    expect(
      await screen.findByText(`案件詳細ページ: ${String(RUNNING_A.project_id)}`),
    ).toBeInTheDocument()
  })

  it('「タスクの詳細」から対応するタスクの詳細画面へ辿れる', async () => {
    setupFakeServer([], [], [RUNNING_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('要件整理')

    await user.click(screen.getByRole('link', { name: 'タスク「要件整理」の詳細へ' }))
    expect(
      await screen.findByText(`タスク詳細ページ: ${String(RUNNING_A.task_id)}`),
    ).toBeInTheDocument()
  })
})

describe('横断一覧の独立性', () => {
  it('選考ステップと進行中稼働ログはそれぞれ独立に取得され、一方の0件がもう一方の表示に影響しない', async () => {
    setupFakeServer([COMPANY_A], [STEP_A], [])

    renderPanel()

    expect(await screen.findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(await screen.findByText('進行中の稼働ログは0件です。')).toBeInTheDocument()
    // 選考ステップ（1件）・進行中稼働ログ（0件）それぞれ独立に件数表示を持つ
    expect(
      within(screen.getByRole('region', { name: '横断一覧' })).getAllByText(/取得件数:/),
    ).toHaveLength(2)
  })
})
