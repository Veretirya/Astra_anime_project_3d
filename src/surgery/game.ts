import scalpel from './assets/scalpel.webp?inline'
import tweezers from './assets/tweezers.webp?inline'
import clamp from './assets/clamp.webp?inline'
import needle from './assets/needle.webp?inline'
import bandage from './assets/bandage.webp?inline'
import iv from './assets/iv.webp?inline'
import glove from './assets/glove.webp?inline'

export type ToolId = 'scalpel' | 'tweezers' | 'clamp' | 'needle' | 'bandage' | 'iv' | 'hand'
export type Layer = 'skin' | 'muscle' | 'organs' | 'bones' | 'combined'
export type Mode = 'overview' | 'orbit' | 'walk'
export type Phase = 'ready' | 'running' | 'paused' | 'failed' | 'complete' | 'sandbox'
export type Zone = 'monitor' | 'arm' | 'leg' | 'pad' | 'iv'
export type Pick = { kind: 'tool'; id: ToolId } | { kind: 'zone'; id: Zone; marker?: number; gesture?: 'click' | 'stroke' } | { kind: 'specimen' }
export type OperationStep = { title: string; instruction: string; tool: ToolId | null; zone: Zone }
export type Operation = { id: string; title: string; subtitle: string; difficulty: number; duration: string; steps: OperationStep[] }
export type Run = { id: string; operation: string; passed: boolean; time: number; mistakes: number; date: string }
export type Settings = { sound: boolean; hints: boolean; traces: boolean; story: boolean; sandboxStory: boolean; gentle: boolean; quality: 'balanced' | 'high' }
export type LogEntry = { time: number; message: string; kind: 'info' | 'ok' | 'error' }

