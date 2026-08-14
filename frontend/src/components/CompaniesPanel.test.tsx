import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Company, CompanyTask, InterviewStep } from '../api/types'
import { CompaniesPanel } from './CompaniesPanel'

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
      return Promise.resolve(jsonResponse(200, server.companies.filter((c) => !c.is_deleted)))
    }
    if (url.pathname === '/companies' && method === 'POST') {
      const created = { ...(body as Omit<Company, 'id' | 'is_deleted'>), id: nextCompanyId, is_deleted: false }
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
        Object.assign(target, patch)
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

  it('削除済みの企業の詳細は参照できず、404と分かるメッセージを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new URL(String(input)).pathname === '/companies'
            ? jsonResponse(200, [COMPANY_B])
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
          return Promise.resolve(jsonResponse(200, [COMPANY_A]))
        }
        return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
      }),
    )

    renderPanel()
    await screen.findByText('株式会社サンプル')
    await selectCompanySteps(user, '株式会社サンプル')

    // 選考ステップ・企業タスクの両方が同じ500エラーを返すため、両方のアラートを確認する
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
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
          return Promise.resolve(jsonResponse(200, [COMPANY_A]))
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
