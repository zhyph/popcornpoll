import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

export function createHealthHandler(dataDir: string): (req: Request) => Promise<Response> {
  return async () => {
    try {
      accessSync(join(dataDir, 'popcornpoll.db'), constants.R_OK | constants.W_OK)
      return Response.json({ status: 'ok' })
    } catch {
      return Response.json({ status: 'unhealthy' }, { status: 503 })
    }
  }
}
