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

import type { Task, TaskInput, TaskStatus } from '../api/types'
import { TASK_STATUSES } from '../api/types'
import type { TaskFormErrors, TaskFormValues } from '../taskForm'
import { toTaskFormValues, toTaskInput, validateTaskForm } from '../taskForm'

type Props = {
  open: boolean
  /** nullなら新規追加、指定時はそのタスクの編集。 */
  task: Task | null
  /** 送信失敗時のメッセージ。入力内容を失わないようダイアログ内に表示する。 */
  errorMessage: string | null
  isSubmitting: boolean
  onSubmit: (input: TaskInput) => void
  onClose: () => void
}

export function TaskFormDialog({ open, task, errorMessage, isSubmitting, onSubmit, onClose }: Props) {
  const [values, setValues] = useState<TaskFormValues>(() => toTaskFormValues(task))
  const [errors, setErrors] = useState<TaskFormErrors>({})

  useEffect(() => {
    if (open) {
      setValues(toTaskFormValues(task))
      setErrors({})
    }
  }, [open, task])

  const isEdit = task !== null

  const update = <K extends keyof TaskFormValues>(field: K, value: TaskFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = () => {
    const validationErrors = validateTaskForm(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      return
    }
    onSubmit(toTaskInput(values))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? `タスクを編集（ID: ${task.id}）` : 'タスクを新規追加'}</DialogTitle>
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
