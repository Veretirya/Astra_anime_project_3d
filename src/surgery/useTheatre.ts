import { activeAvatarName, getActiveAvatar } from '../studio/importAvatar'
import type { ReactionFrame } from './reaction'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TheatreEngine, type Hover, type RoomSnapshot } from './engine'
import { applyProcedure, freshProcedure, type Procedure } from './procedure'
import { partById, type ContactReading, type HandMode, type Workspace } from './regions'
import { operations, tools, toolById, preferences, readRuns, type Phase, type Mode, type Layer, type ToolId, type Pick, type Run, type LogEntry, type Settings, type Zone } from './game'

export type Dialog = 'levels' | 'atlas' | 'journal' | 'settings' | 'help' | 'patient' | 'result' | 'reset' | 'anatomy' | 'aftermath' | null
type SessionSnapshot = {
  level: number; phase: Phase; misses: number; seconds: number; mode: Mode; layer: Layer; selected: ToolId | null
  resume: Phase; log: LogEntry[]; recorded: boolean; reason: string; room: RoomSnapshot
}
export function useTheatre() {
  const [dialog, setDialog] = useState<Dialog>(null), [level, setLevel] = useState(0)
  const [procedure, setProcedure] = useState<Procedure>(() => freshProcedure(0)), liveProcedure = useRef(procedure)
  const step = procedure.progress, lastAction = useRef({ key: '', at: 0 })
  const [phase, setPhase] = useState<Phase>('ready'), [mode, setMode] = useState<Mode>(getActiveAvatar() ? 'orbit' : 'overview')
  const [layer, setLayer] = useState<Layer>('skin'), [selected, setSelected] = useState<ToolId | null>('scalpel')
  const [time, setTime] = useState(0), [mistakes, setMistakes] = useState(0), [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<Settings>(preferences), [anchored, setAnchored] = useState(true)
  const [workspace, setWorkspace] = useState<Workspace>('theatre'), [covered, setCovered] = useState(true)
  const [gravity, setGravity] = useState(9.81), [handMode, setHandMode] = useState<HandMode>('grab')
  const [partId, setPartId] = useState<string | null>(null), [isolated, setIsolated] = useState(false)
  const [contact, setContact] = useState<ContactReading>(null)
  const [reaction, setReaction] = useState<ReactionFrame | null>(null), reactionLive = useRef(false)
  const sessions = useRef<Partial<Record<Workspace, SessionSnapshot>>>({})
  const [hover, setHover] = useState<Hover | null>(null), [menu, setMenu] = useState(false)
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [toast, setToast] = useState('')
  const [fullscreen, setFullscreen] = useState(false), [runs, setRuns] = useState<Run[]>(readRuns)
  const [log, setLog] = useState<LogEntry[]>([{ time: 0, message: `Операционная подготовлена. ${activeAvatarName()} на мониторе.`, kind: 'ok' }])
  const [journalTab, setJournalTab] = useState<'events' | 'results'>('events'), [atlas, setAtlas] = useState<ToolId>('scalpel')
  const [fps, setFps] = useState(0), [failedReason, setFailedReason] = useState(''), [organ, setOrgan] = useState(''), [peekLevel, setPeekLevel] = useState(0)
  const engine = useRef<TheatreEngine | null>(null), host = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null)
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), hoveredTool = useRef<ToolId | null>(null)
  const state = useRef({ phase, mode, level, step, selected, time, mistakes, dialog, settings, layer, anchored, workspace, covered, gravity, handMode })
  state.current = { phase, mode, level, step, selected, time, mistakes, dialog, settings, layer, anchored, workspace, covered, gravity, handMode }
  const clock = useRef(0), audio = useRef<AudioContext | null>(null), resultSaved = useRef(false), resumePhase = useRef<Phase>('running')
  const publish = useCallback((next: Procedure, animate = false, zone?: Zone) => {
    liveProcedure.current = next; setProcedure(next); engine.current?.setProcedure(next, animate, zone)
  }, [])
  const current = operations[level], currentStep = current.steps[step]
  const isPlay = phase === 'running' || phase === 'sandbox' || phase === 'failed'
  const progress = current.steps.length ? Math.round(step / current.steps.length * 100) : 0
  const pulse = phase === 'failed' ? 92 : phase === 'complete' ? 70 : isPlay ? 72 + Math.round(Math.sin(time * .39) * 2 + Math.sin(time * .15)) : 72
  const notify = useCallback((message: string) => { setToast(message); clearTimeout(toastTimeout.current); toastTimeout.current = setTimeout(() => setToast(''), 3400) }, [])
  const addLog = useCallback((message: string, kind: LogEntry['kind'] = 'info') => setLog(old => [...old.slice(-69), { time: clock.current, message, kind }]), [])
  const beep = useCallback((frequency = 720, length = .08) => {
    const ctx = audio.current; if (!ctx || ctx.state !== 'running' || !state.current.settings.sound) return
    const osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = 'sine'; osc.frequency.value = frequency; gain.gain.setValueAtTime(.0001, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.027, ctx.currentTime + .005); gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + length)
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + length + .01)
  }, [])
  const enableAudio = useCallback(() => {
    try { const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (Ctx) { audio.current ??= new Ctx(); void audio.current.resume().catch(() => {}) } } catch { notify('Звук недоступен в этом браузере.') }
  }, [notify])
  const pickTool = useCallback((tool: ToolId | null) => {
    if (reactionLive.current) return
    setSelected(tool); state.current.selected = tool; engine.current?.setHeld(tool); beep(430, .035)
    addLog(tool ? `Выбран инструмент: ${toolById(tool).name}.` : 'Инструмент возвращён на стол.')
    if (tool === 'iv') {
      const s = state.current, requested = operations[s.level].steps[liveProcedure.current.progress]?.zone === 'iv'
      if ((requested || s.phase === 'sandbox') && s.mode !== 'overview' && !s.dialog) {
        if (s.mode === 'orbit') engine.current?.focus('iv')
        notify(liveProcedure.current.infusion ? 'Пакет уже подключён: подача включена.' : 'Пакет в руке. Нажмите на держатель стойки IV-01 у изголовья.')
      }
    }
  }, [beep, addLog, notify])
  const finish = useCallback((passed: boolean, reason = '') => {
    if (resultSaved.current) return
    resultSaved.current = true; const s = state.current, next = passed ? 'complete' : 'failed'; state.current.phase = next; setPhase(next); setFailedReason(reason)
    const entry: Run = { id: `run-${Date.now()}`, operation: operations[s.level].title, time: Math.floor(clock.current), mistakes: s.mistakes + (passed ? 0 : 1), passed, date: new Date().toISOString() }
    const list = [entry, ...readRuns()].slice(0, 40); setRuns(list); try { localStorage.setItem('theatre.runs.v1', JSON.stringify(list)) } catch { notify('Хранилище браузера недоступно. Результат остался в текущей сессии.') }
    engine.current?.setPhase(next, operations[s.level].steps[s.step]?.zone || 'pad'); setMenu(false); setHover(null); setFullscreen(false)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    addLog(passed ? 'Все этапы завершены. Состояние стабильно.' : reason, passed ? 'ok' : 'error'); beep(passed ? 920 : 260, .17)
    if (!passed && engine.current?.startReaction('operation')) return
    setDialog('result')
  }, [addLog, beep, notify])
  const interact = useCallback((pick: Pick) => {
    const s = state.current; if (s.dialog || reactionLive.current) return
    if (pick.kind === 'tool') { pickTool(pick.id); notify(`В руке: ${toolById(pick.id).name}`); return }
    if (pick.kind === 'specimen') { notify('Фрагмент уже в чаше. Продолжайте на прежней метке на модели, не на камешке.'); return }
    if (s.phase === 'ready') { notify('Нажмите «Начать операцию», чтобы приступить к заданию.'); return }
    if (s.phase === 'paused') { notify('Возобновите симуляцию.'); return }
    if (s.phase === 'complete') { notify('Сценарий завершён. Выберите следующий уровень.'); return }
    if (s.layer !== 'skin' && !['iv', 'monitor'].includes(pick.id)) { notify('Открыт анатомический атлас. Выберите «Кожа» для работы с полем.'); return }
    const practice = s.phase === 'sandbox' || s.phase === 'failed', prev = liveProcedure.current
    if (s.selected === 'needle' && pick.marker !== undefined && pick.marker !== prev.stitches) {
      notify(pick.marker < prev.stitches ? 'Эта пара уже соединена. Выберите следующую золотую метку.' : `Сначала соедините пару № ${prev.stitches + 1}.`); return
    }
    const at = performance.now(), key = `${pick.id}/${s.selected}`
    if (key === lastAction.current.key && at - lastAction.current.at < 220) return
    const outcome = applyProcedure(prev, s.selected, pick.id, practice)
    if (outcome.kind === 'failed') { setMistakes(k => k + 1); finish(false, outcome.message); return }
    if (outcome.kind !== 'accepted') { notify(outcome.message); return }
    lastAction.current = { at, key }; publish(outcome.state, true, pick.id); state.current.step = outcome.state.progress
    addLog(outcome.message, 'ok'); beep(outcome.finished ? 960 : 805)
    if (outcome.finished) { finish(true); return }
    if (outcome.state.practiceResolved) { notify('Упражнение завершено: повязка на месте. Свободная практика не оценивается.'); return }
    const following = operations[s.level].steps[outcome.state.progress]
    notify(outcome.message + (!practice && following && outcome.state.progress !== prev.progress ? ` Далее: ${following.title.toLowerCase()}.` : ''))
    if (!practice && following && (following.zone !== pick.id || following.tool === 'tweezers') && s.mode === 'orbit') {
      engine.current?.setPhase('running', following.zone); engine.current?.focus(following.zone)
    }
  }, [pickTool, notify, addLog, finish, beep, publish])
  const interactRef = useRef(interact); interactRef.current = interact
  useEffect(() => {
    if (!host.current) return
    let active = true; setReady(false); setError(''); let room: TheatreEngine | null = null
    const job = requestAnimationFrame(() => {
      if (!active || !host.current) return
      try {
        room = new TheatreEngine(host.current, state.current.settings, {
          ready: () => { if (!active) return; const s = state.current; setReady(true); room?.setWorkspace(s.workspace === 'physics'); room?.setHeld(s.selected); room?.setMode(s.mode); room?.setCover(s.covered); room?.setLayer(s.layer); room?.setHandMode(s.handMode); room?.setGravity(s.gravity); room?.setAnchored(s.anchored); room?.setProcedure(liveProcedure.current, false); room?.setPhase(s.phase, operations[s.level].steps[s.step]?.zone || 'monitor') },
          error: m => { if (active) { setReady(false); setError(m) } }, hint: notify, hover: h => { if (active) setHover(h) }, pick: p => interactRef.current(p),
          inspect: id => { if (active) { setPartId(id); setIsolated(false); setOrgan(partById.get(id)?.name || '') } },
          contact: r => { if (active) setContact(r) }, fps: n => { if (active) setFps(n) },
          reaction: f => { if (active) { reactionLive.current = Boolean(f); setReaction(f); if (f) { setMenu(false); setHover(null); setToast('') } } },
          reactionEnd: kind => { if (!active) return; addLog(kind === 'operation' ? 'Персонаж прервал протокол.' : 'Персонаж остановил эксперимент.', 'info'); setDialog(kind === 'operation' ? 'result' : 'aftermath') },
        }); engine.current = room
        if (import.meta.env.DEV) (window as unknown as { __theatre: TheatreEngine }).__theatre = room
      } catch { setError('Для 3D-операционной нужен WebGL 2. Включите аппаратное ускорение или откройте игру в другом браузере.') }
    })
    return () => { active = false; cancelAnimationFrame(job); room?.dispose(); engine.current = null }
  }, [retry, notify])
  useEffect(() => { engine.current?.setMode(mode); setHover(null); setMenu(false) }, [mode])
  useEffect(() => { engine.current?.setLayer(layer) }, [layer])
  useEffect(() => { engine.current?.setAnchored(anchored) }, [anchored])
  useEffect(() => { engine.current?.setCover(covered) }, [covered])
  useEffect(() => { engine.current?.setGravity(gravity) }, [gravity])
  useEffect(() => { engine.current?.setHandMode(handMode) }, [handMode])
  useEffect(() => { engine.current?.setOptions(settings); try { localStorage.setItem('theatre.preferences.v1', JSON.stringify(settings)) } catch { /* Private mode retains in-memory preferences. */ } }, [settings])
  useEffect(() => { engine.current?.setPhase(dialog ? 'paused' : phase, currentStep?.zone || 'monitor') }, [dialog, phase, currentStep, settings.hints, ready])
  useEffect(() => {
    if (!isPlay || dialog || reactionLive.current) return
    let last = performance.now(); const id = setInterval(() => { const now = performance.now(); if (!document.hidden) clock.current += Math.min(1, (now - last) / 1000); last = now; setTime(Math.floor(clock.current)) }, 220)
    return () => clearInterval(id)
  }, [isPlay, dialog, Boolean(reaction)])
  useEffect(() => { if (!settings.sound || !isPlay || dialog || reactionLive.current) return; const id = setInterval(() => { if (!document.hidden) beep(650, .057) }, 60000 / pulse); return () => clearInterval(id) }, [settings.sound, isPlay, dialog, pulse, beep, Boolean(reaction)])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-view-menu]')) setMenu(false) }; const full = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('mousedown', close); document.addEventListener('fullscreenchange', full)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('fullscreenchange', full); clearTimeout(toastTimeout.current); void audio.current?.close().catch(() => {}) }
  }, [])
  const switchWorkspace = (to: Workspace) => {
    if (reactionLive.current) return
    const e = engine.current, s = state.current
    if (to === s.workspace) { setDialog(null); return }
    const savedRoom = e?.capture()
    if (!e || !savedRoom) { notify('Подготавливаем модель, попробуйте через мгновение.'); return }
    sessions.current[s.workspace] = { level: s.level, phase: s.phase, misses: s.mistakes, seconds: clock.current, mode: s.mode,
      layer: s.layer, selected: s.selected, resume: resumePhase.current, log: log.slice(), recorded: resultSaved.current, reason: failedReason, room: savedRoom }
    state.current.workspace = to; setWorkspace(to); setMenu(false); setDialog(null); setHover(null); setContact(null); e.setWorkspace(to === 'physics')
    const saved = sessions.current[to]
    if (saved) {
      const r = saved.room; setLevel(saved.level); publish(r.effects.procedure); setPhase(saved.phase); setMistakes(saved.misses); clock.current = saved.seconds; setTime(Math.floor(saved.seconds)); resumePhase.current = saved.resume
      setMode(r.mode); setLayer(r.layer); setSelected(r.selected); setGravity(r.gravity); setAnchored(r.anchored); setCovered(r.covered); setHandMode(r.handMode)
      setPartId(r.part); setIsolated(r.isolated); setOrgan(partById.get(r.part || '')?.name || ''); setFailedReason(saved.reason); setLog(saved.log); resultSaved.current = saved.recorded; e.restore(r)
      e.setPhase(saved.phase, operations[saved.level].steps[r.effects.procedure.progress]?.zone || 'monitor')
    } else {
      setLevel(3); setPhase('sandbox'); publish(freshProcedure(3)); setMistakes(0); clock.current = 0; setTime(0); setMode('orbit'); setLayer('skin'); setSelected('hand'); setCovered(false); setAnchored(false); setGravity(9.81); setHandMode('grab'); setPartId(null); setIsolated(false); setOrgan(''); setFailedReason(''); resultSaved.current = false; resumePhase.current = 'sandbox'
      e.reset(); e.setMode('orbit'); e.setLayer('skin'); e.setCover(false); e.setGravity(9.81); e.setAnchored(false); e.setHandMode('grab'); e.setHeld('hand'); e.setPhase('sandbox', 'monitor')
      setLog([{ time: 0, message: 'Открыта физическая песочница. Фиксация снята, земная гравитация включена.', kind: 'ok' }])
    }
  }
  const openDialog = (d: Dialog) => { setMenu(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); setFullscreen(false); if (d === 'levels') setPeekLevel(level); setDialog(d) }
  const beginPractice = () => { publish(freshProcedure(3)); engine.current?.reset(); lastAction.current = { key: '', at: 0 }; setPhase('sandbox'); state.current.phase = 'sandbox'; setDialog(null); addLog('Свободная практика начата. Отчёт операции сохранён.'); notify('Свободная практика: упражнение не влияет на результат операции.') }
  const start = () => {
    if (!ready) { notify(error || 'Подготавливаем встроенную 3D-модель.'); return }
    if (settings.sound) enableAudio()
    if (phase === 'paused') { setPhase(resumePhase.current); return }
    if (phase === 'running' || phase === 'sandbox') { resumePhase.current = phase; setPhase('paused'); return }
    if (phase === 'failed') { beginPractice(); return }
    if (phase === 'complete') { openDialog('levels'); return }
    setPhase(level === 3 ? 'sandbox' : 'running'); setMode('orbit'); setLayer('skin'); resultSaved.current = false; clock.current = 0; setTime(0); publish(freshProcedure(level)); setMistakes(0); lastAction.current = { key: '', at: 0 }; addLog(`Начат сценарий «${current.title}».`, 'ok'); engine.current?.reset()
    if (current.steps[0]) { setTimeout(() => { const e = engine.current; if (e && state.current.phase === 'running' && state.current.step === 0) e.focus(current.steps[0].zone) }, 80) }
  }
  const reset = (op: number) => {
    if (state.current.workspace === 'physics') {
      if (dialog === 'reset') {
        engine.current?.reset(); publish(freshProcedure(3)); setGravity(9.81); setAnchored(false); setCovered(false); setLayer('skin'); setSelected('hand'); engine.current?.setHeld('hand'); setMode('orbit'); setHandMode('grab'); setPhase('sandbox'); setPartId(null); setIsolated(false); setOrgan(''); setDialog(null); clock.current = 0; setTime(0); addLog('Сцена песочницы восстановлена.'); return
      }
      switchWorkspace('theatre')
    }
    setCovered(true); setGravity(9.81); setHandMode('grab'); setPartId(null); setIsolated(false)
    setLevel(op); publish(freshProcedure(op)); setTime(0); clock.current = 0; setMistakes(0); setPhase('ready'); setMode(getActiveAvatar() ? 'orbit' : 'overview'); setLayer('skin'); setAnchored(true); setSelected('scalpel'); engine.current?.setHeld('scalpel'); setDialog(null); setOrgan(''); setFailedReason(''); resultSaved.current = false
    setLog([{ time: 0, message: `Выбран сценарий ${operations[op].id}: ${operations[op].title}.`, kind: 'info' }]); engine.current?.reset()
  }
  const toggleCover = () => {
    setCovered(old => !old)
    if (mode === 'overview') setMode('orbit')
    if (layer !== 'skin') { setLayer('skin'); setPartId(null); setIsolated(false); engine.current?.selectPart(null) }
  }
  const restartPractice = () => { publish(freshProcedure(3)); engine.current?.reset(); lastAction.current = { key: '', at: 0 }; setPhase('sandbox'); state.current.phase = 'sandbox'; notify('Новое учебное поле готово.') }
  const keyAction = useRef({ start, openDialog, toggleCover }); keyAction.current = { start, openDialog, toggleCover }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (reactionLive.current || state.current.dialog || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Escape') { setMenu(false); setFullscreen(false); return }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && state.current.mode === 'walk') { e.preventDefault(); engine.current?.key(e.code, true); return }
      if (e.repeat) return
      if (/^Digit[1-7]$/.test(e.code)) { pickTool(tools[Number(e.code.slice(-1)) - 1].id); return }
      if (e.code === 'KeyE') { e.preventDefault(); if (hoveredTool.current) pickTool(hoveredTool.current); else if (state.current.mode !== 'overview') engine.current?.interact(); else keyAction.current.start() }
      if (e.code === 'KeyQ') pickTool(null)
      if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); keyAction.current.start() }
      if (e.code === 'KeyF') { setMode('orbit'); setTimeout(() => engine.current?.focus(operations[state.current.level].steps[state.current.step]?.zone || 'arm'), 40) }
      if (e.code === 'KeyG') { if (state.current.mode === 'overview') setMode('orbit'); setHandMode('grab'); pickTool('hand') }
      if (e.code === 'KeyB') keyAction.current.toggleCover()
      if (e.code === 'KeyI') keyAction.current.openDialog('atlas')
      if (e.code === 'Slash') keyAction.current.openDialog('help')
    }; const up = (e: KeyboardEvent) => engine.current?.key(e.code, false)
    window.addEventListener('keydown', key); window.addEventListener('keyup', up); return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', up) }
  }, [pickTool])
  const full = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (viewport.current?.requestFullscreen) await viewport.current.requestFullscreen(); else setFullscreen(x => !x) } catch { setFullscreen(x => !x) } }
  const changeSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (key === 'sound' && value) enableAudio()
    if (key === 'sandboxStory' || key === 'story') {
      for (const snapshot of Object.values(sessions.current)) if (snapshot) snapshot.room.handling.strain = 0
    }
    setSettings(s => ({ ...s, [key]: value }))
  }
  const focusTarget = () => { setMode('orbit'); setLayer('skin'); setTimeout(() => engine.current?.focus(currentStep?.zone || 'arm'), 40) }
  const chooseLayer = (l: Layer) => { if (l !== 'skin' && mode === 'overview') setMode('orbit'); setLayer(l); setPartId(null); setIsolated(false); setOrgan(''); engine.current?.selectPart(null) }
  const inspectPart = (id: string, isolate = false) => {
    const p = partById.get(id); if (!p || !engine.current?.rig) return
    setDialog(null); setMenu(false); setPartId(id); setIsolated(isolate); setOrgan(p.name)
    if (mode === 'overview') { setMode('orbit'); engine.current.setMode('orbit') }
    if (p.layer === 'skin') setCovered(false)
    const next = layer === 'combined' && p.layer !== 'skin' ? 'combined' : p.layer
    setLayer(next); engine.current.setLayer(next); engine.current.selectPart(id, isolate, true)
  }
  const clearPart = () => { setPartId(null); setIsolated(false); setOrgan(''); engine.current?.selectPart(null) }
  const exportJournal = () => { const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify({ game: 'THEATRE', operation: current.title, events: log, results: runs }, null, 2)], { type: 'application/json' })); link.href = url; link.download = 'theatre-session.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1500) }
  const buttonLabel = phase === 'ready' ? level === 3 ? 'Начать практику' : 'Начать операцию' : phase === 'paused' ? 'Продолжить' : phase === 'complete' ? 'Выбрать операцию' : phase === 'failed' ? 'В свободную практику' : 'Приостановить'
  return { reaction, skipReaction: () => engine.current?.finishReaction(), procedure, restartPractice, beginPractice, dialog, setDialog, level, step, phase, setPhase, mode, setMode, layer, chooseLayer, selected, time, ready, settings, changeSettings, anchored, setAnchored, hover, menu, setMenu, error, setRetry, toast, setToast, fullscreen, runs, log, journalTab, setJournalTab, atlas, setAtlas, fps, failedReason, organ, peekLevel, setPeekLevel, engine, host, viewport, hoveredTool, current, currentStep, isPlay, progress, pulse, notify, addLog, pickTool, interact, openDialog, start, reset, full, focusTarget, exportJournal, buttonLabel, workspace, switchWorkspace, covered, toggleCover, gravity, setGravity, handMode, setHandMode, contact, partId, isolated, inspectPart, clearPart }
}
export type TheatreState = ReturnType<typeof useTheatre>