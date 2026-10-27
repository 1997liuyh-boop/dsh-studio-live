/** 练习场只用于未安装游戏时验证模型调度，不代表星露谷已连接。 */
export interface FarmState { x: number; y: number; seeds: number; harvest: number; plots: number[] }
export const newFarm = (): FarmState => ({ x: 0, y: 0, seeds: 8, harvest: 0, plots: Array(36).fill(0) })
export const gameActions = ['up', 'down', 'left', 'right', 'plant', 'water', 'harvest', 'wait'] as const
export type FarmAction = typeof gameActions[number]
export const minecraftActions = ['forward', 'back', 'left', 'right', 'jump', 'lookLeft', 'lookRight', 'digLog', 'digStone', 'wait', 'stop'] as const

/** 每次最多一步，边缘不会越界，作物只在浇水和等待后成熟。 */
export function stepFarm(state: FarmState, action: FarmAction): FarmState {
  const next = { ...state, plots: [...state.plots] }
  if (action === 'up') next.y = Math.max(0, state.y - 1)
  if (action === 'down') next.y = Math.min(5, state.y + 1)
  if (action === 'left') next.x = Math.max(0, state.x - 1)
  if (action === 'right') next.x = Math.min(5, state.x + 1)
  const index = next.y * 6 + next.x
  if (action === 'plant' && !next.plots[index] && next.seeds > 0) { next.plots[index] = 1; next.seeds-- }
  if (action === 'water' && next.plots[index] === 1) next.plots[index] = 2
  if (action === 'wait') next.plots = next.plots.map(value => value === 2 ? 3 : value)
  if (action === 'harvest' && next.plots[index] === 3) { next.plots[index] = 0; next.harvest++; next.seeds++ }
  return next
}

/** 模型输出只能选择已声明动作，禁止把回复文本作为命令执行。 */
export function parseDecision(text: string, actions: readonly string[]): { action: string; speech: string } {
  const raw: unknown = JSON.parse(text.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''))
  if (!raw || typeof raw !== 'object' || !('action' in raw) || !('speech' in raw) || typeof raw.action !== 'string'
    || !actions.includes(raw.action) || typeof raw.speech !== 'string' || raw.speech.length > 400) throw new Error('AI 未返回有效动作，本轮未操作游戏')
  return { action: raw.action, speech: raw.speech }
}
