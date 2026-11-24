import { ArrowRight, Check, CircleDot, Droplet, Focus, Grip, HeartPulse, MoveUpRight, RotateCcw, SquareCheck, Target } from 'lucide-react'
import type { TheatreState } from './useTheatre'
import { toolById, zoneNames } from './game'
import { actionLabel, stitchGoal } from './procedure'

export function OperationAction({ g }: { g: TheatreState }) {
  const task = g.currentStep
  if (g.phase !== 'running' || !task) return null
  const needTool = !!task.tool && task.tool !== g.selected, stitching = task.tool === 'needle', isLast = g.step + 1 === g.current.steps.length
  const goal = stitchGoal(g.level), active = g.procedure.stitches
  const action = needTool ? `Взять: ${toolById(task.tool!).name}` : stitching ? `Соединить пару ${Math.min(active + 1, goal)} из ${goal}` : actionLabel(task)
  return <div className="action-workflow" data-stage={g.step}>
    <div className="action-eyebrow"><span>Текущий шаг</span><b>{String(g.step + 1).padStart(2, '0')} / {String(g.current.steps.length).padStart(2, '0')}</b></div>
    <div className="action-choice">{task.tool ? <img src={toolById(task.tool).image} alt="" /> : <span className="action-monitor-icon"><HeartPulse size={20} /></span>}<div><strong>{task.tool ? toolById(task.tool).name : 'Прикроватный монитор'}</strong><span>{task.zone === 'iv' ? 'Держатель IV-01' : zoneNames[task.zone]}</span></div>{!needTool && <Check size={13} />}</div>
    <p>{task.instruction}</p>
    {stitching && <div className="stitch-counter" aria-label={`Соединено пар: ${active} из ${goal}`}>{Array.from({ length: goal }, (_, i) => <span key={i} className={i < active ? 'done' : i === active ? 'current' : ''}>{i < active ? <Check size={10} /> : String(i + 1).padStart(2, '0')}</span>)}<small>пары меток</small></div>}
    {g.procedure.extracted && <div className="specimen-receipt"><SquareCheck size={12} />Фрагмент в чаше</div>}
    <button className="focus-procedure" onClick={g.focusTarget}><Focus size={12} />{task.zone === 'iv' ? 'Показать стойку' : 'Показать цель'}<MoveUpRight size={11} /></button>
    <button className={`apply-action ${needTool ? 'equip' : ''}`} onClick={() => needTool ? g.pickTool(task.tool) : g.interact({ kind: 'zone', id: task.zone })}>
      {needTool ? <Grip size={13} /> : isLast ? <SquareCheck size={13} /> : <Target size={13} />}<span>{action}</span><ArrowRight size={12} /></button>
    {isLast && <small className="last-step-note">После повязки откроется отчёт.</small>}
  </div>
}

export function InfusionReadout({ g }: { g: TheatreState }) {
  const on = g.procedure.infusion, paused = g.phase === 'paused' || !!g.dialog || g.phase === 'complete' || g.phase === 'failed'
  const relevant = g.selected === 'iv' || on || (g.level === 2 && g.workspace === 'theatre')
  if (!relevant) return null
  return <div className={`iv-readout ${on ? 'connected' : ''} ${paused ? 'suspended' : ''}`}>
    <div><span className="iv-icon"><Droplet size={14} /></span><span><strong>Капельница <small>IV-01</small></strong><em>{on ? paused ? 'Подача на паузе' : 'Подача включена' : 'Пакет не подключён'}</em></span><i /></div>
    {!on && <p>Пакет № 6 → держатель стойки у изголовья. Не на тело.</p>}
    {!on && g.mode !== 'overview' && g.phase !== 'paused' && <button onClick={() => { g.setMode('orbit'); setTimeout(() => g.engine.current?.focus('iv'), 50) }}><Focus size={11} />Найти стойку</button>}
    {on && <div className="iv-flow" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>}
  </div>
}

export function PracticeReport({ g }: { g: TheatreState }) {
  if (!g.procedure.practiceResolved || g.phase === 'complete') return null
  return <div className="practice-report" role="status"><div><CircleDot size={13} /><strong>Упражнение завершено</strong></div><p>Повязка на месте. Это свободная практика, без оценки операции.</p><button onClick={g.restartPractice}><RotateCcw size={11} />Новое упражнение</button></div>
}