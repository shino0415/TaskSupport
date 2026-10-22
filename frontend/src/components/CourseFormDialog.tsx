import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'

import type { Course, CourseDayOfWeek, CourseInput, CourseTerm } from '../api/types'
import { COURSE_DAYS_OF_WEEK, COURSE_TERMS } from '../api/types'
import type { CourseFormErrors, CourseFormValues } from '../courseForm'
import { toCourseFormValues, toCourseInput, validateCourseForm } from '../courseForm'
import {
  COURSE_ACADEMIC_YEAR_MAX,
  COURSE_ACADEMIC_YEAR_MIN,
  COURSE_PERIOD_MAX,
  COURSE_PERIOD_MIN,
} from '../inputLimits'

type Props = {
  open: boolean
  /** nullなら新規登録、指定時はその授業の編集。 */
  course: Course | null
  /** 送信失敗時のメッセージ。入力内容を失わないようダイアログ内に表示する。 */
  errorMessage: string | null
  isSubmitting: boolean
  onSubmit: (input: CourseInput) => void
  onClose: () => void
}

const UNSET = '' as const

export function CourseFormDialog({
  open,
  course,
  errorMessage,
  isSubmitting,
  onSubmit,
  onClose,
}: Props) {
  const [values, setValues] = useState<CourseFormValues>(() => toCourseFormValues(course))
  const [errors, setErrors] = useState<CourseFormErrors>({})

  useEffect(() => {
    if (open) {
      setValues(toCourseFormValues(course))
      setErrors({})
    }
  }, [open, course])

  const isEdit = course !== null

  const update = <K extends keyof CourseFormValues>(field: K, value: CourseFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = () => {
    const validationErrors = validateCourseForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      return
    }
    onSubmit(toCourseInput(values))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? `授業を編集（ID: ${course.id}）` : '授業を新規登録'}</DialogTitle>
      <Box
        component="form"
        // 未入力の指摘はブラウザ標準のツールチップではなく項目ごとのメッセージで行う
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          handleSubmit()
        }}
      >
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {errorMessage !== null && <Alert severity="error">{errorMessage}</Alert>}
            <TextField
              label="授業名"
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              error={errors.name !== undefined}
              helperText={errors.name ?? ''}
              required
              fullWidth
            />
            <TextField
              select
              label="曜日"
              value={values.day_of_week}
              onChange={(event) =>
                update('day_of_week', event.target.value as CourseDayOfWeek | typeof UNSET)
              }
              fullWidth
            >
              <MenuItem value={UNSET}>未設定</MenuItem>
              {COURSE_DAYS_OF_WEEK.map((day) => (
                <MenuItem key={day} value={day}>
                  {day}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="時限"
              type="number"
              value={values.period}
              onChange={(event) => update('period', event.target.value)}
              error={errors.period !== undefined}
              helperText={errors.period ?? '未設定でも登録できます。'}
              fullWidth
              slotProps={{
                htmlInput: { min: COURSE_PERIOD_MIN, max: COURSE_PERIOD_MAX, step: 1 },
              }}
            />
            <TextField
              label="年度"
              type="number"
              value={values.academic_year}
              onChange={(event) => update('academic_year', event.target.value)}
              error={errors.academic_year !== undefined}
              helperText={errors.academic_year ?? '未設定でも登録できます。'}
              fullWidth
              slotProps={{
                htmlInput: {
                  min: COURSE_ACADEMIC_YEAR_MIN,
                  max: COURSE_ACADEMIC_YEAR_MAX,
                  step: 1,
                },
              }}
            />
            <TextField
              select
              label="学期"
              value={values.term}
              onChange={(event) => update('term', event.target.value as CourseTerm | typeof UNSET)}
              fullWidth
            >
              <MenuItem value={UNSET}>未設定</MenuItem>
              {COURSE_TERMS.map((term) => (
                <MenuItem key={term} value={term}>
                  {term}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="メモ"
              value={values.memo}
              onChange={(event) => update('memo', event.target.value)}
              error={errors.memo !== undefined}
              helperText={errors.memo ?? ''}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isEdit ? '更新する' : '登録する'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
