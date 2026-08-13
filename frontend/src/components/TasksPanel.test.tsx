import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Project, Task } from '../api/types'
import { TasksPanel } from './TasksPanel'

const BASE_URL = 'http://api.test.local:8000'
const API_KEY = 'valid-key'

const PROJECT_A: Project = {
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

const PROJECT_B: Project = {
  id: 2,
  name: 'LP制作',
  client_name: '合同会社テスト',
  status: '提案中',
  reward: 50000,
  applied_date: '2026-08-05',
  deadline: null,
  platform: 'ランサーズ',
  memo: null,
  is_deleted: false,
}

const TASK_A: Task = {
  id: 101,
  project_id: 1,
  name: '要件整理',
  status: '処理中',
  memo: '初回ヒアリング済み',
  is_deleted: false,
}

const TASK_B: Task = {
  id: 102,
  project_id: 1,
  name: 'デザイン確認',
  status: '未着手',
  memo: null,
  is_deleted: false,
}

/** 逆行遷移の警告を返す線形順序（Task.statusの状態遷移グラフを模す）。 */
const STATUS_ORDER = ['未着手', '処理中', '完了']

type FakeServer = {
  projects: Project[]
  tasks: Task[]
  requests: { method: string; url: string; body: unknown }[]
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 案件一覧（選択肢）とタスクCRUDを模した簡易APIサーバー。 */
function setupFakeServer(projects: Project[], tasks: Task[]): FakeServer {
  const server: FakeServer = {
    projects: projects.map((p) => ({ ...p })),
    tasks: tasks.map((t) => ({ ...t })),
    requests: [],
  }
  let nextId = Math.max(0, ...tasks.map((t) => t.id)) + 1

  const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    server.requests.push({ method, url: `${url.pathname}${url.search}`, body })

    if (url.pathname === '/projects' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, server.projects.filter((p) => !p.is_deleted)))
    }

    const listOrCreateMatch = /^\/projects\/(\d+)\/tasks$/.exec(url.pathname)
    if (listOrCreateMatch !== null && method === 'GET') {
      const projectId = Number(listOrCreateMatch[1])
      const visible = server.tasks.filter((t) => t.project_id === projectId && !t.is_deleted)
      return Promise.resolve(jsonResponse(200, visible))
    }
    if (listOrCreateMatch !== null && method === 'POST') {
      const projectId = Number(listOrCreateMatch[1])
      const created = {
        ...(body as Omit<Task, 'id' | 'project_id' | 'is_deleted'>),
        id: nextId,
        project_id: projectId,
        is_deleted: false,
      }
      nextId += 1
      server.tasks.push(created)
      return Promise.resolve(jsonResponse(201, created))
    }

    const taskMatch = /^\/tasks\/(\d+)$/.exec(url.pathname)
    if (taskMatch !== null) {
      const id = Number(taskMatch[1])
      const target = server.tasks.find((t) => t.id === id && !t.is_deleted)
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'Task not found' }))
      }
      if (method === 'PATCH') {
        const patch = body as Partial<Task>
        const before = target.status
        Object.assign(target, patch)
        const isBackward =
          patch.status !== undefined &&
          STATUS_ORDER.includes(before) &&
          STATUS_ORDER.includes(patch.status) &&
          STATUS_ORDER.indexOf(patch.status) < STATUS_ORDER.indexOf(before)
        return Promise.resolve(
          jsonResponse(200, {
            ...target,
            warning: isBackward
              ? `${before} から ${patch.status} への変更です。意図的な変更か確認してください。`
              : null,
          }),
        )
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
  return render(<TasksPanel apiKey={API_KEY} />)
}

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole('option', { name: option }))
}

async function selectProject(user: ReturnType<typeof userEvent.setup>, projectLabel: string) {
  await selectOption(user, '案件を選択', projectLabel)
}

