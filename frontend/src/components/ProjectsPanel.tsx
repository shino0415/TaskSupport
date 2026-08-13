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
import { createProject, deleteProject, fetchProjects, updateProject } from '../api/projects'
import type { Project, ProjectInput, ProjectStatus } from '../api/types'
import { PROJECT_STATUSES } from '../api/types'
import { ProjectDetailDialog } from './ProjectDetailDialog'
import { ProjectFormDialog } from './ProjectFormDialog'

type Props = {
  apiKey: string
  /** 横断一覧等からの遷移で、指定した案件の詳細ダイアログを開いた状態で表示する。 */
  initialDetailProjectId?: number | null
}

type Notice = {
  severity: 'success' | 'warning'
  message: string
}

const ALL_STATUSES = '' as const

/** 案件の一覧・絞り込み・詳細・登録・編集・削除をまとめた画面。 */
export function ProjectsPanel({ apiKey, initialDetailProjectId = null }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | typeof ALL_STATUSES>(
    ALL_STATUSES,
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [detailProjectId, setDetailProjectId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)

  const reload = useCallback(async () => {
    if (apiKey === '') {
      setProjects(null)
      setErrorMessage(null)
      return
    }
    setIsLoading(true)
    setErrorMessage(null)
    try {
      setProjects(await fetchProjects(apiKey, { status: statusFilter }))
    } catch (error) {
      setProjects(null)
      setErrorMessage(toDisplayMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [apiKey, statusFilter])

  useEffect(() => {
    void reload()
  }, [reload])

  // 横断一覧等からの遷移（initialDetailProjectIdの指定）で、詳細ダイアログを自動的に開く
  useEffect(() => {
    if (initialDetailProjectId !== null) {
      setDetailProjectId(initialDetailProjectId)
    }
  }, [initialDetailProjectId])

  const openCreateForm = () => {
    setEditingProject(null)
    setFormErrorMessage(null)
    setIsFormOpen(true)
  }

  const openEditForm = (project: Project) => {
    setEditingProject(project)
    setFormErrorMessage(null)
    setIsFormOpen(true)
  }

  const handleSubmit = async (input: ProjectInput) => {
    setIsSubmitting(true)
    setFormErrorMessage(null)
    try {
      if (editingProject === null) {
        await createProject(apiKey, input)
        setNotice({ severity: 'success', message: '案件を登録しました。' })
      } else {
        const updated = await updateProject(apiKey, editingProject.id, input)
        // ステータスの逆行はブロックされず、更新は成立したうえで警告が返る
        setNotice(
          updated.warning === null
            ? { severity: 'success', message: '案件を更新しました。' }
            : {
                severity: 'warning',
                message: `案件を更新しました（変更は保存されています）。${updated.warning}`,
              },
        )
      }
      setIsFormOpen(false)
      await reload()
    } catch (error) {
      setFormErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (project: Project) => {
    setIsSubmitting(true)
    try {
      await deleteProject(apiKey, project.id)
      setDeleteTarget(null)
      if (detailProjectId === project.id) {
        setDetailProjectId(null)
      }
      setNotice({ severity: 'success', message: `案件「${project.name}」を削除しました。` })
      await reload()
    } catch (error) {
      setDeleteTarget(null)
      setErrorMessage(toDisplayMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Paper component="section" aria-label="案件管理" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          案件一覧
        </Typography>
        <TextField
          select
          size="small"
          label="ステータスで絞り込み"
          value={statusFilter}
          onChange={(event) => {
            setNotice(null)
            setStatusFilter(event.target.value as ProjectStatus | typeof ALL_STATUSES)
          }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value={ALL_STATUSES}>すべて</MenuItem>
          {PROJECT_STATUSES.map((status) => (
            <MenuItem key={status} value={status}>
              {status}
            </MenuItem>
          ))}
        </TextField>
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

      {!isLoading && errorMessage === null && projects !== null && (
        <>
          <Typography sx={{ mb: 1 }}>取得件数: {projects.length} 件</Typography>
          {projects.length === 0 ? (
            <Alert severity="info">案件は0件です。</Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>案件名</TableCell>
                    <TableCell>クライアント</TableCell>
                    <TableCell>ステータス</TableCell>
                    <TableCell align="right">報酬</TableCell>
                    <TableCell>応募日</TableCell>
                    <TableCell>納期</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell>{project.id}</TableCell>
                      <TableCell>{project.name}</TableCell>
                      <TableCell>{project.client_name}</TableCell>
                      <TableCell>{project.status}</TableCell>
                      <TableCell align="right">{project.reward.toLocaleString()}</TableCell>
                      <TableCell>{project.applied_date}</TableCell>
                      <TableCell>{project.deadline ?? '-'}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            aria-label={`案件「${project.name}」の詳細`}
                            onClick={() => {
                              setNotice(null)
                              setDetailProjectId(project.id)
                            }}
                          >
                            詳細
                          </Button>
                          <Button
                            size="small"
                            aria-label={`案件「${project.name}」を編集`}
                            onClick={() => openEditForm(project)}
                          >
                            編集
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            aria-label={`案件「${project.name}」を削除`}
                            onClick={() => setDeleteTarget(project)}
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

      <ProjectFormDialog
        open={isFormOpen}
        project={editingProject}
        errorMessage={formErrorMessage}
        isSubmitting={isSubmitting}
        onSubmit={(input) => void handleSubmit(input)}
        onClose={() => setIsFormOpen(false)}
      />

      <ProjectDetailDialog
        open={detailProjectId !== null}
        projectId={detailProjectId}
        apiKey={apiKey}
        onClose={() => setDetailProjectId(null)}
      />

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>案件の削除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget === null
              ? ''
              : `案件「${deleteTarget.name}」を削除します。よろしいですか？`}
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
