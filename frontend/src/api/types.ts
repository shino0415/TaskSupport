/** APIのレスポンス／リクエストで扱う型。 */

/** Course.day_of_weekの取りうる値（バックエンドのDayOfWeekと同じ集合）。 */
export const COURSE_DAYS_OF_WEEK = ['月', '火', '水', '木', '金', '土', '日'] as const

export type CourseDayOfWeek = (typeof COURSE_DAYS_OF_WEEK)[number]

/** Course.termの取りうる値（バックエンドのTermと同じ集合）。 */
export const COURSE_TERMS = ['前期', '後期', '通年'] as const

export type CourseTerm = (typeof COURSE_TERMS)[number]

export type Course = {
  id: number
  name: string
  // 表示は取得した値をそのまま扱う（APIのレスポンスはstrのため、未知の値でも壊れないようにする）
  day_of_week: string | null
  period: number | null
  academic_year: number | null
  term: string | null
  memo: string | null
  is_deleted: boolean
}

/** 授業の作成・更新で送信する内容。任意項目はnullで未設定（更新時はクリア）を表す。 */
export type CourseInput = {
  name: string
  day_of_week: CourseDayOfWeek | null
  period: number | null
  academic_year: number | null
  term: CourseTerm | null
  memo: string | null
}

/** CompanyTask.statusの取りうる値（バックエンドの状態遷移グラフのキーと同じ集合）。 */
export const TASK_STATUSES = ['未着手', '処理中', '完了'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

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

export type CompanyTask = {
  id: number
  company_id: number
  name: string
  // 表示は取得した値をそのまま扱う（APIのレスポンスはstrのため、未知の値でも壊れないようにする）
  status: string
  memo: string | null
  is_deleted: boolean
}

/** 企業タスクの作成・更新で送信する内容。稼働時間の計測に関する項目は持たない。 */
export type CompanyTaskInput = {
  name: string
  status: TaskStatus
  memo: string | null
}

/** PATCH /company-tasks/{id} のレスポンス。逆行遷移時のみwarningが入る。 */
export type CompanyTaskPatchResponse = CompanyTask & {
  warning: string | null
}
