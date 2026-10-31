export type GridCellStyle = { color?: string; fontSize?: number; fontFamily?: string; align?: 'left' | 'center' | 'right' }

export type BoardItem = { id: string; scale?: number } & (
    | { type: 'stroke'; points: string; color: string; width: number; opacity: number }
    | { type: 'text'; left: number; top: number; text: string; color: string; size: number; fontFamily?: string; align?: 'left' | 'center' | 'right' }
    | { type: 'note'; left: number; top: number; text: string; color?: string; fontSize?: number; fontFamily?: string }
    | { type: 'shape'; left: number; top: number; shape: 'circle' | 'rectangle' | 'square' | 'triangle' | 'line' | 'arrow'; color: string; fillColor?: string; endX?: number; endY?: number; startArrow?: boolean; endArrow?: boolean; rotation?: number }
    | { type: 'grid'; left: number; top: number; values: string[]; rows?: number; cols?: number; fontSize?: number; fontFamily?: string; color?: string; cellStyles?: GridCellStyle[] }
    | { type: 'image'; left: number; top: number; src: string; label: string; storagePath?: string }
    | { type: 'pdf'; left: number; top: number; src: string; label: string; storagePath?: string }
    | { type: 'web'; left: number; top: number; url: string; title: string; zoom?: number }
)

export type DeckTile = { text: string; kind?: string }
export type CardDeckConfig = { tiles: DeckTile[]; ready: boolean }

export type MatchGameConfig = { words: string[]; ready: boolean }

export type LessonCover = 'page' | 'vowels' | 'blends' | 'safari' | 'magic' | 'custom'
export type Lesson = { id: string; title: string; folder: string; pages: string[]; updated: string; updatedAt?: number; color: string; cover?: LessonCover; coverImage?: string; tags?: string[]; cardDeck?: CardDeckConfig; matchGame?: MatchGameConfig; isMock?: boolean; kind: 'lesson' }
export type ClipboardPage = { id: string; name: string; sourceLesson: string; items: BoardItem[]; background?: string; copiedAt: string }
export type PageItems = Record<string, BoardItem[]>

export type WorkspaceData = {
    folders: string[]
    mockStudentFolders: string[]
    lessons: Lesson[]
    itemsByPage: PageItems
    backgroundsByPage: Record<string, string>
    previewItemsByLesson: Record<string, BoardItem[]>
    previewBackgroundsByLesson: Record<string, string>
    initialized: boolean
    hasData: boolean
}
