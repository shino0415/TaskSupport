import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'

import type { Company, InterviewStep, UpcomingAssignment } from '../api/types'
import { OverviewPanel } from './OverviewPanel'

const BASE_URL = 'http://api.test.local:8000'
const API_KEY = 'valid-key'

const COMPANY_A: Company = { id: 1, name: '株式会社サンプル', status: '選考中', is_deleted: false }
const COMPANY_B: Company = { id: 2, name: '合同会社テスト', status: 'インターン参加', is_deleted: false }

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
  prep_status: '準備万端',
  result: '未定',
  memo: null,
  is_deleted: false,
}

const ASSIGNMENT_OVERDUE: UpcomingAssignment = {
  id: 201,
  course_id: 3,
  name: '正規化レポート',
  status: '未提出',
  deadline: '2000-01-10T23:59:00',
  submission_method: 'WebClass',
  memo: null,
  is_deleted: false,
  course_name: 'データベース論',
}

const ASSIGNMENT_FUTURE: UpcomingAssignment = {
  id: 202,
  course_id: 4,
  name: 'ER図の作成',
  status: '取組中',
  deadline: '2099-12-31T09:00:00',
  submission_method: null,
  memo: null,
  is_deleted: false,
  course_name: 'ソフトウェア工学',
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
  upcomingAssignments: UpcomingAssignment[]
  requests: { method: string; url: string }[]
}

const UPCOMING_COMPANY_STATUSES: readonly Company['status'][] = ['選考中', 'インターン参加']

/** テストデータが GET /interview-steps/upcoming の絞り込み規則と食い違っていないことを保証する。 */
function assertMatchesUpcomingRule(companies: Company[], steps: InterviewStep[]) {
  for (const step of steps) {
    const company = companies.find((c) => c.id === step.company_id)
    if (
      step.result !== '未定' ||
      step.prep_status === '完了' ||
      company === undefined ||
      !UPCOMING_COMPANY_STATUSES.includes(company.status)
    ) {
      throw new Error(`step ${String(step.id)} は upcoming の規則に合わないテストデータです`)
    }
  }
}

/** upcoming選考ステップ・企業一覧・upcoming課題を模した簡易APIサーバー。 */
function setupFakeServer(
  companies: Company[],
  upcomingSteps: InterviewStep[],
  upcomingAssignments: UpcomingAssignment[] = [],
): FakeServer {
  assertMatchesUpcomingRule(companies, upcomingSteps)
  const server: FakeServer = {
    companies: companies.map((c) => ({ ...c })),
    upcomingSteps: upcomingSteps.map((s) => ({ ...s })),
    upcomingAssignments: upcomingAssignments.map((a) => ({ ...a })),
    requests: [],
  }

  const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    server.requests.push({ method, url: `${url.pathname}${url.search}` })

    if (url.pathname === '/interview-steps/upcoming' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, server.upcomingSteps))
    }

    if (url.pathname === '/assignments/upcoming' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, server.upcomingAssignments))
    }

    if (url.pathname === '/companies' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, server.companies))
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
          path="/courses/:courseId"
          element={<RouteMarker label="授業ページ" paramName="courseId" />}
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

function stepsSection() {
  return screen.getByRole('region', { name: '予定の近い選考ステップ' })
}

async function findStepsSection() {
  return screen.findByRole('region', { name: '予定の近い選考ステップ' })
}

function assignmentsSection() {
  return screen.getByRole('region', { name: '締切が近い課題' })
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
    setupFakeServer([COMPANY_A, COMPANY_B], [STEP_A, STEP_B])

    renderPanel()

    expect(await within(await findStepsSection()).findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(within(stepsSection()).getByText('株式会社サンプル')).toBeInTheDocument()
    expect(within(stepsSection()).getByText('一次面接')).toBeInTheDocument()
    expect(within(stepsSection()).getByText('2026-03-01')).toBeInTheDocument()
    expect(within(stepsSection()).getByText('合同会社テスト')).toBeInTheDocument()
    expect(within(stepsSection()).getByText('書類選考')).toBeInTheDocument()
    // APIが返した順（予定日なしは末尾）のまま並ぶ
    const rows = within(stepsSection()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('一次面接')).toBeInTheDocument()
    expect(within(rows[1]).getByText('書類選考')).toBeInTheDocument()
    // STEP_Bは予定日が未設定のため予定日の列に「未定」と表示される（結果の列も「未定」なので列で絞る）
    const stepBCells = within(rows[1]).getAllByRole('cell')
    expect(stepBCells[2]).toHaveTextContent(/^未定$/)
    expect(within(rows[0]).getAllByRole('cell')[2]).toHaveTextContent(/^2026-03-01$/)
  })

  it('0件の場合も表示が破綻せず、0件であることが分かる', async () => {
    setupFakeServer([], [])

    renderPanel()

    expect(await within(await findStepsSection()).findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(within(stepsSection()).getByText('予定の近い選考ステップは0件です。')).toBeInTheDocument()
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

    expect(await within(await findStepsSection()).findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(within(stepsSection()).getByText('企業ID: 1')).toBeInTheDocument()
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
        return Promise.resolve(jsonResponse(200, []))
      }),
    )

    renderPanel()

    const alert = await within(await findStepsSection()).findByRole('alert')
    expect(alert).toHaveTextContent('401')
    expect(alert).toHaveTextContent('API Key')
  })

  it('「企業の詳細」から対応する企業の詳細画面へ辿れる', async () => {
    setupFakeServer([COMPANY_A, COMPANY_B], [STEP_A, STEP_B])
    const user = userEvent.setup()

    renderPanel()
    await within(await findStepsSection()).findByText('取得件数: 2 件')
    await user.click(within(stepsSection()).getByRole('link', { name: '企業「合同会社テスト」の詳細へ' }))

    expect(await screen.findByText(`企業詳細ページ: ${String(COMPANY_B.id)}`)).toBeInTheDocument()
  })
})

