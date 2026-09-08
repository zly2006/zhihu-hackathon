"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Chapter } from "@/lib/domain/chapter";
import type { DialogueBlock, DialogueScene } from "@/lib/domain/dialogue";
import type { GameMode } from "@/lib/domain/shared";
import type { WorldSnapshot } from "@/lib/domain/snapshot";
import { buildLifePresentation } from "@/lib/game/presentation";
import { findScene, pickSceneForNovelScene } from "@/lib/game/scene-catalog";
import { LifeShell } from "./LifeShell";
import { SceneStage } from "./SceneStage";
import { DialogueBox } from "./DialogueBox";
import { StatusHUD } from "./StatusHUD";
import { NovelReader } from "@/components/life/NovelReader";

function fallbackDialogueScenes(novel: NonNullable<Chapter["novel"]>): DialogueScene[] {
  return novel.scenes.map((scene) => ({
    id: scene.id,
    background: pickSceneForNovelScene(scene).id,
    timeLabel: scene.timeLabel,
    characters: [],
    blocks: [{ type: "narration" as const, text: scene.text }],
    choices: [],
  }));
}

function protagonistCharacter(snapshot: WorldSnapshot, avatarUrl: string | null) {
  const hero = snapshot.worldState.characters[snapshot.worldState.protagonistId];
  if (!hero) return undefined;
  return {
    id: hero.id,
    name: hero.identity.name,
    ...(avatarUrl ? { avatarUrl } : {}),
    position: "center" as const,
    emotion: hero.emotionState || "平静",
  };
}

function blockText(block: DialogueBlock | undefined): string {
  return block?.text ?? "";
}

export function SnapshotViewer({
  snapshot,
  presentationMode,
  timeline,
  onBack,
  onRestart,
}: {
  snapshot: WorldSnapshot;
  presentationMode: GameMode;
  timeline?: ReactNode;
  onBack: () => void;
  onRestart?: () => void;
}) {
  const chapter = snapshot.chapterId ? snapshot.chapterContent[snapshot.chapterId] : undefined;
  const events = chapter
    ? chapter.simulationEventIds
        .map((id) => snapshot.events[id])
        .filter((event): event is NonNullable<typeof event> => Boolean(event))
    : [];
  const presentation = useMemo(
    () => buildLifePresentation({ world: snapshot.worldState, chapter, chapterEvents: events }),
    [chapter, events, snapshot.worldState],
  );
  const hero = snapshot.worldState.characters[snapshot.worldState.protagonistId];
  const hud = (
    <StatusHUD
      presentation={presentation.protagonist}
      goals={hero?.state.currentGoals ?? []}
      dilemmas={hero?.state.currentDilemmas ?? []}
      relationships={presentation.relationships}
    />
  );
  const actions = (
    <div className="life-vn-snapshot-actions">
      <button type="button" className="life-vn-btn ghost" onClick={onBack}>
        ← 返回当前人生
      </button>
      {onRestart && snapshot.replayable && (
        <button type="button" className="life-vn-btn" onClick={onRestart}>
          从这里重新开始人生
        </button>
      )}
    </div>
  );
  const legacyNotice =
    snapshot.kind === "legacy-current" ? (
      <div className="life-vn-snapshot-legacy-notice">
        旧版存档只保存了章节内容；本页状态面板是当前存档投影，不能据此创建新分支。
      </div>
    ) : null;

  if (!chapter) {
    return (
      <LifeShell
        chapterLabel="历史回放 · 起点"
        title="人生起点"
        yearRange={`${snapshot.year} 年`}
        brandLabel="知乎 · 历史回放"
        left={timeline}
        right={hud}
        center={
          <div className="life-vn-snapshot-scroll">
            {actions}
            <section className="life-vn-card life-vn-snapshot-card">
              <span className="life-vn-pill">只读快照 · {snapshot.year}</span>
              <h2>从这里开始的人生</h2>
              <p>
                这是当前分支保存的最初状态。你可以返回当前人生，也可以从这个节点创建新的分支，之后的选择不会覆盖原来的时间线。
              </p>
            </section>
          </div>
        }
      />
    );
  }

  return (
    <SnapshotChapterViewer
      key={snapshot.id}
      snapshot={snapshot}
      chapter={chapter}
      events={events}
      presentationMode={presentationMode}
      presentation={presentation}
      hero={hero}
      hud={hud}
      legacyNotice={legacyNotice}
      timeline={timeline}
      actions={actions}
    />
  );
}

