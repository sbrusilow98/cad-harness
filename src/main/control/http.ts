import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { errorMessage } from '@shared/errors'
import { buildControlServer } from './server'
import type { ControlDeps } from './deps'

export const CONTROL_PATH = '/mcp'
const HOST = '127.0.0.1'

export interface ControlListener {
  port: number
  url: string
  close(): Promise<void>
}

export interface ControlListenerOptions {
  port: number
  token: string
  deps: ControlDeps
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
}

/** Compares in constant time so the token cannot be guessed a character at a time. */
function authorized(header: string | undefined, token: string): boolean {
  if (!header || header.slice(0, 7).toLowerCase() !== 'bearer ') return false
  const given = Buffer.from(header.slice(7).trim(), 'utf8')
  const expected = Buffer.from(token, 'utf8')
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

export async function startControlListener(options: ControlListenerOptions): Promise<ControlListener> {
  const sockets = new Set<Socket>()
  let boundPort = options.port

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`)
    } catch {
      sendJson(res, 400, { error: 'The Host header is malformed.' })
      return
    }
    if (url.pathname !== CONTROL_PATH) {
      sendJson(res, 404, { error: `Nothing here. The MCP endpoint is ${CONTROL_PATH}.` })
      return
    }
    if (!authorized(req.headers.authorization, options.token)) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      sendJson(res, 401, { error: 'A valid bearer token is required. Copy it from Settings, Remote control.' })
      return
    }

    // Stateless: one server and transport per request, so there are no sessions to track.
    const server = buildControlServer(options.deps)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`${HOST}:${boundPort}`, `localhost:${boundPort}`]
    })
    res.on('close', () => {
      void transport.close().catch(() => undefined)
      void server.close().catch(() => undefined)
    })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  }

  const httpServer: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: errorMessage(err) })
      else res.end()
    })
  })

  httpServer.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err)
    httpServer.once('error', onError)
    httpServer.listen(options.port, HOST, () => {
      httpServer.removeListener('error', onError)
      resolve()
    })
  })

  // Without this, a post-bind error would be an unhandled 'error' event and would end the process.
  httpServer.on('error', (err: Error) => {
    console.error('The remote control listener errored:', errorMessage(err))
  })

  const address = httpServer.address()
  boundPort = typeof address === 'object' && address ? address.port : options.port

  return {
    port: boundPort,
    url: `http://${HOST}:${boundPort}${CONTROL_PATH}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        sockets.clear()
        httpServer.close(() => resolve())
      })
  }
}