async function waitForDialogClosed() {
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('案件の選択とタスク一覧', () => {
  it('案件を選ぶとその配下のタスク一覧が表示され、GET /projects/{id}/tasks を叩く', async () => {
    const server = setupFakeServer([PROJECT_A, PROJECT_B], [TASK_A, TASK_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')

    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(screen.getByText('要件整理')).toBeInTheDocument()
    expect(screen.getByText('デザイン確認')).toBeInTheDocument()
    expect(
      server.requests.some(
        (request) => request.method === 'GET' && request.url === '/projects/1/tasks',
      ),
    ).toBe(true)
  })

  it('案件を切り替えると別案件のタスク一覧に切り替わる', async () => {
    setupFakeServer([PROJECT_A, PROJECT_B], [TASK_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await screen.findByText('要件整理')

    await selectProject(user, 'LP制作（提案中）')

    expect(await screen.findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(screen.getByText('タスクは0件です。')).toBeInTheDocument()
  })

  it('タスクが0件の案件でも表示が破綻しない', async () => {
    setupFakeServer([PROJECT_A, PROJECT_B], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')

    expect(await screen.findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(screen.getByText('タスクは0件です。')).toBeInTheDocument()
  })
})

describe('新規追加', () => {
  it('フォームから追加でき、追加内容が一覧に反映される', async () => {
    const server = setupFakeServer([PROJECT_A], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await screen.findByText('取得件数: 0 件')

    await user.click(screen.getByRole('button', { name: 'タスクを追加' }))
    await user.type(screen.getByLabelText('タスク名', { exact: false }), '見積もり作成')
    await selectOption(user, 'ステータス', '処理中')
    await user.type(screen.getByLabelText('メモ'), '先方確認待ち')
    await user.click(screen.getByRole('button', { name: '追加する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('タスクを追加しました。')).toBeInTheDocument()
    expect(await screen.findByText('見積もり作成')).toBeInTheDocument()
    expect(screen.getByText('取得件数: 1 件')).toBeInTheDocument()

    const created = server.requests.find((request) => request.method === 'POST')
    expect(created?.url).toBe('/projects/1/tasks')
    expect(created?.body).toEqual({ name: '見積もり作成', status: '処理中', memo: '先方確認待ち' })
  })

  it('タスク名が未入力ならメッセージを表示し、送信しない', async () => {
    const server = setupFakeServer([PROJECT_A], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await screen.findByText('取得件数: 0 件')

    await user.click(screen.getByRole('button', { name: 'タスクを追加' }))
    await user.click(screen.getByRole('button', { name: '追加する' }))

    expect(await screen.findByText('タスク名を入力してください。')).toBeInTheDocument()
    expect(server.requests.some((request) => request.method === 'POST')).toBe(false)
  })
})

describe('編集', () => {
  it('各項目を編集でき、変更内容が一覧に反映される', async () => {
    const server = setupFakeServer([PROJECT_A], [TASK_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await screen.findByText('デザイン確認')

    await user.click(screen.getByRole('button', { name: 'タスク「デザイン確認」を編集' }))
    const nameField = screen.getByLabelText('タスク名', { exact: false })
    await user.clear(nameField)
    await user.type(nameField, 'デザイン確認（修正反映）')
    await selectOption(user, 'ステータス', '処理中')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('タスクを更新しました。')).toBeInTheDocument()
    expect(await screen.findByText('デザイン確認（修正反映）')).toBeInTheDocument()
    const patch = server.requests.find((request) => request.method === 'PATCH')
    expect(patch?.url).toBe('/tasks/102')
    expect(patch?.body).toMatchObject({ name: 'デザイン確認（修正反映）', status: '処理中' })
  })

  it('ステータス逆行時はAPIの警告を表示しつつ、更新自体は成立する', async () => {
    setupFakeServer([PROJECT_A], [{ ...TASK_A, status: '完了' }])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await screen.findByText('要件整理')

    await user.click(screen.getByRole('button', { name: 'タスク「要件整理」を編集' }))
    await selectOption(user, 'ステータス', '処理中')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    const alert = await screen.findByText(/意図的な変更か確認してください/)
    expect(alert).toHaveTextContent('完了 から 処理中 への変更です')
    expect(alert).toHaveTextContent('変更は保存されています')
    expect(
      within(screen.getByRole('table')).getByText('処理中'),
    ).toBeInTheDocument()
  })
})

describe('削除', () => {
  it('確認のうえ削除でき、削除後は一覧に表示されなくなる', async () => {
    const server = setupFakeServer([PROJECT_A], [TASK_A, TASK_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await screen.findByText('取得件数: 2 件')

    await user.click(screen.getByRole('button', { name: 'タスク「デザイン確認」を削除' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/タスク「デザイン確認」を削除します/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('タスク「デザイン確認」を削除しました。')).toBeInTheDocument()
    expect(await screen.findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(screen.queryByText('デザイン確認')).not.toBeInTheDocument()
    expect(
      server.requests.some((r) => r.method === 'DELETE' && r.url === '/tasks/102'),
    ).toBe(true)
  })

  it('キャンセルすると削除されない', async () => {
    const server = setupFakeServer([PROJECT_A], [TASK_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await screen.findByText('要件整理')

    await user.click(screen.getByRole('button', { name: 'タスク「要件整理」を削除' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitForDialogClosed()

    expect(server.requests.some((request) => request.method === 'DELETE')).toBe(false)
    expect(screen.getByText('要件整理')).toBeInTheDocument()
  })
})

describe('通信エラー', () => {
  it('案件一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(401, { detail: 'Invalid or missing API Key' }))),
    )

    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('401')
    expect(alert).toHaveTextContent('API Key')
  })

  it('タスク一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const pathname = new URL(String(input)).pathname
        if (pathname === '/projects') {
          return Promise.resolve(jsonResponse(200, [PROJECT_A]))
        }
        return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
      }),
    )

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('500')
  })
})

describe('横断一覧等からの遷移（初期選択）', () => {
  it('initialSelectedProjectIdを渡すと、その案件のタスク一覧が最初から表示される', async () => {
    setupFakeServer([PROJECT_A, PROJECT_B], [TASK_A, TASK_B])

    render(<TasksPanel apiKey={API_KEY} initialSelectedProjectId={PROJECT_A.id} />)

    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(screen.getByText('要件整理')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '案件を選択' })).toHaveTextContent(
      'ポートフォリオサイト制作（契約中）',
    )
  })

  it('initialHighlightTaskIdを渡すと、対象タスクの行が目立つ表示になる', async () => {
    setupFakeServer([PROJECT_A, PROJECT_B], [TASK_A, TASK_B])

    render(
      <TasksPanel
        apiKey={API_KEY}
        initialSelectedProjectId={PROJECT_A.id}
        initialHighlightTaskId={TASK_B.id}
      />,
    )

    await screen.findByText('取得件数: 2 件')
    const highlightedRow = screen.getByText('デザイン確認').closest('tr')!
    expect(highlightedRow).toHaveAttribute('aria-current', 'true')
    expect(within(highlightedRow).getByText('対象のタスク')).toBeInTheDocument()
    const otherRow = screen.getByText('要件整理').closest('tr')!
    expect(otherRow).not.toHaveAttribute('aria-current')
  })
})
