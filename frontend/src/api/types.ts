/** APIのレスポンス／リクエストで扱う型。 */

/** Project.statusの取りうる値（バックエンドの状態遷移グラフのキーと同じ集合）。 */
export const PROJECT_STATUSES = ['提案中', '契約中', '納品済み', '完了', '見送り'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export type Project = {
  id: number
  name: string
  client_name: string
  // 表示は取得した値をそのまま扱う（APIのレスポンスはstrのため、未知の値でも壊れないようにする）
  status: string
  reward: number
  applied_date: string
  deadline: string | null
  platform: string
  memo: string | null
  is_deleted: boolean
}

/** 案件の作成・更新で送信する内容。 */
export type ProjectInput = {
  name: string
  client_name: string
  status: ProjectStatus
  reward: number
  applied_date: string
  deadline: string | null
  platform: string
  memo: string | null
}

/** PATCH /projects/{id} のレスポンス。逆行遷移時のみwarningが入る。 */
export type ProjectPatchResponse = Project & {
  warning: string | null
}

/** Task.statusの取りうる値（バックエンドの状態遷移グラフのキーと同じ集合）。 */
export const TASK_STATUSES = ['未着手', '処理中', '完了'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export type Task = {
  id: number
  project_id: number
  name: string
  // 表示は取得した値をそのまま扱う（APIのレスポンスはstrのため、未知の値でも壊れないようにする）
  status: string
  memo: string | null
  is_deleted: boolean
}

/** タスクの作成・更新で送信する内容。 */
export type TaskInput = {
  name: string
  status: TaskStatus
  memo: string | null
}

/** PATCH /tasks/{id} のレスポンス。逆行遷移時のみwarningが入る。 */
export type TaskPatchResponse = Task & {
  warning: string | null
}

export type WorkLog = {
  id: number
  task_id: number
  started_at: string | null
  ended_at: string | null
  memo: string | null
  is_deleted: boolean
}

/** GET /work-logs/running のレスポンス。どのタスク・案件の稼働かを一覧側で判別できるよう、
 * WorkLog相当のフィールドに加えtask_name/project_id/project_nameを含む（バックエンドの
 * RunningWorkLogReadと対応）。 */
export type RunningWorkLog = {
  id: number
  task_id: number
  task_name: string
  project_id: number
  project_name: string
  started_at: string | null
  ended_at: string | null
  memo: string | null
  is_deleted: boolean
}

/** GET /projects/{id}/hourly-rate のレスポンス。稼働実績が無い場合hourly_rateはnull。 */
export type HourlyRate = {
  project_id: number
  reward: number
  total_work_hours: number
  hourly_rate: number | null
}

export type Company = {
  id: number
  name: string
  is_deleted: boolean
}

/** 企業の登録で送信する内容。 */
export type CompanyInput = {
  name: string
}

/** InterviewStep.prep_statusの取りうる値（バックエンドの状態遷移グラフのキーと同じ集合）。 */
export const INTERVIEW_STEP_PREP_STATUSES = ['準備中', '準備万端', '完了'] as const

export type InterviewStepPrepStatus = (typeof INTERVIEW_STEP_PREP_STATUSES)[number]

/** InterviewStep.resultの取りうる値（バックエンドの状態遷移グラフのキーと同じ集合）。 */
export const INTERVIEW_STEP_RESULTS = ['未定', '通過', '不通過'] as const

export type InterviewStepResult = (typeof INTERVIEW_STEP_RESULTS)[number]

export type InterviewStep = {
  id: number
  company_id: number
  type: string
  date: string | null
  // 表示は取得した値をそのまま扱う（APIのレスポンスはstrのため、未知の値でも壊れないようにする）
  prep_status: string
  result: string
  memo: string | null
  is_deleted: boolean
}

/** 選考ステップの作成・更新で送信する内容。 */
export type InterviewStepInput = {
  type: string
  date: string | null
  prep_status: InterviewStepPrepStatus
  result: InterviewStepResult
  memo: string | null
}

/** PATCH /interview-steps/{id} のレスポンス。逆行遷移時のみwarningが入る
 * （prep_status・result両方が同時に逆行した場合は" / "区切りで1つの文字列にまとめられる）。 */
export type InterviewStepPatchResponse = InterviewStep & {
  warning: string | null
}
