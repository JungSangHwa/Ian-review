import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error The local gateway is a plain Node ESM module without declarations.
import { handleLocalModel } from '../local-model.mjs'
export default defineConfig({ plugins: [react(), { name: 'local-ollama', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (!(req as typeof req & { url?: string }).url?.startsWith('/api/')) return next()
    void handleLocalModel(req, res, 4173).then((handled: boolean) => { if (!handled) next() }).catch(next)
  })
} }], server: { host: '0.0.0.0', allowedHosts: ['terminal.local'], port: 4173, strictPort: true }, preview: { host: '127.0.0.1', port: 4173, strictPort: true }, build: { sourcemap: false } })
