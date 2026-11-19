import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Company, CompanyTask, InterviewStep } from '../api/types'
import { CompaniesPanel } from './CompaniesPanel'

const BASE_URL = 'http://api.test.local:8000'
const API_KEY = 'valid-key'

const COMPANY_A: Company = { id: 1, name: '株式会社サンプル', status: '選考中', is_deleted: false }
const COMPANY_B: Company = { id: 2, name: '合同会社テスト', status: '選考中', is_deleted: false }
const COMPANY_OFFER: Company = { id: 3, name: '内定株式会社', status: '内定', is_deleted: false }
const COMPANY_REJECTED: Company = { id: 4, name: '見送り商事', status: 'お見送り', is_deleted: false }
const COMPANY_DECLINED: Company = { id: 6, name: '辞退工業', status: '辞退', is_deleted: false }
const COMPANY_INTERNSHIP: Company = {
  id: 9,
  name: 'インターン株式会社',
  status: 'インターン参加',
  is_deleted: false,
}

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
  company_id: 1,
  type: '書類選考',
  date: null,
  prep_status: '完了',
  result: '通過',
  memo: null,
  is_deleted: false,
}

const COMPANY_TASK_A: CompanyTask = {
  id: 201,
  company_id: 1,
  name: '職務経歴書更新',
  status: '未着手',
  memo: '最新の実績を反映する',
  is_deleted: false,
}

const COMPANY_TASK_B: CompanyTask = {
  id: 202,
  company_id: 1,
  name: 'お礼メール送付',
  status: '完了',
  memo: null,
  is_deleted: false,
}

/** 準備状況の逆行遷移を判定するための線形順序（バックエンドの状態遷移グラフの一部を模す）。 */
const PREP_STATUS_ORDER = ['準備中', '準備万端', '完了']

/** 企業タスクのステータス逆行遷移を判定するための線形順序（Taskと同一集合を模す）。 */
const TASK_STATUS_ORDER = ['未着手', '処理中', '完了']

/** 企業の選考状態のうち終了した状態（ここから選考中・インターン参加へ戻すと逆行）。 */
const FINISHED_COMPANY_STATUSES: readonly string[] = ['内定', 'お見送り', '辞退']

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type FakeServer = {
  companies: Company[]
  steps: InterviewStep[]
  companyTasks: CompanyTask[]
  requests: { method: string; url: string; body: unknown }[]
}

/** 企業CRUD・選考ステップCRUD・企業タスクCRUD・逆行warningまで模した簡易APIサーバー。 */
function setupFakeServer(
  companies: Company[],
  steps: InterviewStep[],
  companyTasks: CompanyTask[] = [],
): FakeServer {
  const server: FakeServer = {
    companies: companies.map((c) => ({ ...c })),
    steps: steps.map((s) => ({ ...s })),
    companyTasks: companyTasks.map((t) => ({ ...t })),
    requests: [],
  }
  let nextCompanyId = Math.max(0, ...companies.map((c) => c.id)) + 1
  let nextStepId = Math.max(0, ...steps.map((s) => s.id)) + 1
  let nextCompanyTaskId = Math.max(0, ...companyTasks.map((t) => t.id)) + 1

  function stepWarning(before: InterviewStep, patch: Partial<InterviewStep>): string | null {
    const messages: string[] = []
    if (patch.prep_status !== undefined && patch.prep_status !== before.prep_status) {
      const fromIndex = PREP_STATUS_ORDER.indexOf(before.prep_status)
      const toIndex = PREP_STATUS_ORDER.indexOf(patch.prep_status)
      if (fromIndex !== -1 && toIndex !== -1 && toIndex < fromIndex) {
        messages.push(
          `${before.prep_status} から ${patch.prep_status} への変更です。意図的な変更か確認してください。`,
        )
      }
    }
    if (patch.result !== undefined && patch.result !== before.result) {
      // 未定 -> 通過/不通過 が順行、通過/不通過 -> 未定 のみが明確な逆行（分岐先同士は無警告）
      if (before.result !== '未定' && patch.result === '未定') {
        messages.push(
          `${before.result} から ${patch.result} への変更です。意図的な変更か確認してください。`,
        )
      }
    }
    return messages.length === 0 ? null : messages.join(' / ')
  }

  /** バックエンドの next_step と同じ規則（結果が未定・準備状況が完了でない・未削除のうち予定日が最も早いもの、予定日なしは最後）。 */
  function nextStepOf(companyId: number) {
    const candidates = server.steps
      .filter(
        (s) =>
          s.company_id === companyId &&
          !s.is_deleted &&
          s.result === '未定' &&
          s.prep_status !== '完了',
      )
      .sort((a, b) => {
        if (a.date === b.date) {
          return a.id - b.id
        }
        if (a.date === null) {
          return 1
        }
        if (b.date === null) {
          return -1
        }
        return a.date < b.date ? -1 : 1
      })
    const next = candidates[0]
    return next === undefined ? null : { id: next.id, type: next.type, date: next.date }
  }

  /** 選考ステップの結果が不通過になったら、選考中・インターン参加の企業に限りお見送りにする（自動お見送りを模す）。 */
  function applyAutoRejection(companyId: number) {
    const company = server.companies.find((c) => c.id === companyId)
    if (company !== undefined && (company.status === '選考中' || company.status === 'インターン参加')) {
      company.status = 'お見送り'
    }
  }

  function companyTaskWarning(before: CompanyTask, patch: Partial<CompanyTask>): string | null {
    if (patch.status === undefined || patch.status === before.status) {
      return null
    }
    const fromIndex = TASK_STATUS_ORDER.indexOf(before.status)
    const toIndex = TASK_STATUS_ORDER.indexOf(patch.status)
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

    if (url.pathname === '/companies' && method === 'GET') {
      return Promise.resolve(
        jsonResponse(
          200,
          server.companies
            .filter((c) => !c.is_deleted)
            .map((c) => ({ ...c, next_step: nextStepOf(c.id) })),
        ),
      )
    }
    if (url.pathname === '/companies' && method === 'POST') {
      const created: Company = {
        ...(body as Pick<Company, 'name'>),
        id: nextCompanyId,
        status: '選考中',
        is_deleted: false,
      }
      nextCompanyId += 1
      server.companies.push(created)
      return Promise.resolve(jsonResponse(201, created))
    }

    const stepsListMatch = /^\/companies\/(\d+)\/interview-steps$/.exec(url.pathname)
    if (stepsListMatch !== null) {
      const companyId = Number(stepsListMatch[1])
      const company = server.companies.find((c) => c.id === companyId && !c.is_deleted)
      if (company === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'Company not found' }))
      }
      if (method === 'GET') {
        const visible = server.steps.filter((s) => s.company_id === companyId && !s.is_deleted)
        return Promise.resolve(jsonResponse(200, visible))
      }
      if (method === 'POST') {
        const input = body as Omit<InterviewStep, 'id' | 'company_id' | 'is_deleted'>
        const created: InterviewStep = {
          ...input,
          id: nextStepId,
          company_id: companyId,
          is_deleted: false,
        }
        nextStepId += 1
        server.steps.push(created)
        if (created.result === '不通過') {
          applyAutoRejection(companyId)
        }
        return Promise.resolve(jsonResponse(201, created))
      }
    }

    const companyTasksListMatch = /^\/companies\/(\d+)\/company-tasks$/.exec(url.pathname)
    if (companyTasksListMatch !== null) {
      const companyId = Number(companyTasksListMatch[1])
      const company = server.companies.find((c) => c.id === companyId && !c.is_deleted)
      if (company === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'Company not found' }))
      }
      if (method === 'GET') {
        const visible = server.companyTasks.filter(
          (t) => t.company_id === companyId && !t.is_deleted,
        )
        return Promise.resolve(jsonResponse(200, visible))
      }
      if (method === 'POST') {
        const input = body as Omit<CompanyTask, 'id' | 'company_id' | 'is_deleted'>
        const created: CompanyTask = {
          ...input,
          id: nextCompanyTaskId,
          company_id: companyId,
          is_deleted: false,
        }
        nextCompanyTaskId += 1
        server.companyTasks.push(created)
        return Promise.resolve(jsonResponse(201, created))
      }
    }

    const companyMatch = /^\/companies\/(\d+)$/.exec(url.pathname)
    if (companyMatch !== null) {
      const id = Number(companyMatch[1])
      const target = server.companies.find((c) => c.id === id && !c.is_deleted)
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'Company not found' }))
      }
      if (method === 'GET') {
        return Promise.resolve(jsonResponse(200, target))
      }
      if (method === 'PATCH') {
        const patch = body as Pick<Company, 'status'>
        // 終了した状態から選考中・インターン参加へ戻す変更と、辞退から内定へ戻す変更だけが逆行
        // （選考中とインターン参加の間はどちら向きも無警告、それ以外の終了状態どうしも無警告）
        const isBackward =
          (FINISHED_COMPANY_STATUSES.includes(target.status) &&
            (patch.status === '選考中' || patch.status === 'インターン参加')) ||
          (target.status === '辞退' && patch.status === '内定')
        const warning = isBackward
          ? `${target.status} から ${patch.status} への変更です。意図的な変更か確認してください。`
          : null
        target.status = patch.status
        return Promise.resolve(jsonResponse(200, { ...target, warning }))
      }
      if (method === 'DELETE') {
        target.is_deleted = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
    }

    const stepMatch = /^\/interview-steps\/(\d+)$/.exec(url.pathname)
    if (stepMatch !== null) {
      const id = Number(stepMatch[1])
      const target = server.steps.find((s) => s.id === id && !s.is_deleted)
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'InterviewStep not found' }))
      }
      if (method === 'PATCH') {
        const patch = body as Partial<InterviewStep>
        const warning = stepWarning(target, patch)
        const becameRejected = target.result !== '不通過' && patch.result === '不通過'
        Object.assign(target, patch)
        if (becameRejected) {
          applyAutoRejection(target.company_id)
        }
        return Promise.resolve(jsonResponse(200, { ...target, warning }))
      }
      if (method === 'DELETE') {
        target.is_deleted = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
    }

    const companyTaskMatch = /^\/company-tasks\/(\d+)$/.exec(url.pathname)
    if (companyTaskMatch !== null) {
      const id = Number(companyTaskMatch[1])
      const target = server.companyTasks.find((t) => t.id === id && !t.is_deleted)
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'CompanyTask not found' }))
      }
      if (method === 'PATCH') {
        const patch = body as Partial<CompanyTask>
        const warning = companyTaskWarning(target, patch)
        Object.assign(target, patch)
        return Promise.resolve(jsonResponse(200, { ...target, warning }))
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
  return render(<CompaniesPanel apiKey={API_KEY} />)
}

