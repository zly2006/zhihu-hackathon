"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameSave } from "@/lib/domain/chapter";
import type { ScenePackage, SceneRuntimeState } from "@/lib/domain/scene";
import type { ZhaoLengGenerationMode } from "@/lib/domain/zhao-leng-runtime";
import { canObserveZhaoLengLibraryCard, deriveZhaoLengFacts, evaluateZhaoLengHidden } from "@/lib/game/zhao-leng-progress";
import { getZhaoLengRelationship, ZHAO_LENG_SAVE_KEYS } from "@/lib/game/zhao-leng-demo";
import { serializeSceneSave } from "@/lib/game/scene-save";
import {
  DEFAULT_SCENE_READING_PREFERENCES,
  normalizeSceneReadingPreferences,
  type SceneReadingPreferences,
} from "@/lib/game/scene-reading";
import { resolveZhaoLengBoundary } from "@/lib/game/zhao-leng-flow";
import { ZHAO_LENG_BEAT_SCRIPTS } from "@/lib/narrative/zhao-leng-script";
import { LifeShell } from "@/components/life-vn/LifeShell";
import { SceneReadingLog, SceneReadingTools } from "@/components/life-vn/SceneReadingTools";
import { StoryPlayer } from "@/components/life-vn/StoryPlayer";
import { useZhaoLengFlow } from "./use-zhao-leng-flow";

const SCENE_READING_PREFERENCES_KEY = "restart-life-reading-preferences-v1";

function readError(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
  }
  return "请求失败";
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(readError(payload));
  return payload as T;
}

