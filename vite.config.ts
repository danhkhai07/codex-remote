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
    define: { __CODEX_REMOTE_BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
    server: { allowedHosts },
    // Open tabs may still request an earlier hashed bundle during an update.
    build: { sourcemap: true, emptyOutDir: false },
  }
})
