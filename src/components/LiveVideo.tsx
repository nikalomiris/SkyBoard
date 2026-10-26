import { useEffect, useRef } from 'react'

export default function LiveVideo({ stream, label }: { stream: MediaStream; label: string }) {
    const ref = useRef<HTMLVideoElement>(null)
    useEffect(() => {
        const video = ref.current
        if (!video) return
        video.srcObject = stream
        void video.play().catch(() => undefined)
    }, [stream])
    return <video ref={ref} className="board-web-video" aria-label={label} autoPlay muted playsInline disablePictureInPicture />
}