function SnapshotChapterViewer({
  snapshot,
  chapter,
  events,
  presentationMode,
  presentation,
  hero,
  hud,
  legacyNotice,
  timeline,
  actions,
}: {
  snapshot: WorldSnapshot;
  chapter: Chapter;
  events: Array<NonNullable<WorldSnapshot["events"][string]>>;
  presentationMode: GameMode;
  presentation: ReturnType<typeof buildLifePresentation>;
  hero: WorldSnapshot["worldState"]["characters"][string] | undefined;
  hud: ReactNode;
  legacyNotice: ReactNode;
  timeline?: ReactNode;
  actions: ReactNode;
}) {
  const scenes = useMemo(
    () => (chapter.dialogue?.length ? chapter.dialogue : chapter.novel ? fallbackDialogueScenes(chapter.novel) : []),
    [chapter.dialogue, chapter.novel],
  );
  const [sceneIndex, setSceneIndex] = useState(0);
  const [blockIndex, setBlockIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const activeScene = scenes[sceneIndex] ?? scenes[0];
  const activeBlock = activeScene?.blocks[blockIndex];
  const fallbackNovelScene = chapter.novel?.scenes[sceneIndex];
  const sceneDef = activeScene
    ? findScene(activeScene.background) ?? pickSceneForNovelScene(fallbackNovelScene ?? {})
    : pickSceneForNovelScene(fallbackNovelScene ?? {});
  const fallbackCharacter = protagonistCharacter(snapshot, presentation.protagonist.avatarUrl);

  function nextBlock() {
    if (!activeScene) return;
    if (blockIndex + 1 < activeScene.blocks.length) {
      setBlockIndex((index) => index + 1);
      return;
    }
    if (sceneIndex + 1 < scenes.length) {
      setSceneIndex((index) => index + 1);
      setBlockIndex(0);
      return;
    }
    setFinished(true);
  }

  const finishedCard = (
    <div className="life-vn-snapshot-scroll">
      {actions}
      <section className="life-vn-card life-vn-snapshot-card">
        <span className="life-vn-pill">历史节点 · 已读完</span>
        <h2>{chapter.novel?.title ?? "互动人生"}</h2>
        {legacyNotice}
        <p>{chapter.summary.keyEvents.join("；") || "本章故事已保存。"}</p>
        <div className="life-vn-snapshot-actions inline">
          <button type="button" className="life-vn-btn ghost" onClick={() => setFinished(false)}>
            返回剧情
          </button>
        </div>
      </section>
    </div>
  );

  const dialogueCenter = finished ? (
    finishedCard
  ) : (
    <div style={{ position: "absolute", inset: 0 }}>
      <div className="life-vn-snapshot-stage-actions">
        {actions}
        {legacyNotice}
      </div>
      <SceneStage
        key={activeScene?.id ?? sceneDef.id}
        scene={sceneDef}
        meta={activeScene?.timeLabel ?? `${chapter.startYear} 年`}
        characters={activeScene?.characters}
        activeCharacterId={activeBlock?.type === "dialogue" ? activeBlock.speakerId : null}
        fallbackCharacter={fallbackCharacter}
        children={
          <DialogueBox
            speaker={activeBlock?.type === "dialogue" ? activeBlock.speaker : activeBlock?.type === "choice" ? "本章提示" : undefined}
            copy={blockText(activeBlock)}
            options={
              activeBlock?.type === "choice"
                ? activeBlock.choices.map((choice) => ({ id: choice.id, label: choice.label, disabled: true }))
                : undefined
            }
            onContinue={nextBlock}
            continueLabel={
              sceneIndex + 1 < scenes.length || (activeScene && blockIndex + 1 < activeScene.blocks.length)
                ? "继续剧情"
                : "读完本章"
            }
            children={
              <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="life-vn-pill">
                  {String(sceneIndex + 1).padStart(2, "0")}/{String(scenes.length).padStart(2, "0")} · {sceneDef.label}
                </span>
                {activeBlock?.type === "dialogue" && <span className="life-vn-pill">{activeBlock.emotion}</span>}
                {activeBlock?.type === "choice" && <span className="life-vn-pill">历史选择 · 仅展示</span>}
              </div>
            }
          />
        }
      />
    </div>
  );

  const novelCenter = chapter.novel ? (
    <div className="life-vn-snapshot-scroll">
      {actions}
      {legacyNotice}
      <NovelReader novel={chapter.novel} onRegenerate={() => undefined} regenerating={false} showRegenerate={false} />
      <section className="life-vn-card life-vn-snapshot-summary">
        <span className="life-vn-pill">本章已保存</span>
        <p>{chapter.summary.keyEvents.join("；") || "本章故事已保存。"}</p>
      </section>
    </div>
  ) : (
    <div className="life-vn-snapshot-scroll">
      {actions}
      {legacyNotice}
      <section className="life-vn-card life-vn-snapshot-card">
        <span className="life-vn-pill">互动人生 · 只读快照</span>
        <h2>本章互动内容</h2>
        <p>{chapter.summary.keyEvents.join("；") || "本章故事已保存。"}</p>
      </section>
    </div>
  );

  return (
    <LifeShell
      chapterLabel={`历史回放 · Chapter ${String(chapter.index + 1).padStart(2, "0")}`}
      title={chapter.novel?.title ?? "互动人生"}
      yearRange={`${chapter.startYear} → ${chapter.endYear}`}
      brandLabel="知乎 · 历史回放"
      left={timeline}
      right={hud}
      center={presentationMode === "novel" ? novelCenter : dialogueCenter}
    />
  );
}
