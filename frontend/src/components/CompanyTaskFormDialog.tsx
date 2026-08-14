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

import type { CompanyTask, CompanyTaskInput, TaskStatus } from '../api/types'
import { TASK_STATUSES } from '../api/types'
import type { CompanyTaskFormErrors, CompanyTaskFormValues } from '../companyTaskForm'
import {
  toCompanyTaskFormValues,
  toCompanyTaskInput,
  validateCompanyTaskForm,
} from '../companyTaskForm'

type Props = {
  open: boolean
  /** nullなら新規追加、指定時はその企業タスクの編集。 */
  companyTask: CompanyTask | null
  /** 送信失敗時のメッセージ。入力内容を失わないようダイアログ内に表示する。 */
  errorMessage: string | null
  isSubmitting: boolean
  onSubmit: (input: CompanyTaskInput) => void
  onClose: () => void
}

export function CompanyTaskFormDialog({
  open,
  companyTask,
  errorMessage,
  isSubmitting,
  onSubmit,
  onClose,
}: Props) {
  const [values, setValues] = useState<CompanyTaskFormValues>(() =>
    toCompanyTaskFormValues(companyTask),
  )
  const [errors, setErrors] = useState<CompanyTaskFormErrors>({})

  useEffect(() => {
    if (open) {
      setValues(toCompanyTaskFormValues(companyTask))
      setErrors({})
    }
  }, [open, companyTask])

  const isEdit = companyTask !== null

  const update = <K extends keyof CompanyTaskFormValues>(
    field: K,
    value: CompanyTaskFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = () => {
    const validationErrors = validateCompanyTaskForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      return
    }
    onSubmit(toCompanyTaskInput(values))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isEdit ? `企業タスクを編集（ID: ${companyTask.id}）` : '企業タスクを新規追加'}
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
              label="タスク名"
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
              onChange={(event) => update('status', event.target.value as TaskStatus)}
              fullWidth
            >
              {TASK_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
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
