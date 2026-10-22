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

/** Assignment.statusの取りうる値（バックエンドの状態遷移グラフのキーと同じ集合）。 */
export const ASSIGNMENT_STATUSES = ['未着手', '取組中', '未提出', '提出済み'] as const

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

/** Assignment.submission_methodの取りうる値（バックエンドのSubmissionMethodと同じ集合）。 */
export const ASSIGNMENT_SUBMISSION_METHODS = ['WebClass', '紙', 'その他'] as const

export type AssignmentSubmissionMethod = (typeof ASSIGNMENT_SUBMISSION_METHODS)[number]

export type Assignment = {
  id: number
  course_id: number
  name: string
  // 表示は取得した値をそのまま扱う（APIのレスポンスはstrのため、未知の値でも壊れないようにする）
  status: string
  /** タイムゾーン無しの日時（例: "2026-11-01T23:59:00"）。 */
  deadline: string | null
  submission_method: string | null
  memo: string | null
  is_deleted: boolean
}

/** 課題の作成・更新で送信する内容。任意項目はnullで未設定（更新時はクリア）を表す。
 * deadlineはタイムゾーン無しの日時文字列のみ（オフセット付きはAPIが422で拒否する）。 */
export type AssignmentInput = {
  name: string
  status: AssignmentStatus
  deadline: string | null
  submission_method: AssignmentSubmissionMethod | null
  memo: string | null
}

/** PATCH /assignments/{id} のレスポンス。逆行遷移時のみwarningが入る。 */
export type AssignmentPatchResponse = Assignment & {
  warning: string | null
}

/** GET /assignments/upcoming の各要素。課題の全項目に所属授業の授業名が付く。 */
export type UpcomingAssignment = Assignment & {
  course_name: string
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
