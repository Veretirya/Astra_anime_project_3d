export type Tool = 'grab' | 'orbit' | 'move'
export type View = 'perspective' | 'front' | 'side' | 'back'
export type Settings = {
  running: boolean
  gravityEnabled: boolean
  gravity: number
  anchored: boolean
  grid: boolean
  skeleton: boolean
  speed: number
  tool: Tool
}

export const defaults: Settings = {
  running: true, gravityEnabled: true, gravity: 9.81, anchored: true,
  grid: true, skeleton: false, speed: 1, tool: 'grab',
}

export type BodyState = { name: string; p: number[]; q: number[]; v: number[]; w: number[] }
export type SceneState = {
  bodies: BodyState[]
  anchor: number[]
  camera: number[]
  target: number[]
  time: number
}
export type SavedScene = {
  id: string
  name: string
  date: string
  thumbnail: string
  settings: Settings
  state: SceneState
}
export type Metrics = { fps: number; time: number; x: number; y: number; z: number }
export const viewNames: Record<View, string> = {
  perspective: 'Перспектива', front: 'Спереди', side: 'Сбоку', back: 'Сзади',
}
export function timecode(seconds: number) {
  const s = Math.floor(seconds)
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}