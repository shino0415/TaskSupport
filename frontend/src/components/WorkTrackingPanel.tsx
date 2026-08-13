import { useCallback, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
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
import { fetchHourlyRate } from '../api/hourlyRate'
import { fetchProjects } from '../api/projects'
import { fetchTasks } from '../api/tasks'
import type { HourlyRate, Project, Task, WorkLog } from '../api/types'
import { deleteWorkLog, fetchWorkLogs, startWorkLog, stopWorkLog } from '../api/workLogs'
import { formatHourlyRate, formatTotalWorkHours, formatWorkLogDuration } from '../workLogFormat'

type Props = {
  apiKey: string
}

type Notice = {
  severity: 'success' | 'warning'
  message: string
}

const NO_SELECTION = '' as const

/** タスク単位の稼働計測（開始/終了/一覧/削除）と、案件の時給換算結果を表示する画面。 */
export function WorkTrackingPanel({ apiKey }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [projectsErrorMessage, setProjectsErrorMessage] = useState<string | null>(null)
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)

  const [selectedProjectId, setSelectedProjectId] = useState<number | typeof NO_SELECTION>(
    NO_SELECTION,
  )

  const [hourlyRate, setHourlyRate] = useState<HourlyRate | null>(null)
  const [hourlyRateErrorMessage, setHourlyRateErrorMessage] = useState<string | null>(null)
  const [isLoadingHourlyRate, setIsLoadingHourlyRate] = useState(false)

  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [tasksErrorMessage, setTasksErrorMessage] = useState<string | null>(null)
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)

  const [selectedTaskId, setSelectedTaskId] = useState<number | typeof NO_SELECTION>(
    NO_SELECTION,
  )

  const [workLogs, setWorkLogs] = useState<WorkLog[] | null>(null)
  const [workLogsErrorMessage, setWorkLogsErrorMessage] = useState<string | null>(null)
  const [isLoadingWorkLogs, setIsLoadingWorkLogs] = useState(false)

  const [notice, setNotice] = useState<Notice | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WorkLog | null>(null)

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

  const reloadHourlyRate = useCallback(async () => {
    if (apiKey === '' || selectedProjectId === NO_SELECTION) {
      setHourlyRate(null)
      setHourlyRateErrorMessage(null)
      return
    }
    setIsLoadingHourlyRate(true)
    setHourlyRateErrorMessage(null)
    try {
      setHourlyRate(await fetchHourlyRate(apiKey, selectedProjectId))
    } catch (error) {
      setHourlyRate(null)
      setHourlyRateErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoadingHourlyRate(false)
    }
  }, [apiKey, selectedProjectId])

  useEffect(() => {
    void reloadHourlyRate()
  }, [reloadHourlyRate])

  const reloadTasks = useCallback(async () => {
    if (apiKey === '' || selectedProjectId === NO_SELECTION) {
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

  // 案件を切り替えたら、別案件のタスクidを引きずらないよう選択を解除する
  useEffect(() => {
    setSelectedTaskId(NO_SELECTION)
  }, [selectedProjectId])

  const reloadWorkLogs = useCallback(async () => {
    if (apiKey === '' || selectedTaskId === NO_SELECTION) {
      setWorkLogs(null)
      setWorkLogsErrorMessage(null)
      return
    }
    setIsLoadingWorkLogs(true)
    setWorkLogsErrorMessage(null)
    try {
      setWorkLogs(await fetchWorkLogs(apiKey, selectedTaskId))
    } catch (error) {
      setWorkLogs(null)
      setWorkLogsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoadingWorkLogs(false)
    }
  }, [apiKey, selectedTaskId])

  useEffect(() => {
    void reloadWorkLogs()
  }, [reloadWorkLogs])

  const handleStart = async () => {
    if (selectedTaskId === NO_SELECTION) {
      return
    }
    setIsSubmitting(true)
    setWorkLogsErrorMessage(null)
    try {
      // 進行中ログの有無は確認しない（同一タスク内の多重start・案件/タスク間の
      // 同時進行を許可するAPIの仕様どおり、常に新規レコードとして開始する）
      await startWorkLog(apiKey, selectedTaskId)
      setNotice({ severity: 'success', message: '計測を開始しました。' })
      await reloadWorkLogs()
    } catch (error) {
      setWorkLogsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleStop = async (workLog: WorkLog) => {
    setIsSubmitting(true)
    setWorkLogsErrorMessage(null)
    try {
      await stopWorkLog(apiKey, workLog.id)
      setNotice({ severity: 'success', message: '計測を終了しました。' })
      await reloadWorkLogs()
      await reloadHourlyRate()
    } catch (error) {
      setWorkLogsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (workLog: WorkLog) => {
    setIsSubmitting(true)
    try {
      await deleteWorkLog(apiKey, workLog.id)
      setDeleteTarget(null)
      setNotice({ severity: 'success', message: `稼働ログ（ID: ${workLog.id}）を削除しました。` })
      await reloadWorkLogs()
      await reloadHourlyRate()
    } catch (error) {
      setDeleteTarget(null)
      setWorkLogsErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedProject = projects?.find((project) => project.id === selectedProjectId) ?? null

  return (
    <Paper component="section" aria-label="稼働計測・時給換算" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          稼働計測・時給換算
        </Typography>
        <TextField
          select
          size="small"
          label="案件を選択"
          value={selectedProjectId}
          onChange={(event) => {
            setNotice(null)
            const value = event.target.value
            setSelectedProjectId(value === NO_SELECTION ? NO_SELECTION : Number(value))
          }}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value={NO_SELECTION}>（未選択）</MenuItem>
          {(projects ?? []).map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name}（{project.status}）
            </MenuItem>
          ))}
        </TextField>
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

      {selectedProjectId === NO_SELECTION && projects !== null && projects.length > 0 && (
        <Alert severity="info">案件を選択すると、時給換算結果とタスク一覧を表示します。</Alert>
      )}

      {selectedProjectId !== NO_SELECTION && (
        <>
          <Typography variant="subtitle1" component="h3" sx={{ mt: 2 }}>
            時給換算{selectedProject === null ? '' : `（${selectedProject.name}）`}
          </Typography>
          {isLoadingHourlyRate && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={20} />
              <Typography>読み込み中...</Typography>
            </Stack>
          )}
          {!isLoadingHourlyRate && hourlyRateErrorMessage !== null && (
            <Alert severity="error">{hourlyRateErrorMessage}</Alert>
          )}
          {!isLoadingHourlyRate && hourlyRateErrorMessage === null && hourlyRate !== null && (
            <Stack spacing={0.5} sx={{ mb: 2 }}>
              <Typography>報酬額: {hourlyRate.reward.toLocaleString()} 円</Typography>
              <Typography>
                合計稼働時間（完了済みログのみ）: {formatTotalWorkHours(hourlyRate.total_work_hours)}
              </Typography>
              {hourlyRate.hourly_rate === null ? (
                <Alert severity="info">{formatHourlyRate(hourlyRate.hourly_rate)}</Alert>
              ) : (
                <Typography>換算時給: {formatHourlyRate(hourlyRate.hourly_rate)}</Typography>
              )}
            </Stack>
          )}

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ mt: 2, mb: 2, alignItems: { sm: 'center' } }}
          >
            <Typography variant="subtitle1" component="h3" sx={{ flexGrow: 1 }}>
              稼働ログ
            </Typography>
            <TextField
              select
              size="small"
              label="タスクを選択"
              value={selectedTaskId}
              onChange={(event) => {
                setNotice(null)
                const value = event.target.value
                setSelectedTaskId(value === NO_SELECTION ? NO_SELECTION : Number(value))
              }}
              sx={{ minWidth: 240 }}
            >
              <MenuItem value={NO_SELECTION}>（未選択）</MenuItem>
              {(tasks ?? []).map((task) => (
                <MenuItem key={task.id} value={task.id}>
                  {task.name}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              onClick={() => void handleStart()}
              disabled={apiKey === '' || selectedTaskId === NO_SELECTION || isSubmitting}
            >
              計測開始
            </Button>
          </Stack>

          {isLoadingTasks && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
              <CircularProgress size={20} />
              <Typography>タスク一覧を読み込み中...</Typography>
            </Stack>
          )}

          {!isLoadingTasks && tasksErrorMessage !== null && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {tasksErrorMessage}
            </Alert>
          )}

          {!isLoadingTasks &&
            tasksErrorMessage === null &&
            tasks !== null &&
            tasks.length === 0 && <Alert severity="info">タスクが0件です。</Alert>}

          {selectedTaskId === NO_SELECTION && tasks !== null && tasks.length > 0 && (
            <Alert severity="info">タスクを選択すると、稼働ログの一覧を表示します。</Alert>
          )}

          {isLoadingWorkLogs && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={20} />
              <Typography>読み込み中...</Typography>
            </Stack>
          )}

          {!isLoadingWorkLogs && workLogsErrorMessage !== null && (
            <Alert severity="error">{workLogsErrorMessage}</Alert>
          )}

          {!isLoadingWorkLogs && workLogsErrorMessage === null && workLogs !== null && (
            <>
              <Typography sx={{ mb: 1 }}>取得件数: {workLogs.length} 件</Typography>
              {workLogs.length === 0 ? (
                <Alert severity="info">稼働ログは0件です。</Alert>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>状態</TableCell>
                        <TableCell>開始時刻</TableCell>
                        <TableCell>終了時刻</TableCell>
                        <TableCell>稼働時間</TableCell>
                        <TableCell>操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {workLogs.map((workLog) => {
                        const isRunning = workLog.ended_at === null
                        return (
                          <TableRow
                            key={workLog.id}
                            sx={isRunning ? { backgroundColor: 'action.hover' } : undefined}
                          >
                            <TableCell>{workLog.id}</TableCell>
                            <TableCell>
                              {isRunning ? (
                                <Chip label="進行中" color="warning" size="small" />
                              ) : (
                                <Chip label="終了済み" size="small" />
                              )}
                            </TableCell>
                            <TableCell>{workLog.started_at ?? '-'}</TableCell>
                            <TableCell>{workLog.ended_at ?? '-'}</TableCell>
                            <TableCell>
                              {formatWorkLogDuration(workLog.started_at, workLog.ended_at)}
                            </TableCell>
                            <TableCell>
                              <Stack direction="row" spacing={1}>
                                {isRunning && (
                                  <Button
                                    size="small"
                                    aria-label={`稼働ログ（ID: ${workLog.id}）の計測を終了`}
                                    onClick={() => void handleStop(workLog)}
                                    disabled={isSubmitting}
                                  >
                                    計測終了
                                  </Button>
                                )}
                                <Button
                                  size="small"
                                  color="error"
                                  aria-label={`稼働ログ（ID: ${workLog.id}）を削除`}
                                  onClick={() => setDeleteTarget(workLog)}
                                >
                                  削除
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </>
      )}

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>稼働ログの削除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget === null
              ? ''
              : `稼働ログ（ID: ${deleteTarget.id}）を削除します。よろしいですか？`}
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
