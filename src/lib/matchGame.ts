export type MatchPlayer = { id: string; name: string; color?: string }
export type MatchCard = { id: number; text: string; pairId: number }
export type MatchSession = {
    cards: MatchCard[]
    flipped: number[]
    matched: number[]
    players: MatchPlayer[]
    scores: number[]
    turn: number
}

export const MAX_MATCH_WORDS = 20
export const MIN_MATCH_WORDS = 2
export const TEACHER_PLAYER: MatchPlayer = { id: 'teacher', name: 'Teacher' }
export const emptyMatchSession: MatchSession = { cards: [], flipped: [], matched: [], players: [TEACHER_PLAYER], scores: [0], turn: 0 }

// Accepts one word per line or comma separated, drops blanks and case-insensitive duplicates.
export function parseMatchWords(input: string) {
    const seen = new Set<string>()
    const words: string[] = []
    for (const part of input.split(/[\n,]/)) {
        const word = part.trim().replace(/\s+/g, ' ')
        const key = word.toLowerCase()
        if (!word || seen.has(key)) continue
        seen.add(key)
        words.push(word)
    }
    return words
}

function shuffle<T>(list: T[], random: () => number) {
    const result = [...list]
    for (let index = result.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1))
        ;[result[index], result[swap]] = [result[swap], result[index]]
    }
    return result
}

export function createMatchSession(words: string[], students: MatchPlayer[] = [], random: () => number = Math.random): MatchSession {
    const pairs = words.slice(0, MAX_MATCH_WORDS).flatMap((text, pairId) => [{ text, pairId }, { text, pairId }])
    const cards = shuffle(pairs, random).map((card, id) => ({ id, ...card }))
    const players = [TEACHER_PLAYER, ...students]
    return { cards, flipped: [], matched: [], players, scores: players.map(() => 0), turn: 0 }
}

// True while two cards are face up waiting for the teacher to move on.
export function hasPendingPair(session: MatchSession) {
    return session.flipped.length === 2
}

export function isPendingMatch(session: MatchSession) {
    return hasPendingPair(session) && session.cards[session.flipped[0]]?.pairId === session.cards[session.flipped[1]]?.pairId
}

export function isRoundOver(session: MatchSession) {
    const found = session.matched.length + (isPendingMatch(session) ? 2 : 0)
    return session.cards.length > 0 && found === session.cards.length
}

// The second card is scored immediately but both cards stay face up until advanceMatch is called.
export function flipCard(session: MatchSession, index: number, player: number): MatchSession {
    if (player !== session.turn || hasPendingPair(session)) return session
    if (!session.cards[index] || session.flipped.includes(index) || session.matched.includes(index)) return session
    const next = { ...session, flipped: [...session.flipped, index] }
    if (!isPendingMatch(next)) return next
    const scores = [...session.scores]
    scores[player] += 1
    return { ...next, scores }
}

// The next player after `from` (wrapping around) who is available; the teacher at index 0 always is, so this terminates.
function nextAvailable(session: MatchSession, from: number, isAvailable: (player: number) => boolean) {
    const count = session.players.length
    for (let step = 1; step <= count; step++) {
        const candidate = (from + step) % count
        if (candidate === 0 || isAvailable(candidate)) return candidate
    }
    return 0
}

// Teacher moves on: a matched pair stays revealed, a mismatch turns face down, and the next available player is up.
export function advanceMatch(session: MatchSession, isAvailable: (player: number) => boolean = () => true): MatchSession {
    if (!hasPendingPair(session)) return session
    const matched = isPendingMatch(session) ? [...session.matched, ...session.flipped] : session.matched
    return { ...session, flipped: [], matched, turn: nextAvailable(session, session.turn, isAvailable) }
}

// Teacher failsafe: ends the current player's turn. A pair waiting for review is resolved as usual,
// and a single card the player had already turned goes face down again.
export function skipTurn(session: MatchSession, isAvailable: (player: number) => boolean = () => true): MatchSession {
    if (session.cards.length === 0 || isRoundOver(session)) return session
    if (hasPendingPair(session)) return advanceMatch(session, isAvailable)
    return { ...session, flipped: [], turn: nextAvailable(session, session.turn, isAvailable) }
}

// Hands the turn on when the current player has dropped out while no pair is waiting to be resolved.
export function skipUnavailable(session: MatchSession, isAvailable: (player: number) => boolean): MatchSession {
    if (session.cards.length === 0 || hasPendingPair(session) || isRoundOver(session)) return session
    if (session.turn === 0 || isAvailable(session.turn)) return session
    return { ...session, turn: nextAvailable(session, session.turn, isAvailable) }
}

export function matchWinners(session: MatchSession) {
    const best = Math.max(...session.scores)
    return session.players.filter((_, index) => session.scores[index] === best)
}

// What students receive: the text of face-down cards is withheld so it cannot be read from the network.
export function maskMatchSession(session: MatchSession): MatchSession {
    const visible = new Set([...session.flipped, ...session.matched])
    return { ...session, cards: session.cards.map((card) => visible.has(card.id) ? card : { ...card, text: '', pairId: -1 }) }
}

export function isMatchSession(value: unknown): value is MatchSession {
    const session = value as MatchSession | null
    return Boolean(session && Array.isArray(session.cards) && Array.isArray(session.flipped) && Array.isArray(session.matched)
        && Array.isArray(session.players) && session.players.length > 0 && Array.isArray(session.scores) && session.scores.length === session.players.length
        && Number.isInteger(session.turn) && session.turn >= 0 && session.turn < session.players.length)
}
