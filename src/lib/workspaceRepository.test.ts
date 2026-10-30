import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFrom, mockRpc, mockStorageFrom, selectedColumns } = vi.hoisted(() => ({
    mockFrom: vi.fn(),
    mockRpc: vi.fn(),
    mockStorageFrom: vi.fn(),
    selectedColumns: vi.fn(),
}))
vi.mock('./supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc, storage: { from: mockStorageFrom } } }))

import { loadLessonPages, loadWorkspace, saveWorkspace } from './workspaceRepository'

const ownerId = 'owner-1'
const lesson = {
    id: 'lesson-1',
    student_id: 'student-1',
    folder_id: null,
    title: 'Lesson',
    position: 0,
    cover: null,
    cover_image: null,
    color: '#ffffff',
    tags: [],
    card_deck: null,
    is_mock: false,
    updated_at: '2026-10-30T00:00:00.000Z',
}
const student = { id: 'student-1', name: 'Student', position: 0, is_mock: false }

function configureQueries(pageRows: unknown[], previewRows: unknown[] = []) {
    const dataByTable: Record<string, unknown> = {
        profiles: { workspace_initialized: true },
        students: [student],
        student_folders: [],
        lessons: [lesson],
        lesson_pages: pageRows,
    }
    mockFrom.mockImplementation((table: string) => {
        const query = {
            select: vi.fn((columns: string) => {
                selectedColumns(table, columns)
                return query
            }),
            eq: vi.fn(() => query),
            order: vi.fn(async () => ({ data: dataByTable[table], error: null })),
            maybeSingle: vi.fn(async () => ({ data: dataByTable[table], error: null })),
        }
        return query
    })
    mockRpc.mockResolvedValue({ data: previewRows, error: null })
}

describe('lazy lesson page loading', () => {
    beforeEach(() => {
        mockFrom.mockReset()
        mockRpc.mockReset()
        mockStorageFrom.mockReset()
        selectedColumns.mockReset()
    })

    it('loads page metadata with the workspace, then loads elements only for an opened lesson', async () => {
        const pageMetadata = [{ id: 'page-1', lesson_id: lesson.id, name: 'Page 1', position: 0 }]
        const elements = [{ id: 'note-1', type: 'note', left: 1, top: 2, text: 'Hello' }]
        configureQueries(pageMetadata, [{ lesson_id: lesson.id, background: '#ffeeee', elements }])

        const workspace = await loadWorkspace(ownerId)
        expect(workspace.lessons[0].pages).toEqual(['Page 1'])
        expect(workspace.itemsByPage).toEqual({})
        expect(workspace.previewItemsByLesson[lesson.id]).toEqual(elements)
        expect(workspace.previewBackgroundsByLesson[lesson.id]).toBe('#ffeeee')
        expect(mockRpc).toHaveBeenCalledWith('get_lesson_previews')
        expect(selectedColumns).toHaveBeenCalledWith('lesson_pages', 'id,lesson_id,name,position')

        configureQueries([{ ...pageMetadata[0], elements, background: '#ffeeee' }])
        const pages = await loadLessonPages(ownerId, lesson.id)
        expect(pages.itemsByPage[`${lesson.id}:0`]).toEqual(elements)
        expect(pages.backgroundsByPage[`${lesson.id}:0`]).toBe('#ffeeee')
        expect(selectedColumns).toHaveBeenCalledWith('lesson_pages', 'id,lesson_id,name,position,elements,background')
    })

    it('does not save unopened lesson pages as empty', async () => {
        configureQueries([{ id: 'page-1', lesson_id: lesson.id, name: 'Page 1', position: 0 }])
        const workspace = await loadWorkspace(ownerId)
        mockRpc.mockClear()

        await saveWorkspace(ownerId, workspace.folders, workspace.lessons, {}, {}, new Set())

        expect(mockRpc).not.toHaveBeenCalled()
    })

    it('signs preview image paths in one storage request', async () => {
        const previewImage = { id: 'image-1', type: 'image', left: 0, top: 0, label: 'Preview', storagePath: 'owner/lesson/page/image', src: '' }
        configureQueries([], [{ lesson_id: lesson.id, background: '#ffffff', elements: [previewImage] }])
        mockStorageFrom.mockReturnValue({
            createSignedUrls: vi.fn().mockResolvedValue({
                data: [{ path: previewImage.storagePath, signedUrl: 'https://storage.example/preview' }],
                error: null,
            }),
        })

        const workspace = await loadWorkspace(ownerId)

        expect(mockStorageFrom).toHaveBeenCalledWith('lesson-assets')
        expect(workspace.previewItemsByLesson[lesson.id][0]).toMatchObject({ ...previewImage, src: 'https://storage.example/preview' })
    })

    it('keeps image backgrounds and inline legacy images in the lightweight preview', async () => {
        const background = 'url("data:image/jpeg;base64,cover") center / cover no-repeat #fffef9'
        const inlineImage = { id: 'image-legacy', type: 'image', left: 0, top: 0, label: 'Cover', src: 'data:image/jpeg;base64,picture' }
        configureQueries([], [{ lesson_id: lesson.id, background, elements: [inlineImage] }])

        const workspace = await loadWorkspace(ownerId)

        expect(workspace.previewBackgroundsByLesson[lesson.id]).toBe(background)
        expect(workspace.previewItemsByLesson[lesson.id][0]).toEqual(inlineImage)
        expect(mockStorageFrom).not.toHaveBeenCalled()
    })

    it('keeps remotely hosted image sources for thumbnails', async () => {
        const remoteImage = { id: 'image-remote', type: 'image', left: 0, top: 0, label: 'Photo', src: 'https://images.example/photo.jpg' }
        configureQueries([], [{ lesson_id: lesson.id, background: '#ffffff', elements: [remoteImage] }])

        const workspace = await loadWorkspace(ownerId)

        expect(workspace.previewItemsByLesson[lesson.id][0]).toEqual(remoteImage)
        expect(mockStorageFrom).not.toHaveBeenCalled()
    })
})
