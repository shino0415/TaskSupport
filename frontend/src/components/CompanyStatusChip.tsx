import Chip from '@mui/material/Chip'

type Props = {
  status: string
}

const COLORS: Record<string, 'primary' | 'success' | 'default'> = {
  選考中: 'primary',
  内定: 'success',
  お見送り: 'default',
}

/** 企業の選考状態。内定とお見送りを色でも見分けられるようにする（未知の値は既定の色で表示）。 */
export function CompanyStatusChip({ status }: Props) {
  return (
    <Chip
      label={status}
      size="small"
      color={COLORS[status] ?? 'default'}
      variant={status === 'お見送り' ? 'outlined' : 'filled'}
    />
  )
}
