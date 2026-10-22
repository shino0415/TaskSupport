import { useCallback, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'

import {
  createAssignment,
  deleteAssignment,
  fetchAssignments,
  updateAssignment,
} from '../api/assignments'
import { createCourse, deleteCourse, fetchCourses, updateCourse } from '../api/courses'
import { toDisplayMessage } from '../api/errors'
import type { Assignment, AssignmentInput, Course, CourseInput } from '../api/types'
import { formatDeadline } from '../assignmentDeadline'
import { AssignmentFormDialog } from './AssignmentFormDialog'
import { CourseFormDialog } from './CourseFormDialog'

type Props = {
  apiKey: string
  /** 横断一覧等からの遷移で、指定した授業を選択した状態（課題一覧を表示した状態）で開く。 */
  initialSelectedCourseId?: number | null
}

type Notice = {
  severity: 'success' | 'warning'
  message: string
}

const NO_SELECTION = '' as const

/**
 * 授業の一覧・登録・編集・削除と、選択した授業配下の課題の一覧・追加・編集・削除を
 * まとめた画面。授業のレスポンスは課題の情報を含めないため、課題は別途
 * GET /courses/{id}/assignments で取得して表示する。
 */
export function CoursesPanel({ apiKey, initialSelectedCourseId = null }: Props) {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null)

  const [selectedCourseId, setSelectedCourseId] = useState<number | typeof NO_SELECTION>(
    NO_SELECTION,
  )

  const [assignments, setAssignments] = useState<Assignment[] | null>(null)
  const [assignmentsErrorMessage, setAssignmentsErrorMessage] = useState<string | null>(null)
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false)

  const [isAssignmentFormOpen, setIsAssignmentFormOpen] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null)
  const [assignmentFormErrorMessage, setAssignmentFormErrorMessage] = useState<string | null>(
    null,
  )
  const [isSubmittingAssignment, setIsSubmittingAssignment] = useState(false)

  const [deleteAssignmentTarget, setDeleteAssignmentTarget] = useState<Assignment | null>(null)

  const reload = useCallback(async () => {
    if (apiKey === '') {
      setCourses(null)
      setErrorMessage(null)
      return
    }
    setIsLoading(true)
    setErrorMessage(null)
    try {
      setCourses(await fetchCourses(apiKey))
    } catch (error) {
      setCourses(null)
      setErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [apiKey])

  useEffect(() => {
    void reload()
  }, [reload])

  // 横断一覧等からの遷移（initialSelectedCourseIdの指定）で、授業を自動的に選択する
  useEffect(() => {
    if (initialSelectedCourseId !== null) {
      setSelectedCourseId(initialSelectedCourseId)
    }
  }, [initialSelectedCourseId])

  const reloadAssignments = useCallback(async () => {
    if (apiKey === '' || selectedCourseId === NO_SELECTION) {
      setAssignments(null)
      setAssignmentsErrorMessage(null)
      return
    }
    setIsLoadingAssignments(true)
    setAssignmentsErrorMessage(null)
    try {
      setAssignments(await fetchAssignments(apiKey, selectedCourseId))
    } catch (error) {
      setAssignments(null)
      setAssignmentsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoadingAssignments(false)
    }
  }, [apiKey, selectedCourseId])

  useEffect(() => {
    void reloadAssignments()
  }, [reloadAssignments])

  const openCreateForm = () => {
    setEditingCourse(null)
    setFormErrorMessage(null)
    setIsFormOpen(true)
  }

  const openEditForm = (course: Course) => {
    setEditingCourse(course)
    setFormErrorMessage(null)
    setIsFormOpen(true)
  }

  const handleSubmit = async (input: CourseInput) => {
    setIsSubmitting(true)
    setFormErrorMessage(null)
    try {
      if (editingCourse === null) {
        await createCourse(apiKey, input)
        setNotice({ severity: 'success', message: '授業を登録しました。' })
      } else {
        await updateCourse(apiKey, editingCourse.id, input)
        setNotice({ severity: 'success', message: '授業を更新しました。' })
      }
      setIsFormOpen(false)
      await reload()
    } catch (error) {
      setFormErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (course: Course) => {
    setIsSubmitting(true)
    try {
      await deleteCourse(apiKey, course.id)
      setDeleteTarget(null)
      if (selectedCourseId === course.id) {
        setSelectedCourseId(NO_SELECTION)
      }
      setNotice({ severity: 'success', message: `授業「${course.name}」を削除しました。` })
      await reload()
    } catch (error) {
      setDeleteTarget(null)
      setErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const openCreateAssignmentForm = () => {
    setEditingAssignment(null)
    setAssignmentFormErrorMessage(null)
    setIsAssignmentFormOpen(true)
  }

  const openEditAssignmentForm = (assignment: Assignment) => {
    setEditingAssignment(assignment)
    setAssignmentFormErrorMessage(null)
    setIsAssignmentFormOpen(true)
  }

  const handleSubmitAssignment = async (input: AssignmentInput) => {
    if (selectedCourseId === NO_SELECTION) {
      return
    }
    setIsSubmittingAssignment(true)
    setAssignmentFormErrorMessage(null)
    try {
      if (editingAssignment === null) {
        await createAssignment(apiKey, selectedCourseId, input)
        setNotice({ severity: 'success', message: '課題を追加しました。' })
      } else {
        const updated = await updateAssignment(apiKey, editingAssignment.id, input)
        // ステータスの逆行はブロックされず、更新は成立したうえで警告が返る
        setNotice(
          updated.warning === null
            ? { severity: 'success', message: '課題を更新しました。' }
            : {
                severity: 'warning',
                message: `課題を更新しました（変更は保存されています）。${updated.warning}`,
              },
        )
      }
      setIsAssignmentFormOpen(false)
      await reloadAssignments()
    } catch (error) {
      setAssignmentFormErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmittingAssignment(false)
    }
  }

  const handleDeleteAssignment = async (assignment: Assignment) => {
    setIsSubmittingAssignment(true)
    try {
      await deleteAssignment(apiKey, assignment.id)
      setDeleteAssignmentTarget(null)
      setNotice({ severity: 'success', message: `課題「${assignment.name}」を削除しました。` })
      await reloadAssignments()
    } catch (error) {
      setDeleteAssignmentTarget(null)
      setAssignmentsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmittingAssignment(false)
    }
  }

  const selectedCourse = courses?.find((course) => course.id === selectedCourseId) ?? null

  return (
    <Paper component="section" aria-label="授業管理" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          授業一覧
        </Typography>
        <Button variant="contained" onClick={openCreateForm} disabled={apiKey === ''}>
          新規登録
        </Button>
        <Button variant="outlined" onClick={() => void reload()} disabled={isLoading}>
          再読み込み
        </Button>
      </Stack>

      {notice !== null && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {isLoading && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          <Typography>読み込み中...</Typography>
        </Stack>
      )}

      {!isLoading && errorMessage !== null && <Alert severity="error">{errorMessage}</Alert>}

      {!isLoading && errorMessage === null && courses !== null && (
        <>
          <Typography sx={{ mb: 1 }}>取得件数: {courses.length} 件</Typography>
          {courses.length === 0 ? (
            <Alert severity="info">授業は0件です。</Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>授業名</TableCell>
                    <TableCell>曜日</TableCell>
                    <TableCell>時限</TableCell>
                    <TableCell>年度</TableCell>
                    <TableCell>学期</TableCell>
                    <TableCell>メモ</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {courses.map((course) => (
                    <TableRow key={course.id} selected={course.id === selectedCourseId}>
                      <TableCell>{course.id}</TableCell>
                      <TableCell>{course.name}</TableCell>
                      <TableCell>{course.day_of_week ?? '-'}</TableCell>
                      <TableCell>{course.period === null ? '-' : `${course.period}限`}</TableCell>
                      <TableCell>
                        {course.academic_year === null ? '-' : `${course.academic_year}年度`}
                      </TableCell>
                      <TableCell>{course.term ?? '-'}</TableCell>
                      <TableCell>{course.memo ?? '-'}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            aria-label={`授業「${course.name}」を編集`}
                            onClick={() => openEditForm(course)}
                          >
                            編集
                          </Button>
                          <Button
                            size="small"
                            aria-label={`授業「${course.name}」の課題を表示`}
                            onClick={() => {
                              setNotice(null)
                              setSelectedCourseId(course.id)
                            }}
                          >
                            課題
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            aria-label={`授業「${course.name}」を削除`}
                            onClick={() => setDeleteTarget(course)}
                          >
                            削除
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      {selectedCourseId !== NO_SELECTION && (
        <>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ mt: 3, mb: 2, alignItems: { sm: 'center' } }}
          >
            <Typography variant="subtitle1" component="h3" sx={{ flexGrow: 1 }}>
              課題{selectedCourse === null ? '' : `（${selectedCourse.name}）`}
            </Typography>
            <Button
              variant="contained"
              onClick={openCreateAssignmentForm}
              disabled={apiKey === ''}
            >
              課題を追加
            </Button>
            <Button
              variant="outlined"
              onClick={() => void reloadAssignments()}
              disabled={isLoadingAssignments}
            >
              課題一覧を再読み込み
            </Button>
          </Stack>

          {isLoadingAssignments && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={20} />
              <Typography>読み込み中...</Typography>
            </Stack>
          )}

          {!isLoadingAssignments && assignmentsErrorMessage !== null && (
            <Alert severity="error">{assignmentsErrorMessage}</Alert>
          )}

          {!isLoadingAssignments && assignmentsErrorMessage === null && assignments !== null && (
            <>
              <Typography sx={{ mb: 1 }}>取得件数: {assignments.length} 件</Typography>
              {assignments.length === 0 ? (
                <Alert severity="info">課題は0件です。</Alert>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>課題名</TableCell>
                        <TableCell>ステータス</TableCell>
                        <TableCell>提出期限</TableCell>
                        <TableCell>提出方法</TableCell>
                        <TableCell>メモ</TableCell>
                        <TableCell>操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {assignments.map((assignment) => (
                        <TableRow key={assignment.id}>
                          <TableCell>{assignment.id}</TableCell>
                          <TableCell>{assignment.name}</TableCell>
                          <TableCell>{assignment.status}</TableCell>
                          <TableCell>
                            {assignment.deadline === null ? '-' : formatDeadline(assignment.deadline)}
                          </TableCell>
                          <TableCell>{assignment.submission_method ?? '-'}</TableCell>
                          <TableCell>{assignment.memo ?? '-'}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={1}>
                              <Button
                                size="small"
                                aria-label={`課題「${assignment.name}」を編集`}
                                onClick={() => openEditAssignmentForm(assignment)}
                              >
                                編集
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                aria-label={`課題「${assignment.name}」を削除`}
                                onClick={() => setDeleteAssignmentTarget(assignment)}
                              >
                                削除
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </>
      )}

      <CourseFormDialog
        open={isFormOpen}
        course={editingCourse}
        errorMessage={formErrorMessage}
        isSubmitting={isSubmitting}
        onSubmit={(input) => void handleSubmit(input)}
        onClose={() => setIsFormOpen(false)}
      />

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>授業の削除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget === null
              ? ''
              : `授業「${deleteTarget.name}」を削除します。よろしいですか？`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>キャンセル</Button>
          <Button
            color="error"
            variant="contained"
            disabled={isSubmitting}
            onClick={() => {
              if (deleteTarget !== null) {
                void handleDelete(deleteTarget)
              }
            }}
          >
            削除する
          </Button>
        </DialogActions>
      </Dialog>

      <AssignmentFormDialog
        open={isAssignmentFormOpen}
        assignment={editingAssignment}
        errorMessage={assignmentFormErrorMessage}
        isSubmitting={isSubmittingAssignment}
        onSubmit={(input) => void handleSubmitAssignment(input)}
        onClose={() => setIsAssignmentFormOpen(false)}
      />

      <Dialog
        open={deleteAssignmentTarget !== null}
        onClose={() => setDeleteAssignmentTarget(null)}
      >
        <DialogTitle>課題の削除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteAssignmentTarget === null
              ? ''
              : `課題「${deleteAssignmentTarget.name}」を削除します。よろしいですか？`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteAssignmentTarget(null)}>キャンセル</Button>
          <Button
            color="error"
            variant="contained"
            disabled={isSubmittingAssignment}
            onClick={() => {
              if (deleteAssignmentTarget !== null) {
                void handleDeleteAssignment(deleteAssignmentTarget)
              }
            }}
          >
            削除する
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
