type LessonThumbnailProps = { kind: string; tint: string }

export default function LessonThumbnail({ kind, tint }: LessonThumbnailProps) {
    return (
        <div className={`lesson-thumb ${kind}`} style={{ backgroundColor: tint }} aria-hidden="true">
            {kind === 'blends' ? <><span className="thumb-line short" /><span className="thumb-chip">sh</span><span className="thumb-chip peach">i</span><span className="thumb-chip green">p</span><span className="thumb-line" /></> :
                kind === 'safari' ? <><div className="thumb-sun" /><span className="thumb-word">syllables</span><div className="thumb-hills" /></> :
                    kind === 'magic' ? <><span className="thumb-letter">a</span><span className="thumb-arrow">→</span><span className="thumb-letter accent">ā</span><span className="thumb-star">✳</span></> :
                        <><span className="thumb-title">at</span><span className="thumb-chip">c</span><span className="thumb-chip peach">a</span><span className="thumb-chip green">t</span><span className="thumb-underline" /></>}
        </div>
    )
}
