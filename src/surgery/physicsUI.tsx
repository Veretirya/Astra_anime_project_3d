import { useMemo, useState } from 'react'
import { ArrowRight, Atom, Blend, Bone, Boxes, Check, ChevronRight, CircleDot, Fingerprint, Focus, Footprints, Hand, HeartPulse, Layers2, Minus, MousePointer2, Orbit, Pause, Play, Plus, RotateCcw, ScanLine, Search, SlidersHorizontal, Stethoscope, Waves, X } from 'lucide-react'
import type { TheatreState } from './useTheatre'
import { Modal, Toggle } from './ui'
import { allParts, gravities, partById, type AtlasPart } from './regions'
import { layerNames, type Layer } from './game'
import { openGame } from '../release'

export function WorkspaceTabs({ g }: { g: TheatreState }) {
  return <nav className="workspace-tabs" aria-label="Режим работы"><button type="button" aria-current={g.workspace === 'theatre' ? 'page' : undefined} aria-label="Вкладка Операционная" className={g.workspace === 'theatre' ? 'chosen' : ''} onClick={() => g.switchWorkspace('theatre')}><Stethoscope size={13} /><span>Операционная</span></button><button type="button" aria-current={g.workspace === 'physics' ? 'page' : undefined} aria-label="Вкладка Песочница" className={g.workspace === 'physics' ? 'chosen' : ''} onClick={() => g.switchWorkspace('physics')}><Boxes size={14} /><span>Песочница</span></button><button type="button" className="kinema-switch" aria-label="Открыть Kinema Lab" title="Студия физики из первой игры" onClick={() => openGame('kinema')}><Orbit size={13} /><span>Kinema Lab</span></button></nav>
}

export function HandOptions({ g, compact = false }: { g: TheatreState; compact?: boolean }) {
  return <div className={`hand-options ${compact ? 'compact' : ''}`} aria-label="Режим руки">{([{ id: 'grab', name: 'Захват', Icon: Hand }, { id: 'inspect', name: 'Осмотр', Icon: ScanLine }] as const).map(m => <button key={m.id} aria-pressed={g.handMode === m.id} className={g.handMode === m.id ? 'on' : ''} onClick={() => { g.setHandMode(m.id); if (g.selected !== 'hand') g.pickTool('hand') }}><m.Icon size={13} />{m.name}</button>)}</div>
}

export function PhysicsPanel({ g }: { g: TheatreState }) {
  const [confirm, setConfirm] = useState(false)
  return <section className="physics-panel"><div className="panel-title"><span><SlidersHorizontal size={15} />Параметры физики</span><span className="physics-code">LAB</span></div><div className="physics-inner">
    <div className="physics-heading"><span className="field-label">СВОБОДНАЯ СИМУЛЯЦИЯ</span><h2>Физика тела</h2><p>Выберите руку и потяните за любую область модели.</p></div>
    <div className="gravity-label"><span><Orbit size={13} />Гравитация</span><output>{g.gravity.toFixed(2)} <small>м/с²</small></output></div>
    <input aria-label="Сила гравитации" className="gravity-range" type="range" min="0" max="20" step="0.01" value={g.gravity} onChange={e => g.setGravity(Number(e.target.value))} style={{ '--fill': `${g.gravity / 20 * 100}%` } as React.CSSProperties} />
    <div className="gravity-presets">{gravities.map(p => <button key={p.name} className={Math.abs(g.gravity - p.value) < .005 ? 'on' : ''} aria-pressed={Math.abs(g.gravity - p.value) < .005} onClick={() => g.setGravity(p.value)}>{p.name}</button>)}</div>
    <div className="physics-line"><span><Focus size={13} />Фиксация корпуса</span><Toggle label="Фиксация корпуса" checked={g.anchored} change={() => g.setAnchored(v => !v)} /></div>
    <div className="physics-line"><span><Layers2 size={13} />Покрывало</span><Toggle label="Покрывало в песочнице" checked={g.covered} change={g.toggleCover} /></div>
    <div className="physics-hand"><span className="field-label">ИНСТРУМЕНТ «РУКА»</span><HandOptions g={g} /></div>
    {g.procedure.practiceResolved && <div className="practice-report"><strong>Упражнение завершено</strong><p>Повязка на месте. Результат песочницы не оценивается.</p><button onClick={g.restartPractice}><RotateCcw size={11} />Новое упражнение</button></div>}
    <div className="physics-actions"><button className="btn ghost" title="Вернуть модель на стол" onClick={() => setConfirm(true)}><RotateCcw size={12} />На стол</button><button className="btn amber" onClick={g.start}>{g.phase === 'paused' ? <Play size={12} /> : <Pause size={12} />}{g.phase === 'paused' ? 'Продолжить' : 'Пауза'}</button></div>
    {confirm && <div className="return-confirm"><span>Вернуть исходную позу?</span><button onClick={() => { g.engine.current?.reset(); g.clearPart(); setConfirm(false); g.addLog('Модель возвращена на стол.'); g.notify('Поза восстановлена. Параметры физики сохранены.') }}>Вернуть</button><button aria-label="Отменить возврат" onClick={() => setConfirm(false)}><X size={12} /></button></div>}
    <button type="button" role="switch" className="sandbox-story-toggle" aria-label="Катсцены в песочнице" aria-checked={g.settings.story && g.settings.sandboxStory} disabled={!g.settings.story} title={g.settings.story ? 'Только свободная практика. Катсцены операций не изменятся.' : 'Все сюжетные сцены выключены в общих настройках.'} onClick={() => g.changeSettings('sandboxStory', !g.settings.sandboxStory)}>
      <span>Катсцены в песочнице</span><small>{g.settings.story && g.settings.sandboxStory ? 'Вкл.' : 'Выкл.'}</small><i aria-hidden="true" />
    </button>
  </div></section>
}

