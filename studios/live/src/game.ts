/** 内置农场练习场（非星露谷）：本地规则驱动，不依赖 AI 会话，未安装游戏时也能预演直播画面与解说。 */
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

/** 6×6 地块里离当前位置最近、且满足条件的格子下标；没有返回 -1。 */
function nearest(state: FarmState, match: (value: number) => boolean): number {
  let best = -1, bestDistance = Infinity
  state.plots.forEach((value, index) => {
    if (!match(value)) return
    const distance = Math.abs(index % 6 - state.x) + Math.abs(Math.floor(index / 6) - state.y)
    if (distance < bestDistance) { best = index; bestDistance = distance }
  })
  return best
}

/** 朝目标格子走一步：先横向再纵向。 */
function stepToward(state: FarmState, index: number): FarmAction {
  const x = index % 6, y = Math.floor(index / 6)
  if (x < state.x) return 'left'
  if (x > state.x) return 'right'
  return y < state.y ? 'up' : 'down'
}

/**
 * 练习场的本地决策（替代 AI 选动作）：成熟就收、已种就浇、有种子就种，
 * 种子用完后等待作物成熟，再逐块收获，循环推进。
 * @param state - 当前农场状态。
 * @returns 本轮动作与简短中文解说。
 */
export function planFarm(state: FarmState): { action: FarmAction; speech: string } {
  const here = state.plots[state.y * 6 + state.x]
  if (here === 3) return { action: 'harvest', speech: '收获！这块地丰收了' }
  if (here === 1) return { action: 'water', speech: '给刚种下的种子浇点水' }
  const ripe = nearest(state, value => value === 3)
  if (ripe >= 0) return { action: stepToward(state, ripe), speech: '去收成熟的作物' }
  const thirsty = nearest(state, value => value === 1)
  if (thirsty >= 0) return { action: stepToward(state, thirsty), speech: '那边的种子还没浇水' }
  if (here === 0 && state.seeds > 0) return { action: 'plant', speech: '在这里种一颗种子' }
  const empty = state.seeds > 0 ? nearest(state, value => value === 0) : -1
  if (empty >= 0) return { action: stepToward(state, empty), speech: '找下一块空地播种' }
  return { action: 'wait', speech: '等作物慢慢长大' }
}
