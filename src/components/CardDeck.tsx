import { useState } from 'react'
import { ChevronLeft, ChevronRight, Lock, Play, Unlock, X } from 'lucide-react'
import { advancedVowelGroups, affixRootGroups, closedExceptionTiles, digraphTiles, gluedSoundTiles, initialFinalBlendRows, letterTiles, silentETiles } from './BlendingBoard'
import type { BoardItem, CardDeckConfig, DeckTile } from '../lib/workspaceTypes'

export type DeckSession = { order: DeckTile[]; index: number; review?: boolean }
export const emptyDeckSession: DeckSession = { order: [], index: -1 }

const vowels = new Set(['a', 'e', 'i', 'o', 'u'])

export function deckTileKey(tile: DeckTile) {
    return `${tile.kind ?? ''}:${tile.text}`
}

export const DECK_ITEM_PREFIX = 'deck-tile-'
const deckNoteColors: Record<string, string> = { 'deck-vowel': '#ffe94d', 'deck-prefix': '#ffe94d', 'deck-root': '#6fcf7a', 'deck-suffix': '#f26b6b', 'deck-consonant': '#ffffff' }

// Lays the selected tiles out as colour-coded notes, shrinking them until they all fit on the 1000x620 page.
export function buildDeckPageItems(tiles: DeckTile[]): BoardItem[] {
    const margin = 30
    const gridTop = 100
    const gap = 12
    let scale = 0.5
    const fits = (candidate: number) => {
        const columns = Math.floor((1000 - margin * 2 + gap) / (190 * candidate + gap))
        const rows = Math.floor((620 - gridTop - margin + gap) / (170 * candidate + gap))
        return columns > 0 && columns * rows >= tiles.length
    }
    while (scale > 0.12 && !fits(scale)) scale -= 0.02
    const columns = Math.max(1, Math.floor((1000 - margin * 2 + gap) / (190 * scale + gap)))
    const title: BoardItem = { id: `${DECK_ITEM_PREFIX}title`, type: 'text', left: 3, top: 9.7, text: 'Card Deck', color: '#253c37', size: 40 }
    return [title, ...tiles.map((tile, index) => ({
        id: `${DECK_ITEM_PREFIX}${index}`,
        type: 'note' as const,
        left: (margin + (index % columns) * (190 * scale + gap)) / 10,
        top: (gridTop + Math.floor(index / columns) * (170 * scale + gap)) / 6.2,
        text: tile.text,
        color: deckNoteColors[deckTileClass(tile)],
        fontSize: 56,
        scale,
    }))]
}

function deckTileClass(tile: DeckTile) {
    if (tile.kind === 'prefix' || tile.kind === 'root' || tile.kind === 'suffix') return `deck-${tile.kind}`
    if (tile.kind === 'consonant') return 'deck-consonant'
    return vowels.has(tile.text.toLowerCase()) ? 'deck-vowel' : 'deck-consonant'
}

// Every distinct tile offered by the blending board, grouped the way the board groups them.
const catalog: { label: string; tiles: DeckTile[] }[] = [
    { label: 'Letters', tiles: letterTiles.map((text) => ({ text })) },
    { label: 'Digraphs', tiles: digraphTiles.map((text) => ({ text })) },
    { label: 'Silent e', tiles: silentETiles.filter((text) => text !== 'e').map((text) => ({ text })) },
    { label: 'Closed Exceptions', tiles: closedExceptionTiles.map((text) => ({ text })) },
    { label: 'Glued sounds', tiles: gluedSoundTiles.map((text) => ({ text })) },
    { label: 'Advanced vowels', tiles: advancedVowelGroups.flat().map((text) => ({ text })) },
    { label: 'Initial and final blends', tiles: initialFinalBlendRows.flat().map((text) => ({ text })) },
    { label: 'Prefixes', tiles: affixRootGroups.filter((group) => group.kind === 'prefix').flatMap((group) => group.tiles).map((text) => ({ text, kind: 'prefix' })) },
    { label: 'Roots', tiles: affixRootGroups.filter((group) => group.kind === 'root').flatMap((group) => group.tiles).map((text) => ({ text, kind: 'root' })) },
    { label: 'Suffixes', tiles: affixRootGroups.filter((group) => group.kind === 'suffix').flatMap((group) => group.tiles).map((text) => ({ text, kind: 'suffix' })) },
    { label: 'Capital letters', tiles: letterTiles.map((text) => ({ text: text.toUpperCase() })) },
].map((group) => ({ ...group, tiles: group.tiles.filter((tile, index, all) => all.findIndex((other) => deckTileKey(other) === deckTileKey(tile)) === index) }))

function shuffle<T>(list: T[]) {
    const result = [...list]
    for (let index = result.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1))
        ;[result[index], result[swap]] = [result[swap], result[index]]
    }
    return result
}