describe('廃止した稼働計測の表示', () => {
  it('「進行中の稼働ログ」は表示されず、廃止済みの案件系APIへのリクエストも発生しない', async () => {
    const server = setupFakeServer([COMPANY_A], [STEP_A])

    renderPanel()

    expect(await within(await findStepsSection()).findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(screen.queryByText(/稼働ログ/)).not.toBeInTheDocument()
    expect(screen.queryByText(/計測中/)).not.toBeInTheDocument()
    expect(server.requests.length).toBeGreaterThan(0)
    expect(
      server.requests.filter((r) => /^\/(work-logs|projects|tasks)(\/|\?|$)/.test(r.url)),
    ).toEqual([])
  })
})

describe('締切が近い課題', () => {
  it('課題名・授業名・提出期限・ステータスが、APIが返す順（期限切れを含む）で表示される', async () => {
    // APIは期限の早い順に返す。画面側で並べ替えないことを確かめるため、そのままの順序を検証する
    const server = setupFakeServer([], [], [ASSIGNMENT_OVERDUE, ASSIGNMENT_FUTURE])

    renderPanel()

    const section = await screen.findByRole('region', { name: '締切が近い課題' })
    expect(await within(section).findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(server.requests).toContainEqual({ method: 'GET', url: '/assignments/upcoming' })

    const rows = within(section).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('正規化レポート')).toBeInTheDocument()
    expect(within(rows[0]).getByText('データベース論')).toBeInTheDocument()
    expect(within(rows[0]).getByText('1/10 23:59')).toBeInTheDocument()
    expect(within(rows[0]).getByText('未提出')).toBeInTheDocument()
    expect(within(rows[1]).getByText('ER図の作成')).toBeInTheDocument()
    expect(within(rows[1]).getByText('ソフトウェア工学')).toBeInTheDocument()
    expect(within(rows[1]).getByText('12/31 09:00')).toBeInTheDocument()
    expect(within(rows[1]).getByText('取組中')).toBeInTheDocument()
  })

  it('期限切れの課題には「期限切れ」の表示が付き、期限前の課題には付かない', async () => {
    setupFakeServer([], [], [ASSIGNMENT_OVERDUE, ASSIGNMENT_FUTURE])

    renderPanel()

    const section = await screen.findByRole('region', { name: '締切が近い課題' })
    await within(section).findByText('取得件数: 2 件')
    const overdueRow = within(section).getByText('正規化レポート').closest('tr')!
    const futureRow = within(section).getByText('ER図の作成').closest('tr')!
    expect(within(overdueRow).getByText('期限切れ')).toBeInTheDocument()
    expect(within(futureRow).queryByText('期限切れ')).not.toBeInTheDocument()
  })

  it('項目から、その課題が属する授業の授業ページへ辿れる', async () => {
    setupFakeServer([], [], [ASSIGNMENT_OVERDUE, ASSIGNMENT_FUTURE])
    const user = userEvent.setup()

    renderPanel()
    const section = await screen.findByRole('region', { name: '締切が近い課題' })
    await within(section).findByText('取得件数: 2 件')
    await user.click(
      within(section).getByRole('link', {
        name: '課題「ER図の作成」の授業「ソフトウェア工学」の課題一覧へ',
      }),
    )

    expect(
      await screen.findByText(`授業ページ: ${String(ASSIGNMENT_FUTURE.course_id)}`),
    ).toBeInTheDocument()
  })

  it('0件の場合も表示が破綻せず0件と分かり、選考ステップは従来どおり表示される', async () => {
    setupFakeServer([COMPANY_A], [STEP_A], [])

    renderPanel()

    const section = await screen.findByRole('region', { name: '締切が近い課題' })
    expect(await within(section).findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(within(section).getByText('締切が近い課題は0件です。')).toBeInTheDocument()
    expect(await within(stepsSection()).findByText('一次面接')).toBeInTheDocument()
  })

  it('取得に失敗しても画面全体は壊れず、失敗したことが分かり、選考ステップは表示される', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const pathname = new URL(String(input)).pathname
        if (pathname === '/assignments/upcoming') {
          return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
        }
        if (pathname === '/interview-steps/upcoming') {
          return Promise.resolve(jsonResponse(200, [STEP_A]))
        }
        return Promise.resolve(jsonResponse(200, [COMPANY_A]))
      }),
    )

    renderPanel()

    const section = await screen.findByRole('region', { name: '締切が近い課題' })
    const alert = await within(section).findByRole('alert')
    expect(alert).toHaveTextContent('締切が近い課題を取得できませんでした。')
    expect(alert).toHaveTextContent('500')
    expect(await within(stepsSection()).findByText('一次面接')).toBeInTheDocument()
    expect(within(stepsSection()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('再読み込みで取得し直せる', async () => {
    const server = setupFakeServer([], [], [])
    const user = userEvent.setup()

    renderPanel()
    const section = await screen.findByRole('region', { name: '締切が近い課題' })
    await within(section).findByText('取得件数: 0 件')

    server.upcomingAssignments = [ASSIGNMENT_FUTURE]
    await user.click(within(section).getByRole('button', { name: '課題一覧を再読み込み' }))

    expect(await within(section).findByText('ER図の作成')).toBeInTheDocument()
    expect(within(assignmentsSection()).getByText('取得件数: 1 件')).toBeInTheDocument()
  })
})
