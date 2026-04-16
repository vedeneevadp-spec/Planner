import { createApiKernel, destroyApiKernel } from './main.js'

const kernel = createApiKernel()

try {
  await kernel.app.listen({
    host: kernel.config.host,
    port: kernel.config.port,
  })
} catch (error) {
  kernel.app.log.error(error)
  await destroyApiKernel(kernel)
  process.exit(1)
}

const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']

for (const signal of shutdownSignals) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  kernel.app.log.info({ signal }, 'Shutting down API server.')

  await destroyApiKernel(kernel)
  process.exit(0)
}
