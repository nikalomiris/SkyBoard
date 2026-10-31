import { useEffect, useLayoutEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import type { TutorialStep } from '../lib/tutorials'

type Rect = { top: number, left: number, width: number, height: number }
const pad = 6

export function TutorialHelpButton({ onClick }: { onClick: () => void }) {
    return <button type="button" className="icon-button tutorial-help-button" onClick={onClick} aria-label="Show tutorial" title="Show tutorial"><HelpCircle size={17} /></button>
}

export default function TutorialOverlay({ steps: allSteps, onFinish }: { steps: TutorialStep[], onFinish: () => void }) {
    const [steps] = useState(() => {
        const present = allSteps.filter((candidate) => document.querySelector(candidate.selector))
        return present.length ? present : allSteps.slice(0, 1)
    })
    const [index, setIndex] = useState(0)
    const [rect, setRect] = useState<Rect | null>(null)
    const [, setTick] = useState(0)
    const step = steps[index]
    const last = index === steps.length - 1

    useLayoutEffect(() => {
        const measure = () => {
            const element = document.querySelector(step.selector)
            if (!element) { setRect(null); return }
            const box = element.getBoundingClientRect()
            setRect(box.width || box.height ? { top: box.top, left: box.left, width: box.width, height: box.height } : null)
        }
        measure()
        window.addEventListener('resize', measure)
        const timer = window.setInterval(measure, 250)
        return () => { window.removeEventListener('resize', measure); window.clearInterval(timer) }
    }, [step.selector])

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onFinish() }
        window.addEventListener('keydown', onKey)
        const onResize = () => setTick((tick) => tick + 1)
        window.addEventListener('resize', onResize)
        return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize) }
    }, [onFinish])

    const vw = window.innerWidth
    const vh = window.innerHeight
    const hole = rect ? { top: Math.max(0, rect.top - pad), left: Math.max(0, rect.left - pad), right: Math.min(vw, rect.left + rect.width + pad), bottom: Math.min(vh, rect.top + rect.height + pad) } : null
    const cardWidth = Math.min(320, vw - 24)
    let cardStyle: React.CSSProperties = { width: cardWidth, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    if (hole) {
        const below = vh - hole.bottom >= 190 || hole.top < 190
        const top = below ? Math.min(hole.bottom + 12, vh - 190) : Math.max(12, hole.top - 182)
        cardStyle = { width: cardWidth, top, left: Math.min(Math.max(12, hole.left), vw - cardWidth - 12) }
    }

    return <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-label="Tutorial">
        {hole ? <>
            <div className="tutorial-blur" style={{ top: 0, left: 0, right: 0, height: hole.top }} />
            <div className="tutorial-blur" style={{ top: hole.bottom, left: 0, right: 0, bottom: 0 }} />
            <div className="tutorial-blur" style={{ top: hole.top, left: 0, width: hole.left, height: hole.bottom - hole.top }} />
            <div className="tutorial-blur" style={{ top: hole.top, left: hole.right, right: 0, height: hole.bottom - hole.top }} />
            <div className="tutorial-highlight" style={{ top: hole.top, left: hole.left, width: hole.right - hole.left, height: hole.bottom - hole.top }} />
        </> : <div className="tutorial-blur" style={{ inset: 0 }} />}
        <div className="tutorial-card" style={cardStyle}>
            <p className="tutorial-progress">{steps.length > 1 ? `Step ${index + 1} of ${steps.length}` : 'Quick tip'}</p>
            <strong>{step.title}</strong>
            <p>{step.text}</p>
            <div className="tutorial-actions">
                <button type="button" className="tutorial-skip" onClick={onFinish}>{last ? 'Close' : 'Skip'}</button>
                {last ? <button type="button" className="tutorial-next" autoFocus onClick={onFinish}>Done</button> : <button type="button" className="tutorial-next" autoFocus onClick={() => setIndex(index + 1)}>Next</button>}
            </div>
        </div>
    </div>
}
