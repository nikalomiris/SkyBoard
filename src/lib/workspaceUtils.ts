import { isSupabaseConfigured } from './supabase'
import type { Lesson, LessonCover } from './workspaceTypes'

export type Tool = 'select' | 'pen' | 'brush' | 'highlighter' | 'eraser' | 'element-eraser' | 'postit' | 'text' | 'shape' | 'grid' | 'laser'

export const lessonColors = ['#daf0e9', '#fae7d9', '#e3e9fc', '#f5e8a8']
export const MIN_GRID_SIZE = 1
export const MAX_GRID_SIZE = 6
export const lessonCoverOptions: { id: LessonCover; label: string; tint: string }[] = [
    { id: 'page', label: 'No thumbnail', tint: '#fffef9' },
    { id: 'vowels', label: 'Sound tiles', tint: lessonColors[0] },
    { id: 'blends', label: 'Word blends', tint: lessonColors[1] },
    { id: 'safari', label: 'Syllable safari', tint: lessonColors[2] },
    { id: 'magic', label: 'Magic e', tint: lessonColors[3] },
]
export const initialLessons: Lesson[] = [
    { id: '11111111-1111-4111-8111-111111111111', title: 'Short vowels at family', folder: 'Demo student', pages: ['Warm up', 'Blend it', 'Read it'], updated: 'Today', color: lessonColors[0], cover: 'vowels', isMock: true, kind: 'lesson' },
]
export const folderNamesInitial = ['Demo student']
export const mockLessonIds = new Set(initialLessons.map((lesson) => lesson.id))
export const mockFolderNames = new Set(folderNamesInitial)
export const legacyFolderNames: Record<string, string> = { Phonics: 'Maya', Fluency: 'Leo', 'Word study': 'Amira' }
export const folderSeparator = ' / '

export const notePalette = ['#fff3b0', '#ffd9de', '#d8f3e4', '#d6e8ff', '#e6dcff', '#ffe4cc']
export const palette = ['#253c37', '#ee7859', '#387c70', '#576fc2', '#e5ac37', '#bc6c9a']
export const textFontOptions = [
    { label: 'Lexend', value: "'Lexend', sans-serif" },
    { label: 'Manrope', value: "'Manrope', sans-serif" },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'DM Mono', value: "'DM Mono', monospace" },
]
export const defaultTextFont = textFontOptions[0].value

export function id() {
    return crypto.randomUUID()
}

export function readStored<T>(key: string, fallback: T): T {
    try {
        const value = window.localStorage.getItem(key)
        return value ? JSON.parse(value) as T : fallback
    } catch {
        return fallback
    }
}

export function readStudentFolders() {
    if (isSupabaseConfigured) return []
    return readStored<string[]>('skyboard:folders', folderNamesInitial).map((folder) => legacyFolderNames[folder] ?? folder)
}

export function getFolderParent(folder: string) {
    const separatorIndex = folder.lastIndexOf(folderSeparator)
    return separatorIndex < 0 ? null : folder.slice(0, separatorIndex)
}

export function getFolderName(folder: string) {
    const separatorIndex = folder.lastIndexOf(folderSeparator)
    return separatorIndex < 0 ? folder : folder.slice(separatorIndex + folderSeparator.length)
}

export function folderIsWithin(folder: string, parent: string) {
    return folder === parent || folder.startsWith(`${parent}${folderSeparator}`)
}

export function getOrderedFolders(folders: string[]) {
    const childrenByParent = new Map<string, string[]>()
    for (const folder of folders) {
        const parent = getFolderParent(folder)
        if (parent) childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), folder])
    }
    const addFolderAndChildren = (folder: string): string[] => [
        folder,
        ...(childrenByParent.get(folder) ?? []).flatMap(addFolderAndChildren),
    ]
    return folders.filter((folder) => !getFolderParent(folder)).flatMap(addFolderAndChildren)
}

export function readStudentLessons() {
    if (isSupabaseConfigured) return []
    const seedKey = 'skyboard:mock-lessons:v1'
    let lessons = readStored<Lesson[]>('skyboard:lessons', initialLessons)
    if (window.localStorage.getItem(seedKey) !== 'done') {
        // Keep this migration one-time so a user's deleted sample lessons are not restored on every load.
        const existingIds = new Set(lessons.map((lesson) => lesson.id))
        const missingMocks = initialLessons.filter((lesson) => lesson.id.startsWith('mock-') && !existingIds.has(lesson.id))
        lessons = [...lessons, ...missingMocks]
        if (missingMocks.length) window.localStorage.setItem('skyboard:lessons', JSON.stringify(lessons))
        window.localStorage.setItem(seedKey, 'done')
    }
    return lessons.map((lesson) => ({
        ...lesson,
        folder: legacyFolderNames[lesson.folder] ?? lesson.folder,
    }))
}
