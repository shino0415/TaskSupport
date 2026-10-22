import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'

import type { Company, InterviewStep } from '../api/types'
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type FakeServer = {
  companies: Company[]
  upcomingSteps: InterviewStep[]
  requests: { method: string; url: string }[]
}

/** upcoming選考ステップ・企業一覧を模した簡易APIサーバー。 */
function setupFakeServer(companies: Company[], upcomingSteps: InterviewStep[]): FakeServer {
  const server: FakeServer = {
    companies: companies.map((c) => ({ ...c })),
    upcomingSteps: upcomingSteps.map((s) => ({ ...s })),
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
    setupFakeServer([COMPANY_A, COMPANY_B], [STEP_A, STEP_B])

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
    setupFakeServer([], [])

    renderPanel()

    expect(await screen.findByText('取得件数: 0 件')).toBeInTheDocument()
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
        return Promise.resolve(jsonResponse(200, []))
      }),
    )

    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('401')
    expect(alert).toHaveTextContent('API Key')
  })

  it('「企業の詳細」から対応する企業の詳細画面へ辿れる', async () => {
    setupFakeServer([COMPANY_A, COMPANY_B], [STEP_A, STEP_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(screen.getByRole('link', { name: '企業「合同会社テスト」の詳細へ' }))

    expect(await screen.findByText(`企業詳細ページ: ${String(COMPANY_B.id)}`)).toBeInTheDocument()
  })
})

describe('廃止した稼働計測の表示', () => {
  it('「進行中の稼働ログ」は表示されず、廃止済みの案件系APIへのリクエストも発生しない', async () => {
    const server = setupFakeServer([COMPANY_A], [STEP_A])

    renderPanel()

    expect(await screen.findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(screen.queryByText(/稼働ログ/)).not.toBeInTheDocument()
    expect(screen.queryByText(/計測中/)).not.toBeInTheDocument()
    expect(server.requests.length).toBeGreaterThan(0)
    expect(
      server.requests.filter((r) => /^\/(work-logs|projects|tasks)(\/|\?|$)/.test(r.url)),
    ).toEqual([])
  })
})
