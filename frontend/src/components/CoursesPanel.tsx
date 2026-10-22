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

import { createCourse, deleteCourse, fetchCourses, updateCourse } from '../api/courses'
import { toDisplayMessage } from '../api/errors'
import type { Course, CourseInput } from '../api/types'
import { CourseFormDialog } from './CourseFormDialog'

type Props = {
  apiKey: string
}

type Notice = {
  severity: 'success'
  message: string
}

/** 授業の一覧・登録・編集・削除をまとめた画面。 */
export function CoursesPanel({ apiKey }: Props) {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null)

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
      setNotice({ severity: 'success', message: `授業「${course.name}」を削除しました。` })
      await reload()
    } catch (error) {
      setDeleteTarget(null)
      setErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

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
                    <TableRow key={course.id}>
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
    </Paper>
  )
}
