import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight, Box, Check, CheckCheck,
  ChevronDown, ChevronRight, CircleHelp, Cuboid, Download, Earth,
  Expand, Focus, FolderOpen, Grid2X2, Hand, Keyboard, Layers3, LoaderCircle,
  Minimize, Mouse, MousePointer2, Move, Orbit, Pause, Pin, Play,
  Plus, RotateCcw, Save, ScanLine, SlidersHorizontal, StepForward,
  Trash2, Unplug, Waypoints, X,
} from 'lucide-react'
import { StudioEngine } from '../studio/engine'
import { activeAvatarBuffer, activeAvatarName, getActiveAvatar } from '../studio/importAvatar'
import { AvatarImport, AvatarIcon } from '../studio/AvatarImport'
import mikaPortrait from '../assets/mika-portrait.webp?inline'
import { BUILD, openGame } from '../release'
import { saveOfflineGame } from '../surgery/downloads'
import { defaults, timecode, viewNames, type Metrics, type SavedScene, type Settings, type Tool, type View } from '../studio/types'

type Dialog = 'help' | 'save' | 'library' | 'model' | 'reset' | null
type Menu = 'view' | 'speed' | 'gravity' | null
const KEY = 'kinema.studio.scenes.v1'
const toolNames: Record<Tool, string> = { grab: 'Захват', orbit: 'Орбита', move: 'Перемещение' }
const presets = [{ name: 'Земля', value: 9.81 }, { name: 'Луна', value: 1.62 }, { name: 'Марс', value: 3.71 }, { name: 'Юпитер', value: 24.79 }]
const shortcuts = [
  ['ЛКМ на модели', 'Захватить конечность'], ['ПКМ + движение', 'Вращать камеру на 360°'],
  ['Колесо мыши', 'Приблизить или отдалить'], ['Shift + ЛКМ', 'Сдвинуть камеру'],
  ['G / V / M', 'Захват, орбита, перемещение'], ['Space', 'Пауза или продолжение'],
  ['F', 'Вернуть камеру к персонажу'], ['B', 'Показать или скрыть скелет'],
  ['P', 'Переключить фиксацию'], ['Ctrl + S', 'Сохранить сцену'],
]

function readScenes(): SavedScene[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(data) ? data.filter(s => typeof s?.id === 'string' && typeof s?.name === 'string' &&
      Array.isArray(s?.state?.bodies) && s.settings && Array.isArray(s.state.camera) && Array.isArray(s.state.anchor)).slice(0, 12) : []
  } catch { return [] }
}

function Logo() {
  return <div className="brand" aria-label="Kinema Lab">
    <svg className="brand-mark" viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <path d="M2 8.5 10.6 4v12.2L2 21V8.5Z" fill="currentColor" />
      <path d="m13.4 4.5 8.5-4.1v13.1l-8.5 4.6V4.5Z" fill="currentColor" />
      <path d="m3.2 23.7 17.5-9.2 11.1 6.3-8.2 4.8-4-2.2-8.7 4.7-7.7-4.4Z" fill="currentColor" />
      <path d="m13.4 29.7 8.5-4.5 7.3 4.2-8.1 4.6-7.7-4.3Z" fill="currentColor" />
    </svg>
    <span>kinema<span className="brand-dot">.</span></span><b>LAB</b>
  </div>
}

function Toggle({ on, label, change }: { on: boolean; label: string; change: () => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={change} className={`toggle ${on ? 'on' : ''}`}><span /></button>
}

function IconButton({ label, children, onClick, className = '', disabled = false }: {
  label: string; children: ReactNode; onClick: () => void; className?: string; disabled?: boolean
}) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return <section className="inspector-section">
    <button className="section-heading" onClick={() => setOpen(v => !v)} aria-expanded={open}>
      <span>{icon}{title}</span><ChevronDown size={14} className={open ? 'chevron' : 'chevron closed'} />
    </button>
    {open && <div className="section-content">{children}</div>}
  </section>
}

