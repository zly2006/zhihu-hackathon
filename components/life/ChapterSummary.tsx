"use client";

import { useMemo, useState } from "react";
import type { Chapter, DecisionResolution, NovelScene } from "@/lib/domain/chapter";
import type { DialogueBlock, DialogueScene } from "@/lib/domain/dialogue";
import type { GameMode } from "@/lib/domain/shared";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { LifeExperience } from "@/lib/domain/experience";
import type { WorldState } from "@/lib/domain/world";
import { buildLifePresentation } from "@/lib/game/presentation";
import { findScene, pickSceneForNovelScene } from "@/lib/game/scene-catalog";
import { LifeShell } from "@/components/life-vn/LifeShell";
import { SceneStage } from "@/components/life-vn/SceneStage";
import { DialogueBox } from "@/components/life-vn/DialogueBox";
import { Timeline, type TimelineChapter } from "@/components/life-vn/Timeline";
import { StatusHUD } from "@/components/life-vn/StatusHUD";
import { ChapterResult } from "@/components/life-vn/ChapterResult";
import { NovelReader } from "./NovelReader";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function fallbackDialogueScenes(scenes: NovelScene[]): DialogueScene[] {
  return scenes.map((scene) => ({
    id: scene.id,
    background: pickSceneForNovelScene(scene).id,
    timeLabel: scene.timeLabel,
    characters: [],
    blocks: [{ type: "narration", text: scene.text }],
    choices: [],
  }));
}

