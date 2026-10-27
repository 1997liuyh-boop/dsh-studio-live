import { useEffect, useRef, useState } from 'react'

/** 已授权的本机弹幕桥随本轮预演停止，不接收其他网络地址。 */
export function BridgePanel({ active, enqueue, report }: { active: boolean; enqueue(value: unknown): void; report(error: unknown): void }) {
  const [address, setAddress] = useState('ws://127.0.0.1:33108'), [status, setStatus] = useState('未连接弹幕桥')
  const socket = useRef<WebSocket | undefined>(undefined), handlers = useRef({ enqueue, report })
  handlers.current = { enqueue, report }
  const close = () => { const current = socket.current; socket.current = undefined; if (current) { current.onclose = null; current.onmessage = null; current.onerror = null; current.onopen = null; current.close() } }
  useEffect(() => { if (!active) { close(); setStatus('弹幕桥已停止') } return close }, [active])
  const connect = () => {
    try {
      const url = new URL(address)
      if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('只支持 127.0.0.1 的本机弹幕桥')
      close(); const current = new WebSocket(url); socket.current = current; setStatus('正在连接弹幕桥')
      current.onopen = () => setStatus('本机弹幕桥已连接')
      current.onclose = () => setStatus('弹幕桥已断开')
      current.onerror = () => setStatus('弹幕桥连接失败')
      current.onmessage = event => { try { if (typeof event.data !== 'string' || event.data.length > 4096) throw new Error('弹幕格式无效或内容过大'); handlers.current.enqueue(JSON.parse(event.data)) } catch (error) { handlers.current.report(error) } }
    } catch (error) { handlers.current.report(error) }
  }
  return <details><summary className="cursor-pointer text-sm">其他平台本机弹幕桥</summary><div className="mt-3 space-y-2"><input aria-label="弹幕桥地址" className="w-full rounded-lg border border-slate-300 bg-transparent p-2 text-sm dark:border-slate-700" value={address} onChange={event => setAddress(event.target.value)} /><div className="flex gap-2"><button disabled={!active} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" onClick={connect}>连接弹幕桥</button><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => { close(); setStatus('弹幕桥已停止') }}>断开</button></div><p className="text-xs">{status}</p></div></details>
}
