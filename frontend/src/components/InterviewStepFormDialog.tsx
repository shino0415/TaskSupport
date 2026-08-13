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
  InterviewStep,
  InterviewStepInput,
  InterviewStepPrepStatus,
  InterviewStepResult,
} from '../api/types'
import { INTERVIEW_STEP_PREP_STATUSES, INTERVIEW_STEP_RESULTS } from '../api/types'
import type { InterviewStepFormErrors, InterviewStepFormValues } from '../interviewStepForm'
import {
  toInterviewStepFormValues,
  toInterviewStepInput,
  validateInterviewStepForm,
} from '../interviewStepForm'

type Props = {
  open: boolean
  /** nullなら新規追加、指定時はその選考ステップの編集。 */
  step: InterviewStep | null
  /** 送信失敗時のメッセージ。入力内容を失わないようダイアログ内に表示する。 */
  errorMessage: string | null
  isSubmitting: boolean
  onSubmit: (input: InterviewStepInput) => void
  onClose: () => void
}

export function InterviewStepFormDialog({
  open,
  step,
  errorMessage,
  isSubmitting,
  onSubmit,
  onClose,
}: Props) {
  const [values, setValues] = useState<InterviewStepFormValues>(() =>
    toInterviewStepFormValues(step),
  )
  const [errors, setErrors] = useState<InterviewStepFormErrors>({})

  useEffect(() => {
    if (open) {
      setValues(toInterviewStepFormValues(step))
      setErrors({})
    }
  }, [open, step])

  const isEdit = step !== null

  const update = <K extends keyof InterviewStepFormValues>(
    field: K,
    value: InterviewStepFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = () => {
    const validationErrors = validateInterviewStepForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      return
    }
    onSubmit(toInterviewStepInput(values))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isEdit ? `選考ステップを編集（ID: ${step.id}）` : '選考ステップを新規追加'}
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
              label="種別"
              value={values.type}
              onChange={(event) => update('type', event.target.value)}
              error={errors.type !== undefined}
              helperText={errors.type ?? '書類選考／一次面接／二次面接／最終面接など'}
              required
              fullWidth
            />
            <TextField
              label="予定日"
              type="date"
              value={values.date}
              onChange={(event) => update('date', event.target.value)}
              helperText="未設定でも登録できます。"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              label="準備状況"
              value={values.prep_status}
              onChange={(event) => update('prep_status', event.target.value as InterviewStepPrepStatus)}
              fullWidth
            >
              {INTERVIEW_STEP_PREP_STATUSES.map((prepStatus) => (
                <MenuItem key={prepStatus} value={prepStatus}>
                  {prepStatus}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="結果"
              value={values.result}
              onChange={(event) => update('result', event.target.value as InterviewStepResult)}
              fullWidth
            >
              {INTERVIEW_STEP_RESULTS.map((result) => (
                <MenuItem key={result} value={result}>
                  {result}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="メモ"
              value={values.memo}
              onChange={(event) => update('memo', event.target.value)}
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
