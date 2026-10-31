import { describe, expect, it } from 'vitest'
import { advanceMatch, createMatchSession, flipCard, isRoundOver, maskMatchSession, matchWinners, parseMatchWords, skipTurn, skipUnavailable } from './matchGame'

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
        const session = createMatchSession(['a', 'b'], [{ id: 's1', name: 'Ann' }])
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
        const session = createMatchSession(['a', 'b'], [{ id: 's1', name: 'Ann' }])
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

    describe('with several students', () => {
        const students = [{ id: 's1', name: 'Ann' }, { id: 's2', name: 'Ben' }]
        const pendingMiss = () => {
            const session = createMatchSession(['a', 'b'], students)
            return flipCard(flipCard(session, indexesOf(session, 0)[0], 0), indexesOf(session, 1)[0], 0)
        }

        it('creates the teacher and every student as players with zero scores', () => {
            const session = createMatchSession(['a', 'b'], students)
            expect(session.players.map((player) => player.id)).toEqual(['teacher', 's1', 's2'])
            expect(session.scores).toEqual([0, 0, 0])
        })

        it('rotates through the players in order', () => {
            expect(advanceMatch(pendingMiss()).turn).toBe(1)
            expect(advanceMatch({ ...pendingMiss(), turn: 2 }).turn).toBe(0)
        })

        it('skips players who are not available and keeps their score', () => {
            const session = { ...pendingMiss(), scores: [0, 3, 1] }
            const next = advanceMatch(session, (player) => player === 2)
            expect(next.turn).toBe(2)
            expect(next.scores).toEqual([0, 3, 1])
            expect(advanceMatch(session, () => false).turn).toBe(0)
        })

        it('moves the turn on when the current player drops out, but not mid-pair', () => {
            const session = { ...createMatchSession(['a', 'b'], students), turn: 1 }
            expect(skipUnavailable(session, (player) => player === 2).turn).toBe(2)
            expect(skipUnavailable(session, (player) => player === 1)).toBe(session)
            const pending = { ...pendingMiss(), turn: 1 }
            expect(skipUnavailable(pending, () => false)).toBe(pending)
        })

        it('lets the teacher force a skip, clearing a lone flipped card', () => {
            const fresh = createMatchSession(['a', 'b'], students)
            const half = flipCard(fresh, 0, 0)
            const skipped = skipTurn(half)
            expect(skipped.flipped).toEqual([])
            expect(skipped.turn).toBe(1)
            expect(skipTurn(fresh, (player) => player === 2).turn).toBe(2)
            expect(skipTurn(pendingMiss()).turn).toBe(1)
            expect(skipTurn(pendingMiss()).flipped).toEqual([])
        })

        it('reports every leader on a tie', () => {
            const session = { ...createMatchSession(['a'], students), scores: [2, 2, 1] }
            expect(matchWinners(session).map((player) => player.id)).toEqual(['teacher', 's1'])
        })
    })
})
