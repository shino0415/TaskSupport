import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'

import type { Project } from '../api/types'

type Props = {
  projects: Project[] | null
  errorMessage: string | null
  isLoading: boolean
  onReload: () => void
}

/** API疎通確認として案件一覧を取得・表示する領域。 */
export function ProjectsPanel({ projects, errorMessage, isLoading, onReload }: Props) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center' }}>
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          案件一覧（GET /projects）
        </Typography>
        <Button variant="outlined" onClick={onReload} disabled={isLoading}>
          再読み込み
        </Button>
      </Stack>

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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
    </Paper>
  )
}
