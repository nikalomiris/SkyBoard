// Reports whether a web page allows itself to be shown inside an iframe on the SkyBoard origin.
// Authenticated callers only. Fetches server-side, so private network targets are rejected.
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_REDIRECTS = 3
const TIMEOUT_MS = 6000

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Status = 'allowed' | 'blocked' | 'unknown'

function respond(body: { status: Status; reason: string }, code = 200) {
    return new Response(JSON.stringify(body), { status: code, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function isPrivateIp(ip: string) {
    if (ip.includes(':')) {
        const lower = ip.toLowerCase()
        const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
        if (mapped) return isPrivateIp(mapped[1])
        return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)
    }
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224
}

async function assertPublicHttps(raw: string) {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only plain https addresses are supported.')
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const literal = /^[\d.]+$/.test(host) || host.includes(':')
    const addresses: string[] = literal ? [host] : []
    if (!literal) {
        if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('This address is not public.')
        for (const type of ['A', 'AAAA'] as const) {
            try { addresses.push(...await Deno.resolveDns(host, type)) } catch { /* no records of this type */ }
        }
    }
    if (!addresses.length) throw new Error('This address could not be found.')
    if (addresses.some(isPrivateIp)) throw new Error('This address is not public.')
    return url
}

// Evaluates a frame-ancestors source list against the embedding origin.
function ancestorsAllow(sources: string[], origin: string) {
    const embedder = new URL(origin)
    return sources.some((source) => {
        if (source === '*' || source === 'https:') return true
        if (source === "'none'" || source === "'self'") return false
        const clean = source.replace(/^https:\/\//, '').replace(/\/$/, '')
        if (clean.startsWith('*.')) return embedder.hostname.endsWith(clean.slice(1))
        return clean === embedder.host || clean === embedder.hostname
    })
}

function evaluate(headers: Headers, origin: string): { status: Status; reason: string } {
    const csp = headers.get('content-security-policy') ?? ''
    const directive = csp.split(',').flatMap((policy) => policy.split(';')).map((part) => part.trim()).find((part) => part.toLowerCase().startsWith('frame-ancestors'))
    if (directive) {
        const sources = directive.split(/\s+/).slice(1)
        return ancestorsAllow(sources, origin)
            ? { status: 'allowed', reason: '' }
            : { status: 'blocked', reason: 'The site restricts where it can be embedded (frame-ancestors).' }
    }
    const frameOptions = (headers.get('x-frame-options') ?? '').toLowerCase()
    if (/deny|sameorigin/.test(frameOptions)) return { status: 'blocked', reason: 'The site sends an X-Frame-Options header that forbids embedding.' }
    if (frameOptions) return { status: 'unknown', reason: 'The site sends an unusual X-Frame-Options header.' }
    return { status: 'allowed', reason: '' }
}

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const authorization = request.headers.get('Authorization')
    if (!authorization) return respond({ status: 'unknown', reason: 'Sign in to check pages.' }, 401)
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: userData, error: userError } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
    if (userError || !userData.user) return respond({ status: 'unknown', reason: 'Sign in to check pages.' }, 401)

    let target: string
    try {
        const body = await request.json()
        target = String(body.url ?? '')
    } catch {
        return respond({ status: 'unknown', reason: 'Invalid request.' }, 400)
    }

    const origin = request.headers.get('Origin') ?? 'https://localhost'
    try {
        let url = await assertPublicHttps(target)
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'SkyBoardEmbedCheck/1.0' } })
            await response.body?.cancel()
            const location = response.headers.get('location')
            if (response.status >= 300 && response.status < 400 && location) {
                url = await assertPublicHttps(new URL(location, url).href)
                continue
            }
            if (response.status >= 400) return respond({ status: 'unknown', reason: `The site answered with status ${response.status}.` })
            return respond(evaluate(response.headers, origin))
        }
        return respond({ status: 'unknown', reason: 'The address redirects too many times.' })
    } catch (error) {
        return respond({ status: 'unknown', reason: error instanceof Error ? error.message : 'The page could not be reached.' })
    }
})
