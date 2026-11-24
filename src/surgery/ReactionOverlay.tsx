import { useEffect, useRef } from 'react'
import { SkipForward, Volume2, VolumeX } from 'lucide-react'
import { dialogue, type ReactionFrame } from './reaction'

export function ReactionOverlay({ frame, name, skip }: { frame: ReactionFrame; name: string; skip: () => void }) {
  const button = useRef<HTMLButtonElement>(null), action = useRef(skip); action.current = skip
  useEffect(() => {
    const before = document.activeElement as HTMLElement; button.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => { if (['Escape','Space'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); action.current() } else if (e.code === 'Tab') { e.preventDefault(); button.current?.focus() } }
    window.addEventListener('keydown', key, true); return () => { window.removeEventListener('keydown', key, true); before?.focus({preventScroll:true}) }
  }, [])
  return <div className={`reaction-frame beat-${frame.beat} ${frame.gentle ? 'gentle' : ''}`} role="dialog" aria-modal="true" aria-label="Сюжетная сцена: четвёртая стена" data-kind={frame.kind} data-beat={frame.beat}>
    <div className="film-top"><span><i />CAM 01 <b>/</b> ВНЕ ПРОТОКОЛА</span><button ref={button} onClick={skip} aria-label="Пропустить сцену">Пропустить<SkipForward size={13} /></button></div>
    <div className="film-shade" /><div className="film-subtitle"><div className="film-speaker"><span />{name}{frame.audio ? <Volume2 size={12} /> : <VolumeX size={12} />}</div>
    {frame.beat === 'voice' || frame.beat === 'fall' || frame.beat === 'end' ? <p aria-live="polite">{dialogue[frame.kind]}</p> : <p className="voice-pause" aria-label={`${name} открывает глаза`}>…</p>}
    </div><div className="film-timeline"><i style={{width:`${frame.progress * 100}%`}} /></div>
  </div>
}