"use client";

export type TimelineChapter = {
  id: string;
  label: string;
  title: string;
  summary?: string;
  active?: boolean;
  snapshotId?: string;
  canSelect?: boolean;
  canReplay?: boolean;
};

// V2.2 默认仍是纯展示；V2.3 只有调用方显式传 onSelect 时才开放历史节点读取。
export function Timeline({
  chapters,
  onSelect,
  selectedId,
}: {
  chapters: TimelineChapter[];
  onSelect?: (id: string) => void;
  selectedId?: string;
}) {
  return (
    <ol className="life-vn-timeline" aria-label="人生时间线">
      {chapters.map((chapter) => (
        <li
          className={`life-vn-tl-entry${chapter.active ? " active" : ""}${
            selectedId === (chapter.snapshotId ?? chapter.id) ? " selected" : ""
          }`}
          key={chapter.id}
          aria-current={chapter.active ? "step" : undefined}
        >
          {onSelect && chapter.canSelect !== false ? (
            <button
              type="button"
              className="life-vn-tl-button"
              onClick={() => onSelect(chapter.snapshotId ?? chapter.id)}
              aria-label={`查看${chapter.label}历史剧情`}
              aria-pressed={selectedId === (chapter.snapshotId ?? chapter.id)}
            >
              <small>{chapter.label}</small>
              <h3>{chapter.title}</h3>
              {chapter.summary && <p>{chapter.summary}</p>}
            </button>
          ) : (
            <div className="life-vn-tl-content">
              <small>{chapter.label}</small>
              <h3>{chapter.title}</h3>
              {chapter.summary && <p>{chapter.summary}</p>}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
