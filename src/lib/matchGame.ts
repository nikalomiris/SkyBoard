export type MatchPlayer = 0 | 1
export type MatchCard = { id: number; text: string; pairId: number }
export type MatchSession = {
    cards: MatchCard[]
    flipped: number[]
    matched: number[]
    scores: [number, number]
    turn: MatchPlayer
}

export const MAX_MATCH_WORDS = 20
export const MIN_MATCH_WORDS = 2
export const emptyMatchSession: MatchSession = { cards: [], flipped: [], matched: [], scores: [0, 0], turn: 0 }

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

export function createMatchSession(words: string[], random: () => number = Math.random): MatchSession {
    const pairs = words.slice(0, MAX_MATCH_WORDS).flatMap((text, pairId) => [{ text, pairId }, { text, pairId }])
    const cards = shuffle(pairs, random).map((card, id) => ({ id, ...card }))
    return { cards, flipped: [], matched: [], scores: [0, 0], turn: 0 }
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
export function flipCard(session: MatchSession, index: number, player: MatchPlayer): MatchSession {
    if (player !== session.turn || hasPendingPair(session)) return session
    if (!session.cards[index] || session.flipped.includes(index) || session.matched.includes(index)) return session
    const next = { ...session, flipped: [...session.flipped, index] }
    if (!isPendingMatch(next)) return next
    const scores: [number, number] = [...session.scores]
    scores[player] += 1
    return { ...next, scores }
}

// Teacher moves on: a matched pair stays revealed, a mismatch turns face down, and the other player is up next.
export function advanceMatch(session: MatchSession): MatchSession {
    if (!hasPendingPair(session)) return session
    const matched = isPendingMatch(session) ? [...session.matched, ...session.flipped] : session.matched
    return { ...session, flipped: [], matched, turn: session.turn === 0 ? 1 : 0 }
}

// What students receive: the text of face-down cards is withheld so it cannot be read from the network.
export function maskMatchSession(session: MatchSession): MatchSession {
    const visible = new Set([...session.flipped, ...session.matched])
    return { ...session, cards: session.cards.map((card) => visible.has(card.id) ? card : { ...card, text: '', pairId: -1 }) }
}

export function isMatchSession(value: unknown): value is MatchSession {
    const session = value as MatchSession | null
    return Boolean(session && Array.isArray(session.cards) && Array.isArray(session.flipped) && Array.isArray(session.matched)
        && Array.isArray(session.scores) && session.scores.length === 2 && (session.turn === 0 || session.turn === 1))
}
