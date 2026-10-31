export type TutorialId = 'library' | 'board' | 'background' | 'share' | 'blending' | 'deck' | 'match'

export type TutorialStep = { selector: string, title: string, text: string }

export const tutorials: Record<TutorialId, TutorialStep[]> = {
    library: [
        { selector: '.create-primary', title: 'Create a lesson', text: 'Start a new lesson here, or paste one you copied earlier.' },
        { selector: '.nav-section-heading', title: 'Organise by student', text: 'Create folders for each student and drag lessons into them.' },
        { selector: '.search-box', title: 'Find anything', text: 'Search across lesson titles and student names.' },
        { selector: '.library-scroll', title: 'Your lessons', text: 'Open a lesson to start teaching. Use the menu on a card for more options.' },
    ],
    board: [
        { selector: '.tool-rail', title: 'Whiteboard tools', text: 'Pick a tool to draw, type, add shapes, notes, grids and more.' },
        { selector: '.page-directory-anchor', title: 'Pages', text: 'Move between pages, or open the page list to add, reorder, copy and delete them.' },
        { selector: '.board-toolbar-right', title: 'Teaching aids', text: 'Open the blending board, card deck or matching game alongside your lesson.' },
        { selector: '[aria-label="Set background"]', title: 'Page background', text: 'Change the look of the current page.' },
        { selector: '[aria-label="Share lesson"]', title: 'Bring students in', text: 'Create personal links so students can follow along live.' },
    ],
    background: [
        { selector: '.background-panel', title: 'Page background', text: 'Choose a colour, pattern or your own image for this page.' },
    ],
    share: [
        { selector: '.invite-modal', title: 'Invite your students', text: 'Give each student a personal link. They follow the page you’re teaching on.' },
    ],
    deck: [
        { selector: '.deck-prep-groups', title: 'Choose the tiles', text: 'Pick the sounds and letters to practise, then confirm the deck.' },
        { selector: '.deck-split', title: 'Your deck', text: 'The selected tiles are on the left; the current card is shown on the right.' },
        { selector: '.card-deck .deck-bar', title: 'Run the deck', text: 'Start to show cards one at a time, or unlock the deck to change the tiles.' },
    ],
    match: [
        { selector: '.match-prep', title: 'Add your words', text: 'Type the words to practise. Each word becomes a pair of cards.' },
        { selector: '.match-board', title: 'The board', text: 'Players take turns flipping cards to find matching pairs.' },
        { selector: '.matching-game .deck-bar', title: 'Game controls', text: 'Start a new game, or unlock to change the words.' },
    ],
    blending: [
        { selector: '.blending-tabs', title: 'Sound categories', text: 'Switch between sets of letters, blends and word parts.' },
        { selector: '.blending-tray', title: 'Tile tray', text: 'Drag tiles from the tray onto the canvas to build words.' },
        { selector: '.blending-canvas', title: 'Canvas', text: 'Arrange tiles here and draw to mark up the word with your student.' },
    ],
}

// Test hook: marks every tutorial as completed.
const disabledKey = 'skyboard.tutorials.disabled'
const storageKey = (userKey: string) => `skyboard.tutorials.completed.${userKey}`

export function loadCompletedTutorials(userKey: string, storage: Pick<Storage, 'getItem'> = localStorage): TutorialId[] {
    try {
        if (storage.getItem(disabledKey) === '1') return Object.keys(tutorials) as TutorialId[]
        const parsed = JSON.parse(storage.getItem(storageKey(userKey)) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter((id): id is TutorialId => id in tutorials) : []
    } catch {
        return []
    }
}

export function saveCompletedTutorials(userKey: string, ids: TutorialId[], storage: Pick<Storage, 'setItem'> = localStorage) {
    try { storage.setItem(storageKey(userKey), JSON.stringify(ids)) } catch { /* storage unavailable */ }
}

export function markTutorialCompleted(ids: TutorialId[], id: TutorialId): TutorialId[] {
    return ids.includes(id) ? ids : [...ids, id]
}

export function nextTutorialToShow(candidates: (TutorialId | null)[], completed: TutorialId[]): TutorialId | null {
    return candidates.find((id): id is TutorialId => id !== null && !completed.includes(id)) ?? null
}