function AxisGizmo({ azimuth, polar }: { azimuth: number; polar: number }) {
  const a = azimuth, e = Math.PI / 2 - polar
  const axes = [
    { name: 'X', color: '#d99b96', x: Math.cos(a) * 23, y: Math.sin(a) * Math.sin(e) * 23 },
    { name: 'Y', color: '#bada9e', x: 0, y: -Math.cos(e) * 26 },
    { name: 'Z', color: '#98b5de', x: -Math.sin(a) * 25, y: Math.cos(a) * Math.sin(e) * 25 + 10 },
  ]
  return <svg className="axis-gizmo" viewBox="0 0 80 76" aria-label="Оси координат">
    {axes.map(ax => <g key={ax.name}>
      <path d={`M40 41 l${-ax.x * .65} ${-ax.y * .65}`} stroke={ax.color} opacity=".25" strokeWidth="1.5" strokeDasharray="2 2" />
      <path d={`M40 41 l${ax.x} ${ax.y}`} stroke={ax.color} strokeWidth="1.7" />
      <circle cx={40 + ax.x} cy={41 + ax.y} r="6.4" fill={ax.color} />
      <text x={40 + ax.x} y={43.8 + ax.y} textAnchor="middle" fill="#253027" fontSize="8.5" fontFamily="monospace" fontWeight="bold">{ax.name}</text>
    </g>)}<circle cx="40" cy="41" r="2.6" fill="#cad0c6" />
  </svg>
}