function activeBlockText(block: DialogueBlock | undefined): string {
  return block?.text ?? "";
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
  timelineItems,
  onTimelineSelect,
  presentationMode = "galgame",
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
  timelineItems?: TimelineChapter[];
  onTimelineSelect?: (id: string) => void;
  presentationMode?: GameMode;
}) {
  const [viewMode, setViewMode] = useState<"dialogue" | "result">("dialogue");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [blockIndex, setBlockIndex] = useState(0);

  const scenes = useMemo(
    () => (chapter.dialogue?.length ? chapter.dialogue : fallbackDialogueScenes(chapter.novel.scenes)),
    [chapter.dialogue, chapter.novel.scenes],
  );
  const activeDialogueScene = scenes[sceneIndex] ?? scenes[0];
  const activeBlock = activeDialogueScene?.blocks[blockIndex];
  const fallbackNovelScene = chapter.novel.scenes[sceneIndex];
  const sceneDef = activeDialogueScene
    ? findScene(activeDialogueScene.background) ?? pickSceneForNovelScene(fallbackNovelScene ?? {})
    : pickSceneForNovelScene(fallbackNovelScene ?? {});

  const presentation = useMemo(
    () => buildLifePresentation({ world, chapter, chapterEvents: events, sceneIndex }),
    [world, chapter, events, sceneIndex],
  );

  const protagonist = world.characters[world.protagonistId];
  const protagonistCharacter = protagonist
    ? {
        id: protagonist.id,
        name: protagonist.identity.name,
        ...(presentation.protagonist.avatarUrl ? { avatarUrl: presentation.protagonist.avatarUrl } : {}),
        position: "center" as const,
        emotion: protagonist.emotionState || "平静",
      }
    : undefined;
  const hudContent = (
    <StatusHUD
      presentation={presentation.protagonist}
      goals={protagonist?.state.currentGoals ?? []}
      dilemmas={protagonist?.state.currentDilemmas ?? []}
      relationships={presentation.relationships}
    />
  );

  const timelineContent = (
    <Timeline
      chapters={
        timelineItems ?? [
          ...pastChapters
            .filter((past) => past.id !== chapter.id)
            .map((past) => ({
              id: past.id,
              label: `第 ${pad(past.index + 1)} 章 · ${past.startYear}—${past.endYear}`,
              title: past.novel.title,
              summary: past.summary.keyEvents.slice(0, 2).join("；"),
            })),
          {
            id: chapter.id,
            label: `第 ${pad(chapter.index + 1)} 章 · ${chapter.startYear}—${chapter.endYear}`,
            title: chapter.novel.title,
            summary: "本章 · 正在结算",
            active: true,
          },
        ]
      }
      onSelect={onTimelineSelect}
    />
  );

  function nextDialogueBlock() {
    if (!activeDialogueScene) return;
    if (blockIndex + 1 < activeDialogueScene.blocks.length) {
      setBlockIndex((index) => index + 1);
      return;
    }
    if (sceneIndex + 1 < scenes.length) {
      setSceneIndex((index) => index + 1);
      setBlockIndex(0);
      return;
    }
    setViewMode("result");
  }

  function returnToDialogue() {
    setSceneIndex(0);
    setBlockIndex(0);
    setViewMode("dialogue");
  }

  function blockSpeaker(): string | undefined {
    return activeBlock?.type === "dialogue"
      ? activeBlock.speaker
      : activeBlock?.type === "choice"
        ? "本章提示"
        : undefined;
  }

  const galgameCenter = (
    <SceneStage
      key={activeDialogueScene?.id ?? sceneDef.id}
      scene={sceneDef}
      meta={activeDialogueScene?.timeLabel ?? `${chapter.startYear} 年`}
      characters={activeDialogueScene?.characters}
      activeCharacterId={activeBlock?.type === "dialogue" ? activeBlock.speakerId : null}
      fallbackCharacter={protagonistCharacter}
      children={
        <DialogueBox
          speaker={blockSpeaker()}
          copy={activeBlockText(activeBlock)}
          options={
            activeBlock?.type === "choice"
              ? activeBlock.choices.map((choice) => ({ id: choice.id, label: choice.label, disabled: true }))
              : undefined
          }
          onContinue={nextDialogueBlock}
          continueLabel={
            sceneIndex + 1 < scenes.length || (activeDialogueScene && blockIndex + 1 < activeDialogueScene.blocks.length)
              ? "继续剧情"
              : "查看本章结算"
          }
          children={
            <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="life-vn-pill">
                {pad(sceneIndex + 1)}/{pad(scenes.length)} · {sceneDef.label}
              </span>
              {activeBlock?.type === "dialogue" && <span className="life-vn-pill">{activeBlock.emotion}</span>}
              {activeBlock?.type === "choice" && <span className="life-vn-pill">本 Sprint 仅展示</span>}
            </div>
          }
        />
      }
    />
  );

  const resultCenter = (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" className="life-vn-btn ghost" onClick={returnToDialogue}>
          ← 返回互动剧情
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
        theme={chapter.narrative?.plan.theme}
        mainConflict={chapter.narrative?.plan.mainConflict}
        directorBrief={chapter.narrative?.plan.directorBrief}
        directorFocusName={
          chapter.narrative?.plan.directorBrief
            ? world.characters[chapter.narrative.plan.directorBrief.focusCharacterId]?.identity.name
            : undefined
        }
      />
    </div>
  );

  const novelCenter = (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: 18 }}>
      <NovelReader
        novel={chapter.novel}
        onRegenerate={onRegenerate}
        regenerating={regenerating}
        showRegenerate={false}
      />
      <div style={{ marginTop: 24 }}>
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
          theme={chapter.narrative?.plan.theme}
          mainConflict={chapter.narrative?.plan.mainConflict}
          directorBrief={chapter.narrative?.plan.directorBrief}
          directorFocusName={
            chapter.narrative?.plan.directorBrief
              ? world.characters[chapter.narrative.plan.directorBrief.focusCharacterId]?.identity.name
              : undefined
          }
          showRegenerate={false}
        />
      </div>
    </div>
  );

  const center =
    presentationMode === "novel"
      ? novelCenter
      : viewMode === "dialogue"
        ? galgameCenter
        : resultCenter;

  return (
    <LifeShell
      chapterLabel={`Chapter ${pad(chapter.index + 1)}`}
      title={chapter.novel.title}
      yearRange={`${chapter.startYear} → ${chapter.endYear}`}
      brandLabel={presentationMode === "novel" ? "知乎 · 人生小说" : "知乎 · 互动人生小说"}
      left={timelineContent}
      right={hudContent}
      center={center}
      sheet={hudContent}
    />
  );
}
