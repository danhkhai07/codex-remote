import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const origin = loadEnv(mode, process.cwd(), 'CODEX_REMOTE_').CODEX_REMOTE_PUBLIC_ORIGIN
  let allowedHosts: true | string[] = true
  try {
    if (origin) allowedHosts = [new URL(origin).hostname]
  } catch {
    // The gateway validates the configured origin before it starts.
  }
  return {
    plugins: [react()],
    server: { allowedHosts },
    build: { sourcemap: true },
  }
})
