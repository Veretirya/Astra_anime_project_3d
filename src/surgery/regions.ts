import type { Layer } from './game'

export type AtlasPart = { id: string; name: string; layer: Layer; group: string; bone: string }
export const regionNames: Record<string, string> = {
  C_Hips: 'Таз', C_Spine: 'Поясница', C_Chest: 'Корпус', C_UpperChest: 'Грудной отдел', C_Neck: 'Шея', C_Head: 'Голова',
  L_UpperArm: 'Левое плечо', R_UpperArm: 'Правое плечо', L_LowerArm: 'Левое предплечье', R_LowerArm: 'Правое предплечье',
  L_Hand: 'Левая кисть', R_Hand: 'Правая кисть', L_UpperLeg: 'Левое бедро', R_UpperLeg: 'Правое бедро',
  L_LowerLeg: 'Левая голень', R_LowerLeg: 'Правая голень', L_Foot: 'Левая стопа', R_Foot: 'Правая стопа',
}
export const bodyParts: AtlasPart[] = Object.entries(regionNames).map(([bone, name]) => ({
  id: 'body:' + bone, name, bone, layer: 'skin', group: bone.startsWith('C_') ? 'Голова и корпус' : /Arm|Hand/.test(bone) ? 'Руки' : 'Ноги',
}))
export const organParts: AtlasPart[] = ['Сердце', 'Левое лёгкое', 'Правое лёгкое', 'Печень', 'Желудок', 'Левая почка', 'Правая почка', 'Кишечник'].map(name => ({
  id: 'organ:' + name, name, layer: 'organs', group: 'Внутренние органы', bone: 'C_Chest',
}))
const coreBones: Record<string, string> = { C_Head: 'Череп', C_Chest: 'Рёбра', C_Spine: 'Позвоночник', C_Hips: 'Тазовые кости' }
export const boneParts: AtlasPart[] = [...bodyParts.filter(p => !p.bone.startsWith('C_') || coreBones[p.bone]).map(p => ({
  ...p, id: 'bone:' + p.bone, layer: 'bones' as Layer, name: coreBones[p.bone] || p.name,
})), ...['L', 'R'].flatMap(side => ['Index', 'Middle', 'Ring', 'Little', 'Thumb'].flatMap((finger, i) => [1, 2, 3].map(j => {
  const bone = `${side}_${finger}${j}`
  return { id: 'bone:' + bone, name: `${['Указательный', 'Средний', 'Безымянный', 'Мизинец', 'Большой'][i]} · фаланга ${j}`, bone, layer: 'bones' as Layer, group: side === 'L' ? 'Левая кисть' : 'Правая кисть' }
}))) ]
export const muscleParts: AtlasPart[] = bodyParts.filter(p => !p.bone.startsWith('C_') || p.bone === 'C_Chest').map(p => ({
  ...p, id: 'muscle:' + p.bone, layer: 'muscle', name: p.bone === 'C_Chest' ? 'Мышцы корпуса' : p.name,
}))
export const allParts = [...bodyParts, ...organParts, ...boneParts, ...muscleParts]
export const partById = new Map(allParts.map(p => [p.id, p]))
export type ContactReading = { part: string; effort: number; held: boolean; pinned?: boolean } | null
export type HandMode = 'grab' | 'inspect'
export type Workspace = 'theatre' | 'physics'
export const gravities = [{ name: 'Земля', value: 9.81 }, { name: 'Луна', value: 1.62 }, { name: 'Невесомость', value: 0 }]