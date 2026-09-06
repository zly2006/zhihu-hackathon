"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameSave } from "@/lib/domain/chapter";
import type { SceneChoiceResponse, ScenePackage, SceneRuntimeState } from "@/lib/domain/scene";
import type { ZhaoLengCommand, ZhaoLengGenerationMode } from "@/lib/domain/zhao-leng-runtime";
import { canObserveZhaoLengLibraryCard, evaluateZhaoLengHidden, deriveZhaoLengFacts } from "@/lib/game/zhao-leng-progress";
import { getZhaoLengRelationship, ZHAO_LENG_SAVE_KEYS } from "@/lib/game/zhao-leng-demo";
import { ZHAO_LENG_BEAT_SCRIPTS } from "@/lib/narrative/zhao-leng-script";
import { commitSceneChoice, mergeSceneProjection, projectGameSave, serializeSceneSave } from "@/lib/game/scene-save";
import { SceneRuntimePlayer } from "@/components/life-vn/SceneRuntimePlayer";
import { LifeShell } from "@/components/life-vn/LifeShell";

type StartResponse = { gameSave: GameSave; scenePackage: ScenePackage; reused: boolean };
type CommandResponse = { gameSave: GameSave; scenePackage?: ScenePackage; runtime: SceneRuntimeState; replayed: boolean };
type ExperienceResponse = { saveAfter: GameSave };

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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(readError(payload));
  return payload as T;
}

function requestId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