export const tools: { id: ToolId; name: string; category: string; description: string; image: string }[] = [
  { id: 'scalpel', name: 'Скальпель', category: 'Режущий инструмент', description: 'Открывает помеченный сегмент учебной кассеты. Вне учебного поля действие считается ошибкой.', image: scalpel },
  { id: 'tweezers', name: 'Пинцет', category: 'Захватывающий инструмент', description: 'Переносит отмеченные фрагменты и маркеры на учебном поле. Выберите инструмент, затем нужную зону.', image: tweezers },
  { id: 'clamp', name: 'Зажим', category: 'Фиксирующий инструмент', description: 'Фиксирует игровой модуль в отмеченной позиции. Подготовлен для второго и третьего сценариев.', image: clamp },
  { id: 'needle', name: 'Шовная игла', category: 'Шовный инструмент', description: 'Соединяет цветные метки учебного поля. Ориентируйтесь на текущий пункт плана операции.', image: needle },
  { id: 'bandage', name: 'Бинт', category: 'Перевязочный материал', description: 'Устанавливает стерильную повязку на выбранную игровую зону. Повязка остаётся на модели до сброса.', image: bandage },
  { id: 'iv', name: 'Капельница', category: 'Инфузионный модуль', description: 'Возьмите пакет № 6 и нажмите на держатель стойки рядом с изголовьем. Пакет появится на крючке, в камере пойдут капли, а на мониторе загорится «Подача включена». Нажимать на тело не нужно.', image: iv },
  { id: 'hand', name: 'Рука', category: 'Осмотр и позиционирование', description: 'В режиме захвата удерживайте участок модели и перемещайте его мышью или пальцем. При осмотре касание выделяет область. Жёлтое кольцо показывает усилие захвата.', image: glove },
]
export const toolById = (id: ToolId) => tools.find(t => t.id === id)!
export const zoneNames: Record<Zone, string> = { monitor: 'Монитор пациента', arm: 'Предплечье', leg: 'Голень', pad: 'Учебное поле', iv: 'Инфузионная стойка' }
export const layerNames: Record<Layer, string> = { skin: 'Кожа', muscle: 'Мышцы', organs: 'Органы', bones: 'Скелет', combined: 'Все слои' }
export const operations: Operation[] = [
  { id: '01', title: 'Первичный шов', subtitle: 'Восстановление учебного поля на предплечье.', difficulty: 1, duration: '2–3 мин', steps: [
    { title: 'Проверьте показатели', instruction: 'Осмотрите прикроватный монитор и подтвердите игровые показатели Мики.', tool: null, zone: 'monitor' },
    { title: 'Совместите метки', instruction: 'Выберите иглу № 4. Нажимайте на подсвеченные пары по очереди: 1, 2, 3.', tool: 'needle', zone: 'arm' },
    { title: 'Завершите перевязку', instruction: 'Выберите бинт и установите повязку на отмеченную зону.', tool: 'bandage', zone: 'arm' },
  ] },
  { id: '02', title: 'Извлечение фрагмента', subtitle: 'Найдите бирюзовый фрагмент, переместите его на лоток и закройте прежнюю метку.', difficulty: 2, duration: '3–5 мин', steps: [
    { title: 'Подключите мониторинг', instruction: 'Проверьте состояние пациентки на мониторе слева от стола.', tool: null, zone: 'monitor' },
    { title: 'Зафиксируйте модуль', instruction: 'Установите зажим на подсвеченное учебное поле.', tool: 'clamp', zone: 'pad' },
    { title: 'Уберите фрагмент', instruction: 'Перенесите отмеченный фрагмент пинцетом из учебной кассеты.', tool: 'tweezers', zone: 'pad' },
    { title: 'Завершите перевязку', instruction: 'Фрагмент на лотке. Возьмите бинт № 5 и нажмите на пустую метку на модели, не на камешек. Это последний этап.', tool: 'bandage', zone: 'pad' },
  ] },
  { id: '03', title: 'Комплексное восстановление', subtitle: 'Согласованная работа с несколькими игровыми модулями.', difficulty: 3, duration: '5–7 мин', steps: [
    { title: 'Подключите капельницу', instruction: 'Возьмите пакет № 6 и нажмите на пустой держатель стойки у изголовья. Зелёный сигнал подтвердит подключение.', tool: 'iv', zone: 'iv' },
    { title: 'Сверьте показатели', instruction: 'Подтвердите стабильное состояние на мониторе пациентки.', tool: null, zone: 'monitor' },
    { title: 'Откройте метку', instruction: 'Скальпелем № 1 проведите между концами пунктирной линии на учебной накладке. Можно также нажать на саму линию.', tool: 'scalpel', zone: 'pad' },
    { title: 'Перенесите вставку', instruction: 'Пинцетом извлеките цветную вставку учебного поля.', tool: 'tweezers', zone: 'pad' },
    { title: 'Совместите разметку', instruction: 'Иглой № 4 поочерёдно соедините три светящиеся пары на том же поле. Бирюзовый фрагмент остаётся в лотке.', tool: 'needle', zone: 'pad' },
    { title: 'Завершите сценарий', instruction: 'Установите повязку на отмеченное учебное поле.', tool: 'bandage', zone: 'pad' },
  ] },
  { id: '04', title: 'Свободная практика', subtitle: 'Исследуйте операционную, слои модели и инструменты без оценки.', difficulty: 0, duration: 'Без лимита', steps: [] },
]
export const layerInfo: Record<Layer, string> = {
  skin: 'Исходная модель Мики. Покрывало можно убрать: под ним остаётся одежда персонажа. Кисти и предплечья опираются на стол под действием гравитации.',
  muscle: 'Условная карта основных мышечных групп. Волокна и объёмы привязаны к костям модели.',
  organs: 'Схематичный обзор сердца, лёгких, печени, желудка, почек и кишечника. Модули закреплены внутри модели.',
  bones: 'Суставная система, позвоночник, рёбра и конечности. Положение костей следует физическому скелету.',
  combined: 'Полупрозрачный обзор всех слоёв. Используйте карту модели для выбора даже перекрытых органов, костей и фаланг.',
}
export const defaultSettings: Settings = { sound: false, hints: true, traces: true, story: true, sandboxStory: true, gentle: false, quality: 'balanced' }
export function timer(sec: number) { return `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(Math.floor(sec) % 60).padStart(2, '0')}` }
export function readRuns(): Run[] {
  try { const v: unknown = JSON.parse(localStorage.getItem('theatre.runs.v1') || '[]'); return Array.isArray(v) ? v.filter(r => typeof r.id === 'string' && typeof r.time === 'number' && typeof r.passed === 'boolean').slice(0, 40) : [] } catch { return [] }
}
export function preferences(): Settings {
  try {
    const o = JSON.parse(localStorage.getItem('theatre.preferences.v1') || '{}')
    return { sound: o.sound === true, hints: o.hints !== false, traces: o.traces !== false, story: o.story !== false, sandboxStory: o.sandboxStory !== false, gentle: typeof o.gentle === 'boolean' ? o.gentle : matchMedia('(prefers-reduced-motion: reduce)').matches, quality: o.quality === 'high' ? 'high' : 'balanced' }
  } catch { return { ...defaultSettings, gentle: matchMedia('(prefers-reduced-motion: reduce)').matches } }
}