import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { HourlyRate, Project, Task, WorkLog } from '../api/types'
import { WorkTrackingPanel } from './WorkTrackingPanel'

const BASE_URL = 'http://api.test.local:8000'
const API_KEY = 'valid-key'

const PROJECT_A: Project = {
  id: 1,
  name: 'ポートフォリオサイト制作',
  client_name: '株式会社サンプル',
  status: '契約中',
  reward: 10000,
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

const TASK_A1: Task = {
  id: 101,
  project_id: 1,
  name: '要件整理',
  status: '処理中',
  memo: null,
  is_deleted: false,
}

const TASK_A2: Task = {
  id: 102,
  project_id: 1,
  name: 'デザイン確認',
  status: '未着手',
  memo: null,
  is_deleted: false,
}

const TASK_B1: Task = {
  id: 201,
  project_id: 2,
  name: 'LPワイヤーフレーム',
  status: '未着手',
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
  projects: Project[]
  tasks: Task[]
  workLogs: WorkLog[]
  requests: { method: string; url: string; body: unknown }[]
}

function computeHourlyRate(server: FakeServer, projectId: number): HourlyRate {
  const project = server.projects.find((p) => p.id === projectId)!
  const taskIds = new Set(
    server.tasks.filter((t) => t.project_id === projectId && !t.is_deleted).map((t) => t.id),
  )
  const completed = server.workLogs.filter(
    (w) => taskIds.has(w.task_id) && !w.is_deleted && w.ended_at !== null,
  )
  const totalMs = completed.reduce(
    (sum, w) => sum + (new Date(w.ended_at!).getTime() - new Date(w.started_at!).getTime()),
    0,
  )
  const totalHours = totalMs / 3_600_000
  return {
    project_id: projectId,
    reward: project.reward,
    total_work_hours: totalHours,
    hourly_rate: totalHours > 0 ? project.reward / totalHours : null,
  }
}

/** 案件・タスク・稼働ログ・時給換算を模した簡易APIサーバー。 */
function setupFakeServer(projects: Project[], tasks: Task[], workLogs: WorkLog[]): FakeServer {
  const server: FakeServer = {
    projects: projects.map((p) => ({ ...p })),
    tasks: tasks.map((t) => ({ ...t })),
    workLogs: workLogs.map((w) => ({ ...w })),
    requests: [],
  }
  let nextId = Math.max(0, ...workLogs.map((w) => w.id)) + 1

  const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    server.requests.push({ method, url: `${url.pathname}${url.search}`, body })

    if (url.pathname === '/projects' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, server.projects.filter((p) => !p.is_deleted)))
    }

    const hourlyRateMatch = /^\/projects\/(\d+)\/hourly-rate$/.exec(url.pathname)
    if (hourlyRateMatch !== null && method === 'GET') {
      const projectId = Number(hourlyRateMatch[1])
      return Promise.resolve(jsonResponse(200, computeHourlyRate(server, projectId)))
    }

    const tasksMatch = /^\/projects\/(\d+)\/tasks$/.exec(url.pathname)
    if (tasksMatch !== null && method === 'GET') {
      const projectId = Number(tasksMatch[1])
      const visible = server.tasks.filter((t) => t.project_id === projectId && !t.is_deleted)
      return Promise.resolve(jsonResponse(200, visible))
    }

    const workLogListMatch = /^\/tasks\/(\d+)\/work-logs$/.exec(url.pathname)
    if (workLogListMatch !== null && method === 'GET') {
      const taskId = Number(workLogListMatch[1])
      const visible = server.workLogs.filter((w) => w.task_id === taskId && !w.is_deleted)
      return Promise.resolve(jsonResponse(200, visible))
    }

    const startMatch = /^\/tasks\/(\d+)\/work-logs\/start$/.exec(url.pathname)
    if (startMatch !== null && method === 'POST') {
      const taskId = Number(startMatch[1])
      const created: WorkLog = {
        id: nextId,
        task_id: taskId,
        started_at: `2026-08-13T10:00:0${nextId}`,
        ended_at: null,
        memo: null,
        is_deleted: false,
      }
      nextId += 1
      server.workLogs.push(created)
      return Promise.resolve(jsonResponse(201, created))
    }

    const stopMatch = /^\/work-logs\/(\d+)\/stop$/.exec(url.pathname)
    if (stopMatch !== null && method === 'PATCH') {
      const id = Number(stopMatch[1])
      const target = server.workLogs.find((w) => w.id === id && !w.is_deleted)
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'WorkLog not found' }))
      }
      target.ended_at = '2026-08-13T11:30:00'
      return Promise.resolve(jsonResponse(200, target))
    }

    const workLogMatch = /^\/work-logs\/(\d+)$/.exec(url.pathname)
    if (workLogMatch !== null && method === 'DELETE') {
      const id = Number(workLogMatch[1])
      const target = server.workLogs.find((w) => w.id === id && !w.is_deleted)
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'WorkLog not found' }))
      }
      target.is_deleted = true
      return Promise.resolve(new Response(null, { status: 204 }))
    }

    return Promise.resolve(jsonResponse(404, { detail: 'Not Found' }))
  }

  vi.stubGlobal('fetch', vi.fn(handler))
  return server
}

