import type { Chapter } from "@/lib/domain/chapter";

type StreamingNovelPreviewProps = {
  title?: string;
  scenes: Chapter["novel"]["scenes"];
  loading?: boolean;
};

export function StreamingNovelPreview({ title, scenes, loading = false }: StreamingNovelPreviewProps) {
  if (!loading && scenes.length === 0) return null;
  return (
    <section className="life-vn-streaming-preview" aria-live="polite" aria-busy={loading}>
      <div className="life-vn-streaming-kicker">实时生成</div>
      <h3>{title?.trim() || "本章正在展开"}</h3>
      {scenes.map((scene, index) =>
        scene ? (
          <article className="life-vn-streaming-scene" key={scene.id || `scene-${index + 1}`}>
            <div className="life-vn-streaming-scene-meta">
              <span>Scene {index + 1}</span>
              {scene.timeLabel && <span>{scene.timeLabel}</span>}
            </div>
            {scene.heading && <div className="life-vn-streaming-scene-heading">{scene.heading}</div>}
            <p>{scene.text || "正在生成这一幕…"}</p>
          </article>
        ) : null,
      )}
      {loading && <div className="life-vn-streaming-status">下一幕正在赶来…</div>}
    </section>
  );
}
