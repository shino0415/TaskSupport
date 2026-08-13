import { useCallback, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { toDisplayMessage } from '../api/errors'
import { fetchProjects } from '../api/projects'
import { createTask, deleteTask, fetchTasks, updateTask } from '../api/tasks'
import type { Project, Task, TaskInput } from '../api/types'
import { TaskFormDialog } from './TaskFormDialog'

type Props = {
  apiKey: string
}

type Notice = {
  severity: 'success' | 'warning'
  message: string
}

const NO_PROJECT_SELECTED = '' as const

/** 案件を選んでその配下のタスクの一覧・追加・編集・削除を行う画面。 */
export function TasksPanel({ apiKey }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [projectsErrorMessage, setProjectsErrorMessage] = useState<string | null>(null)
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)

  const [selectedProjectId, setSelectedProjectId] = useState<
    number | typeof NO_PROJECT_SELECTED
  >(NO_PROJECT_SELECTED)

  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [tasksErrorMessage, setTasksErrorMessage] = useState<string | null>(null)
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)

  const reloadProjects = useCallback(async () => {
    if (apiKey === '') {
      setProjects(null)
      setProjectsErrorMessage(null)
      return
    }
    setIsLoadingProjects(true)
    setProjectsErrorMessage(null)
    try {
      setProjects(await fetchProjects(apiKey))
    } catch (error) {
      setProjects(null)
      setProjectsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoadingProjects(false)
    }
  }, [apiKey])

  useEffect(() => {
    void reloadProjects()
  }, [reloadProjects])

  const reloadTasks = useCallback(async () => {
    if (apiKey === '' || selectedProjectId === NO_PROJECT_SELECTED) {
      setTasks(null)
      setTasksErrorMessage(null)
      return
    }
    setIsLoadingTasks(true)
    setTasksErrorMessage(null)
    try {
      setTasks(await fetchTasks(apiKey, selectedProjectId))
    } catch (error) {
      setTasks(null)
      setTasksErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoadingTasks(false)
    }
  }, [apiKey, selectedProjectId])

  useEffect(() => {
    void reloadTasks()
  }, [reloadTasks])

  const openCreateForm = () => {
    setEditingTask(null)
    setFormErrorMessage(null)
    setIsFormOpen(true)
  }

  const openEditForm = (task: Task) => {
    setEditingTask(task)
    setFormErrorMessage(null)
    setIsFormOpen(true)
  }

  const handleSubmit = async (input: TaskInput) => {
    if (selectedProjectId === NO_PROJECT_SELECTED) {
      return
    }
    setIsSubmitting(true)
    setFormErrorMessage(null)
    try {
      if (editingTask === null) {
        await createTask(apiKey, selectedProjectId, input)
        setNotice({ severity: 'success', message: 'タスクを追加しました。' })
      } else {
        const updated = await updateTask(apiKey, editingTask.id, input)
        // ステータスの逆行はブロックされず、更新は成立したうえで警告が返る
        setNotice(
          updated.warning === null
            ? { severity: 'success', message: 'タスクを更新しました。' }
            : {
                severity: 'warning',
                message: `タスクを更新しました（変更は保存されています）。${updated.warning}`,
              },
        )
      }
      setIsFormOpen(false)
      await reloadTasks()
    } catch (error) {
      setFormErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (task: Task) => {
    setIsSubmitting(true)
    try {
      await deleteTask(apiKey, task.id)
      setDeleteTarget(null)
      setNotice({ severity: 'success', message: `タスク「${task.name}」を削除しました。` })
      await reloadTasks()
    } catch (error) {
      setDeleteTarget(null)
      setTasksErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Paper component="section" aria-label="タスク管理" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          タスク管理
        </Typography>
        <TextField
          select
          size="small"
          label="案件を選択"
          value={selectedProjectId}
          onChange={(event) => {
            setNotice(null)
            const value = event.target.value
            setSelectedProjectId(value === NO_PROJECT_SELECTED ? NO_PROJECT_SELECTED : Number(value))
          }}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value={NO_PROJECT_SELECTED}>（未選択）</MenuItem>
          {(projects ?? []).map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name}（{project.status}）
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="contained"
          onClick={openCreateForm}
          disabled={apiKey === '' || selectedProjectId === NO_PROJECT_SELECTED}
        >
          タスクを追加
        </Button>
        <Button
          variant="outlined"
          onClick={() => void reloadTasks()}
          disabled={isLoadingTasks || selectedProjectId === NO_PROJECT_SELECTED}
        >
          タスク一覧を再読み込み
        </Button>
      </Stack>

      {isLoadingProjects && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
          <CircularProgress size={20} />
          <Typography>案件一覧を読み込み中...</Typography>
        </Stack>
      )}

      {!isLoadingProjects && projectsErrorMessage !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {projectsErrorMessage}
        </Alert>
      )}

      {!isLoadingProjects &&
        projectsErrorMessage === null &&
        projects !== null &&
        projects.length === 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            案件が0件です。先に案件を登録してください。
          </Alert>
        )}

      {notice !== null && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {selectedProjectId === NO_PROJECT_SELECTED && projects !== null && projects.length > 0 && (
        <Alert severity="info">案件を選択すると、その配下のタスク一覧を表示します。</Alert>
      )}

      {isLoadingTasks && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          <Typography>読み込み中...</Typography>
        </Stack>
      )}

      {!isLoadingTasks && tasksErrorMessage !== null && (
        <Alert severity="error">{tasksErrorMessage}</Alert>
      )}

      {!isLoadingTasks && tasksErrorMessage === null && tasks !== null && (
        <>
          <Typography sx={{ mb: 1 }}>取得件数: {tasks.length} 件</Typography>
          {tasks.length === 0 ? (
            <Alert severity="info">タスクは0件です。</Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>タスク名</TableCell>
                    <TableCell>ステータス</TableCell>
                    <TableCell>メモ</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>{task.id}</TableCell>
                      <TableCell>{task.name}</TableCell>
                      <TableCell>{task.status}</TableCell>
                      <TableCell>{task.memo ?? '-'}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            aria-label={`タスク「${task.name}」を編集`}
                            onClick={() => openEditForm(task)}
                          >
                            編集
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            aria-label={`タスク「${task.name}」を削除`}
                            onClick={() => setDeleteTarget(task)}
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

      <TaskFormDialog
        open={isFormOpen}
        task={editingTask}
        errorMessage={formErrorMessage}
        isSubmitting={isSubmitting}
        onSubmit={(input) => void handleSubmit(input)}
        onClose={() => setIsFormOpen(false)}
      />

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>タスクの削除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget === null ? '' : `タスク「${deleteTarget.name}」を削除します。よろしいですか？`}
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
