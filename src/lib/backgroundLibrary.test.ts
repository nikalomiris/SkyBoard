import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: mockFrom } }))

import { loadBackgroundLibrary } from './backgroundLibrary'

function makeQuery(data: unknown[]) {
    const query = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn().mockResolvedValue({ data, error: null }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    return query
}

describe('cloud background library cache', () => {
    beforeEach(() => {
        window.localStorage.clear()
        mockFrom.mockReset()
    })

    it('reuses cached image payloads after checking lightweight metadata', async () => {
        const entry = { id: 'bg-1', name: 'Classroom', group_name: 'School', image: 'data:image/jpeg;base64,abc' }
        const initialQuery = makeQuery([entry])
        const metadataQuery = makeQuery([{ id: entry.id, name: entry.name, group_name: entry.group_name }])
        mockFrom.mockReturnValueOnce(initialQuery).mockReturnValueOnce(metadataQuery)

        expect(await loadBackgroundLibrary('owner-1')).toEqual([{ id: 'bg-1', name: 'Classroom', group: 'School', image: entry.image }])
        expect(await loadBackgroundLibrary('owner-1')).toEqual([{ id: 'bg-1', name: 'Classroom', group: 'School', image: entry.image }])

        expect(initialQuery.select).toHaveBeenCalledWith('id,name,group_name,image')
        expect(metadataQuery.select).toHaveBeenCalledWith('id,name,group_name')
        expect(mockFrom).toHaveBeenCalledTimes(2)
    })
})