export function AnatomyBrowser({ g }: { g: TheatreState }) {
  const [filter, setFilter] = useState<Layer | 'all'>(g.partId ? partById.get(g.partId)?.layer || 'all' : 'all')
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(g.partId)
  const parts = useMemo(() => allParts.filter(p => (filter === 'all' || p.layer === filter) && (p.name + ' ' + p.group + ' ' + p.bone).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [filter, query])
  const groups = useMemo(() => parts.reduce<Record<string, AtlasPart[]>>((o, p) => { const name = `${layerNames[p.layer]} / ${p.group}`; (o[name] ??= []).push(p); return o }, {}), [parts])
  const selectedPart = selected && partById.get(selected)
  const open = (alone: boolean) => { if (selected) g.inspectPart(selected, alone) }
  return <Modal title="Карта модели" kicker="ANATOMICAL EXPLORER" close={() => g.setDialog(null)} wide><p className="dialog-description">Выберите область для осмотра. Даже перекрытые структуры доступны без прохождения уровней.</p>
    <div className="part-categories">{([{ id: 'all', label: 'Все', icon: Blend }, { id: 'skin', label: 'Тело', icon: Fingerprint }, { id: 'muscle', label: 'Мышцы', icon: Waves }, { id: 'organs', label: 'Органы', icon: HeartPulse }, { id: 'bones', label: 'Скелет', icon: Bone }] as const).map(f => <button key={f.id} className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setSelected(null) }}><f.icon size={12} />{f.label}</button>)}</div>
    <label className="part-search"><Search size={14} /><input value={query} type="search" placeholder="Найти область или орган" aria-label="Найти область или орган" onChange={e => setQuery(e.target.value)} /><span>{parts.length}</span></label>
    <div className="part-directory">{Object.entries(groups).map(([group, entries]) => <div key={group}><h3>{group}</h3><div className="part-options">{entries.map(p => <button key={p.id} className={p.id === selected ? 'selected' : ''} aria-label={`Выбрать область: ${p.name}, ${p.group}`} aria-pressed={p.id === selected} onClick={() => setSelected(p.id)}><span>{p.name}</span>{p.id === selected ? <Check size={12} /> : <ChevronRight size={11} />}</button>)}</div></div>)}{!parts.length && <p className="part-empty">Ничего не найдено. Попробуйте другое название или слой.</p>}</div>
    <div className="part-status"><CircleDot size={12} />{selectedPart ? `${selectedPart.name} · ${layerNames[selectedPart.layer]}` : 'Выберите структуру из списка'}</div><div className="dialog-actions"><button disabled={!selectedPart || selectedPart.layer === 'skin'} className="btn ghost" onClick={() => open(true)}><Focus size={13} />Изолировать</button><button disabled={!selectedPart} className="btn amber" onClick={() => open(false)}>Показать в 3D<ArrowRight size={13} /></button></div>
  </Modal>
}

export function ContactOverlay({ g }: { g: TheatreState }) {
  if (g.mode === 'overview' || g.dialog) return null
  return <>{g.selected === 'hand' && !g.contact && <div className="scene-hand-strip"><Hand size={13} /><HandOptions g={g} compact />{g.mode === 'walk' && <button className="grab-action" onClick={() => g.engine.current?.interact()}><kbd>E</kbd>{g.handMode === 'grab' ? 'Взять' : 'Осмотреть'}</button>}</div>}
    {g.contact && <div className="contact-readout"><div><span><CircleDot size={12} />{g.contact.part}</span><b>{g.contact.held ? 'ЗАХВАТ' : 'КОНТАКТ'}</b></div>{g.contact.pinned && <button className="unlock-contact" onClick={() => { g.setAnchored(false); g.notify('Фиксация корпуса снята. Теперь модель можно перенести.') }}>Снять фиксацию<ChevronRight size={11} /></button>}{g.contact.held && <><div className="load-meter"><i style={{ width: `${Math.round(g.contact.effort * 100)}%` }} /></div><p>Усилие захвата <span>{Math.round(g.contact.effort * 100)}%</span></p><div className="grip-buttons"><button aria-label="Приблизить удерживаемую модель" onClick={() => g.engine.current?.adjustDepth(-.10)}><Minus size={13} /></button><button aria-label="Отдалить удерживаемую модель" onClick={() => g.engine.current?.adjustDepth(.10)}><Plus size={13} /></button><button onClick={() => g.engine.current?.toggleCarry()}>Отпустить</button></div></>}</div>}
  </>
}

export function PhysicsTransport({ g }: { g: TheatreState }) {
  return <div className="physics-transport"><div><Atom size={15} /><span>Физическая песочница</span></div><span className="physics-transport-rule" /><span className="lab-caption">Без оценки и таймера задания</span><button className={g.mode === 'walk' ? 'on' : ''} onClick={() => g.setMode(g.mode === 'walk' ? 'orbit' : 'walk')}>{g.mode === 'walk' ? <Orbit size={14} /> : <Footprints size={14} />}{g.mode === 'walk' ? 'Свободная камера' : 'От первого лица'}</button></div>
}

export function SelectionSummary({ g }: { g: TheatreState }) {
  const selected = g.partId && partById.get(g.partId)
  return <div className="structure-line"><button aria-label="Открыть карту модели" onClick={() => g.openDialog('anatomy')}><MousePointer2 size={12} /><span>{selected ? selected.name : 'Карта модели'}</span><ChevronRight size={12} /></button>{selected && <button aria-label="Снять выделение" title="Снять выделение" onClick={g.clearPart}><X size={11} /></button>}</div>
}