/**
 * 直播画面清晰度。工作室本身不推流：OBS 用「浏览器源」抓取形象叠加层，所以清晰度由两件事决定——
 * 1. OBS 浏览器源的尺寸（添加形象源时按所选清晰度设置）；
 * 2. 形象画布的渲染倍率（叠加层按浏览器源的实际尺寸自动放大，画布按同样的倍率渲染，放大后不发虚）。
 */

/** 清晰度档位 */
export type LiveQuality = 'standard' | 'hd' | 'uhd'

/** 叠加层的设计尺寸：所有布局按这个尺寸排版，再整体缩放到浏览器源的实际尺寸。 */
export const OVERLAY_BASE = { width: 960, height: 540 } as const

/** 各档位的浏览器源尺寸 */
export const QUALITIES: Record<LiveQuality, { label: string; width: number; height: number }> = {
  standard: { label: '标准 540p（最省资源）', width: 960, height: 540 },
  hd: { label: '高清 1080p', width: 1920, height: 1080 },
  uhd: { label: '超清 1440p', width: 2560, height: 1440 },
}

/** 本机保存所选清晰度的键 */
export const QUALITY_STORAGE_KEY = 'dsh.studio.live.quality.v1'

/** 把任意输入收窄成合法档位，无效时用标准。 */
export function parseQuality(value: unknown): LiveQuality {
  return value === 'hd' || value === 'uhd' ? value : 'standard'
}

/**
 * 叠加层缩放倍率：浏览器源实际尺寸相对设计尺寸的比例，按较小的一边取，至少 1。
 * 这样用户在 OBS 里直接把浏览器源改成 1920×1080，叠加层也会自动变清晰。
 */
export function overlayScale(viewportWidth: number, viewportHeight: number): number {
  const scale = Math.min(viewportWidth / OVERLAY_BASE.width, viewportHeight / OVERLAY_BASE.height)
  return Number.isFinite(scale) && scale > 1 ? Math.round(scale * 100) / 100 : 1
}

/**
 * 工作室内预览的渲染倍率：标准档保持原来的省电设置（屏幕倍率，最高 1.25）；
 * 高清 / 超清按屏幕倍率渲染（最高 2 / 3），高分屏上预览更清楚。
 */
export function previewResolution(quality: LiveQuality, devicePixelRatio: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  return Math.min(ratio, quality === 'uhd' ? 3 : quality === 'hd' ? 2 : 1.25)
}