function ModelDownload() {
  const [url, setUrl] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true, objectUrl = ''
    activeAvatarBuffer().then(buffer => {
      if (!active) return
      objectUrl = URL.createObjectURL(new Blob([buffer], { type: getActiveAvatar()?.format === 'gltf' ? 'model/gltf+json' : 'model/gltf-binary' }))
      setUrl(objectUrl)
    }).catch(() => { if (active) setError(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [])
  if (error) return <p className="form-error" role="alert">Не удалось подготовить модель к скачиванию.</p>
  return <a href={url || undefined} download={getActiveAvatar() ? `${activeAvatarName()}.${getActiveAvatar()!.format}` : 'Mika.glb'} aria-disabled={!url} className="button primary"><Download size={15} />Скачать 3D-модель</a>
}

function Modal({ title, eyebrow, children, close, wide = false }: { title: string; eyebrow: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close); closeRef.current = close
  useEffect(() => {
    const active = document.activeElement as HTMLElement
    const el = box.current!
    const first = el.querySelector<HTMLElement>('input[required]') || el.querySelector<HTMLElement>('button, a[href]')
    first?.focus()
    if (first instanceof HTMLInputElement) first.select()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current() }
      if (e.key === 'Tab') {
        const els = Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, [tabindex="0"]'))
        if (e.shiftKey && document.activeElement === els[0]) { els[els.length - 1]?.focus(); e.preventDefault() }
        else if (!e.shiftKey && document.activeElement === els[els.length - 1]) { els[0]?.focus(); e.preventDefault() }
      }
    }
    document.addEventListener('keydown', key)
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; active?.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
    <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={box}>
      <div className="modal-heading"><div><div className="eyebrow"><i />{eyebrow}</div><h2 id="dialog-title">{title}</h2></div>
        <IconButton label="Закрыть" onClick={close}><X size={18} /></IconButton></div>
      {children}
    </div>
  </div>
}

export default function App() {
  const avatar = getActiveAvatar(), name = avatar?.name || 'Mika'
  const [settings, setSettings] = useState<Settings>({ ...defaults })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const [view, setView] = useState<View>('perspective')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [metrics, setMetrics] = useState<Metrics>({ fps: 0, time: 0, x: 0, y: .94, z: 0 })
  const [joints, setJoints] = useState(17)
  const [angles, setAngles] = useState([2.93, 1.43])
  const [expanded, setExpanded] = useState(false)
  const [dragged, setDragged] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [saved, setSaved] = useState<SavedScene[]>(readScenes)
  const [saveName, setSaveName] = useState('Эксперимент 01')
  const [saveError, setSaveError] = useState('')
  const [sceneName, setSceneName] = useState('Сцена 01')
  const [savedJust, setSavedJust] = useState(false)
  const [helpTab, setHelpTab] = useState<'controls' | 'physics'>('controls')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<StudioEngine | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef(settings); settingsRef.current = settings
  const dialogRef = useRef(dialog); dialogRef.current = dialog

  const notify = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3600)
  }, [])

  const change = useCallback(<K extends keyof Settings>(k: K, value: Settings[K]) => {
    setSettings(s => ({ ...s, [k]: value })); setSavedJust(false)
  }, [])

  const chooseTool = useCallback((tool: Tool) => {
    change('tool', tool)
    if (tool === 'move' && settingsRef.current.anchored) notify('Для переноса отключите «Фиксация на месте».')
  }, [change, notify])

  useEffect(() => {
    if (!host.current) return
    let active = true
    let studio: StudioEngine | null = null
    setReady(false); setError('')
    try {
      studio = new StudioEngine(host.current, {
        ready: n => { if (active) { setJoints(n); setReady(true) } },
        metrics: m => { if (active) setMetrics(m) },
        hint: notify, drag: setDragged, resume: () => change('running', true),
        error: text => { if (active) { setError(text); setReady(false) } },
        camera: (theta, phi) => { if (active) setAngles([theta, phi]) },
      })
      engine.current = studio; studio.update(settingsRef.current)
      if (import.meta.env.DEV) (window as unknown as { __kinema: StudioEngine }).__kinema = studio
    } catch { setError('Браузер не предоставил WebGL 2. Включите аппаратное ускорение для интерактивного режима.') }
    return () => { active = false; studio?.dispose(); engine.current = null }
  }, [retry, notify, change])

  useEffect(() => { engine.current?.update(settings) }, [settings])
  useEffect(() => { if (!menu) return; const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-menu]')) setMenu(null) }
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close)
  }, [menu])
  useEffect(() => {
    const toggle = () => setExpanded(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', toggle)
    return () => document.removeEventListener('fullscreenchange', toggle)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const openSave = useCallback(() => {
    if (!engine.current?.rig) { notify('Дождитесь загрузки модели.'); return }
    setSaveName(`Эксперимент ${String(readScenes().length + 1).padStart(2, '0')}`)
    setSaveError(''); setMenu(null); setDialog('save')
  }, [notify])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); if (!dialogRef.current) openSave(); return }
      if (dialogRef.current || (e.target instanceof HTMLInputElement && e.target.type !== 'range')) return
      if (e.code === 'Escape') { setMenu(null); setExpanded(false); return }
      if (e.repeat || e.ctrlKey || e.metaKey || !engine.current?.rig) return
      if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); change('running', !settingsRef.current.running) }
      if (e.code === 'KeyF') { engine.current.setView('perspective'); setView('perspective') }
      if (e.code === 'KeyB') change('skeleton', !settingsRef.current.skeleton)
      if (e.code === 'KeyP') change('anchored', !settingsRef.current.anchored)
      if (e.code === 'KeyG') chooseTool('grab')
      if (e.code === 'KeyV') chooseTool('orbit')
      if (e.code === 'KeyM') chooseTool('move')
      if (e.code === 'Slash') setDialog('help')
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [change, chooseTool, openSave])

  async function fullscreen() {
    setMenu(null)
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (zoomRef.current?.requestFullscreen) await zoomRef.current.requestFullscreen()
      else setExpanded(v => !v)
    } catch { setExpanded(v => !v) }
  }

  function persist(list: SavedScene[]) {
    localStorage.setItem(KEY, JSON.stringify(list)); setSaved(list)
  }

  function saveScene(e: React.FormEvent) {
    e.preventDefault()
    if (!saveName.trim() || !engine.current) return
    if (saved.length >= 12) { setSaveError('Сохранено 12 сцен. Удалите одну из них в библиотеке.'); return }
    const scene: SavedScene = { id: crypto.randomUUID?.() || `s-${Date.now()}`, name: saveName.trim().slice(0, 54),
      date: new Date().toISOString(), settings: { ...settings }, thumbnail: engine.current.snapshot(360), state: engine.current.save() }
    try {
      persist([scene, ...saved]); setSceneName(scene.name); setSavedJust(true); setDialog(null); notify('Сцена сохранена в «Мои сцены».')
    } catch { setSaveError('Хранилище браузера заполнено или недоступно. Освободите место и повторите.') }
  }

  function restore(scene: SavedScene) {
    if (!engine.current?.rig) return
    const s = { ...defaults, ...scene.settings }
    engine.current.update(s); engine.current.restore(scene.state); setSettings(s)
    setSceneName(scene.name); setSavedJust(true); setDialog(null); notify(`Открыта сцена «${scene.name}».`)
  }

  function downloadShot() {
    if (!engine.current || !ready) return
    const a = document.createElement('a'); a.download = `kinema-mika-${Date.now()}.jpg`; a.href = engine.current.snapshot(1600); a.click()
    notify('Снимок 3D-сцены сохранён.')
  }

  const selectedPlanet = presets.find(p => Math.abs(p.value - settings.gravity) < .006)?.name || 'Своя'
  const toolHint = settings.tool === 'grab' ? 'Зажмите конечность, потяните и отпустите, чтобы взаимодействовать.' :
    settings.tool === 'orbit' ? 'Потяните в любую сторону для обзора. Колесо меняет масштаб.' :
    settings.anchored ? 'Снимите фиксацию, затем перетащите персонажа по плоскости.' : 'Зажмите персонажа и перетащите в нужную точку на плоскости.'
  const ToolIcon = settings.tool === 'grab' ? Hand : settings.tool === 'orbit' ? Orbit : Move

  return <div className="app-shell">
    <header className="topbar">
      <Logo />
      <div className="nav-divider" />
      <nav className="main-nav" aria-label="Основная навигация">
        <button className={dialog !== 'library' ? 'active' : ''} onClick={() => setDialog(null)}><Cuboid size={16} />Студия</button>
        <button className={dialog === 'library' ? 'active' : ''} onClick={() => { setDeleteId(null); setDialog('library') }}><Layers3 size={16} />Мои сцены</button>
        <button className="back-to-theatre" aria-label="Вернуться в THEATRE" onClick={() => openGame('theatre')}><ArrowRight size={14} />THEATRE</button>
      </nav>
      <div className="header-meta"><span className="local-status"><i className="status-dot" />Локальная сессия</span>
        <span className="version" title="Общая сборка THEATRE + Kinema Lab">v{BUILD}</span><span className="meta-rule" />
        <IconButton label="Руководство по студии" onClick={() => setDialog('help')}><CircleHelp size={19} /></IconButton>
      </div>
    </header>

    <main className="workspace-main">
      <div className="page-heading">
        <div><div className="eyebrow"><i />PHYSICS WORKSPACE</div><h1>Студия симуляции</h1>
          <p>Пространство для экспериментов с персонажем и физикой.</p></div>
        <div className="heading-actions">
          <button className="quiet-action" disabled={!ready} onClick={() => setDialog('reset')}><RotateCcw size={15} /><span>Сбросить</span></button>
          <button className="button secondary save-top" disabled={!ready} onClick={openSave}>{savedJust ? <CheckCheck size={16} /> : <Save size={16} />}<span>Сохранить сцену</span></button>
        </div>
      </div>

      <div className="workspace-grid">
        <div className={`viewport-frame ${expanded ? 'expanded' : ''}`} ref={zoomRef}>
          <div className="viewport-header"><span className="viewport-title"><Box size={16} />3D-пространство</span>
            <div className="viewport-health"><span className={`live-label ${!settings.running || !ready ? 'inactive' : ''}`}><i />{!ready ? 'INIT' : settings.running ? 'LIVE' : 'PAUSE'}</span>
              <span className="fps">{ready && metrics.fps > 0 ? metrics.fps : '··'} FPS</span><span className="tiny-rule" />
              <IconButton label={expanded ? 'Выйти из полного экрана' : 'На весь экран'} onClick={fullscreen}>{expanded ? <Minimize size={15} /> : <Expand size={15} />}</IconButton>
            </div>
          </div>
          <div className="scene-area">
            <div className={`three-host ${ready ? 'loaded' : ''}`} ref={host} />
            <div className="view-pick" data-menu ref={menuRef}><button className="view-button" onClick={() => setMenu(menu === 'view' ? null : 'view')} aria-expanded={menu === 'view'}>
              <Cuboid size={13} />{viewNames[view]}<ChevronDown size={12} /></button>
              {menu === 'view' && <div className="popover view-menu">{(Object.keys(viewNames) as View[]).map(v => <button key={v} onClick={() => { setView(v); engine.current?.setView(v); setMenu(null) }}>{viewNames[v]}{view === v && <Check size={13} />}</button>)}</div>}
            </div>
            <AxisGizmo azimuth={angles[0]} polar={angles[1]} />
            <div className="scene-tools" role="toolbar" aria-label="Инструменты 3D-сцены">
              {([{ id: 'grab', icon: Hand, key: 'G' }, { id: 'orbit', icon: Orbit, key: 'V' }, { id: 'move', icon: Move, key: 'M' }] as const).map(t =>
                <button key={t.id} className={settings.tool === t.id ? 'selected' : ''} aria-label={`${toolNames[t.id]} (${t.key})`} aria-pressed={settings.tool === t.id} title={`${toolNames[t.id]} (${t.key})`} onClick={() => chooseTool(t.id)}>
                  <t.icon size={18} strokeWidth={1.6} /><span className="tool-tip">{toolNames[t.id]} <kbd>{t.key}</kbd></span>
                </button>)}
              <div className="tool-separator" /><button aria-label="Центрировать камеру (F)" title="Центрировать камеру (F)" onClick={() => { engine.current?.setView('perspective'); setView('perspective') }}><Focus size={18} strokeWidth={1.6} /></button>
            </div>
            <div className="character-caption"><div className="caption-kicker"><i />CHARACTER_01</div><div className="character-name">{name}{!avatar && <span>ミカ</span>}</div><div className="caption-sub"><span />Humanoid model</div></div>
            <button className="shot-button" title="Сохранить снимок сцены" aria-label="Сохранить снимок сцены" disabled={!ready} onClick={downloadShot}><ScanLine size={16} /></button>
            {dragged && <div className="grab-indicator"><Hand size={14} />{dragged}</div>}
            {!ready && !error && <div className="loading-scene"><LoaderCircle size={15} className="spinner" />Загрузка модели</div>}
            {error && <div className="scene-error"><Unplug size={20} /><strong>Режим предпросмотра</strong><p>{error}</p><button className="button secondary" onClick={() => setRetry(n => n + 1)}>Перезапустить 3D</button></div>}
          </div>
          <div className="transport">
            <button className="play-button" disabled={!ready} aria-label={settings.running ? 'Пауза' : 'Запустить симуляцию'} onClick={() => change('running', !settings.running)}>
              {settings.running ? <Pause size={14} fill="currentColor" strokeWidth={1.4} /> : <Play size={14} fill="currentColor" />}<span>{settings.running ? 'Пауза' : 'Запуск'}</span>
            </button>
            <IconButton label="Шаг на один кадр" disabled={!ready} onClick={() => { change('running', false); engine.current?.stepFrame() }}><StepForward size={17} /></IconButton>
            <span className="transport-rule" /><span className="timecode">{timecode(metrics.time)}</span>
            <div className="speed-picker" data-menu><button className="speed-button" onClick={() => setMenu(menu === 'speed' ? null : 'speed')} aria-label="Скорость симуляции" aria-expanded={menu === 'speed'}>{settings.speed}×<ChevronDown size={11} /></button>
              {menu === 'speed' && <div className="popover speed-menu"><small>СКОРОСТЬ</small>{[.25, .5, 1, 1.5, 2].map(v => <button key={v} onClick={() => { change('speed', v); setMenu(null) }}>{v}×{v === settings.speed && <Check size={12} />}</button>)}</div>}
            </div>
            <span className="transport-state"><i className={`status-dot ${!settings.running ? 'idle' : ''}`} />{!ready ? 'Подготовка' : settings.running ? 'Симуляция активна' : 'На паузе'}</span>
          </div>
        </div>

        <aside className="inspector" aria-label="Инспектор сцены">
          <div className="inspector-header"><span><SlidersHorizontal size={16} />Инспектор</span><span className="panel-number">01 / PANEL</span></div>
          <div className="character-section"><div className="micro-label">АКТИВНЫЙ ПЕРСОНАЖ</div>
            <button className="model-select" onClick={() => setDialog('model')} aria-label={`О модели ${name}`}>
              {avatar ? <AvatarIcon className="model-avatar" /> : <img src={mikaPortrait} alt="Портрет Мики" className="model-avatar" />}
              <span className="model-info"><strong>{name}</strong><span><i className="status-dot" />{ready ? 'Модель загружена' : error ? 'Предпросмотр' : 'Загрузка модели'}</span></span>
              <ChevronRight size={15} />
            </button>
          </div>
          <Section title="Физика" icon={<Orbit size={16} />}>
            <div className="setting-row"><span>Гравитация</span><Toggle on={settings.gravityEnabled} label="Гравитация" change={() => change('gravityEnabled', !settings.gravityEnabled)} /></div>
            <div className={`gravity-control ${!settings.gravityEnabled ? 'disabled' : ''}`}>
              <div className="gravity-value"><div className="planet-pick" data-menu><button disabled={!settings.gravityEnabled} onClick={() => setMenu(menu === 'gravity' ? null : 'gravity')} aria-expanded={menu === 'gravity'}><Earth size={12} />{selectedPlanet}<ChevronDown size={11} /></button>
                {menu === 'gravity' && <div className="popover planet-menu">{presets.map(p => <button key={p.name} onClick={() => { change('gravity', p.value); setMenu(null) }}>{p.name}<span>{p.value}</span></button>)}</div>}
              </div><span className="gravity-number">{settings.gravityEnabled ? settings.gravity.toFixed(2) : '0.00'} <small>м/с²</small></span></div>
              <input type="range" min="0" max="25" step="0.01" value={settings.gravity} disabled={!settings.gravityEnabled} aria-label="Сила гравитации" onChange={e => change('gravity', Number(e.target.value))} style={{ '--fill': `${settings.gravity / 25 * 100}%` } as React.CSSProperties} />
              <div className="range-marks"><span>0</span><span>25 м/с²</span></div>
            </div>
            <div className="anchor-settings"><div className="setting-row"><span className="setting-with-icon"><Pin size={14} />Фиксация на месте</span>
              <Toggle on={settings.anchored} label="Фиксация на месте" change={() => change('anchored', !settings.anchored)} /></div>
              <p>{settings.anchored ? 'Отключите для свободного перемещения персонажа.' : 'Персонаж свободен. Захватывайте, перемещайте и подбрасывайте.'}</p>
            </div>
          </Section>
          <Section title="Отображение" icon={<Layers3 size={16} />}>
            <div className="setting-row"><span className="setting-with-icon"><Waypoints size={14} />Скелет персонажа</span><Toggle on={settings.skeleton} label="Скелет персонажа" change={() => change('skeleton', !settings.skeleton)} /></div>
            <div className="setting-row"><span className="setting-with-icon"><Grid2X2 size={14} />Сетка плоскости</span><Toggle on={settings.grid} label="Сетка плоскости" change={() => change('grid', !settings.grid)} /></div>
          </Section>
          <div className="mode-note"><div className="mode-icon"><ToolIcon size={17} /></div><div><strong>{settings.tool === 'grab' ? 'Режим захвата' : settings.tool === 'orbit' ? 'Режим орбиты' : 'Режим переноса'}</strong><p>{toolHint}</p></div></div>
        </aside>
      </div>

      <div className="controls-strip">
        <div className="control-hints"><span><MousePointer2 size={14} /><kbd>ЛКМ</kbd>Захват</span><i /><span><Orbit size={15} /><kbd>ПКМ</kbd>Вращение</span><i /><span><Mouse size={14} /><kbd>Колесо</kbd>Масштаб</span></div>
        <button onClick={() => { setHelpTab('controls'); setDialog('help') }}><Keyboard size={16} />Управление<ChevronRight size={13} /></button>
      </div>
    </main>

    <footer className="statusbar"><div><span className={`status-dot ${!ready ? 'idle' : ''}`} /><span>{ready ? 'Движок готов' : error ? '3D недоступно' : 'Инициализация'}</span><span className="status-divider" /><span className="status-scene">{sceneName}</span></div>
      <div className="engine-meta"><span>Three.js</span><i />Cannon-es<span className="status-divider" /><span className="webgl"><span />WebGL 2.0</span></div>
    </footer>

    {toast && <div className="toast" role="status"><Check size={15} /><span>{toast}</span><button aria-label="Закрыть уведомление" onClick={() => setToast('')}><X size={13} /></button></div>}

    {dialog === 'save' && <Modal title="Сохранить сцену" eyebrow="SCENE SNAPSHOT" close={() => setDialog(null)}>
      <p className="modal-description">Сохранятся поза, положение камеры, физика и настройки этой сцены.</p>
      <form onSubmit={saveScene}><label className="input-label" htmlFor="scene-name">Название сцены</label><input id="scene-name" className="text-input" value={saveName} maxLength={54} onChange={e => setSaveName(e.target.value)} autoFocus required />
        <div className="save-details"><Box size={15} />Mika<span>·</span>{joints} суставов<span>·</span>{timecode(metrics.time)}</div>
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setDialog(null)}>Отмена</button><button className="button primary" disabled={!saveName.trim()} type="submit"><Save size={15} />Сохранить</button></div>
      </form><div className="local-footnote"><span className="status-dot" />Только в этом браузере. Без облачного хранилища.</div>
    </Modal>}
    {dialog === 'library' && <Modal title="Мои сцены" eyebrow="LOCAL LIBRARY" close={() => setDialog(null)} wide>
      <p className="modal-description">Сохранённые эксперименты на этом устройстве.</p>
      {saved.length ? <div className="saved-list">{saved.map(s => <div className="saved-item" key={s.id}>
        <button className="saved-open" onClick={() => restore(s)} disabled={!ready}><img src={s.thumbnail} alt={`Превью: ${s.name}`} /><span><strong>{s.name}</strong><small>{new Date(s.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · {timecode(s.state.time)}</small></span><ArrowRight size={16} /></button>
        {deleteId === s.id ? <div className="delete-confirm"><button onClick={() => { try { persist(saved.filter(q => q.id !== s.id)); setDeleteId(null) } catch { notify('Не удалось изменить хранилище.') } }}>Удалить?</button><button aria-label="Отменить удаление" onClick={() => setDeleteId(null)}><X size={13} /></button></div> : <IconButton label={`Удалить сцену ${s.name}`} onClick={() => setDeleteId(s.id)}><Trash2 size={14} /></IconButton>}
      </div>)}</div> : <div className="library-empty"><FolderOpen size={34} strokeWidth={1.2} /><h3>Здесь будут ваши сцены</h3><p>Сохраните первый эксперимент, чтобы вернуться к нему позже.</p></div>}
      <div className="modal-actions"><button className="button primary" disabled={!ready} onClick={openSave}><Plus size={15} />Сохранить текущую сцену</button></div>
    </Modal>}
    {dialog === 'reset' && <Modal title="Сбросить сцену?" eyebrow="RESET WORKSPACE" close={() => setDialog(null)}>
      <p className="modal-description">Мика вернётся на платформу в исходной позе. Камера и параметры физики будут восстановлены. Сохранённые сцены останутся в библиотеке.</p>
      <div className="modal-actions"><button className="button secondary" onClick={() => setDialog(null)}>Отмена</button><button className="button primary" onClick={() => { const s = { ...defaults }; engine.current?.update(s); engine.current?.reset(); setSettings(s); setView('perspective'); setSceneName('Сцена 01'); setSavedJust(false); setDialog(null); notify('Исходная сцена восстановлена.') }}><RotateCcw size={15} />Сбросить сцену</button></div>
    </Modal>}
    {dialog === 'model' && <Modal title="Модель персонажа" eyebrow="CHARACTER ASSET" close={() => setDialog(null)}>
      <div className="model-detail">{avatar ? <AvatarIcon /> : <img src={mikaPortrait} alt="Розововолосая Мика" />}<div><div className="micro-label">CHARACTER_01</div><h3>{name} {!avatar && <span>ミカ</span>}</h3><p>Стилизованный гуманоид</p></div></div>
      <p className="modal-description">{avatar ? 'Локально импортированный персонаж. Исходный файл можно скачать ниже.' : 'Розовые пряди, жилет, плиссированная юбка и вязаные гетры созданы по референсам. Внутри модели уже есть скелет и мимика.'}</p>
      <div className="detail-row"><span>Формат</span><b>{avatar ? avatar.format.toUpperCase() : 'glTF 2.0 / GLB'}</b></div><div className="detail-row"><span>Физический скелет</span><b>{joints + 1} тел · {joints} суставов</b></div><div className="detail-row"><span>Основа модели</span><b>{avatar ? avatar.profile : 'VRoid Project · CC0'}</b></div>
      <div className="modal-actions"><ModelDownload /></div><AvatarImport />
    </Modal>}
    {dialog === 'help' && <Modal title="Руководство студии" eyebrow="FIELD GUIDE" close={() => setDialog(null)} wide>
      <div className="guide-tabs"><button className={helpTab === 'controls' ? 'active' : ''} onClick={() => setHelpTab('controls')}><Keyboard size={15} />Управление</button><button className={helpTab === 'physics' ? 'active' : ''} onClick={() => setHelpTab('physics')}><Orbit size={15} />Физика</button></div>
      {helpTab === 'controls' ? <><div className="shortcut-list">{shortcuts.map(([k, v]) => <div key={k}><span>{v}</span><kbd>{k}</kbd></div>)}</div><p className="guide-note"><Hand size={15} />На сенсорном экране: один палец для захвата или вращения, два для масштаба и перемещения камеры.</p></> : <div className="physics-guide">
        <h3><Pin size={16} />Фиксация и свободная физика</h3><p>При включённой фиксации персонаж сохраняет позу, а конечности реагируют на захват. Снимите фиксацию, чтобы всё тело подчинялось гравитации.</p>
        <h3><Hand size={16} />Захват и бросок</h3><p>Выберите руку на панели инструментов. Зажмите кисть или стопу, потяните вверх и отпустите в движении. Скорость руки передаётся телу.</p>
        <h3><Move size={16} />Перенос по сцене</h3><p>Отключите фиксацию и выберите инструмент со стрелками. Перетаскивайте персонажа по полу. Нажмите F, чтобы снова расположить его в центре кадра.</p>
        <h3><Earth size={16} />Гравитация</h3><p>Выберите планету, задайте силу ползунком или полностью выключите притяжение. Без фиксации Мика пока не балансирует сама: это физическая модель, а не обученный агент.</p>
      </div>}
      <div className="offline-downloads"><div><strong>Kinema Lab · {BUILD}</strong><p>В этом файле обе игры и одна исправленная модель. Копия для студии открывается сразу в Kinema Lab.</p></div>
        <div><button className="button secondary" onClick={() => saveOfflineGame('kinema')}><Download size={14} />Скачать Kinema Lab</button><button className="source-download" onClick={() => saveOfflineGame()}><Download size={12} />Скачать обе игры</button></div>
      </div>
    </Modal>}
  </div>
}