import { describe, expect, it } from 'vitest'
import { advanceMatch, createMatchSession, flipCard, isRoundOver, maskMatchSession, parseMatchWords } from './matchGame'

const indexesOf = (session: ReturnType<typeof createMatchSession>, pairId: number) => session.cards.filter((card) => card.pairId === pairId).map((card) => card.id)

describe('matching game', () => {
    it('parses words, dropping blanks and duplicates', () => {
        expect(parseMatchWords('cat\n Dog ,CAT\n\n  big   bird ')).toEqual(['cat', 'Dog', 'big bird'])
    })

    it('builds two cards per word', () => {
        const session = createMatchSession(['a', 'b', 'c'])
        expect(session.cards).toHaveLength(6)
        expect(indexesOf(session, 1)).toHaveLength(2)
    })

    it('awards a point on a match, keeps the pair up, and passes the turn only when advancing', () => {
        const session = createMatchSession(['a', 'b'])
        const [first, second] = indexesOf(session, 0)
        const pending = flipCard(flipCard(session, first, 0), second, 0)
        expect(pending.scores).toEqual([1, 0])
        expect(pending.flipped).toEqual([first, second])
        expect(flipCard(pending, indexesOf(session, 1)[0], 0)).toBe(pending)
        const next = advanceMatch(pending)
        expect(next.matched).toEqual([first, second])
        expect(next.flipped).toEqual([])
        expect(next.turn).toBe(1)
    })

    it('keeps a mismatch face up until advancing, then turns it down and passes the turn', () => {
        const session = createMatchSession(['a', 'b'])
        const a = indexesOf(session, 0)[0]
        const b = indexesOf(session, 1)[0]
        expect(flipCard(session, a, 1)).toBe(session)
        const mismatch = flipCard(flipCard(session, a, 0), b, 0)
        expect(mismatch.scores).toEqual([0, 0])
        expect(flipCard(mismatch, indexesOf(session, 1)[1], 0)).toBe(mismatch)
        const resolved = advanceMatch(mismatch)
        expect(resolved.flipped).toEqual([])
        expect(resolved.matched).toEqual([])
        expect(resolved.turn).toBe(1)
    })

    it('detects the end of the round and masks hidden cards', () => {
        let session = createMatchSession(['a'])
        expect(maskMatchSession(session).cards.every((card) => card.text === '')).toBe(true)
        session = flipCard(flipCard(session, 0, 0), 1, 0)
        expect(isRoundOver(session)).toBe(true)
        expect(maskMatchSession(session).cards.map((card) => card.text)).toEqual(['a', 'a'])
    })
})