export function ZhaoLengDemo() {
  const [save, setSave] = useState<GameSave | null>(null);
  const saveRef = useRef<GameSave | null>(null);
  const [mode, setMode] = useState<ZhaoLengGenerationMode>("scripted");
  const [resumeModes, setResumeModes] = useState<ZhaoLengGenerationMode[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const available = (['scripted', 'llm'] as const).filter((candidate) => Boolean(storedSave(candidate)));
    setResumeModes([...available]);
    if (available.includes("scripted")) setMode("scripted");
    else if (available.includes("llm")) setMode("llm");
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
        scores: relation?.scores ?? null,
        error,
      });
    };
    return () => {
      if (win.render_game_to_text) delete win.render_game_to_text;
    };
  }, [error, mode]);

  const updateSave = useCallback((next: GameSave) => {
    saveRef.current = next;
    setSave(next);
    try {
      persistSave(next);
    } catch {
      setError("浏览器存档写入失败；当前页面仍可继续，但刷新后可能丢失最近进度。");
    }
  }, []);

  const refreshNarrative = useCallback(async (next: GameSave, contextKind: "demo-entry" | "zhao-leng-beat") => {
    try {
      const result = await postJson<ExperienceResponse>("/api/life/zhao-leng/experience", {
        save: next,
        contextKind,
      });
      updateSave(result.saveAfter);
    } catch {
      // 主动事件预览失败不阻断已结算的场景；下一次进入仍可重试。
    }
  }, [updateSave]);

  const start = useCallback(async (nextMode: ZhaoLengGenerationMode, continueExisting: boolean) => {
    setBusy(true);
    setError("");
    try {
      const candidate = continueExisting ? storedSave(nextMode) : undefined;
      const result = await postJson<StartResponse>("/api/life/zhao-leng", {
        mode: nextMode,
        ...(candidate ? { save: candidate } : {}),
        currentYear: new Date().getFullYear(),
      });
      updateSave(result.gameSave);
      setMode(nextMode);
      await refreshNarrative(result.gameSave, "demo-entry");
    } catch (err) {
      setError(err instanceof Error ? err.message : "赵冷 Demo 启动失败");
    } finally {
      setBusy(false);
    }
  }, [refreshNarrative, updateSave]);

  const activePackage = useMemo(() => {
    if (!save?.sceneRuntime) return undefined;
    const packageItem = save.scenePackages?.[save.sceneRuntime.chapterId];
    return packageItem?.id === save.sceneRuntime.packageId && packageItem.version === save.sceneRuntime.packageVersion
      ? packageItem
      : save.zhaoLeng?.packagesById[save.sceneRuntime.packageId];
  }, [save]);

  const onPersistPosition = useCallback((runtime: SceneRuntimeState) => {
    const current = saveRef.current;
    if (!current) return;
    if (JSON.stringify(current.sceneRuntime) === JSON.stringify(runtime)) return;
    updateSave({ ...current, sceneRuntime: runtime, savedAt: new Date().toISOString() });
  }, [updateSave]);

  const onSelect = useCallback(async (input: {
    requestId: string;
    issuedAt: string;
    expectedRevision: number;
    choiceId: "A" | "B" | "C";
  }): Promise<SceneChoiceResponse> => {
    const current = saveRef.current;
    const packageItem = activePackage;
    if (!current?.sceneRuntime || !packageItem) throw new Error("赵冷 Demo 场景尚未就绪");
    const projection = projectGameSave(current, current.sceneRuntime, current.sceneActions, current.sceneFlags);
    const response = await postJson<SceneChoiceResponse>("/api/chapter/scene-choice", {
      projection,
      package: packageItem,
      ...input,
    });
    const nextProjection = commitSceneChoice(projection, response);
    updateSave(mergeSceneProjection(current, nextProjection));
    return response;
  }, [activePackage, updateSave]);

  const command = useCallback(async (type: ZhaoLengCommand["type"]) => {
    const current = saveRef.current;
    const packageItem = activePackage;
    if (!current?.sceneRuntime || !packageItem) return;
    setBusy(true);
    setError("");
    try {
      const result = await postJson<CommandResponse>("/api/life/zhao-leng/command", {
        save: current,
        command: {
          type,
          requestId: requestId(`zhao-${type}`),
          expectedRevision: current.saveRevision ?? 0,
          expectedPackageId: packageItem.id,
          issuedAt: new Date().toISOString(),
        },
      });
      updateSave(result.gameSave);
      if (type === "advance_beat" || type === "observe_library_card") {
        await refreshNarrative(result.gameSave, "zhao-leng-beat");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "赵冷 Demo 命令失败");
    } finally {
      setBusy(false);
    }
  }, [activePackage, refreshNarrative, updateSave]);

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
            <button type="button" className={mode === "scripted" ? "life-vn-btn" : "life-vn-btn ghost"} onClick={() => setMode("scripted")} disabled={busy}>固定剧本</button>
            <button type="button" className={mode === "llm" ? "life-vn-btn" : "life-vn-btn ghost"} onClick={() => setMode("llm")} disabled={busy}>AI 写作</button>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <button type="button" className="life-vn-btn" onClick={() => void start(mode, false)} disabled={busy}>
              {busy ? "正在准备…" : "开始赵冷 Demo"}
            </button>
            {resumeModes.includes(mode) && (
              <button type="button" className="life-vn-btn ghost" onClick={() => void start(mode, true)} disabled={busy}>
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
  const atCompletedBoundary = runtime.status === "completed";
  const canFinishNormal = atCompletedBoundary && save.zhaoLeng?.beatId === "zl-12-hook" && save.zhaoLeng.stage === "reading";
  const canFinishHidden = canFinishNormal && hidden.status === "eligible";
  const endingReady = atCompletedBoundary && save.zhaoLeng?.stage === "ending_reading";

  return (
    <LifeShell
      chapterLabel="赵冷 · 成人关系 Demo"
      title={ZHAO_LENG_BEAT_SCRIPTS[currentBeatIndex]?.title ?? "剧情现场"}
      yearRange={`${save.worldState.currentYear} 年 · ${mode === "llm" ? "AI 写作" : "固定剧本"}`}
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
          <SceneRuntimePlayer
            key={`${activePackage.id}:v${activePackage.version}`}
            scenePackage={activePackage}
            initialState={runtime}
            projection={projectGameSave(save, runtime, save.sceneActions, save.sceneFlags)}
            onSelect={onSelect}
            onPersistPosition={onPersistPosition}
          />
          <div style={{ position: "absolute", right: 18, bottom: 18, zIndex: 6, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {canObserveCard && <button type="button" className="life-vn-btn ghost" onClick={() => void command("observe_library_card")} disabled={busy}>查看旧借阅卡</button>}
            {atCompletedBoundary && save.zhaoLeng?.beatId !== "zl-12-hook" && <button type="button" className="life-vn-btn" onClick={() => void command("advance_beat")} disabled={busy}>{busy ? "正在进入下一节拍…" : "进入下一节拍"}</button>}
            {canFinishNormal && <button type="button" className="life-vn-btn" onClick={() => void command("finish_normal")} disabled={busy}>收束普通结局</button>}
            {canFinishHidden && <button type="button" className="life-vn-btn ghost" onClick={() => void command("open_hidden")} disabled={busy}>打开隐藏来信</button>}
            {save.zhaoLeng?.stage === "hidden_reading" && atCompletedBoundary && <button type="button" className="life-vn-btn" onClick={() => void command("finish_hidden")} disabled={busy}>读完来信</button>}
            {endingReady && <button type="button" className="life-vn-btn" onClick={() => void command("finish_ending")} disabled={busy}>完成结局</button>}
          </div>
          {save.zhaoLeng?.stage === "ended" && <div className="life-vn-pill" style={{ position: "absolute", top: 18, right: 18, zIndex: 6 }}>结局：{save.zhaoLeng.endingId}</div>}
          {error && <div className="life-vn-error" role="alert" style={{ position: "absolute", left: 18, right: 18, top: 18, zIndex: 7 }}>{error}</div>}
        </div>
      }
      sheet={
        <div style={{ display: "grid", gap: 12 }}>
          <div><b>存档</b><p style={{ margin: "6px 0 0", color: "var(--lv-muted)", fontSize: 12 }}>自动保存至本浏览器的 {mode === "llm" ? "AI" : "固定剧本"} 独立存档。</p></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="life-vn-btn ghost" onClick={restart} disabled={busy}>重新开始</button>
            <button type="button" className="life-vn-btn ghost" onClick={() => { const blob = new Blob([serializeSceneSave(save)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `zhao-leng-${mode}-save.json`; link.click(); URL.revokeObjectURL(link.href); }}>导出存档</button>
          </div>
          {save.zhaoLeng?.stage === "ended" && <p style={{ margin: 0, color: "var(--lv-gold-strong)" }}>本次结局已完成，可以重新开始探索其他路径。</p>}
          <div><b>当前运行时</b><p style={{ margin: "6px 0 0", color: "var(--lv-muted)", fontSize: 12 }}>{runtime.status} · revision {save.saveRevision ?? 0}</p></div>
        </div>
      }
    />
  );
}
