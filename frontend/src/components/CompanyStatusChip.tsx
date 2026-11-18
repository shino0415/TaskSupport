import Chip from '@mui/material/Chip'

type Props = {
  status: string
}

const COLORS: Record<string, 'primary' | 'info' | 'success' | 'secondary' | 'default'> = {
  選考中: 'primary',
  インターン参加: 'info',
  内定: 'success',
  お見送り: 'default',
  辞退: 'secondary',
}

const OUTLINED_STATUSES = new Set(['お見送り', '辞退'])

/**
 * 企業の選考状態。5つの状態を色でも見分けられるようにし、終了した状態（お見送り・辞退）は
 * 枠線のみで表示する（未知の値は既定の色で表示）。
 */
export function CompanyStatusChip({ status }: Props) {
  return (
    <Chip
      label={status}
      size="small"
      color={COLORS[status] ?? 'default'}
      variant={OUTLINED_STATUSES.has(status) ? 'outlined' : 'filled'}
    />
  )
}