async function selectOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole('option', { name: option }))
}

async function selectCompanySteps(user: ReturnType<typeof userEvent.setup>, companyName: string) {
  await user.click(screen.getByRole('button', { name: `企業「${companyName}」の選考ステップを表示` }))
}

async function waitForDialogClosed() {
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

/**
 * 企業一覧・選考ステップ一覧・企業タスク一覧はいずれも役割上のroleが同じ"table"のため、
 * その表だけが持つ列見出しで対象の表を明示的に取り出すヘルパー。
 */
function tableWithColumnHeader(headerText: string) {
  const tables = screen.getAllByRole('table')
  const found = tables.find((table) => within(table).queryByText(headerText) !== null)
  if (found === undefined) {
    throw new Error(`列見出し「${headerText}」を持つ表が見つかりません`)
  }
  return found
}

/** 選考ステップ一覧の表（「種別」列を持つのはこの表のみ）。 */
function stepsTable() {
  return tableWithColumnHeader('種別')
}

/** 企業タスク一覧の表（「タスク名」列を持つのはこの表のみ）。 */
function companyTasksTable() {
  return tableWithColumnHeader('タスク名')
}

/**
 * 選考中の企業の表。「次回選考」列はインターン参加の欄の表にもあるため、
 * 折りたたみ欄（region）の外にある表に絞って取り出す。
 */
function inProgressTable() {
  const found = screen
    .getAllByRole('table')
    .find(
      (table) =>
        within(table).queryByText('次回選考') !== null && table.closest('[role="region"]') === null,
    )
  if (found === undefined) {
    throw new Error('選考中の企業の表が見つかりません')
  }
  return found
}

/** 「インターン参加（N 件）」の欄の見出しのボタン。 */
function internshipAccordionButton() {
  return screen.getByRole('button', { name: /^インターン参加（\d+ 件）$/ })
}

/** 「インターン参加」の欄の中身（閉じていればnull）。 */
function queryInternshipRegion() {
  return screen.queryByRole('region', { name: /^インターン参加（\d+ 件）$/ })
}

/** 「内定（N 件）」の欄の見出しのボタン。 */
function offerAccordionButton() {
  return screen.getByRole('button', { name: /^内定（\d+ 件）$/ })
}

/** 「お見送り・辞退（N 件）」の欄の見出しのボタン。 */
function closedAccordionButton() {
  return screen.getByRole('button', { name: /^お見送り・辞退（\d+ 件）$/ })
}

/** 「内定」の欄の中身（閉じていればnull）。 */
function queryOfferRegion() {
  return screen.queryByRole('region', { name: /^内定（\d+ 件）$/ })
}

/** 「お見送り・辞退」の欄の中身（閉じていればnull）。 */
function queryClosedRegion() {
  return screen.queryByRole('region', { name: /^お見送り・辞退（\d+ 件）$/ })
}

/** 行の中の選考状態のChip（同じ文言が状態変更の選択欄にも出るため、Chipに絞って取り出す）。 */
function statusChipOf(row: HTMLElement) {
  const chip = row.querySelector<HTMLElement>('.MuiChip-root')
  if (chip === null) {
    throw new Error('選考状態のChipが見つかりません')
  }
  return chip
}

async function changeCompanyStatus(
  user: ReturnType<typeof userEvent.setup>,
  companyName: string,
  status: string,
) {
  await user.click(screen.getByRole('combobox', { name: `企業「${companyName}」の選考状態を変更` }))
  await user.click(await screen.findByRole('option', { name: status }))
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('企業一覧と登録', () => {
  it('企業一覧と件数を表示する', async () => {
    setupFakeServer([COMPANY_A, COMPANY_B], [])

    renderPanel()

    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(screen.getByText('株式会社サンプル')).toBeInTheDocument()
    expect(screen.getByText('合同会社テスト')).toBeInTheDocument()
  })

  it('0件でも表示が破綻せず0件と分かる', async () => {
    setupFakeServer([], [])

    renderPanel()

    expect(await screen.findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(screen.getByText('企業は0件です。')).toBeInTheDocument()
  })

  it('フォームから新規登録でき、一覧に反映される', async () => {
    const server = setupFakeServer([], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 0 件')
    await user.click(screen.getByRole('button', { name: '企業を新規登録' }))
    await user.type(screen.getByLabelText('企業名', { exact: false }), '株式会社ノヴァ')
    await user.click(screen.getByRole('button', { name: '登録する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('企業を登録しました。')).toBeInTheDocument()
    expect(await screen.findByText('株式会社ノヴァ')).toBeInTheDocument()
    const created = server.requests.find((request) => request.method === 'POST' && request.url === '/companies')
    expect(created?.body).toEqual({ name: '株式会社ノヴァ' })
  })

  it('企業名が未入力ならメッセージを表示し、送信しない', async () => {
    const server = setupFakeServer([], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 0 件')
    await user.click(screen.getByRole('button', { name: '企業を新規登録' }))
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByText('企業名を入力してください。')).toBeInTheDocument()
    expect(server.requests.some((request) => request.method === 'POST')).toBe(false)
  })
})

describe('企業詳細', () => {
  it('詳細を開くと GET /companies/{id} の内容を表示する', async () => {
    const server = setupFakeServer([COMPANY_A, COMPANY_B], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(screen.getByRole('button', { name: '企業「合同会社テスト」の詳細' }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('合同会社テスト')).toBeInTheDocument()
    expect(server.requests.at(-1)).toMatchObject({ method: 'GET', url: '/companies/2' })
  })

  it('別の企業の詳細を開き直すと、前回の企業ではなく開いた企業の内容を表示する', async () => {
    setupFakeServer([COMPANY_A, COMPANY_B], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(screen.getByRole('button', { name: '企業「合同会社テスト」の詳細' }))
    let dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('合同会社テスト')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '企業「株式会社サンプル」の詳細' }))
    dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('株式会社サンプル')).toBeInTheDocument()
    expect(within(dialog).queryByText('合同会社テスト')).not.toBeInTheDocument()
  })

  it('削除済みの企業の詳細は参照できず、404と分かるメッセージを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new URL(String(input)).pathname === '/companies'
            ? jsonResponse(200, [{ ...COMPANY_B, next_step: null }])
            : jsonResponse(404, { detail: 'Company not found' }),
        ),
      ),
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await user.click(screen.getByRole('button', { name: '企業「合同会社テスト」の詳細' }))

    const dialog = await screen.findByRole('dialog')
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('404')
    expect(alert).toHaveTextContent('Company not found')
  })
})

describe('企業削除', () => {
  it('確認のうえ削除でき、削除後は一覧・詳細から参照できなくなる', async () => {
    const server = setupFakeServer([COMPANY_A, COMPANY_B], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(screen.getByRole('button', { name: '企業「合同会社テスト」を削除' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/企業「合同会社テスト」を削除します/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('企業「合同会社テスト」を削除しました。')).toBeInTheDocument()
    expect(await screen.findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(screen.queryByText('合同会社テスト')).not.toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'DELETE' && r.url === '/companies/2')).toBe(true)
    expect(
      screen.queryByRole('button', { name: '企業「合同会社テスト」の詳細' }),
    ).not.toBeInTheDocument()
  })

  it('キャンセルすると削除されない', async () => {
    const server = setupFakeServer([COMPANY_A], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await user.click(screen.getByRole('button', { name: '企業「株式会社サンプル」を削除' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitForDialogClosed()

    expect(server.requests.some((request) => request.method === 'DELETE')).toBe(false)
    expect(screen.getByText('株式会社サンプル')).toBeInTheDocument()
  })
})

describe('選考ステップの選択と一覧', () => {
  it('企業を選ぶと選考ステップ一覧が表示され、GET /companies/{id}/interview-steps を叩く', async () => {
    const server = setupFakeServer([COMPANY_A], [STEP_A, STEP_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')

    expect(await screen.findByText('一次面接')).toBeInTheDocument()
    expect(screen.getByText('書類選考')).toBeInTheDocument()
    expect(
      server.requests.some(
        (request) => request.method === 'GET' && request.url === '/companies/1/interview-steps',
      ),
    ).toBe(true)
  })

  it('選考ステップが0件の企業でも表示が破綻しない', async () => {
    setupFakeServer([COMPANY_A], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')

    expect(await screen.findByText('選考ステップは0件です。')).toBeInTheDocument()
  })

  it('予定日が未設定の選考ステップでも表示が破綻しない', async () => {
    setupFakeServer([COMPANY_A], [STEP_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')

    expect(await screen.findByText('書類選考')).toBeInTheDocument()
    expect(screen.getByText('未定')).toBeInTheDocument()
  })

  it('企業詳細と選考ステップ一覧は別々に取得される（企業詳細に選考ステップを含めない）', async () => {
    const server = setupFakeServer([COMPANY_A], [STEP_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await user.click(screen.getByRole('button', { name: '企業「株式会社サンプル」の詳細' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    await waitForDialogClosed()
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('一次面接')

    expect(
      server.requests.some((r) => r.method === 'GET' && r.url === '/companies/1'),
    ).toBe(true)
    expect(
      server.requests.some((r) => r.method === 'GET' && r.url === '/companies/1/interview-steps'),
    ).toBe(true)
  })
})

describe('選考ステップの追加', () => {
  it('フォームから追加でき、一覧に反映される', async () => {
    const server = setupFakeServer([COMPANY_A], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('選考ステップは0件です。')

    await user.click(screen.getByRole('button', { name: '選考ステップを追加' }))
    await user.type(screen.getByLabelText('種別', { exact: false }), '最終面接')
    await user.type(screen.getByLabelText('メモ'), '役員面接')
    await user.click(screen.getByRole('button', { name: '追加する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('選考ステップを追加しました。')).toBeInTheDocument()
    expect(await screen.findByText('最終面接')).toBeInTheDocument()

    const created = server.requests.find(
      (request) => request.method === 'POST' && request.url === '/companies/1/interview-steps',
    )
    expect(created?.body).toEqual({
      type: '最終面接',
      date: null,
      prep_status: '準備中',
      result: '未定',
      memo: '役員面接',
    })
  })

  it('種別が未入力ならメッセージを表示し、送信しない', async () => {
    const server = setupFakeServer([COMPANY_A], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('選考ステップは0件です。')

    await user.click(screen.getByRole('button', { name: '選考ステップを追加' }))
    await user.click(screen.getByRole('button', { name: '追加する' }))

    expect(await screen.findByText('選考種別を入力してください。')).toBeInTheDocument()
    expect(server.requests.some((request) => request.method === 'POST')).toBe(false)
  })
})

describe('選考ステップの編集', () => {
  it('各項目を編集でき、変更内容が反映される', async () => {
    const server = setupFakeServer([COMPANY_A], [STEP_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('一次面接')

    await user.click(screen.getByRole('button', { name: '選考ステップ「一次面接」を編集' }))
    const typeField = screen.getByLabelText('種別', { exact: false })
    await user.clear(typeField)
    await user.type(typeField, '一次面接（再調整）')
    await selectOption(user, '準備状況', '準備万端')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('選考ステップを更新しました。')).toBeInTheDocument()
    expect(await screen.findByText('一次面接（再調整）')).toBeInTheDocument()
    const patch = server.requests.find((request) => request.method === 'PATCH')
    expect(patch?.url).toBe('/interview-steps/101')
    expect(patch?.body).toMatchObject({ type: '一次面接（再調整）', prep_status: '準備万端' })
  })

  it('準備状況の逆行時はAPIの警告を表示しつつ、更新自体は成立する', async () => {
    setupFakeServer([COMPANY_A], [STEP_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('書類選考')

    await user.click(screen.getByRole('button', { name: '選考ステップ「書類選考」を編集' }))
    await selectOption(user, '準備状況', '準備中')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    const alert = await screen.findByText(/意図的な変更か確認してください/)
    expect(alert).toHaveTextContent('完了 から 準備中 への変更です')
    expect(alert).toHaveTextContent('変更は保存されています')
    expect(within(stepsTable()).getByText('準備中')).toBeInTheDocument()
  })

  it('結果の逆行時はAPIの警告を表示しつつ、更新自体は成立する', async () => {
    setupFakeServer([COMPANY_A], [STEP_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('書類選考')

    await user.click(screen.getByRole('button', { name: '選考ステップ「書類選考」を編集' }))
    await selectOption(user, '結果', '未定')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    const alert = await screen.findByText(/意図的な変更か確認してください/)
    expect(alert).toHaveTextContent('通過 から 未定 への変更です')
  })

  it('準備状況・結果が両方同時に逆行した場合、両方の内容が分かる警告が表示される', async () => {
    setupFakeServer([COMPANY_A], [STEP_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('書類選考')

    await user.click(screen.getByRole('button', { name: '選考ステップ「書類選考」を編集' }))
    await selectOption(user, '準備状況', '準備中')
    await selectOption(user, '結果', '未定')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    const alert = await screen.findByText(/意図的な変更か確認してください.*意図的な変更か確認してください/s)
    expect(alert).toHaveTextContent('完了 から 準備中 への変更です')
    expect(alert).toHaveTextContent('通過 から 未定 への変更です')
  })
})

describe('選考ステップの削除', () => {
  it('確認のうえ削除でき、削除後は一覧に表示されなくなる', async () => {
    const server = setupFakeServer([COMPANY_A], [STEP_A, STEP_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('取得件数: 2 件')

    await user.click(screen.getByRole('button', { name: '選考ステップ「書類選考」を削除' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/選考ステップ「書類選考」を削除します/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('選考ステップ「書類選考」を削除しました。')).toBeInTheDocument()
    // 「取得件数: 1 件」は企業一覧（1社）・選考ステップ一覧（削除後1件）の両方に表示され得るため、
    // 選考ステップの表内の行数で削除後の反映を確認する
    await waitFor(() => expect(within(stepsTable()).getAllByRole('row')).toHaveLength(2))
    expect(screen.queryByText('書類選考')).not.toBeInTheDocument()
    expect(
      server.requests.some((r) => r.method === 'DELETE' && r.url === '/interview-steps/102'),
    ).toBe(true)
  })

  it('キャンセルすると削除されない', async () => {
    setupFakeServer([COMPANY_A], [STEP_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('一次面接')

    await user.click(screen.getByRole('button', { name: '選考ステップ「一次面接」を削除' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitForDialogClosed()

    expect(screen.getByText('一次面接')).toBeInTheDocument()
  })
})

describe('企業タスクの選択と一覧', () => {
  it('企業を選ぶと企業タスク一覧が表示され、GET /companies/{id}/company-tasks を叩く', async () => {
    const server = setupFakeServer([COMPANY_A], [], [COMPANY_TASK_A, COMPANY_TASK_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')

    expect(await screen.findByText('職務経歴書更新')).toBeInTheDocument()
    expect(screen.getByText('お礼メール送付')).toBeInTheDocument()
    expect(
      server.requests.some(
        (request) => request.method === 'GET' && request.url === '/companies/1/company-tasks',
      ),
    ).toBe(true)
  })

  it('企業タスクが0件の企業でも表示が破綻しない', async () => {
    setupFakeServer([COMPANY_A], [], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')

    expect(await screen.findByText('企業タスクは0件です。')).toBeInTheDocument()
  })

  it('企業詳細と企業タスク一覧は別々に取得される（企業詳細に企業タスクを含めない）', async () => {
    const server = setupFakeServer([COMPANY_A], [], [COMPANY_TASK_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await user.click(screen.getByRole('button', { name: '企業「株式会社サンプル」の詳細' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    await waitForDialogClosed()
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('職務経歴書更新')

    expect(server.requests.some((r) => r.method === 'GET' && r.url === '/companies/1')).toBe(true)
    expect(
      server.requests.some((r) => r.method === 'GET' && r.url === '/companies/1/company-tasks'),
    ).toBe(true)
  })
})

describe('企業タスクの追加', () => {
  it('フォームから追加でき、一覧に反映される', async () => {
    const server = setupFakeServer([COMPANY_A], [], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('企業タスクは0件です。')

    await user.click(screen.getByRole('button', { name: '企業タスクを追加' }))
    await user.type(screen.getByLabelText('タスク名', { exact: false }), '一次面接対策')
    await user.type(screen.getByLabelText('メモ'), '想定質問集を作る')
    await user.click(screen.getByRole('button', { name: '追加する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('企業タスクを追加しました。')).toBeInTheDocument()
    expect(await screen.findByText('一次面接対策')).toBeInTheDocument()

    const created = server.requests.find(
      (request) => request.method === 'POST' && request.url === '/companies/1/company-tasks',
    )
    expect(created?.body).toEqual({
      name: '一次面接対策',
      status: '未着手',
      memo: '想定質問集を作る',
    })
  })

  it('タスク名が未入力ならメッセージを表示し、送信しない', async () => {
    const server = setupFakeServer([COMPANY_A], [], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('企業タスクは0件です。')

    await user.click(screen.getByRole('button', { name: '企業タスクを追加' }))
    await user.click(screen.getByRole('button', { name: '追加する' }))

    expect(await screen.findByText('企業タスク名を入力してください。')).toBeInTheDocument()
    expect(
      server.requests.some(
        (request) => request.method === 'POST' && request.url === '/companies/1/company-tasks',
      ),
    ).toBe(false)
  })
})

describe('企業タスクの編集', () => {
  it('各項目を編集でき、変更内容が反映される', async () => {
    const server = setupFakeServer([COMPANY_A], [], [COMPANY_TASK_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('職務経歴書更新')

    await user.click(screen.getByRole('button', { name: '企業タスク「職務経歴書更新」を編集' }))
    const nameField = screen.getByLabelText('タスク名', { exact: false })
    await user.clear(nameField)
    await user.type(nameField, '職務経歴書更新（提出済み）')
    await selectOption(user, 'ステータス', '処理中')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('企業タスクを更新しました。')).toBeInTheDocument()
    expect(await screen.findByText('職務経歴書更新（提出済み）')).toBeInTheDocument()
    const patch = server.requests.find((request) => request.method === 'PATCH')
    expect(patch?.url).toBe('/company-tasks/201')
    expect(patch?.body).toMatchObject({ name: '職務経歴書更新（提出済み）', status: '処理中' })
  })

  it('ステータスの逆行時はAPIの警告を表示しつつ、更新自体は成立する', async () => {
    setupFakeServer([COMPANY_A], [], [COMPANY_TASK_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('お礼メール送付')

    await user.click(screen.getByRole('button', { name: '企業タスク「お礼メール送付」を編集' }))
    await selectOption(user, 'ステータス', '未着手')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    const alert = await screen.findByText(/意図的な変更か確認してください/)
    expect(alert).toHaveTextContent('完了 から 未着手 への変更です')
    expect(alert).toHaveTextContent('変更は保存されています')
    expect(within(companyTasksTable()).getByText('未着手')).toBeInTheDocument()
  })
})

describe('企業タスクの削除', () => {
  it('確認のうえ削除でき、削除後は一覧に表示されなくなる', async () => {
    const server = setupFakeServer([COMPANY_A], [], [COMPANY_TASK_A, COMPANY_TASK_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('職務経歴書更新')

    await user.click(screen.getByRole('button', { name: '企業タスク「お礼メール送付」を削除' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/企業タスク「お礼メール送付」を削除します/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('企業タスク「お礼メール送付」を削除しました。')).toBeInTheDocument()
    await waitFor(() => expect(within(companyTasksTable()).getAllByRole('row')).toHaveLength(2))
    expect(screen.queryByText('お礼メール送付')).not.toBeInTheDocument()
    expect(
      server.requests.some((r) => r.method === 'DELETE' && r.url === '/company-tasks/202'),
    ).toBe(true)
  })

  it('キャンセルすると削除されない', async () => {
    setupFakeServer([COMPANY_A], [], [COMPANY_TASK_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('職務経歴書更新')

    await user.click(screen.getByRole('button', { name: '企業タスク「職務経歴書更新」を削除' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitForDialogClosed()

    expect(screen.getByText('職務経歴書更新')).toBeInTheDocument()
  })
})

describe('通信エラー', () => {
  it('企業一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(401, { detail: 'Invalid or missing API Key' }))),
    )

    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('401')
    expect(alert).toHaveTextContent('API Key')
  })

  it('選考ステップ一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const pathname = new URL(String(input)).pathname
        if (pathname === '/companies') {
          return Promise.resolve(jsonResponse(200, [{ ...COMPANY_A, next_step: null }]))
        }
        return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
      }),
    )

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')

    // 選考ステップ・企業タスクの両方が同じ500エラーを返すため、両方のアラートを確認する
    // （最初から開いている「内定」の欄の0件表示のアラートは対象外）
    await waitFor(() => {
      const alerts = screen
        .getAllByRole('alert')
        .filter((alert) => alert.classList.contains('MuiAlert-colorError'))
      expect(alerts).toHaveLength(2)
      alerts.forEach((alert) => expect(alert).toHaveTextContent('500'))
    })
  })

  it('企業タスク一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input))
        if (url.pathname === '/companies') {
          return Promise.resolve(jsonResponse(200, [{ ...COMPANY_A, next_step: null }]))
        }
        if (url.pathname === '/companies/1/interview-steps') {
          return Promise.resolve(jsonResponse(200, []))
        }
        return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
      }),
    )

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')

    // 選考ステップは0件（info）のアラートも同時に出るため、500エラーの内容で絞り込む
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      expect(alerts.some((alert) => alert.textContent?.includes('500'))).toBe(true)
    })
  })
})

describe('横断一覧等からの遷移（初期選択）', () => {
  it('initialDetailCompanyIdを渡すと、詳細ダイアログが最初から開いた状態で表示される', async () => {
    setupFakeServer([COMPANY_A, COMPANY_B], [])

    render(<CompaniesPanel apiKey={API_KEY} initialDetailCompanyId={COMPANY_B.id} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('企業詳細（ID: 2）')).toBeInTheDocument()
    expect(await within(dialog).findByText('合同会社テスト')).toBeInTheDocument()
  })
})

describe('入力値の上限', () => {
  const NAME_32 = 'あ'.repeat(32)
  const MEMO_1000 = 'm'.repeat(1000)

  it('企業名が32文字を超えると送信せずに示し、32文字ちょうどなら登録でき保存される', async () => {
    const server = setupFakeServer([], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 0 件')
    await user.click(screen.getByRole('button', { name: '企業を新規登録' }))
    const nameField = screen.getByLabelText('企業名', { exact: false })
    fireEvent.change(nameField, { target: { value: `${NAME_32}あ` } })
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByText('企業名は32文字以内で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((request) => request.method === 'POST')).toBe(false)

    fireEvent.change(nameField, { target: { value: NAME_32 } })
    await user.click(screen.getByRole('button', { name: '登録する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('企業を登録しました。')).toBeInTheDocument()
    expect(await screen.findByText(NAME_32)).toBeInTheDocument()
    expect(server.requests.find((request) => request.method === 'POST')?.body).toEqual({
      name: NAME_32,
    })
  })

  it('選考ステップの種別・メモが上限を超えると送信せずに示し、上限ちょうどなら追加でき保存される', async () => {
    const server = setupFakeServer([COMPANY_A], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('選考ステップは0件です。')
    await user.click(screen.getByRole('button', { name: '選考ステップを追加' }))
    const typeField = screen.getByLabelText('種別', { exact: false })
    const memoField = screen.getByLabelText('メモ')
    fireEvent.change(typeField, { target: { value: `${NAME_32}あ` } })
    fireEvent.change(memoField, { target: { value: `${MEMO_1000}m` } })
    await user.click(screen.getByRole('button', { name: '追加する' }))

    expect(await screen.findByText('選考種別は32文字以内で入力してください。')).toBeInTheDocument()
    expect(screen.getByText('メモは1000文字以内で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((request) => request.method === 'POST')).toBe(false)

    fireEvent.change(typeField, { target: { value: NAME_32 } })
    fireEvent.change(memoField, { target: { value: MEMO_1000 } })
    await user.click(screen.getByRole('button', { name: '追加する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('選考ステップを追加しました。')).toBeInTheDocument()
    expect(await screen.findByText(NAME_32)).toBeInTheDocument()
    expect(
      server.requests.find(
        (request) => request.method === 'POST' && request.url === '/companies/1/interview-steps',
      )?.body,
    ).toMatchObject({ type: NAME_32, memo: MEMO_1000 })
  })

  it('選考ステップの編集でも種別の上限超過は送信しない', async () => {
    const server = setupFakeServer([COMPANY_A], [STEP_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('一次面接')
    await user.click(screen.getByRole('button', { name: '選考ステップ「一次面接」を編集' }))
    fireEvent.change(screen.getByLabelText('種別', { exact: false }), {
      target: { value: `${NAME_32}あ` },
    })
    await user.click(screen.getByRole('button', { name: '更新する' }))

    expect(await screen.findByText('選考種別は32文字以内で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('企業タスク名・メモが上限を超えると送信せずに示し、上限ちょうどなら追加でき保存される', async () => {
    const server = setupFakeServer([COMPANY_A], [], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('企業タスクは0件です。')
    await user.click(screen.getByRole('button', { name: '企業タスクを追加' }))
    const nameField = screen.getByLabelText('タスク名', { exact: false })
    const memoField = screen.getByLabelText('メモ')
    fireEvent.change(nameField, { target: { value: `${NAME_32}あ` } })
    fireEvent.change(memoField, { target: { value: `${MEMO_1000}m` } })
    await user.click(screen.getByRole('button', { name: '追加する' }))

    expect(await screen.findByText('企業タスク名は32文字以内で入力してください。')).toBeInTheDocument()
    expect(screen.getByText('メモは1000文字以内で入力してください。')).toBeInTheDocument()
    expect(
      server.requests.some(
        (request) => request.method === 'POST' && request.url === '/companies/1/company-tasks',
      ),
    ).toBe(false)

    fireEvent.change(nameField, { target: { value: NAME_32 } })
    fireEvent.change(memoField, { target: { value: MEMO_1000 } })
    await user.click(screen.getByRole('button', { name: '追加する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('企業タスクを追加しました。')).toBeInTheDocument()
    expect(await screen.findByText(NAME_32)).toBeInTheDocument()
    expect(
      server.requests.find(
        (request) => request.method === 'POST' && request.url === '/companies/1/company-tasks',
      )?.body,
    ).toMatchObject({ name: NAME_32, memo: MEMO_1000 })
  })

  it('企業タスクの編集でもメモの上限超過は送信しない', async () => {
    const server = setupFakeServer([COMPANY_A], [], [COMPANY_TASK_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('職務経歴書更新')
    await user.click(screen.getByRole('button', { name: '企業タスク「職務経歴書更新」を編集' }))
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: `${MEMO_1000}m` } })
    await user.click(screen.getByRole('button', { name: '更新する' }))

    expect(await screen.findByText('メモは1000文字以内で入力してください。')).toBeInTheDocument()
    expect(server.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })
})

describe('選考中・インターン参加・内定・お見送り・辞退の欄への振り分け', () => {
  it('選考中は上の表に、インターン参加・内定はそれぞれの欄に、お見送りと辞退は「お見送り・辞退」の欄に入り、見出しに件数が出る', async () => {
    const companyOffer2: Company = { id: 7, name: '第二内定株式会社', status: '内定', is_deleted: false }
    const companyInternship2: Company = {
      id: 10,
      name: '第二インターン株式会社',
      status: 'インターン参加',
      is_deleted: false,
    }
    const companyInternship3: Company = {
      id: 11,
      name: '第三インターン株式会社',
      status: 'インターン参加',
      is_deleted: false,
    }
    setupFakeServer(
      [
        COMPANY_A,
        COMPANY_B,
        COMPANY_INTERNSHIP,
        companyInternship2,
        companyInternship3,
        COMPANY_OFFER,
        companyOffer2,
        COMPANY_REJECTED,
        COMPANY_DECLINED,
      ],
      [],
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 9 件')

    expect(screen.getByText('選考中（2 件）')).toBeInTheDocument()
    const inProgress = inProgressTable()
    expect(within(inProgress).getByText('株式会社サンプル')).toBeInTheDocument()
    expect(within(inProgress).getByText('合同会社テスト')).toBeInTheDocument()
    for (const name of [
      'インターン株式会社',
      '第二インターン株式会社',
      '第三インターン株式会社',
      '内定株式会社',
      '第二内定株式会社',
      '見送り商事',
      '辞退工業',
    ]) {
      expect(within(inProgress).queryByText(name)).not.toBeInTheDocument()
    }

    expect(internshipAccordionButton()).toHaveTextContent('インターン参加（3 件）')
    const internship = queryInternshipRegion()!
    expect(within(internship).getAllByRole('row')).toHaveLength(1 + 3)
    for (const name of ['インターン株式会社', '第二インターン株式会社', '第三インターン株式会社']) {
      expect(within(internship).getByText(name)).toBeInTheDocument()
    }
    expect(within(internship).queryByText('株式会社サンプル')).not.toBeInTheDocument()
    expect(within(internship).queryByText('内定株式会社')).not.toBeInTheDocument()

    expect(offerAccordionButton()).toHaveTextContent('内定（2 件）')
    const offer = queryOfferRegion()!
    expect(within(offer).getAllByRole('row')).toHaveLength(1 + 2)
    expect(within(offer).getByText('内定株式会社')).toBeInTheDocument()
    expect(within(offer).getByText('第二内定株式会社')).toBeInTheDocument()
    expect(within(offer).queryByText('次回選考')).not.toBeInTheDocument()

    expect(closedAccordionButton()).toHaveTextContent('お見送り・辞退（2 件）')
    await user.click(closedAccordionButton())
    const closed = queryClosedRegion()!
    expect(within(closed).getAllByRole('row')).toHaveLength(1 + 2)
    expect(within(closed).getByText('見送り商事')).toBeInTheDocument()
    expect(within(closed).getByText('辞退工業')).toBeInTheDocument()
    expect(within(closed).queryByText('内定株式会社')).not.toBeInTheDocument()
    expect(within(closed).queryByText('インターン株式会社')).not.toBeInTheDocument()
  })

  it('欄は 選考中 → インターン参加 → 内定 → お見送り・辞退 の順に並ぶ', async () => {
    setupFakeServer([COMPANY_A, COMPANY_INTERNSHIP, COMPANY_OFFER, COMPANY_REJECTED], [])

    renderPanel()
    await screen.findByText('取得件数: 4 件')

    const headings = [
      screen.getByText('選考中（1 件）'),
      internshipAccordionButton(),
      offerAccordionButton(),
      closedAccordionButton(),
    ]
    for (let i = 0; i + 1 < headings.length; i += 1) {
      expect(
        headings[i].compareDocumentPosition(headings[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
    expect(
      inProgressTable().compareDocumentPosition(internshipAccordionButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('ページを開いた時点で「インターン参加」の欄は開いていて、操作で開閉できる', async () => {
    setupFakeServer([COMPANY_A, COMPANY_INTERNSHIP, COMPANY_OFFER, COMPANY_REJECTED], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 4 件')

    expect(internshipAccordionButton()).toHaveAttribute('aria-expanded', 'true')
    expect(within(queryInternshipRegion()!).getByText('インターン株式会社')).toBeInTheDocument()
    expect(offerAccordionButton()).toHaveAttribute('aria-expanded', 'true')
    expect(closedAccordionButton()).toHaveAttribute('aria-expanded', 'false')

    await user.click(internshipAccordionButton())
    expect(internshipAccordionButton()).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(queryInternshipRegion()).toBeNull())
    expect(screen.queryByText('インターン株式会社')).not.toBeInTheDocument()
    await user.click(internshipAccordionButton())
    expect(internshipAccordionButton()).toHaveAttribute('aria-expanded', 'true')
    expect(within(queryInternshipRegion()!).getByText('インターン株式会社')).toBeInTheDocument()
  })

  it('インターン参加の企業がない場合でも、その欄で0件と分かる', async () => {
    setupFakeServer([COMPANY_A], [])

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    expect(internshipAccordionButton()).toHaveTextContent('インターン参加（0 件）')
    expect(
      within(queryInternshipRegion()!).getByText('インターン参加の企業は0件です。'),
    ).toBeInTheDocument()
    expect(within(queryInternshipRegion()!).queryByRole('table')).not.toBeInTheDocument()
  })

  it('ページを開いた時点で「内定」の欄は開き「お見送り・辞退」の欄は閉じていて、どちらも操作で開閉できる', async () => {
    setupFakeServer([COMPANY_A, COMPANY_OFFER, COMPANY_REJECTED], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 3 件')

    expect(offerAccordionButton()).toHaveAttribute('aria-expanded', 'true')
    expect(within(queryOfferRegion()!).getByText('内定株式会社')).toBeInTheDocument()
    expect(closedAccordionButton()).toHaveAttribute('aria-expanded', 'false')
    expect(queryClosedRegion()).toBeNull()
    expect(screen.queryByText('見送り商事')).not.toBeInTheDocument()

    await user.click(offerAccordionButton())
    expect(offerAccordionButton()).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(queryOfferRegion()).toBeNull())
    await user.click(offerAccordionButton())
    expect(offerAccordionButton()).toHaveAttribute('aria-expanded', 'true')
    expect(within(queryOfferRegion()!).getByText('内定株式会社')).toBeInTheDocument()

    await user.click(closedAccordionButton())
    expect(closedAccordionButton()).toHaveAttribute('aria-expanded', 'true')
    expect(within(queryClosedRegion()!).getByText('見送り商事')).toBeInTheDocument()
    await user.click(closedAccordionButton())
    expect(closedAccordionButton()).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(queryClosedRegion()).toBeNull())
  })

  it('選考状態がChipで表示され、5つの状態がそれぞれ見分けられる', async () => {
    setupFakeServer(
      [COMPANY_A, COMPANY_INTERNSHIP, COMPANY_OFFER, COMPANY_REJECTED, COMPANY_DECLINED],
      [],
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 5 件')
    await user.click(closedAccordionButton())

    const chipOf = (container: HTMLElement, name: string) =>
      statusChipOf(within(container).getByText(name).closest('tr')!)
    const inProgressChip = chipOf(inProgressTable(), '株式会社サンプル')
    const internshipChip = chipOf(queryInternshipRegion()!, 'インターン株式会社')
    const offerChip = chipOf(queryOfferRegion()!, '内定株式会社')
    const rejectedChip = chipOf(queryClosedRegion()!, '見送り商事')
    const declinedChip = chipOf(queryClosedRegion()!, '辞退工業')
    expect(inProgressChip).toHaveTextContent('選考中')
    expect(internshipChip).toHaveTextContent('インターン参加')
    expect(offerChip).toHaveTextContent('内定')
    expect(rejectedChip).toHaveTextContent('お見送り')
    expect(declinedChip).toHaveTextContent('辞退')
    const classNames = [inProgressChip, internshipChip, offerChip, rejectedChip, declinedChip].map(
      (chip) => chip.className,
    )
    expect(new Set(classNames).size).toBe(5)
  })

  it('未知の選考状態の企業は「お見送り・辞退」の欄に入る', async () => {
    const companyUnknown = {
      id: 8,
      name: '未知状態株式会社',
      status: '保留',
      is_deleted: false,
    } as unknown as Company
    setupFakeServer([COMPANY_A, companyUnknown], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    expect(internshipAccordionButton()).toHaveTextContent('（0 件）')
    expect(offerAccordionButton()).toHaveTextContent('（0 件）')
    expect(closedAccordionButton()).toHaveTextContent('（1 件）')
    await user.click(closedAccordionButton())
    const row = within(queryClosedRegion()!).getByText('未知状態株式会社').closest('tr')!
    expect(statusChipOf(row)).toHaveTextContent('保留')
  })

  it('選考中・内定の企業がない場合でも表示が破綻せず、それぞれ0件と分かる', async () => {
    setupFakeServer([COMPANY_DECLINED], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    expect(screen.getByText('選考中（0 件）')).toBeInTheDocument()
    expect(screen.getByText('選考中の企業は0件です。')).toBeInTheDocument()
    expect(offerAccordionButton()).toHaveTextContent('内定（0 件）')
    expect(within(queryOfferRegion()!).getByText('内定の企業は0件です。')).toBeInTheDocument()
    expect(within(queryOfferRegion()!).queryByRole('table')).not.toBeInTheDocument()
    expect(closedAccordionButton()).toHaveTextContent('お見送り・辞退（1 件）')
    await user.click(closedAccordionButton())
    expect(within(queryClosedRegion()!).getByText('辞退工業')).toBeInTheDocument()
  })

  it('お見送り・辞退の企業がない場合でも、その欄を開くと0件と分かる', async () => {
    setupFakeServer([COMPANY_OFFER], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    expect(closedAccordionButton()).toHaveTextContent('お見送り・辞退（0 件）')
    await user.click(closedAccordionButton())
    expect(
      within(queryClosedRegion()!).getByText('お見送り・辞退の企業は0件です。'),
    ).toBeInTheDocument()
    expect(within(queryClosedRegion()!).queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('次回選考の表示', () => {
  it('次回のステップがあれば「種別（M/D）」、予定日が無ければ日付未定、ステップが無ければ「—」', async () => {
    const companyC: Company = { id: 5, name: '株式会社ステップなし', status: '選考中', is_deleted: false }
    const undatedStep: InterviewStep = {
      ...STEP_A,
      id: 103,
      company_id: 2,
      type: '最終面接',
      date: null,
    }
    setupFakeServer([COMPANY_A, COMPANY_B, companyC], [STEP_A, STEP_B, undatedStep])

    renderPanel()
    await screen.findByText('取得件数: 3 件')

    const table = inProgressTable()
    const rowOf = (name: string) => within(table).getByText(name).closest('tr')!
    expect(within(rowOf('株式会社サンプル')).getByText('一次面接（3/1）')).toBeInTheDocument()
    expect(within(rowOf('合同会社テスト')).getByText('最終面接（日付未定）')).toBeInTheDocument()
    expect(within(rowOf('株式会社ステップなし')).getByText('—')).toBeInTheDocument()
  })

  it('「インターン参加」の欄にも同じ形式の次回選考の列が出る（予定日あり・日付未定・該当なし）', async () => {
    const internshipUndated: Company = {
      id: 12,
      name: '日付未定インターン株式会社',
      status: 'インターン参加',
      is_deleted: false,
    }
    const internshipNoStep: Company = {
      id: 13,
      name: 'ステップなしインターン株式会社',
      status: 'インターン参加',
      is_deleted: false,
    }
    const datedStep: InterviewStep = {
      ...STEP_A,
      id: 104,
      company_id: COMPANY_INTERNSHIP.id,
      type: 'インターン面接',
      date: '2026-12-05',
    }
    const undatedStep: InterviewStep = {
      ...STEP_A,
      id: 105,
      company_id: internshipUndated.id,
      type: '本選考面接',
      date: null,
    }
    setupFakeServer(
      [COMPANY_A, COMPANY_INTERNSHIP, internshipUndated, internshipNoStep],
      [datedStep, undatedStep],
    )

    renderPanel()
    await screen.findByText('取得件数: 4 件')

    const region = queryInternshipRegion()!
    expect(within(region).getByText('次回選考')).toBeInTheDocument()
    const rowOf = (name: string) => within(region).getByText(name).closest('tr')!
    expect(within(rowOf('インターン株式会社')).getByText('インターン面接（12/5）')).toBeInTheDocument()
    expect(
      within(rowOf('日付未定インターン株式会社')).getByText('本選考面接（日付未定）'),
    ).toBeInTheDocument()
    expect(within(rowOf('ステップなしインターン株式会社')).getByText('—')).toBeInTheDocument()
  })
})

describe('企業の選考状態の変更', () => {
  it('選考中から内定に変えると PATCH /companies/{id} を送り、一覧を取り直して「内定」の欄へ移る', async () => {
    const server = setupFakeServer([COMPANY_A, COMPANY_B], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    const listRequestsBefore = server.requests.filter(
      (r) => r.method === 'GET' && r.url === '/companies',
    ).length
    await changeCompanyStatus(user, '合同会社テスト', '内定')

    expect(
      await screen.findByText('企業「合同会社テスト」の選考状態を「内定」に変更しました。'),
    ).toBeInTheDocument()
    const patch = server.requests.find((r) => r.method === 'PATCH')
    expect(patch).toMatchObject({ url: '/companies/2', body: { status: '内定' } })
    expect(
      server.requests.filter((r) => r.method === 'GET' && r.url === '/companies').length,
    ).toBe(listRequestsBefore + 1)
    await waitFor(() =>
      expect(within(inProgressTable()).queryByText('合同会社テスト')).not.toBeInTheDocument(),
    )
    expect(offerAccordionButton()).toHaveTextContent('（1 件）')
    expect(within(queryOfferRegion()!).getByText('合同会社テスト')).toBeInTheDocument()
  })

  it('選考中から辞退に変えると PATCH を送り、一覧を取り直して「お見送り・辞退」の欄へ移る', async () => {
    const server = setupFakeServer([COMPANY_A, COMPANY_B], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await changeCompanyStatus(user, '合同会社テスト', '辞退')

    expect(
      await screen.findByText('企業「合同会社テスト」の選考状態を「辞退」に変更しました。'),
    ).toBeInTheDocument()
    const patch = server.requests.find((r) => r.method === 'PATCH')
    expect(patch).toMatchObject({ url: '/companies/2', body: { status: '辞退' } })
    await waitFor(() =>
      expect(within(inProgressTable()).queryByText('合同会社テスト')).not.toBeInTheDocument(),
    )
    expect(closedAccordionButton()).toHaveTextContent('（1 件）')
    await user.click(closedAccordionButton())
    const row = within(queryClosedRegion()!).getByText('合同会社テスト').closest('tr')!
    expect(statusChipOf(row)).toHaveTextContent('辞退')
  })

  it('内定から辞退に変えると「内定」の欄から「お見送り・辞退」の欄へ移る', async () => {
    setupFakeServer([COMPANY_A, COMPANY_OFFER], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await changeCompanyStatus(user, '内定株式会社', '辞退')

    const alert = await screen.findByText('企業「内定株式会社」の選考状態を「辞退」に変更しました。')
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorSuccess')
    await waitFor(() => expect(offerAccordionButton()).toHaveTextContent('（0 件）'))
    expect(within(queryOfferRegion()!).getByText('内定の企業は0件です。')).toBeInTheDocument()
    expect(closedAccordionButton()).toHaveTextContent('（1 件）')
    await user.click(closedAccordionButton())
    expect(within(queryClosedRegion()!).getByText('内定株式会社')).toBeInTheDocument()
  })

  it('辞退から内定へ戻す変更で警告が返ると、警告を表示しつつ変更は成立して「内定」の欄へ移る', async () => {
    setupFakeServer([COMPANY_DECLINED], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await user.click(closedAccordionButton())
    await changeCompanyStatus(user, '辞退工業', '内定')

    const alert = await screen.findByText(/意図的な変更か確認してください/)
    expect(alert).toHaveTextContent('辞退 から 内定 への変更です')
    expect(alert).toHaveTextContent('変更は保存されています')
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorWarning')
    await waitFor(() =>
      expect(within(queryOfferRegion()!).getByText('辞退工業')).toBeInTheDocument(),
    )
    expect(closedAccordionButton()).toHaveTextContent('（0 件）')
  })

  it('内定から選考中へ戻す逆行は警告を表示しつつ、変更は成立して選考中の表へ移る', async () => {
    setupFakeServer([COMPANY_A, COMPANY_OFFER], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await changeCompanyStatus(user, '内定株式会社', '選考中')

    const alert = await screen.findByText(/意図的な変更か確認してください/)
    expect(alert).toHaveTextContent('内定 から 選考中 への変更です')
    expect(alert).toHaveTextContent('変更は保存されています')
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorWarning')
    await waitFor(() =>
      expect(within(inProgressTable()).getByText('内定株式会社')).toBeInTheDocument(),
    )
    expect(offerAccordionButton()).toHaveTextContent('（0 件）')
  })

  it('辞退から選考中へ戻す逆行は警告を表示しつつ、変更は成立して選考中の表へ移る', async () => {
    setupFakeServer([COMPANY_DECLINED], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await user.click(closedAccordionButton())
    await changeCompanyStatus(user, '辞退工業', '選考中')

    const alert = await screen.findByText(/意図的な変更か確認してください/)
    expect(alert).toHaveTextContent('辞退 から 選考中 への変更です')
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorWarning')
    await waitFor(() =>
      expect(within(inProgressTable()).getByText('辞退工業')).toBeInTheDocument(),
    )
    expect(closedAccordionButton()).toHaveTextContent('（0 件）')
  })

  it('選考中からインターン参加に変えると警告なしで「インターン参加」の欄へ移る', async () => {
    const server = setupFakeServer([COMPANY_A, COMPANY_B], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await changeCompanyStatus(user, '合同会社テスト', 'インターン参加')

    const alert = await screen.findByText(
      '企業「合同会社テスト」の選考状態を「インターン参加」に変更しました。',
    )
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorSuccess')
    expect(server.requests.find((r) => r.method === 'PATCH')).toMatchObject({
      url: '/companies/2',
      body: { status: 'インターン参加' },
    })
    await waitFor(() =>
      expect(within(queryInternshipRegion()!).getByText('合同会社テスト')).toBeInTheDocument(),
    )
    expect(within(inProgressTable()).queryByText('合同会社テスト')).not.toBeInTheDocument()
    expect(internshipAccordionButton()).toHaveTextContent('（1 件）')
  })

  it('インターン参加から選考中に変えると一覧を取り直して選考中の表へ移り、警告は出ない', async () => {
    const server = setupFakeServer([COMPANY_A, COMPANY_INTERNSHIP], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    const listRequestsBefore = server.requests.filter(
      (r) => r.method === 'GET' && r.url === '/companies',
    ).length
    await changeCompanyStatus(user, 'インターン株式会社', '選考中')

    const alert = await screen.findByText(
      '企業「インターン株式会社」の選考状態を「選考中」に変更しました。',
    )
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorSuccess')
    expect(screen.queryByText(/意図的な変更か確認してください/)).not.toBeInTheDocument()
    expect(server.requests.find((r) => r.method === 'PATCH')).toMatchObject({
      url: `/companies/${COMPANY_INTERNSHIP.id}`,
      body: { status: '選考中' },
    })
    expect(
      server.requests.filter((r) => r.method === 'GET' && r.url === '/companies').length,
    ).toBe(listRequestsBefore + 1)
    await waitFor(() =>
      expect(within(inProgressTable()).getByText('インターン株式会社')).toBeInTheDocument(),
    )
    expect(internshipAccordionButton()).toHaveTextContent('（0 件）')
  })

  it('インターン参加から内定に変えると警告なしで「内定」の欄へ移る', async () => {
    setupFakeServer([COMPANY_INTERNSHIP], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await changeCompanyStatus(user, 'インターン株式会社', '内定')

    const alert = await screen.findByText(
      '企業「インターン株式会社」の選考状態を「内定」に変更しました。',
    )
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorSuccess')
    await waitFor(() =>
      expect(within(queryOfferRegion()!).getByText('インターン株式会社')).toBeInTheDocument(),
    )
    expect(internshipAccordionButton()).toHaveTextContent('（0 件）')
  })

  it.each([
    { from: COMPANY_OFFER, openClosed: false },
    { from: COMPANY_REJECTED, openClosed: true },
    { from: COMPANY_DECLINED, openClosed: true },
  ])(
    '$from.status からインターン参加へ戻すと警告を表示しつつ、変更は成立して「インターン参加」の欄へ移る',
    async ({ from, openClosed }) => {
      setupFakeServer([from], [])
      const user = userEvent.setup()

      renderPanel()
      await screen.findByText('取得件数: 1 件')
      if (openClosed) {
        await user.click(closedAccordionButton())
      }
      await changeCompanyStatus(user, from.name, 'インターン参加')

      const alert = await screen.findByText(/意図的な変更か確認してください/)
      expect(alert).toHaveTextContent(`${from.status} から インターン参加 への変更です`)
      expect(alert).toHaveTextContent('変更は保存されています')
      expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorWarning')
      await waitFor(() =>
        expect(within(queryInternshipRegion()!).getByText(from.name)).toBeInTheDocument(),
      )
      expect(internshipAccordionButton()).toHaveTextContent('（1 件）')
      expect(offerAccordionButton()).toHaveTextContent('（0 件）')
      expect(closedAccordionButton()).toHaveTextContent('（0 件）')
    },
  )

  it('インターン参加への変更に失敗するとエラーを表示する', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'PATCH') {
          return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
        }
        return Promise.resolve(jsonResponse(200, [{ ...COMPANY_A, next_step: null }]))
      }),
    )

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await changeCompanyStatus(user, '株式会社サンプル', 'インターン参加')

    await waitFor(() => {
      const alerts = screen
        .getAllByRole('alert')
        .filter((alert) => alert.classList.contains('MuiAlert-colorError'))
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveTextContent('500')
    })
  })

  it('同じ状態を選び直しても送信しない', async () => {
    const server = setupFakeServer([COMPANY_A], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await changeCompanyStatus(user, '株式会社サンプル', '選考中')

    expect(server.requests.some((r) => r.method === 'PATCH')).toBe(false)
  })

  it('変更に失敗するとエラーを表示する', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'PATCH') {
          return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
        }
        return Promise.resolve(jsonResponse(200, [{ ...COMPANY_A, next_step: null }]))
      }),
    )

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await changeCompanyStatus(user, '株式会社サンプル', '辞退')

    // 最初から開いている「内定」の欄の0件表示（info）ではなく、エラーのアラートを待つ
    await waitFor(() => {
      const alerts = screen
        .getAllByRole('alert')
        .filter((alert) => alert.classList.contains('MuiAlert-colorError'))
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveTextContent('500')
    })
  })

  it('企業詳細で選考状態が分かる', async () => {
    setupFakeServer([COMPANY_A, COMPANY_REJECTED], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(closedAccordionButton())
    await user.click(screen.getByRole('button', { name: '企業「見送り商事」の詳細' }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('見送り商事')).toBeInTheDocument()
    expect(within(dialog).getByText('選考状態')).toBeInTheDocument()
    expect(within(dialog).getByText('お見送り').closest('.MuiChip-root')).not.toBeNull()
  })

  it('企業詳細で辞退の状態が分かる', async () => {
    setupFakeServer([COMPANY_A, COMPANY_DECLINED], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(closedAccordionButton())
    await user.click(screen.getByRole('button', { name: '企業「辞退工業」の詳細' }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('辞退工業')).toBeInTheDocument()
    expect(within(dialog).getByText('辞退').closest('.MuiChip-root')).not.toBeNull()
  })

  it('企業詳細でインターン参加の状態が分かる', async () => {
    setupFakeServer([COMPANY_A, COMPANY_INTERNSHIP], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(screen.getByRole('button', { name: '企業「インターン株式会社」の詳細' }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('インターン株式会社')).toBeInTheDocument()
    expect(within(dialog).getByText('インターン参加').closest('.MuiChip-root')).not.toBeNull()
  })
})

describe('選考ステップの変更後の企業一覧の取り直し', () => {
  it('選考ステップを追加すると企業一覧が取り直され、次回選考に反映される', async () => {
    const server = setupFakeServer([COMPANY_A], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    expect(within(inProgressTable()).getByText('—')).toBeInTheDocument()
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('選考ステップは0件です。')

    await user.click(screen.getByRole('button', { name: '選考ステップを追加' }))
    await user.type(screen.getByLabelText('種別', { exact: false }), '二次面接')
    fireEvent.change(screen.getByLabelText('予定日'), { target: { value: '2026-11-25' } })
    await user.click(screen.getByRole('button', { name: '追加する' }))
    await waitForDialogClosed()

    await waitFor(() =>
      expect(within(inProgressTable()).getByText('二次面接（11/25）')).toBeInTheDocument(),
    )
    const lastPost = server.requests.findIndex((r) => r.method === 'POST')
    expect(
      server.requests.slice(lastPost).some((r) => r.method === 'GET' && r.url === '/companies'),
    ).toBe(true)
  })

  it('選考ステップの結果を不通過に更新すると、自動お見送りの結果として「お見送り・辞退」の欄へ移る', async () => {
    setupFakeServer([COMPANY_A, COMPANY_B], [STEP_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('一次面接')

    await user.click(screen.getByRole('button', { name: '選考ステップ「一次面接」を編集' }))
    await selectOption(user, '結果', '不通過')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    await waitFor(() =>
      expect(within(inProgressTable()).queryByText('株式会社サンプル')).not.toBeInTheDocument(),
    )
    expect(closedAccordionButton()).toHaveTextContent('（1 件）')
    await user.click(closedAccordionButton())
    const row = within(queryClosedRegion()!).getByText('株式会社サンプル').closest('tr')!
    expect(statusChipOf(row)).toHaveTextContent('お見送り')
  })

  it('インターン参加の企業に不通過の選考ステップを追加すると、自動お見送りで「お見送り・辞退」の欄へ移る', async () => {
    setupFakeServer([COMPANY_A, COMPANY_INTERNSHIP], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await selectCompanySteps(user, 'インターン株式会社')
    await screen.findByText('選考ステップは0件です。')

    await user.click(screen.getByRole('button', { name: '選考ステップを追加' }))
    await user.type(screen.getByLabelText('種別', { exact: false }), 'インターン選考')
    await selectOption(user, '結果', '不通過')
    await user.click(screen.getByRole('button', { name: '追加する' }))
    await waitForDialogClosed()

    await waitFor(() => expect(internshipAccordionButton()).toHaveTextContent('（0 件）'))
    expect(closedAccordionButton()).toHaveTextContent('（1 件）')
    await user.click(closedAccordionButton())
    const row = within(queryClosedRegion()!).getByText('インターン株式会社').closest('tr')!
    expect(statusChipOf(row)).toHaveTextContent('お見送り')
  })

  it('インターン参加の企業の選考ステップの結果を不通過に更新すると、自動お見送りで「お見送り・辞退」の欄へ移る', async () => {
    const internshipStep: InterviewStep = { ...STEP_A, company_id: COMPANY_INTERNSHIP.id }
    setupFakeServer([COMPANY_A, COMPANY_INTERNSHIP], [internshipStep])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    expect(within(queryInternshipRegion()!).getByText('一次面接（3/1）')).toBeInTheDocument()
    await selectCompanySteps(user, 'インターン株式会社')
    await screen.findByText('一次面接')

    await user.click(screen.getByRole('button', { name: '選考ステップ「一次面接」を編集' }))
    await selectOption(user, '結果', '不通過')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    await waitFor(() => expect(internshipAccordionButton()).toHaveTextContent('（0 件）'))
    expect(closedAccordionButton()).toHaveTextContent('（1 件）')
    await user.click(closedAccordionButton())
    const row = within(queryClosedRegion()!).getByText('インターン株式会社').closest('tr')!
    expect(statusChipOf(row)).toHaveTextContent('お見送り')
  })

  it('選考ステップを削除すると企業一覧が取り直され、次回選考が無くなったことが反映される', async () => {
    setupFakeServer([COMPANY_A], [STEP_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    expect(within(inProgressTable()).getByText('一次面接（3/1）')).toBeInTheDocument()
    await selectCompanySteps(user, '株式会社サンプル')
    await screen.findByText('一次面接')

    await user.click(screen.getByRole('button', { name: '選考ステップ「一次面接」を削除' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    await waitForDialogClosed()

    await waitFor(() => expect(within(inProgressTable()).getByText('—')).toBeInTheDocument())
    expect(within(inProgressTable()).queryByText('一次面接（3/1）')).not.toBeInTheDocument()
  })
})