function storedSave(mode: ZhaoLengGenerationMode): GameSave | undefined {
  try {
    const raw = window.localStorage.getItem(ZHAO_LENG_SAVE_KEYS[mode]);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as GameSave;
    if (parsed?.zhaoLeng?.generationMode !== mode) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function persistSave(save: GameSave): void {
  const mode = save.zhaoLeng?.generationMode;
  if (!mode) return;
  window.localStorage.setItem(ZHAO_LENG_SAVE_KEYS[mode], serializeSceneSave(save));
}

export function ZhaoLengCompletion({ endingId }: { endingId?: string }) {
  return (
    <div className="life-vn-ending-screen" role="status" aria-label="赵冷结局完成">
      <span className="life-vn-tool-kicker">STORY COMPLETE</span>
      <h2>这一段故事已经走到结尾</h2>
      <p>你已经读完赵冷 Demo 的全部回应。关系结算与隐藏事件已保存，本页不会自动重新开始。</p>
      {endingId && <div className="life-vn-ending-screen-id">结局 · {endingId}</div>}
      <small>如要探索另一条路径，请从阅读菜单选择“重新开始”。</small>
    </div>
  );
}

export function ZhaoLengDemo() {
  const [save, setSave] = useState<GameSave | null>(null);
  const saveRef = useRef<GameSave | null>(null);
  const [mode, setMode] = useState<ZhaoLengGenerationMode>("scripted");
  const [resumeModes, setResumeModes] = useState<ZhaoLengGenerationMode[]>([]);
  const [startBusy, setStartBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingSave, setPendingSave] = useState<GameSave | null>(null);
  const pendingSaveRef = useRef<GameSave | null>(null);
  const [readingPreferences, setReadingPreferences] = useState<SceneReadingPreferences>(DEFAULT_SCENE_READING_PREFERENCES);
  const [readingLogOpen, setReadingLogOpen] = useState(false);
  const [readingSheetOpen, setReadingSheetOpen] = useState(false);
  const [pauseAfterReadingLog, setPauseAfterReadingLog] = useState(false);

  useEffect(() => {
    const available = (["scripted", "llm"] as const).filter((candidate) => Boolean(storedSave(candidate)));
    setResumeModes([...available]);
    if (available.includes("scripted")) setMode("scripted");
    else if (available.includes("llm")) setMode("llm");
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SCENE_READING_PREFERENCES_KEY);
      if (raw) setReadingPreferences(normalizeSceneReadingPreferences(JSON.parse(raw)));
    } catch {
      setReadingPreferences(DEFAULT_SCENE_READING_PREFERENCES);
    }
  }, []);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    const win = window as unknown as Record<string, unknown>;
    win.render_game_to_text = () => {
      const current = saveRef.current;
      const relation = current ? getZhaoLengRelationship(current) : undefined;
      return JSON.stringify({
        screen: current ? "zhao-leng-demo" : "zhao-leng-entry",
        mode: current?.zhaoLeng?.generationMode ?? mode,
        beatId: current?.zhaoLeng?.beatId ?? null,
        stage: current?.zhaoLeng?.stage ?? null,
        runtimeStatus: current?.sceneRuntime?.status ?? null,
        endingId: current?.zhaoLeng?.endingId ?? null,
        readingEntries: current?.sceneReading?.entries.length ?? 0,
        pendingSave: Boolean(pendingSaveRef.current),
        pendingCommand: current?.sceneFlow?.pendingCommand?.type ?? null,
        scores: relation?.scores ?? null,
        error,
      });
    };
    return () => {
      if (win.render_game_to_text) delete win.render_game_to_text;
    };
  }, [error, mode]);

  const publishSave = useCallback((next: GameSave, options: { allowPending?: boolean } = {}) => {
    if (pendingSaveRef.current && !options.allowPending) {
      setError("上一笔存档还没有写入成功，请先重试保存。");
      return false;
    }
    saveRef.current = next;
    setSave(next);
    try {
      persistSave(next);
      pendingSaveRef.current = null;
      setPendingSave(null);
      setError("");
      return true;
    } catch {
      pendingSaveRef.current = next;
      setPendingSave(next);
      setError("浏览器存档写入失败；最近成功结果只保留在当前页面，请重试保存。");
      return false;
    }
  }, []);

  const activePackage = useMemo(() => {
    if (!save?.sceneRuntime) return undefined;
    const packageItem = save.scenePackages?.[save.sceneRuntime.chapterId];
    return packageItem?.id === save.sceneRuntime.packageId && packageItem.version === save.sceneRuntime.packageVersion
      ? packageItem
      : save.zhaoLeng?.packagesById[save.sceneRuntime.packageId];
  }, [save]);

  const flow = useZhaoLengFlow({
    saveRef,
    activePackage,
    publishSave,
    postJson: (url, body) => postJson<unknown>(url, body),
    onError: setError,
  });

  const updateReadingPreferences = useCallback((next: SceneReadingPreferences) => {
    const normalized = normalizeSceneReadingPreferences(next);
    setReadingPreferences(normalized);
    try {
      window.localStorage.setItem(SCENE_READING_PREFERENCES_KEY, JSON.stringify(normalized));
    } catch {
      // 阅读偏好不可写时继续使用当前页面的内存值，不影响游戏存档。
    }
  }, []);

  const start = useCallback(async (nextMode: ZhaoLengGenerationMode, continueExisting: boolean) => {
    flow.invalidateSession();
    setStartBusy(true);
    setError("");
    try {
      const candidate = continueExisting ? storedSave(nextMode) : undefined;
      const result = await postJson<{ gameSave: GameSave; scenePackage: ScenePackage; reused: boolean }>("/api/life/zhao-leng", {
        mode: nextMode,
        ...(candidate ? { save: candidate } : {}),
        currentYear: new Date().getFullYear(),
      });
      const saved = publishSave(result.gameSave);
      setMode(result.gameSave.zhaoLeng?.generationMode ?? nextMode);
      if (saved) await flow.refreshNarrative(result.gameSave, "demo-entry");
    } catch (err) {
      setError(err instanceof Error ? err.message : "赵冷 Demo 启动失败");
    } finally {
      setStartBusy(false);
    }
  }, [flow, publishSave]);

  const retrySave = useCallback(() => {
    const candidate = pendingSaveRef.current;
    if (candidate) publishSave(candidate, { allowPending: true });
  }, [publishSave]);

  const handleReadingLogOpen = useCallback(() => {
    setPauseAfterReadingLog(true);
    setReadingLogOpen(true);
  }, []);
  const handleReadingLogClose = useCallback(() => setReadingLogOpen(false), []);
  const handlePlaybackModeChange = useCallback((nextMode: SceneRuntimeState["playbackMode"]) => {
    if (nextMode === "auto") setPauseAfterReadingLog(false);
  }, []);

  const restart = useCallback(() => {
    void start(mode, false);
  }, [mode, start]);

  if (!save || !activePackage || !save.sceneRuntime) {
    return (
      <div className="life-vn" style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
        <div className="life-vn-card" style={{ maxWidth: 620, width: "100%", padding: 34 }}>
          <div className="life-vn-pill">赵冷 · 成人关系 Demo</div>
          <h1 className="life-vn-title" style={{ fontSize: 30, marginTop: 16 }}>十二节拍，三种收束</h1>
          <p className="life-vn-sub">固定剧本用于稳定验收；AI 模式只生成对白与旁白，选择后果仍由服务端规则结算。</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "22px 0" }} role="group" aria-label="生成模式">
            <button type="button" className={mode === "scripted" ? "life-vn-btn" : "life-vn-btn ghost"} onClick={() => setMode("scripted")} disabled={startBusy}>固定剧本</button>
            <button type="button" className={mode === "llm" ? "life-vn-btn" : "life-vn-btn ghost"} onClick={() => setMode("llm")} disabled={startBusy}>AI 写作</button>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <button type="button" className="life-vn-btn" onClick={() => void start(mode, false)} disabled={startBusy}>
              {startBusy ? "正在准备…" : "开始赵冷 Demo"}
            </button>
            {resumeModes.includes(mode) && (
              <button type="button" className="life-vn-btn ghost" onClick={() => void start(mode, true)} disabled={startBusy}>
                继续 {mode === "llm" ? "AI" : "固定剧本"} 存档
              </button>
            )}
            <a className="life-vn-btn ghost" href="/life" style={{ textAlign: "center", textDecoration: "none" }}>返回主游戏</a>
          </div>
          {error && <div className="life-vn-error" style={{ marginTop: 16 }} role="alert">{error}</div>}
        </div>
      </div>
    );
  }

  const relation = getZhaoLengRelationship(save);
  const facts = deriveZhaoLengFacts(save);
  const hidden = evaluateZhaoLengHidden(save);
  const currentBeatIndex = ZHAO_LENG_BEAT_SCRIPTS.findIndex((beat) => beat.id === save.zhaoLeng?.beatId);
  const runtime = save.sceneRuntime;
  const canObserveCard = canObserveZhaoLengLibraryCard(save);
  const boundary = runtime.status === "completed"
    ? resolveZhaoLengBoundary({ save, completedRuntime: runtime })
    : { kind: "none" as const };
  const pendingCommand = save.sceneFlow?.pendingCommand;
  const interactionDisabled = Boolean(pendingSave) || flow.busy || Boolean(pendingCommand);
  const commandDisabled = Boolean(pendingSave) || flow.busy;
  const autoPaused = readingLogOpen || readingSheetOpen || pauseAfterReadingLog;

  return (
    <LifeShell
      chapterLabel="赵冷 · 成人关系 Demo"
      title={ZHAO_LENG_BEAT_SCRIPTS[currentBeatIndex]?.title ?? "剧情现场"}
      yearRange={`${save.worldState.currentYear} 年 · ${save.zhaoLeng?.generationMode === "llm" ? "AI 写作" : "固定剧本"}`}
      brandLabel="赵冷 Demo · Restart Life"
      onBrandClick={() => { window.location.href = "/life"; }}
      left={
        <div style={{ display: "grid", gap: 8 }}>
          <div className="life-vn-pill">{save.zhaoLeng?.completedBeatIds.length ?? 0} / 12 节拍完成</div>
          {ZHAO_LENG_BEAT_SCRIPTS.map((beat, index) => {
            const done = save.zhaoLeng?.completedBeatIds.includes(beat.id);
            const active = beat.id === save.zhaoLeng?.beatId;
            return <div key={beat.id} style={{ padding: "8px 10px", borderRadius: 8, background: active ? "var(--lv-gold-soft)" : done ? "rgba(96, 142, 106, .12)" : "transparent", color: active ? "var(--lv-ink)" : "var(--lv-muted)" }}><small>{String(index + 1).padStart(2, "0")}</small> {beat.title}{done ? " ✓" : active ? " · 当前" : ""}</div>;
          })}
        </div>
      }
      right={
        <div style={{ display: "grid", gap: 16 }}>
          <section><b>公开关系</b><p style={{ margin: "8px 0 0", color: "var(--lv-muted)", fontSize: 12 }}>{relation.publicSummary}</p></section>
          <section style={{ display: "grid", gap: 8 }}>
            {(["closeness", "trust", "conflict", "commitment"] as const).map((key) => <div key={key}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>{{ closeness: "亲近", trust: "信任", conflict: "冲突", commitment: "承诺" }[key]}</span><b>{relation.scores[key]}</b></div><div style={{ height: 5, background: "rgba(75, 56, 39, .12)", borderRadius: 99, overflow: "hidden" }}><i style={{ display: "block", width: `${relation.scores[key]}%`, height: "100%", background: key === "conflict" ? "#bd6d60" : "var(--lv-gold-strong)" }} /></div></div>)}
          </section>
          <p style={{ margin: 0, color: "var(--lv-muted)", fontSize: 12 }}>当前倾向：{facts.relationshipIntent === "undecided" ? "尚未决定" : facts.relationshipIntent === "together" ? "尝试继续" : facts.relationshipIntent === "friends" ? "保留朋友关系" : "各自向前"}</p>
        </div>
      }
      center={
        <div style={{ position: "absolute", inset: 0 }}>
          {save.zhaoLeng?.stage === "ended" ? (
            <ZhaoLengCompletion endingId={save.zhaoLeng.endingId} />
          ) : (
            <StoryPlayer
              key={`${activePackage.id}:v${activePackage.version}`}
              scenePackage={activePackage}
              initialState={runtime}
              projection={{
                ...projectGameSaveForPlayer(save, runtime),
              }}
              flowPolicy="seamless"
            readingPreferences={readingPreferences}
            autoPaused={autoPaused}
            observationWindow={canObserveCard}
            interactionDisabled={interactionDisabled}
              onSelect={flow.onSelect}
              onPersistPosition={flow.onPersistPosition}
              onBlockRead={flow.onBlockRead}
              onBoundary={flow.onBoundary}
              onPlaybackModeChange={handlePlaybackModeChange}
            />
          )}
          <div className="life-vn-zhao-overlay">
            {canObserveCard && <button type="button" className="life-vn-btn ghost" onClick={() => void flow.runCommand("observe_library_card", "button")} disabled={commandDisabled || Boolean(pendingCommand)}>查看旧借阅卡</button>}
            {boundary.kind === "decision" && (
              <div className="life-vn-boundary-decision" role="group" aria-label="结局选择">
                <span>这封信要不要打开？</span>
                <button type="button" className="life-vn-btn" onClick={() => flow.chooseBoundary("open_hidden")} disabled={commandDisabled}>打开隐藏来信</button>
                <button type="button" className="life-vn-btn ghost" onClick={() => flow.chooseBoundary("finish_normal")} disabled={commandDisabled}>在这里告别</button>
              </div>
            )}
            {pendingCommand && <div className="life-vn-flow-status" role="status"><span>{pendingCommand.type === "advance_beat" && flow.preparing ? "正在准备下一节拍…" : "故事已经读到边界，正在继续。"}</span><button type="button" className="life-vn-btn ghost" onClick={flow.retryPendingCommand} disabled={commandDisabled || flow.preparing}>重试继续</button></div>}
            {flow.prepareError && !pendingCommand && <div className="life-vn-flow-status life-vn-flow-status--warning" role="alert"><span>下一节拍准备失败：{flow.prepareError}</span><button type="button" className="life-vn-btn ghost" onClick={() => { const current = saveRef.current; if (current) void flow.prepareNextBeat(current).catch(() => undefined); }}>重试准备</button></div>}
            {pendingSave && <div className="life-vn-flow-status life-vn-flow-status--warning" role="alert"><span>最近结果尚未写入浏览器存档。</span><button type="button" className="life-vn-btn ghost" onClick={retrySave}>重试保存</button></div>}
            {error && <div className="life-vn-error" role="alert">{error}</div>}
          </div>
          <SceneReadingLog open={readingLogOpen} entries={save.sceneReading?.entries ?? []} onClose={handleReadingLogClose} />
        </div>
      }
      dockItems={[{ id: "reading", label: "阅读", sub: "R" }]}
      onSheetOpenChange={setReadingSheetOpen}
      sheet={
        <div style={{ display: "grid", gap: 16 }}>
          <SceneReadingTools
            entries={save.sceneReading?.entries ?? []}
            preferences={readingPreferences}
            onOpenRecords={handleReadingLogOpen}
            onChangePreferences={updateReadingPreferences}
          />
          <section className="life-vn-save-tools">
            <b>存档</b>
            <p style={{ margin: "6px 0 0", color: "var(--lv-muted)", fontSize: 12 }}>自动保存至本浏览器的 {save.zhaoLeng?.generationMode === "llm" ? "AI" : "固定剧本"} 独立存档。</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" className="life-vn-btn ghost" onClick={restart} disabled={commandDisabled || Boolean(pendingCommand)}>重新开始</button>
              <button type="button" className="life-vn-btn ghost" onClick={() => { const blob = new Blob([serializeSceneSave(save)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `zhao-leng-${save.zhaoLeng?.generationMode ?? mode}-save.json`; link.click(); URL.revokeObjectURL(link.href); }}>导出存档</button>
              {pendingSave && <button type="button" className="life-vn-btn" onClick={retrySave}>重试保存</button>}
            </div>
          </section>
          <div><b>当前运行时</b><p style={{ margin: "6px 0 0", color: "var(--lv-muted)", fontSize: 12 }}>{runtime.status} · revision {save.saveRevision ?? 0}</p></div>
          {save.zhaoLeng?.stage === "ended" && <p style={{ margin: 0, color: "var(--lv-gold-strong)" }}>本次结局已完成，可以重新开始探索其他路径。</p>}
        </div>
      }
    />
  );
}

function projectGameSaveForPlayer(save: GameSave, runtime: SceneRuntimeState) {
  return {
    worldState: save.worldState,
    chapters: save.chapters,
    events: save.events,
    experienceCache: save.experienceCache,
    activeBranchId: save.activeBranchId ?? runtime.branchId,
    runtime,
    actions: save.sceneActions ?? [],
    flags: save.sceneFlags ?? {},
    revision: save.saveRevision ?? 0,
    ...(save.zhaoLeng ? { zhaoLeng: save.zhaoLeng } : {}),
    ...(save.narrativeRuntime ? { narrativeRuntime: save.narrativeRuntime } : {}),
    ...(save.sceneReading ? { sceneReading: save.sceneReading } : {}),
    ...(save.sceneFlow ? { sceneFlow: save.sceneFlow } : {}),
    ...(save.storySession ? { storySession: save.storySession } : {}),
  };
}
