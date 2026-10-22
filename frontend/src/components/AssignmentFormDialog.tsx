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

import type {
  Assignment,
  AssignmentInput,
  AssignmentStatus,
  AssignmentSubmissionMethod,
} from '../api/types'
import { ASSIGNMENT_STATUSES, ASSIGNMENT_SUBMISSION_METHODS } from '../api/types'
import type { AssignmentFormErrors, AssignmentFormValues } from '../assignmentForm'
import {
  toAssignmentFormValues,
  toAssignmentInput,
  validateAssignmentForm,
} from '../assignmentForm'

type Props = {
  open: boolean
  /** nullなら新規追加、指定時はその課題の編集。 */
  assignment: Assignment | null
  /** 送信失敗時のメッセージ。入力内容を失わないようダイアログ内に表示する。 */
  errorMessage: string | null
  isSubmitting: boolean
  onSubmit: (input: AssignmentInput) => void
  onClose: () => void
}

const UNSET = '' as const

export function AssignmentFormDialog({
  open,
  assignment,
  errorMessage,
  isSubmitting,
  onSubmit,
  onClose,
}: Props) {
  const [values, setValues] = useState<AssignmentFormValues>(() =>
    toAssignmentFormValues(assignment),
  )
  const [errors, setErrors] = useState<AssignmentFormErrors>({})

  useEffect(() => {
    if (open) {
      setValues(toAssignmentFormValues(assignment))
      setErrors({})
    }
  }, [open, assignment])

  const isEdit = assignment !== null

  const update = <K extends keyof AssignmentFormValues>(
    field: K,
    value: AssignmentFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = () => {
    const validationErrors = validateAssignmentForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      return
    }
    onSubmit(toAssignmentInput(values))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isEdit ? `課題を編集（ID: ${assignment.id}）` : '課題を新規追加'}
      </DialogTitle>
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
              label="課題名"
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              error={errors.name !== undefined}
              helperText={errors.name ?? ''}
              required
              fullWidth
            />
            <TextField
              select
              label="ステータス"
              value={values.status}
              onChange={(event) => update('status', event.target.value as AssignmentStatus)}
              fullWidth
            >
              {ASSIGNMENT_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="提出期限"
              type="datetime-local"
              value={values.deadline}
              onChange={(event) => update('deadline', event.target.value)}
              error={errors.deadline !== undefined}
              helperText={errors.deadline ?? '未設定でも登録できます。'}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              label="提出方法"
              value={values.submission_method}
              onChange={(event) =>
                update(
                  'submission_method',
                  event.target.value as AssignmentSubmissionMethod | typeof UNSET,
                )
              }
              fullWidth
            >
              <MenuItem value={UNSET}>未設定</MenuItem>
              {ASSIGNMENT_SUBMISSION_METHODS.map((method) => (
                <MenuItem key={method} value={method}>
                  {method}
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
            {isEdit ? '更新する' : '追加する'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