export default function CardDeck({ readOnly = false, config, onConfigChange, session = emptyDeckSession, onSessionChange, tile, onClose }: {
    readOnly?: boolean
    config?: CardDeckConfig
    onConfigChange?: (config: CardDeckConfig) => void
    session?: DeckSession
    onSessionChange?: (session: DeckSession) => void
    tile?: DeckTile | null
    onClose: () => void
}) {
    const [draft, setDraft] = useState<DeckTile[]>(() => config?.tiles ?? [])
    const ready = Boolean(config?.ready)
    const reviewing = Boolean(session.review)
    const current = readOnly ? tile ?? null : session.order[session.index] ?? null
    const selectedKeys = new Set((ready ? config?.tiles ?? [] : draft).map(deckTileKey))
    const shownKeys = new Set(session.order.slice(0, session.index + 1).map(deckTileKey))

    // Selection changes are saved with the lesson straight away (still unconfirmed) so they survive closing the deck.
    function updateDraft(next: DeckTile[]) {
        setDraft(next)
        onConfigChange?.({ tiles: next, ready: false })
    }
    function toggle(target: DeckTile) {
        const key = deckTileKey(target)
        updateDraft(draft.some((item) => deckTileKey(item) === key) ? draft.filter((item) => deckTileKey(item) !== key) : [...draft, target])
    }
    function start() {
        if (!config?.tiles.length) return
        onSessionChange?.({ order: shuffle(config.tiles), index: 0 })
    }
    const canGoNext = session.index >= 0 && session.index < session.order.length - 1
    const canGoBack = session.index > 0
    const atLastCard = session.index >= 0 && session.index === session.order.length - 1
    function reviewTile(target: DeckTile) {
        const position = session.order.findIndex((item) => deckTileKey(item) === deckTileKey(target))
        if (position >= 0) onSessionChange?.({ ...session, index: position })
    }

    const stage = current
        ? <div className={`deck-card ${deckTileClass(current)}`} aria-live="polite" aria-label={`Card ${current.text}`}>{current.text}</div>
        : <p className="deck-empty">{readOnly ? 'Waiting for the next card…' : 'Press Start to show the first card'}</p>

    if (readOnly) return <div className="card-deck read-only" role="dialog" aria-modal="true" aria-label="Card deck"><div className="deck-stage">{stage}</div></div>

    return <div className="card-deck" role="dialog" aria-modal="true" aria-label="Card deck">
        <header className="deck-header">
            <strong>Card Deck</strong>
            <span>{ready ? 'Lesson ready' : 'Preparing the deck'}</span>
            <button className="deck-close" title="Close" aria-label="Close card deck" onClick={onClose}><X size={16} /></button>
        </header>
        {ready ? <div className="deck-session">
            <div className="deck-split">
                <aside className="deck-tiles" aria-label="Selected tiles">
                    <div className="deck-tile-list">
                        {(config?.tiles ?? []).map((item) => reviewing
                            ? <button key={deckTileKey(item)} type="button" className={`deck-chip ${deckTileClass(item)}${current && deckTileKey(current) === deckTileKey(item) ? ' selected' : ''}`} aria-pressed={Boolean(current && deckTileKey(current) === deckTileKey(item))} title={`Show ${item.text}`} onClick={() => reviewTile(item)}>{item.text}</button>
                            : <span key={deckTileKey(item)} className={`deck-chip ${deckTileClass(item)}${shownKeys.has(deckTileKey(item)) ? ' shown' : ''}`}>{item.text}</span>)}
                    </div>
                </aside>
                <section className="deck-canvas" aria-label="Card canvas">
                    <div className="deck-stage">{stage}</div>
                </section>
            </div>
            <div className="deck-bar">
                <span className="deck-bar-note"><button className="deck-unlock" title="Unlock the deck to change the selected tiles" onClick={() => { onSessionChange?.(emptyDeckSession); onConfigChange?.({ tiles: config?.tiles ?? [], ready: false }) }}><Unlock size={14} /> Unlock to edit</button></span>
                <button disabled={!canGoBack || reviewing} onClick={() => onSessionChange?.({ ...session, index: session.index - 1 })}><ChevronLeft size={17} /> Previous</button>
                <button className="primary" onClick={start} disabled={!config?.tiles.length}><Play size={15} /> {session.index >= 0 ? 'Restart' : 'Start'}</button>
                {reviewing
                    ? <button className="primary" onClick={() => { onSessionChange?.(emptyDeckSession); onClose() }}>Finish and close</button>
                    : atLastCard
                        ? <button className="primary" onClick={() => onSessionChange?.({ ...session, review: true })}>Review</button>
                        : <button disabled={!canGoNext} onClick={() => onSessionChange?.({ ...session, index: session.index + 1 })}>Next <ChevronRight size={17} /></button>}
                <span className="deck-bar-note deck-bar-end" role="status">{reviewing ? 'Review mode' : session.index >= 0 ? `Card ${session.index + 1} of ${session.order.length}` : ''}</span>
            </div>
        </div> : <div className="deck-prep">
            <div className="deck-prep-groups">
                {catalog.map((group) => <section key={group.label} className="deck-prep-group" aria-label={group.label}>
                    <h3>{group.label}</h3>
                    <div className="deck-prep-tiles">
                        {group.tiles.map((item) => <button key={deckTileKey(item)} className={`deck-chip ${deckTileClass(item)}${selectedKeys.has(deckTileKey(item)) ? ' selected' : ''}`} aria-pressed={selectedKeys.has(deckTileKey(item))} onClick={() => toggle(item)}>{item.text}</button>)}
                    </div>
                </section>)}
            </div>
            <div className="deck-bar">
                <span className="deck-bar-note" role="status">{draft.length} tile{draft.length === 1 ? '' : 's'} selected</span>
                <button onClick={() => updateDraft([])} disabled={!draft.length}>Clear</button>
                <button className="primary" disabled={!draft.length} onClick={() => onConfigChange?.({ tiles: draft, ready: true })}><Lock size={14} /> Confirm deck ready</button>
            </div>
        </div>}
    </div>
}
