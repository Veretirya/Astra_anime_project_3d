import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function TheatreLogo() {
  return <svg viewBox="0 0 40 40" width="35" height="35" className="theatre-logo" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M15 3h10v10h10v12H25v11H15V25H4V14h11z" /><path d="m9 26 18-18M13 30l18-18" /></g><path d="m19 18 5-5 4 4-5 5z" fill="currentColor" /></svg>
}
export function IconButton({ label, onClick, children, active = false, className = '' }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; className?: string }) {
  return <button type="button" className={`icon-btn ${active ? 'active' : ''} ${className}`} title={label} aria-label={label} onClick={onClick}>{children}</button>
}
export function Toggle({ label, checked, change }: { label: string; checked: boolean; change: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'checked' : ''}`} onClick={change}><span /></button>
}
export function Bars({ n }: { n: number }) { return <span className="difficulty-bars" aria-label={`Сложность ${n} из 3`}>{[1, 2, 3].map(x => <i key={x} className={x <= n ? 'lit' : ''} style={{ height: 3 + x * 3 }} />)}</span> }
export function Modal({ title, kicker, children, close, wide }: { title: string; kicker: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), closeRef = useRef(close); closeRef.current = close
  useEffect(() => {
    const before = document.activeElement as HTMLElement, root = ref.current!
    root.querySelector<HTMLElement>('button, a[href], input')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current() }
      if (e.key === 'Tab') {
        const nodes = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]'))
        if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length - 1]?.focus() }
        if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0]?.focus() }
      }
    }
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', key); before?.focus() }
  }, [])
  return <div className="dialog-shade" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><div ref={ref} className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-heading"><div className="dialog-head"><div><span className="eyebrow"><i />{kicker}</span><h2 id="dialog-heading">{title}</h2></div><IconButton label="Закрыть окно" onClick={close}><X size={18} /></IconButton></div>{children}</div></div>
}
export function ECG({ paused, warning }: { paused: boolean; warning: boolean }) {
  const points = '0,28 9,28 12,27 15,28 18,28 21,25 24,28 34,28 37,30 40,17 42,40 45,4 48,34 51,25 54,28 64,28 70,23 73,24 77,28 90,28 '
  return <div className={`ecg-graph ${paused ? 'stopped' : ''} ${warning ? 'warning' : ''}`}><svg viewBox="0 0 270 49" preserveAspectRatio="none" aria-label="Игровая кривая ЭКГ"><g className="ecg-trace">{[0, 90, 180, 270].map(x => <polyline key={x} points={points} transform={`translate(${x} 1)`} fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}</g></svg><span>ECG II</span></div>
}