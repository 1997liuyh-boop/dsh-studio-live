import { parentPort, workerData } from 'node:worker_threads'
import { createBot } from 'mineflayer'

const port = parentPort
if (!port) throw new Error('Minecraft 适配器只能由工作室启动')
const config: { port: number; username: string } = workerData
const bot = createBot({ host: '127.0.0.1', port: config.port, username: config.username, auth: 'offline', hideErrors: true, logErrors: false })
let ready = false, busy = false
const stop = () => { bot.clearControlStates(); bot.stopDigging() }
bot.once('spawn', () => { ready = true; port.postMessage({ type: 'ready' }) })
bot.on('error', () => port.postMessage({ type: 'failure', error: 'Minecraft 连接失败，请检查本机 Java 测试服' }))
bot.on('end', () => { ready = false; port.postMessage({ type: 'failure', error: 'Minecraft 连接已断开' }) })
bot.on('kicked', () => { ready = false; port.postMessage({ type: 'failure', error: 'Minecraft 服务器拒绝连接，请检查版本和测试服设置' }) })

/** 只回传结构化游戏状态；不向游戏聊天发送模型或观众文本。 */
function snapshot() {
  const position = bot.entity.position
  const nearby = bot.findBlocks({ matching: block => /(?:log|stone|ore|crafting_table)$/u.test(block.name), maxDistance: 8, count: 12 })
    .map(value => { const block = bot.blockAt(value); return { name: block?.name, x: value.x, y: value.y, z: value.z } })
  return { connected: ready, game: 'minecraft-java', health: bot.health, food: bot.food, position: { x: position.x, y: position.y, z: position.z }, inventory: bot.inventory.items().map(item => ({ name: item.name, count: item.count })), nearby, at: Date.now() }
}

/** 每条动作有五秒上限，超时断开连接，避免旧动作在下一轮继续执行。 */
async function act(action: string): Promise<void> {
  stop()
  if (action === 'wait' || action === 'stop') return
  if (action === 'lookLeft' || action === 'lookRight') { await bot.look(bot.entity.yaw + (action === 'lookLeft' ? 0.5 : -0.5), 0, true); return }
  if (['forward', 'back', 'left', 'right', 'jump'].includes(action)) {
    if (action === 'forward') {
      const next = bot.entity.position.offset(-Math.sin(bot.entity.yaw), -1, -Math.cos(bot.entity.yaw))
      const ground = bot.blockAt(next)
      if (!ground || ['air', 'lava', 'water'].includes(ground.name)) throw new Error('前方缺少安全地面，本轮未移动')
    }
    bot.setControlState(action as 'forward' | 'back' | 'left' | 'right' | 'jump', true)
    await new Promise(resolve => setTimeout(resolve, 500)); stop(); return
  }
  if (action === 'digLog' || action === 'digStone') {
    const block = bot.findBlock({ matching: value => action === 'digLog' ? /(?:_log|_stem)$/u.test(value.name) : value.name === 'stone', maxDistance: 3 })
    if (!block || !bot.canDigBlock(block) || block.position.y < Math.floor(bot.entity.position.y)) throw new Error('附近没有可以安全挖掘的目标，本轮未挖掘')
    await bot.dig(block); return
  }
  throw new Error('Minecraft 动作不在允许列表')
}
port.on('message', (request: { id: string; action: string }) => {
  if (request.action === 'stop') stop()
  if (!ready || busy && request.action !== 'stop') { port.postMessage({ id: request.id, error: ready ? 'Minecraft 正在执行上一条动作' : 'Minecraft 尚未进入世界' }); return }
  busy = true
  const deadline = setTimeout(() => { stop(); bot.quit(); port.postMessage({ type: 'failure', error: 'Minecraft 动作超时，已断开连接，请检查游戏状态后重新预演' }) }, 5000)
  void (async () => {
    try { if (request.action !== 'state') await act(request.action); port.postMessage({ id: request.id, state: snapshot() }) }
    catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Minecraft 动作失败' }) }
    finally { clearTimeout(deadline); busy = false }
  })()
})