function renderPanel() {
  return render(<WorkTrackingPanel apiKey={API_KEY} />)
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

async function selectTask(user: ReturnType<typeof userEvent.setup>, taskLabel: string) {
  await selectOption(user, 'タスクを選択', taskLabel)
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

describe('計測の開始・終了', () => {
  it('タスクを選んで計測を開始すると、進行中のログとして一覧に反映される', async () => {
    const server = setupFakeServer([PROJECT_A], [TASK_A1], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await selectTask(user, '要件整理')
    await screen.findByText('稼働ログは0件です。')

    await user.click(screen.getByRole('button', { name: '計測開始' }))

    expect(await screen.findByText('計測を開始しました。')).toBeInTheDocument()
    expect(await screen.findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(screen.getByText('進行中', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(
      server.requests.some(
        (r) => r.method === 'POST' && r.url === '/tasks/101/work-logs/start',
      ),
    ).toBe(true)
  })

  it('進行中のログに対して計測終了すると、終了済みとして表示が変わる', async () => {
    const server = setupFakeServer(
      [PROJECT_A],
      [TASK_A1],
      [{ id: 1, task_id: 101, started_at: '2026-08-13T10:00:00', ended_at: null, memo: null, is_deleted: false }],
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await selectTask(user, '要件整理')
    await screen.findByText('進行中', { selector: '.MuiChip-label' })

    await user.click(screen.getByRole('button', { name: /計測を終了/ }))

    expect(await screen.findByText('計測を終了しました。')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('進行中', { selector: '.MuiChip-label' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('終了済み', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('1時間30分')).toBeInTheDocument()
    expect(
      server.requests.some((r) => r.method === 'PATCH' && r.url === '/work-logs/1/stop'),
    ).toBe(true)
  })
})

describe('多重計測・同時計測', () => {
  it('同一タスク内で複数回計測を開始すると、別レコードとして両方表示される', async () => {
    const server = setupFakeServer([PROJECT_A], [TASK_A1], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await selectTask(user, '要件整理')
    await screen.findByText('稼働ログは0件です。')

    await user.click(screen.getByRole('button', { name: '計測開始' }))
    await screen.findByText('取得件数: 1 件')
    await user.click(screen.getByRole('button', { name: '計測開始' }))

    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(screen.getAllByText('進行中', { selector: '.MuiChip-label' })).toHaveLength(2)
    expect(server.requests.filter((r) => r.method === 'POST').length).toBe(2)
  })

  it('別タスク・別案件を選び直しても、それぞれ独立に計測を開始・表示できる', async () => {
    const server = setupFakeServer(
      [PROJECT_A, PROJECT_B],
      [TASK_A1, TASK_A2, TASK_B1],
      [],
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await selectTask(user, '要件整理')
    await user.click(screen.getByRole('button', { name: '計測開始' }))
    await screen.findByText('取得件数: 1 件')

    await selectProject(user, 'LP制作（提案中）')
    await selectTask(user, 'LPワイヤーフレーム')
    await screen.findByText('稼働ログは0件です。')
    await user.click(screen.getByRole('button', { name: '計測開始' }))

    expect(await screen.findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(
      server.requests.some(
        (r) => r.method === 'POST' && r.url === '/tasks/101/work-logs/start',
      ),
    ).toBe(true)
    expect(
      server.requests.some(
        (r) => r.method === 'POST' && r.url === '/tasks/201/work-logs/start',
      ),
    ).toBe(true)
  })
})

describe('稼働ログの削除', () => {
  it('稼働ログを削除でき、削除後は一覧に表示されなくなる', async () => {
    const server = setupFakeServer(
      [PROJECT_A],
      [TASK_A1],
      [
        {
          id: 1,
          task_id: 101,
          started_at: '2026-08-13T10:00:00',
          ended_at: null,
          memo: null,
          is_deleted: false,
        },
      ],
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await selectTask(user, '要件整理')
    await screen.findByText('取得件数: 1 件')

    await user.click(screen.getByRole('button', { name: '稼働ログ（ID: 1）を削除' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/稼働ログ（ID: 1）を削除します/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('稼働ログ（ID: 1）を削除しました。')).toBeInTheDocument()
    expect(await screen.findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(screen.getByText('稼働ログは0件です。')).toBeInTheDocument()
    expect(
      server.requests.some((r) => r.method === 'DELETE' && r.url === '/work-logs/1'),
    ).toBe(true)
  })

  it('キャンセルすると削除されない', async () => {
    const server = setupFakeServer(
      [PROJECT_A],
      [TASK_A1],
      [
        {
          id: 1,
          task_id: 101,
          started_at: '2026-08-13T10:00:00',
          ended_at: null,
          memo: null,
          is_deleted: false,
        },
      ],
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await selectTask(user, '要件整理')
    await screen.findByText('取得件数: 1 件')

    await user.click(screen.getByRole('button', { name: '稼働ログ（ID: 1）を削除' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitForDialogClosed()

    expect(server.requests.some((r) => r.method === 'DELETE')).toBe(false)
    expect(screen.getByText('取得件数: 1 件')).toBeInTheDocument()
  })
})

describe('時給換算', () => {
  it('案件を選ぶと時給換算結果（報酬額・合計稼働時間・時給）が表示される', async () => {
    setupFakeServer(
      [PROJECT_A],
      [TASK_A1],
      [
        {
          id: 1,
          task_id: 101,
          started_at: '2026-08-13T10:00:00',
          ended_at: '2026-08-13T12:00:00',
          memo: null,
          is_deleted: false,
        },
      ],
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')

    expect(await screen.findByText('報酬額: 10,000 円')).toBeInTheDocument()
    expect(screen.getByText(/合計稼働時間.*2 時間/)).toBeInTheDocument()
    expect(screen.getByText('換算時給: 5,000 円/時')).toBeInTheDocument()
  })

  it('合計稼働時間が0の場合でも画面が破綻せず、換算できない旨が表示される', async () => {
    setupFakeServer([PROJECT_A], [TASK_A1], [])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')

    expect(await screen.findByText('報酬額: 10,000 円')).toBeInTheDocument()
    expect(
      await screen.findByText('時給を算出できません（稼働実績がありません）。'),
    ).toBeInTheDocument()
  })

  it('進行中のログのみの場合も合計稼働時間0として画面が破綻しない', async () => {
    setupFakeServer(
      [PROJECT_A],
      [TASK_A1],
      [
        {
          id: 1,
          task_id: 101,
          started_at: '2026-08-13T10:00:00',
          ended_at: null,
          memo: null,
          is_deleted: false,
        },
      ],
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')

    expect(
      await screen.findByText('時給を算出できません（稼働実績がありません）。'),
    ).toBeInTheDocument()
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

  it('稼働ログ一覧の取得に失敗すると原因が分かるメッセージを表示する', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const pathname = new URL(String(input)).pathname
        if (pathname === '/projects') {
          return Promise.resolve(jsonResponse(200, [PROJECT_A]))
        }
        if (pathname === '/projects/1/tasks') {
          return Promise.resolve(jsonResponse(200, [TASK_A1]))
        }
        if (pathname === '/projects/1/hourly-rate') {
          // hourly_rateをnullにすると情報用Alertも role="alert" で描画され、
          // このテストが検証したい稼働ログ取得エラーのAlertと衝突するため非null値にする
          return Promise.resolve(
            jsonResponse(200, { project_id: 1, reward: 10000, total_work_hours: 2, hourly_rate: 5000 }),
          )
        }
        return Promise.resolve(jsonResponse(500, { detail: 'Internal Server Error' }))
      }),
    )

    renderPanel()
    await screen.findByLabelText('案件を選択')
    await selectProject(user, 'ポートフォリオサイト制作（契約中）')
    await selectTask(user, '要件整理')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('500')
  })
})
