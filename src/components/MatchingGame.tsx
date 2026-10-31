import { useState } from 'react'
import { Lock, RotateCcw, Sparkles, Unlock, X } from 'lucide-react'
import { MAX_MATCH_WORDS, MIN_MATCH_WORDS, hasPendingPair, isPendingMatch, isRoundOver, parseMatchWords } from '../lib/matchGame'
import type { MatchPlayer, MatchSession } from '../lib/matchGame'
import type { MatchGameConfig } from '../lib/workspaceTypes'

const playerNames = ['Teacher', 'Student']

export default function MatchingGame({ readOnly = false, locked = false, config, onConfigChange, session, onStart, onEdit, onFlip, onAdvance, onClose }: {
    readOnly?: boolean
    locked?: boolean
    config?: MatchGameConfig
    onConfigChange?: (config: MatchGameConfig) => void
    session: MatchSession
    onStart?: () => void
    onEdit?: () => void
    onFlip: (index: number) => void
    onAdvance?: () => void
    onClose: () => void
}) {
    const [text, setText] = useState(() => (config?.words ?? []).join('\n'))
    const [error, setError] = useState('')
    const ready = Boolean(config?.ready)
    const playing = session.cards.length > 0
    const me: MatchPlayer = readOnly ? 1 : 0
    const over = isRoundOver(session)
    const pending = hasPendingPair(session)
    const pendingMatch = isPendingMatch(session)
    const myTurn = session.turn === me && !locked && !pending && !over
    const columns = Math.max(1, Math.ceil(Math.sqrt(session.cards.length * 1.6)))
    const rows = Math.max(1, Math.ceil(session.cards.length / columns))
    const words = parseMatchWords(text)

    function confirm() {
        if (words.length < MIN_MATCH_WORDS) { setError(`Add at least ${MIN_MATCH_WORDS} different words.`); return }
        if (words.length > MAX_MATCH_WORDS) { setError(`Use at most ${MAX_MATCH_WORDS} words.`); return }
        setError('')
        onConfigChange?.({ words, ready: true })
    }
    function winnerText() {
        if (session.scores[0] === session.scores[1]) return "It's a tie!"
        return `${playerNames[session.scores[0] > session.scores[1] ? 0 : 1]} wins!`
    }

    const board = <div className={`match-board${pending ? ' pending' : ''}`} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }} aria-label="Matching cards">
        {session.cards.map((card, index) => {
            const matched = session.matched.includes(index)
            const faceUp = matched || session.flipped.includes(index)
            return <button key={card.id} type="button" className={`match-card${faceUp ? ' face-up' : ''}${matched ? ' matched' : ''}${pending && faceUp && !matched ? (pendingMatch ? ' hit' : ' miss') : ''}`}
                style={{ ['--tilt' as string]: `${((index * 37) % 7 - 3) * 0.35}deg` }}
                disabled={!myTurn || faceUp} aria-label={faceUp ? `Card ${index + 1}: ${card.text}` : `Card ${index + 1}, face down`} onClick={() => onFlip(index)}>
                <span className="match-card-inner">
                    <span className="match-card-back"><b>{index + 1}</b></span>
                    <span className="match-card-front">{card.text}</span>
                </span>
            </button>
        })}
    </div>

    const scoreboard = <div className="match-scores" role="status" aria-live="polite">
        {playerNames.map((name, player) => <span key={name} className={`match-score${!over && session.turn === player ? ' turn' : ''}`}><strong>{name}</strong> {session.scores[player]}</span>)}
        <span className="match-turn">{over ? winnerText() : pending ? (readOnly ? (pendingMatch ? 'A match!' : 'Not a match') : `${pendingMatch ? 'A match!' : 'Not a match'} — click anywhere to continue`) : session.turn === me ? (locked ? 'Paused by your teacher' : 'Your turn') : `${playerNames[session.turn]}'s turn`}</span>
    </div>

    if (readOnly) return <div className="card-deck matching-game read-only" role="dialog" aria-modal="true" aria-label="Matching game">
        {playing ? <>{scoreboard}<div className="match-stage">{board}</div></> : <div className="match-stage"><p className="deck-empty">Waiting for the teacher to start the game…</p></div>}
    </div>

    return <div className="card-deck matching-game" role="dialog" aria-modal="true" aria-label="Matching game">
        <header className="deck-header">
            <strong>Matching Game</strong>
            <span>{playing ? 'Game in progress' : ready ? 'Lesson ready' : 'Preparing the game'}</span>
            <button className="deck-close" title="Close" aria-label="Close matching game" onClick={onClose}><X size={16} /></button>
        </header>
        {playing ? <>
            {scoreboard}
            <div className="match-stage" onClick={pending ? onAdvance : undefined}>{board}</div>
            <div className="deck-bar">
                <span className="deck-bar-note"><button className="deck-unlock" title="Change the words" onClick={onEdit}><Unlock size={14} /> Unlock to edit</button></span>
                <button className="primary" title="Shuffle and start a new game" onClick={onStart}><RotateCcw size={14} /> New game</button>
            </div>
        </> : ready ? <>
            <div className="match-stage match-ready">
                <div className="match-word-list" aria-label="Words">{(config?.words ?? []).map((word) => <span key={word} className="match-chip">{word}</span>)}</div>
                <p className="deck-empty">{(config?.words ?? []).length * 2} cards will be shuffled. Press Start to play.</p>
            </div>
            <div className="deck-bar">
                <span className="deck-bar-note"><button className="deck-unlock" title="Unlock the game to change the words" onClick={() => onConfigChange?.({ words: config?.words ?? [], ready: false })}><Unlock size={14} /> Unlock to edit</button></span>
                <button className="primary" onClick={onStart}>Start</button>
            </div>
        </> : <>
            <div className="match-stage match-prep-stage">
                <div className="match-prep">
                    <div className="match-prep-heading">
                        <span className="match-prep-icon" aria-hidden="true"><Sparkles size={20} /></span>
                        <div>
                            <h2>Build your matching game</h2>
                            <p>Add the words to practise. Each word becomes a pair of cards.</p>
                        </div>
                    </div>
                    <label htmlFor="match-words">Words <em>one per line or separated by commas</em></label>
                    <textarea id="match-words" value={text} rows={6} placeholder={'cat\ndog\nsun'} onChange={(event) => {
                        setText(event.target.value)
                        setError('')
                        onConfigChange?.({ words: parseMatchWords(event.target.value), ready: false })
                    }} />
                    {words.length > 0 && <div className="match-word-list match-preview" aria-label="Preview of the words">{words.map((word) => <span key={word} className="match-chip">{word}</span>)}</div>}
                    <div className="match-prep-footer">
                        <span className={`match-count${words.length > MAX_MATCH_WORDS ? ' over' : ''}`}>{words.length} / {MAX_MATCH_WORDS} words · {Math.min(words.length, MAX_MATCH_WORDS) * 2} cards</span>
                        {error && <span className="match-error" role="alert">{error}</span>}
                    </div>
                </div>
            </div>
            <div className="deck-bar">
                <span className="deck-bar-note"><Lock size={14} /> Words are saved with the lesson</span>
                <button className="primary" onClick={confirm}>Confirm words</button>
            </div>
        </>}
    </div>
}
