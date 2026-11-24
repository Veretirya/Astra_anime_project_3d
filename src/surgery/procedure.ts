import { operations, toolById, zoneNames, type OperationStep, type ToolId, type Zone } from './game'

export type Procedure = {
  scenario: number; progress: number; monitored: boolean; infusion: boolean; fixed: boolean
  opened: boolean; extracted: boolean; stitches: number; dressed: boolean; practiceResolved: boolean
}
export type ActionResult = { state: Procedure; kind: 'accepted' | 'repeat' | 'blocked' | 'failed'; message: string; finished: boolean }

export function freshProcedure(scenario: number): Procedure {
  return { scenario, progress: 0, monitored: false, infusion: false, fixed: false, opened: false, extracted: false, stitches: 0, dressed: false, practiceResolved: false }
}

export function actionLabel(task?: OperationStep) {
  if (!task || !task.tool) return 'Проверить монитор'
  return { scalpel: 'Открыть метку', clamp: 'Закрепить поле', tweezers: 'Извлечь фрагмент', needle: 'Совместить метки', bandage: 'Наложить повязку', iv: 'Подключить пакет', hand: 'Осмотреть' }[task.tool]
}

export function stitchGoal(scenario: number) { return scenario === 3 ? 1 : 3 }

// All input paths use this transition. A visual dressing cannot finish an unrelated step.
export function applyProcedure(prev: Procedure, tool: ToolId | null, zone: Zone, practice = false): ActionResult {
  const same = (kind: ActionResult['kind'], message: string): ActionResult => ({ state: prev, kind, message, finished: false })
  const steps = operations[prev.scenario].steps
  const task = steps[prev.progress]
  const pairs = practice ? 1 : stitchGoal(prev.scenario)
  if (prev.dressed && (!practice || (zone !== 'iv' && zone !== 'monitor'))) return same('repeat', 'Повязка уже на месте. Это игровое поле закрыто.')
  if (!practice && !task) return same('blocked', 'Все этапы уже выполнены.')
  if (!practice && (zone !== task.zone || (task.tool !== null && tool !== task.tool))) {
    if (steps.slice(0, prev.progress).some(s => s.zone === zone && (s.tool === null || s.tool === tool))) return same('repeat', 'Этот этап уже засчитан. Перейдите к выделенному пункту плана.')
    if (tool === 'hand') return same('blocked', 'Осмотр доступен, но для этого этапа нужен инструмент из плана.')
    return same('failed', zone !== task.zone ? `Выбрана другая цель. В этом этапе отмечена зона «${zoneNames[task.zone]}».` : `Для этапа «${task.title}» нужен инструмент «${toolById(task.tool!).name}».`)
  }
  const next = { ...prev }
  let message = '', advance = true
  if (zone === 'monitor') { next.monitored = true; message = 'Показатели проверены.' }
  else if (zone === 'iv') {
    if (tool !== 'iv') return same('blocked', 'Возьмите пакет «Капельница» в ячейке 6, затем нажмите на стойку.')
    if (prev.infusion) return same('repeat', 'Пакет уже подключён. Зелёная индикация означает, что игровая подача работает.')
    next.infusion = true; message = 'Капельница подключена. Подача включена.'
  } else if (tool === 'clamp') {
    if (prev.fixed) return same('repeat', 'Поле уже зафиксировано.')
    next.fixed = true; message = 'Учебное поле зафиксировано.'
  } else if (tool === 'scalpel') {
    if (prev.opened) return same('repeat', 'Метка уже открыта. Выберите пинцет, чтобы забрать фрагмент.')
    if (zone !== 'pad') return same('blocked', 'Скальпель открывает только линию на учебном поле.')
    next.opened = true; message = 'Линия открыта. Бирюзовый фрагмент доступен.'
  } else if (tool === 'tweezers') {
    if (prev.extracted) return same('repeat', 'Фрагмент уже на лотке. Продолжайте на прежней метке.')
    if (zone !== 'pad' || (!prev.fixed && !prev.opened)) return same('blocked', 'Сначала откройте или зафиксируйте метку на учебном поле.')
    next.extracted = true; message = 'Фрагмент перенесён в чашу на лотке.'
  } else if (tool === 'needle') {
    if (prev.stitches >= pairs) return same('repeat', 'Все пары меток уже соединены. Осталась повязка.')
    next.stitches++; advance = next.stitches === pairs
    message = `Метки соединены: ${next.stitches} из ${pairs}.`
  } else if (tool === 'bandage') {
    if (practice && !prev.extracted && !prev.stitches) return same('blocked', 'Сначала завершите работу с метками или извлеките учебный фрагмент.')
    next.dressed = true; next.practiceResolved = practice; message = 'Повязка закреплена на игровом поле.'
  } else return same('blocked', 'Выберите инструмент для этого действия.')
  if (!practice && advance) next.progress++
  const finished = !practice && next.dressed && next.progress === steps.length
  return { state: next, kind: 'accepted', message, finished }
}