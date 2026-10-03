export type BoardItem = { id: string; scale?: number } & (
    | { type: 'stroke'; points: string; color: string; width: number; opacity: number }
    | { type: 'text'; left: number; top: number; text: string; color: string; size: number }
    | { type: 'note'; left: number; top: number; text: string }
    | { type: 'shape'; left: number; top: number; shape: 'circle' | 'rectangle' | 'line'; color: string; endX?: number; endY?: number; startArrow?: boolean; endArrow?: boolean; rotation?: number }
    | { type: 'grid'; left: number; top: number; values: string[]; rows?: number; cols?: number }
    | { type: 'image'; left: number; top: number; src: string; label: string; storagePath?: string }
    | { type: 'pdf'; left: number; top: number; src: string; label: string; storagePath?: string }
)

export type LessonCover = 'page' | 'vowels' | 'blends' | 'safari' | 'magic' | 'custom'
export type Lesson = { id: string; title: string; folder: string; pages: string[]; updated: string; color: string; cover?: LessonCover; coverImage?: string; tags?: string[]; isMock?: boolean; kind: 'lesson' }
export type PageItems = Record<string, BoardItem[]>

export type WorkspaceData = {
    folders: string[]
    mockStudentFolders: string[]
    lessons: Lesson[]
    itemsByPage: PageItems
    backgroundsByPage: Record<string, string>
    initialized: boolean
    hasData: boolean
}
