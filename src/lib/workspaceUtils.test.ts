import { describe, expect, it } from 'vitest'
import { folderIsWithin, getFolderName, getFolderParent, getOrderedFolders, readStored, readStudentFolders, readStudentLessons, initialLessons } from './workspaceUtils'

describe('folder paths', () => {
    it('splits parent and name', () => {
        expect(getFolderParent('A / B / C')).toBe('A / B')
        expect(getFolderName('A / B / C')).toBe('C')
    })
    it('treats a top-level folder as parentless', () => {
        expect(getFolderParent('A')).toBeNull()
        expect(getFolderName('A')).toBe('A')
    })
    it('detects containment without prefix false positives', () => {
        expect(folderIsWithin('A / B', 'A')).toBe(true)
        expect(folderIsWithin('A', 'A')).toBe(true)
        expect(folderIsWithin('AB', 'A')).toBe(false)
        expect(folderIsWithin('A', 'A / B')).toBe(false)
    })
    it('orders children directly after their parent', () => {
        expect(getOrderedFolders(['B', 'A / X', 'A', 'B / Y', 'A / X / Z'])).toEqual(['B', 'B / Y', 'A', 'A / X', 'A / X / Z'])
    })
    it('drops folders whose parent is missing from the top level', () => {
        expect(getOrderedFolders(['A / B'])).toEqual([])
        expect(getOrderedFolders([])).toEqual([])
    })
})

describe('local storage fallback', () => {
    it('returns the fallback for missing or corrupt values', () => {
        expect(readStored('nope', 5)).toBe(5)
        window.localStorage.setItem('bad', '{not json')
        expect(readStored('bad', 'x')).toBe('x')
    })
    it('parses stored JSON', () => {
        window.localStorage.setItem('k', JSON.stringify({ a: 1 }))
        expect(readStored('k', {})).toEqual({ a: 1 })
    })
    it('seeds default folders and lessons', () => {
        expect(readStudentFolders()).toEqual(['Demo student'])
        expect(readStudentLessons()).toEqual(initialLessons)
    })
    it('migrates legacy folder names', () => {
        window.localStorage.setItem('skyboard:folders', JSON.stringify(['Phonics', 'Mine']))
        expect(readStudentFolders()).toEqual(['Maya', 'Mine'])
        window.localStorage.setItem('skyboard:lessons', JSON.stringify([{ ...initialLessons[0], folder: 'Fluency' }]))
        expect(readStudentLessons()[0].folder).toBe('Leo')
    })
})
