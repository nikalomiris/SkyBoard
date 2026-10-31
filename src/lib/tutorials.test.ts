import { describe, expect, it } from 'vitest'
import { loadCompletedTutorials, markTutorialCompleted, nextTutorialToShow, saveCompletedTutorials } from './tutorials'

describe('tutorials', () => {
    it('marks tutorials completed once', () => {
        expect(markTutorialCompleted(['board'], 'board')).toEqual(['board'])
        expect(markTutorialCompleted(['board'], 'share')).toEqual(['board', 'share'])
    })
    it('picks the first uncompleted candidate', () => {
        expect(nextTutorialToShow(['share', 'board'], ['share'])).toBe('board')
        expect(nextTutorialToShow([null, 'board'], ['board'])).toBeNull()
    })
    it('round-trips storage and ignores bad data', () => {
        const data: Record<string, string> = {}
        saveCompletedTutorials('u1', ['board'], { setItem: (k, v) => { data[k] = v } })
        const storage = { getItem: (k: string) => data[k] ?? null }
        expect(loadCompletedTutorials('u1', storage)).toEqual(['board'])
        expect(loadCompletedTutorials('u2', storage)).toEqual([])
        expect(loadCompletedTutorials('u3', { getItem: () => '{oops' })).toEqual([])
        expect(loadCompletedTutorials('u4', { getItem: () => '["x","share"]' })).toEqual(['share'])
    })
})
