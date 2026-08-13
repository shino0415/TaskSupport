import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import { Link as RouterLink, useLocation } from 'react-router-dom'

type NavItem = {
  to: string
  label: string
  isActive: (pathname: string) => boolean
}

// 「案件ページ」は /projects/:projectId・/tasks/:projectId/:taskId のディープリンクも含む。
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '横断一覧', isActive: (pathname) => pathname === '/' },
  {
    to: '/projects',
    label: '案件ページ',
    isActive: (pathname) => pathname.startsWith('/projects') || pathname.startsWith('/tasks'),
  },
  {
    to: '/companies',
    label: '選考ページ',
    isActive: (pathname) => pathname.startsWith('/companies'),
  },
]

/** どの画面を表示していても常に見えるページ切り替えナビゲーション。 */
export function NavBar() {
  const { pathname } = useLocation()

  return (
    <Stack component="nav" aria-label="ページナビゲーション" direction="row" spacing={1}>
      {NAV_ITEMS.map((item) => {
        const active = item.isActive(pathname)
        return (
          <Button
            key={item.to}
            component={RouterLink}
            to={item.to}
            variant={active ? 'contained' : 'text'}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Button>
        )
      })}
    </Stack>
  )
}
