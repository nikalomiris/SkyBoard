// Peer-to-peer mirroring of the teacher's web-page frame. Video flows directly between browsers;
// the existing lesson-live Realtime channel only carries the small signaling messages.

export type GameSignal = {
    kind: 'join' | 'offer' | 'answer' | 'ice'
    from: string
    to: string
    data?: RTCSessionDescriptionInit | RTCIceCandidateInit
}

export const TEACHER_ID = 'teacher'

const rtcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const MAX_BITRATE = 1_500_000

type CropTargetApi = { fromElement(element: Element): Promise<unknown> }
type CroppableTrack = MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> }

export function canShareGameFrame() {
    const cropTarget = (window as unknown as { CropTarget?: CropTargetApi }).CropTarget
    return Boolean(cropTarget && 'getDisplayMedia' in (navigator.mediaDevices ?? {}) && typeof window.RTCPeerConnection === 'function')
}

class PendingCandidates {
    private queue: RTCIceCandidateInit[] = []
    constructor(private connection: RTCPeerConnection) {}

    async add(candidate: RTCIceCandidateInit) {
        if (!this.connection.remoteDescription) { this.queue.push(candidate); return }
        await this.connection.addIceCandidate(candidate).catch(() => undefined)
    }

    async flush() {
        const queued = this.queue
        this.queue = []
        for (const candidate of queued) await this.connection.addIceCandidate(candidate).catch(() => undefined)
    }
}

export class GamePublisher {
    private stream: MediaStream | null = null
    private peers = new Map<string, { connection: RTCPeerConnection; candidates: PendingCandidates }>()

    constructor(private send: (signal: GameSignal) => void, private onEnded: () => void) {}

    // Captures only the given element (Region Capture) from the current tab.
    async start(element: Element) {
        const cropTarget = await (window as unknown as { CropTarget: CropTargetApi }).CropTarget.fromElement(element)
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 20, max: 30 } },
            audio: false,
            preferCurrentTab: true,
        } as DisplayMediaStreamOptions)
        const track = stream.getVideoTracks()[0] as CroppableTrack
        try {
            if (!track?.cropTo) throw new Error('Region capture unavailable')
            await track.cropTo(cropTarget)
        } catch (error) {
            stream.getTracks().forEach((item) => item.stop())
            throw error
        }
        track.addEventListener('ended', () => { this.stop(); this.onEnded() })
        this.stream = stream
    }

    get active() { return this.stream !== null }

    async handle(signal: GameSignal) {
        if (!this.stream || signal.to !== TEACHER_ID) return
        if (signal.kind === 'join') return this.offerTo(signal.from)
        const peer = this.peers.get(signal.from)
        if (!peer) return
        if (signal.kind === 'answer' && signal.data) {
            await peer.connection.setRemoteDescription(signal.data as RTCSessionDescriptionInit).catch(() => undefined)
            await peer.candidates.flush()
        } else if (signal.kind === 'ice' && signal.data) {
            await peer.candidates.add(signal.data as RTCIceCandidateInit)
        }
    }

    private async offerTo(viewerId: string) {
        if (!this.stream) return
        this.closePeer(viewerId)
        const connection = new RTCPeerConnection(rtcConfig)
        this.peers.set(viewerId, { connection, candidates: new PendingCandidates(connection) })
        connection.onicecandidate = (event) => {
            if (event.candidate) this.send({ kind: 'ice', from: TEACHER_ID, to: viewerId, data: event.candidate.toJSON() })
        }
        connection.onconnectionstatechange = () => {
            if (connection.connectionState === 'failed' || connection.connectionState === 'closed') this.closePeer(viewerId, connection)
        }
        const stream = this.stream
        for (const track of stream.getTracks()) {
            const sender = connection.addTrack(track, stream)
            const parameters = sender.getParameters()
            if (parameters.encodings?.length) {
                parameters.encodings[0].maxBitrate = MAX_BITRATE
                await sender.setParameters(parameters).catch(() => undefined)
            }
        }
        const offer = await connection.createOffer()
        await connection.setLocalDescription(offer)
        this.send({ kind: 'offer', from: TEACHER_ID, to: viewerId, data: connection.localDescription?.toJSON() })
    }

    private closePeer(viewerId: string, only?: RTCPeerConnection) {
        const peer = this.peers.get(viewerId)
        if (!peer || (only && peer.connection !== only)) return
        peer.connection.close()
        this.peers.delete(viewerId)
    }

    stop() {
        this.peers.forEach((peer) => peer.connection.close())
        this.peers.clear()
        this.stream?.getTracks().forEach((track) => track.stop())
        this.stream = null
    }
}

export class GameViewer {
    private connection: RTCPeerConnection | null = null
    private candidates: PendingCandidates | null = null
    private retryTimer = 0
    private closed = false

    constructor(readonly id: string, private send: (signal: GameSignal) => void, private onStream: (stream: MediaStream | null) => void) {}

    join() {
        if (this.closed) return
        this.send({ kind: 'join', from: this.id, to: TEACHER_ID })
    }

    async handle(signal: GameSignal) {
        if (this.closed || signal.to !== this.id) return
        if (signal.kind === 'offer' && signal.data) {
            this.connection?.close()
            const connection = new RTCPeerConnection(rtcConfig)
            this.connection = connection
            this.candidates = new PendingCandidates(connection)
            connection.onicecandidate = (event) => {
                if (event.candidate) this.send({ kind: 'ice', from: this.id, to: TEACHER_ID, data: event.candidate.toJSON() })
            }
            connection.ontrack = (event) => this.onStream(event.streams[0] ?? new MediaStream([event.track]))
            connection.onconnectionstatechange = () => {
                if (connection !== this.connection) return
                if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
                    this.onStream(null)
                    window.clearTimeout(this.retryTimer)
                    this.retryTimer = window.setTimeout(() => this.join(), 2000)
                }
            }
            await connection.setRemoteDescription(signal.data as RTCSessionDescriptionInit)
            await this.candidates.flush()
            const answer = await connection.createAnswer()
            await connection.setLocalDescription(answer)
            this.send({ kind: 'answer', from: this.id, to: TEACHER_ID, data: connection.localDescription?.toJSON() })
        } else if (signal.kind === 'ice' && signal.data && this.candidates) {
            await this.candidates.add(signal.data as RTCIceCandidateInit)
        }
    }

    close() {
        this.closed = true
        window.clearTimeout(this.retryTimer)
        this.connection?.close()
        this.connection = null
        this.onStream(null)
    }
}
