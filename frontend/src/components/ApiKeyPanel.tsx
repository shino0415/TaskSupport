import { useEffect, useState } from 'react'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

type Props = {
  savedApiKey: string
  onSave: (apiKey: string) => void
  onClear: () => void
}

/** API Keyの入力欄。入力値は画面から渡された保存処理でsessionStorageへ保持される。 */
export function ApiKeyPanel({ savedApiKey, onSave, onClear }: Props) {
  const [inputValue, setInputValue] = useState(savedApiKey)

  useEffect(() => {
    setInputValue(savedApiKey)
  }, [savedApiKey])

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        API Key
      </Typography>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(inputValue)
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: 'flex-start' }}
        >
          <TextField
            label="API Key"
            type="password"
            size="small"
            fullWidth
            autoComplete="off"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            helperText="入力したキーはこのタブのsessionStorageにのみ保持されます（タブを閉じると破棄されます）。"
          />
          <Button type="submit" variant="contained">
            保存して接続
          </Button>
          <Button type="button" variant="outlined" onClick={onClear} disabled={savedApiKey === ''}>
            クリア
          </Button>
        </Stack>
      </Box>
    </Paper>
  )
}
