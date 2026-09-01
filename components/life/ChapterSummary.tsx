"use client";

import { useMemo, useState } from "react";
import type { Chapter, DecisionResolution } from "@/lib/domain/chapter";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { LifeExperience } from "@/lib/domain/experience";
import type { WorldState } from "@/lib/domain/world";
import { buildLifePresentation } from "@/lib/game/presentation";
import { pickSceneForNovelScene } from "@/lib/game/scene-catalog";
import { LifeShell } from "@/components/life-vn/LifeShell";
import { SceneStage } from "@/components/life-vn/SceneStage";
import { DialogueBox } from "@/components/life-vn/DialogueBox";
import { PlayerHud } from "@/components/life-vn/PlayerHud";
import { RelationshipHud } from "@/components/life-vn/RelationshipHud";
import { ChapterResult } from "@/components/life-vn/ChapterResult";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function ChapterSummary({
  chapter,
  events,
  resolution,
  evidence,
  evidenceTotal,
  onRegenerate,
  onNextChapter,
  regenerating,
  world,
  pastChapters,
}: {
  chapter: Chapter;
  events: SimulationEvent[];
  resolution: DecisionResolution;
  evidence: LifeExperience[];
  evidenceTotal: number;
  onRegenerate: () => void;
  onNextChapter: () => void;
  regenerating: boolean;
  world: WorldState;
  pastChapters: Chapter[];
}) {
  const [mode, setMode] = useState<"novel" | "result">("novel");
  const [sceneIndex, setSceneIndex] = useState(0);

  const scenes = chapter.novel.scenes;
  const scene = scenes[sceneIndex];
  const sceneDef = pickSceneForNovelScene({
    timeLabel: scene?.timeLabel,
    heading: scene?.heading,
    text: scene?.text,
  });

  const presentation = useMemo(
    () => buildLifePresentation({ world, chapter, chapterEvents: events, sceneIndex }),
    [world, chapter, events, sceneIndex],
  );

  const protagonist = world.characters[world.protagonistId];
  const hudContent = (
    <>
      <PlayerHud
        presentation={presentation.protagonist}
        goals={protagonist?.state.currentGoals ?? []}
        dilemmas={protagonist?.state.currentDilemmas ?? []}
      />
      <RelationshipHud relationships={presentation.relationships} />
    </>
  );

  const timelineContent = (
    <div className="life-vn-timeline">
      {pastChapters.map((past) => (
        <div className="life-vn-tl-entry" key={past.id}>
          <small>
            第 {pad(past.index + 1)} 章 · {past.startYear}—{past.endYear}
          </small>
          <h3>{past.novel.title}</h3>
          <p>{past.summary.keyEvents.slice(0, 2).join("；")}</p>
        </div>
      ))}
      <div className="life-vn-tl-entry active">
        <small>
          第 {pad(chapter.index + 1)} 章 · {chapter.startYear}—{chapter.endYear}
        </small>
        <h3>{chapter.novel.title}</h3>
        <p>本章 · 正在结算</p>
      </div>
    </div>
  );

  function nextScene() {
    if (sceneIndex + 1 < scenes.length) {
      setSceneIndex((index) => index + 1);
    } else {
      setMode("result");
    }
  }

  const center =
    mode === "novel" ? (
      <SceneStage
        scene={sceneDef}
        meta={scene?.timeLabel ?? `${chapter.startYear} 年`}
        portraitUrl={presentation.protagonist.avatarUrl}
        children={
          <DialogueBox
            copy={scene?.text ?? ""}
            speaker={undefined}
            onContinue={nextScene}
            continueLabel={sceneIndex + 1 < scenes.length ? "继续剧情" : "查看本章结算"}
            children={
              sceneIndex + 1 < scenes.length ? (
                <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="life-vn-pill">
                    {pad(sceneIndex + 1)}/{pad(scenes.length)} · {sceneDef.label}
                  </span>
                  {scene?.heading && <span className="life-vn-pill">{scene.heading}</span>}
                </div>
              ) : undefined
            }
          />
        }
      />
    ) : (
      <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button type="button" className="life-vn-btn ghost" onClick={() => setMode("novel")}>
            ← 返回阅读本章
          </button>
        </div>
        <ChapterResult
          events={events}
          outcomeAnchor={resolution.outcomeAnchor}
          effectiveRisk={resolution.effectiveRisk}
          summary={chapter.summary}
          evidence={evidence}
          evidenceTotal={evidenceTotal}
          onRegenerate={onRegenerate}
          onNextChapter={onNextChapter}
          regenerating={regenerating}
        />
      </div>
    );

  return (
    <LifeShell
      chapterLabel={`Chapter ${pad(chapter.index + 1)}`}
      title={chapter.novel.title}
      yearRange={`${chapter.startYear} → ${chapter.endYear}`}
      left={timelineContent}
      right={hudContent}
      center={center}
      sheet={hudContent}
    />
  );
}
