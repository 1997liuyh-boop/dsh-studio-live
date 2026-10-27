import { createHash, randomUUID } from 'node:crypto'

/** OBS v5 的单次连接；每次请求完成后关闭，不持有用户的 WebSocket 密码。 */
export async function obsRequest(port: number, password: string, requestType: string, requestData: object = {}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || password.length > 512) throw new Error('OBS 端口或密码格式无效')
  if (!['GetVersion', 'GetStreamStatus', 'GetSceneList', 'CreateInput'].includes(requestType)) throw new Error('不支持此 OBS 操作')
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`)
    const id = randomUUID()
    let settled = false
    const finish = (error?: Error, value: Record<string, unknown> = {}) => {
      if (settled) return
      settled = true; clearTimeout(timer); socket.close()
      if (error) reject(error); else resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('OBS 连接超时；检查是否已启用 WebSocket 服务器')), 8000)
    socket.onerror = () => finish(new Error('无法连接 OBS；请启动 OBS 并启用工具 → WebSocket 服务器设置'))
    socket.onclose = () => finish(new Error('OBS 连接关闭；检查端口与密码'))
    socket.onmessage = event => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 1_000_000) throw new Error('OBS 响应过大')
        const message = record(JSON.parse(event.data))
        const data = record(message.d)
        if (message.op === 0) {
          const auth = record(data.authentication)
          const hash = (input: string) => createHash('sha256').update(input).digest('base64')
          if (data.authentication && (typeof auth.salt !== 'string' || typeof auth.challenge !== 'string')) throw new Error('OBS 认证响应无效')
          socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0,
            ...(data.authentication ? { authentication: hash(hash(password + auth.salt) + auth.challenge) } : {}) } }))
        } else if (message.op === 2) socket.send(JSON.stringify({ op: 6, d: { requestId: id, requestType, requestData } }))
        else if (message.op === 7 && data.requestId === id) {
          const status = record(data.requestStatus)
          if (status.result !== true) throw new Error(typeof status.comment === 'string' ? status.comment : 'OBS 请求失败')
          finish(undefined, record(data.responseData))
        }
      } catch (error) { finish(error instanceof Error ? error : new Error('OBS 响应无效')) }
    }
  })
}

/** 仅在 JSON 和网络输入处缩窄对象。 */
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
