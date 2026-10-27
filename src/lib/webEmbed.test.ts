import { describe, expect, it } from 'vitest'
import { checkEmbeddable, parseWebUrl, webHostname } from './webEmbed'

describe('parseWebUrl', () => {
    it('adds https to bare hosts', () => {
        expect(parseWebUrl('example.com/a')?.href).toBe('https://example.com/a')
        expect(parseWebUrl('  example.com  ')?.hostname).toBe('example.com')
    })
    it.each([
        '', '   ', 'http://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com',
        'https://user:pw@example.com', 'https://localhost', 'exa mple.com', 'https://',
    ])('rejects %j', (input) => {
        expect(parseWebUrl(input)).toBeNull()
    })
})

describe('webHostname', () => {
    it('strips www', () => expect(webHostname('https://www.example.com/x')).toBe('example.com'))
    it('falls back for invalid input', () => expect(webHostname('nope')).toBe('web page'))
})

describe('checkEmbeddable without Supabase', () => {
    it('reports unknown', async () => {
        expect((await checkEmbeddable('https://example.com')).status).toBe('unknown')
    })
})
