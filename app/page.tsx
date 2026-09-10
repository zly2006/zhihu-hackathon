"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicState, GameEvent } from "../lib/story";

type PoolMember = {
  id: string;
  name: string;
  gender: "男" | "女";
  age: number;
  identity: string;
  background?: string;
  zhihuHandle?: string;
};
type ViewNode = {
  title?: string;
  lines: { speaker: string; text: string }[];
  choices: { text: string }[];
  readingSeconds?: number;
};
type SceneId = "studio" | "awning";
type StoryTemplate = {
  state: PublicState | null;
  pool: PoolMember[];
  requiredCastCount: number;
  total: number;
};

const symbols = Array.from("✦◡◎✎✧◌❖♪");
const colors = [
  "#a87355",
  "#8a966e",
  "#77939e",
  "#a86d86",
  "#b18355",
  "#778c75",
  "#8a7b9c",
  "#9b7b68",
];
const sceneAssets: Record<SceneId, string> = {
  studio: "/assets/studio-rain.webp",
  awning: "/assets/courtyard-sunset.webp",
};

export default function Home() {
  const [state, setState] = useState<PublicState | null>(null);
  const [partial, setPartial] = useState<ViewNode | null>(null);
  const [pool, setPool] = useState<PoolMember[]>([]);
  const [requiredCastCount, setRequiredCastCount] = useState(4);
  const [templateTotal, setTemplateTotal] = useState(7);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [line, setLine] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [picker, setPicker] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<
    Record<string, { background: string; zhihuHandle: string }>
  >({});
  const [scene, setScene] = useState<SceneId>("studio");
  const busyRef = useRef(false);

  const totalStages = state?.total || templateTotal;
  const node = partial || state?.nodes.at(-1) || null;
  const currentLine = node?.lines[line];
  const atEnd = !!node && line >= node.lines.length - 1;
  const waiting = !!partial || !!state?.pending;
  const displayedCast: PoolMember[] = state?.world.cast?.length
    ? state.world.cast
    : selected
        .map((id) => pool.find((member) => member.id === id))
        .filter((member): member is PoolMember => !!member);
  const cast = displayedCast.map((member, index) => ({
    ...member,
    symbol:
      symbols[
        pool.findIndex((candidate) => candidate.id === member.id) %
          symbols.length
      ] || symbols[index % symbols.length],
    color:
      colors[
        pool.findIndex((candidate) => candidate.id === member.id) %
          colors.length
      ] || colors[index % colors.length],
    detail:
      member.background?.trim() ||
      "一路做过的选择，会改变彼此看待这段关系的方式。",
  }));
  const locations = state?.world.locations?.length
    ? state.world.locations
    : ["校园活动室", "教学楼连廊"];

  async function restore() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      const storyId = localStorage.getItem("lamplight_story_id");
      response = await fetch(
        `/api/story${storyId ? `?storyId=${encodeURIComponent(storyId)}` : ""}`,
        { signal: controller.signal },
      );
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error("暂时无法读取存档。");
    const data = (await response.json()) as StoryTemplate;
    if (Array.isArray(data.pool) && data.pool.length) setPool(data.pool);
    if (Number.isInteger(data.requiredCastCount))
      setRequiredCastCount(data.requiredCastCount);
    if (Number.isInteger(data.total)) setTemplateTotal(data.total);
    setState(data.state);
    setPartial(data.state?.partial || null);
    if (!data.state) localStorage.removeItem("lamplight_story_id");
    setReady(true);
    return data.state;
  }

  useEffect(() => {
    restore().catch((cause) => {
      setError(cause instanceof Error ? cause.message : "暂时无法读取存档。");
      setReady(true);
    });
  }, []);

  async function act(action: string, choice?: number) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setStatus("正在打开这一页…");
    if (action === "start" || action === "restart") {
      setPartial(null);
      setLine(0);
    }
    try {
      const selectedProfiles = selected.map((id) => {
        const member = pool.find((candidate) => candidate.id === id);
        if (!member) throw new Error("角色池已变化，请刷新页面后重试。");
        return {
          id: member.id,
          name: member.name,
          gender: member.gender,
          ...(profiles[id] || {}),
        };
      });
      const response = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: localStorage.getItem("lamplight_story_id") || undefined,
          action,
          ...(choice !== undefined
            ? { choice, expected: state?.nodes.length }
            : {}),
          ...(action === "start" || action === "restart"
            ? { profiles: selectedProfiles }
            : {}),
        }),
      });
      const responseStoryId = response.headers.get("X-Story-Id");
      if (responseStoryId)
        localStorage.setItem("lamplight_story_id", responseStoryId);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "暂时无法继续。");
      }
      if (
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        const data = await response.json();
        setState(data.state);
        setPartial(data.state?.partial || null);
        return;
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      const receive = (event: GameEvent) => {
        if (event.type === "status") setStatus(event.message);
        if (event.type === "scene") {
          setPartial({ title: event.title, lines: [], choices: [] });
          setLine(0);
        }
        if (event.type === "line")
          setPartial((old) => {
            const next = { ...(old || { lines: [], choices: [] }) };
            next.lines = [...next.lines];
            next.lines[event.index] = {
              speaker: event.speaker,
              text: event.text,
            };
            return next;
          });
        if (event.type === "choices")
          setPartial((old) => (old ? { ...old, choices: event.items } : old));
        if (event.type === "done") {
          setState(event.state);
          setPartial(null);
          finished = true;
          setStatus("");
        }
        if (event.type === "error") throw new Error(event.message);
      };
      try {
        while (true) {
          const part = await reader.read();
          buffer += decoder.decode(part.value, { stream: !part.done });
          const rows = buffer.split("\n");
          buffer = rows.pop() || "";
          for (const row of rows)
            if (row.startsWith("data:")) receive(JSON.parse(row.slice(5)));
          if (part.done) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (!finished) throw new Error("连接中断，已收到的对白会保留。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法继续。");
      await restore().catch(() => {});
      if (action === "start" || action === "restart") setPicker(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setStatus("");
    }
  }

  function advance() {
    if (node && line < node.lines.length - 1) setLine(line + 1);
  }
  function toggleMember(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < requiredCastCount
          ? [...current, id]
          : current,
    );
  }
  function restartSelection() {
    setConfirm(false);
    setPanelOpen(false);
    if (state) {
      setSelected(state.world.cast.map((member) => member.id));
      setProfiles(
        Object.fromEntries(
          state.world.cast.map((member) => [
            member.id,
            {
              background: member.background || "",
              zhihuHandle: member.zhihuHandle || "",
            },
          ]),
        ),
      );
    }
    setState(null);
    setPartial(null);
    setLine(0);
    setError("");
    setScene("studio");
    setPicker(true);
    localStorage.removeItem("lamplight_story_id");
  }
  function selectScene(next: SceneId) {
    setScene(next);
  }
  function cycleScene() {
    setScene((current) => (current === "studio" ? "awning" : "studio"));
  }

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHistory(false);
        setConfirm(false);
        setPanelOpen(false);
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("input,textarea,select,button") ||
          target.isContentEditable)
      )
        return;
      if (history || confirm || panelOpen || (picker && !state)) return;
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        advance();
      }
      if (event.key === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  useEffect(() => {
    const target = window as unknown as {
      render_game_to_text: () => string;
      advanceTime: (ms: number) => void;
    };
    target.render_game_to_text = () =>
      JSON.stringify({
        mode: history
          ? "history"
          : !node
            ? "start"
            : state?.complete
              ? "ending"
              : "reading",
        busy,
        pending: waiting,
        poolCount: pool.length,
        requiredCastCount,
        selectedCount: selected.length,
        segment: state?.nodes.length || 0,
        total: totalStages,
        receivedLines: node?.lines.length || 0,
        line: line + 1,
        speaker: currentLine?.speaker,
        text: currentLine?.text,
        choices: atEnd && !waiting ? node?.choices : [],
        route: state?.route,
        error,
      });
    target.advanceTime = () => {};
  }, [
    node,
    state,
    line,
    busy,
    history,
    waiting,
    error,
    atEnd,
    currentLine,
    pool.length,
    requiredCastCount,
    selected.length,
    totalStages,
  ]);

  return (
    <main
      onContextMenu={(event) => {
        event.preventDefault();
        setPanelOpen((open) => !open);
      }}
    >
      {picker && !state && (
        <div className="character-picker">
          <div className="picker-card">
            <p className="eyebrow">知乎 × LAMPLIGHT</p>
            <h2>选择一路同行的四位角色</h2>
            <p>
              从服务端模板角色池中选择 {requiredCastCount}{" "}
              位，故事将从高中、本科推进到硕士。
            </p>
            {!pool.length ? (
              <div className="picker-loading">角色模板正在读取…</div>
            ) : (
              <div className="pool">
                {pool.map((member) => (
                  <button
                    className={selected.includes(member.id) ? "picked" : ""}
                    data-character-id={member.id}
                    onClick={() => toggleMember(member.id)}
                    key={member.id}
                  >
                    <b>{member.name}</b>
                    <span>
                      {member.gender} · {member.identity}
                    </span>
                    <small>{member.age} 岁</small>
                  </button>
                ))}
              </div>
            )}
            {selected.map((id) => {
              const member = pool.find((candidate) => candidate.id === id);
              return member ? (
                <div className="profile-edit" key={id}>
                  <b>{member.name}</b>
                  <input
                    value={profiles[id]?.background || ""}
                    placeholder="人物背景（可选）"
                    onChange={(event) =>
                      setProfiles((current) => ({
                        ...current,
                        [id]: {
                          background: event.target.value,
                          zhihuHandle: current[id]?.zhihuHandle || "",
                        },
                      }))
                    }
                  />
                  <input
                    value={profiles[id]?.zhihuHandle || ""}
                    placeholder="知乎答主链接或用户名（可选）"
                    onChange={(event) =>
                      setProfiles((current) => ({
                        ...current,
                        [id]: {
                          background: current[id]?.background || "",
                          zhihuHandle: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              ) : null;
            })}
            <button
              id="start-story"
              className="primary"
              disabled={
                selected.length !== requiredCastCount ||
                busy ||
                !ready ||
                !pool.length
              }
              onClick={() => {
                setPicker(false);
                void act("start");
              }}
            >
              开始人生故事 · {selected.length}/{requiredCastCount} ↗
            </button>
          </div>
        </div>
      )}
      <header>
        <a className="brand" href="/">
          灯<span> / </span> LAMPLIGHT
        </a>
        <nav>
          <span className="saved">● {busy ? "正在续写" : "进度自动保存"}</span>
          <button
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
          >
            ☰ 菜单
          </button>
          <button onClick={() => setHistory(true)} disabled={!node}>
            回看故事
          </button>
          <button onClick={() => setConfirm(true)} disabled={busy || !node}>
            重新开始
          </button>
        </nav>
      </header>
      <div className={`layout ${panelOpen ? "panel-open" : ""}`}>
        {panelOpen && (
          <button
            className="menu-backdrop"
            aria-label="关闭菜单遮罩"
            onClick={() => setPanelOpen(false)}
          />
        )}
        <aside className="drawer" inert={!panelOpen}>
          <button
            className="drawer-close"
            onClick={() => setPanelOpen(false)}
            aria-label="关闭菜单"
          >
            ×
          </button>
          <div className="eyebrow">
            {state?.lifeStage?.label || "校园人生"} · 人生选择故事
          </div>
          <h1>
            {state?.storyTitle || "正在生成故事"}
            <span>。</span>
          </h1>
          <p className="intro">
            {state?.world?.premise || "故事基调由模板与角色共同生成。"}
          </p>
          <div className="scene-switcher" aria-label="场景选择">
            {locations.slice(0, 2).map((label, index) => {
              const id: SceneId = index === 0 ? "studio" : "awning";
              return (
                <button
                  key={label}
                  className={scene === id ? "active" : ""}
                  onClick={() => selectScene(id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="separator" />
          <div className="cast-heading">
            一路同行的人 <span>{String(cast.length).padStart(2, "0")}</span>
          </div>
          <div className="people">
            {cast.map((member) => (
              <div
                className={`person ${state?.route === member.id ? "chosen" : ""}`}
                key={member.id}
              >
                <div className="portrait" style={{ background: member.color }}>
                  {member.symbol}
                </div>
                <div>
                  <strong>{member.name}</strong>
                  <span>
                    {member.identity}
                    {state?.route === member.id ? " · 正在靠近" : ""}
                  </span>
                  <p>{member.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <footer>
            <span>{state?.lifeStage?.label || "校园阶段"}</span>
            <span>{state?.lifeEvent?.title || "人生选择"}</span>
          </footer>
        </aside>
        <section className="story">
          <div className="scene">
            <img
              className="scene-art"
              src={sceneAssets[scene]}
              alt={`${locations[scene === "studio" ? 0 : 1] || "故事场景"}背景`}
            />
            <div className="scene-characters" aria-hidden="true">
              <img src="/assets/chibi-cast.webp" alt="" />
            </div>
            <button
              className="scene-badge"
              onClick={cycleScene}
              aria-label="切换场景"
            >
              {state?.lifeStage?.label || "校园"} ·{" "}
              {locations[scene === "studio" ? 0 : 1] || "故事现场"} · 切换
            </button>
            <div className="hero-title">
              <small>
                {state?.lifeEvent?.title || state?.storyTone || "人生选择故事"}
              </small>
              <h1>
                {state?.storyTitle || "正在生成故事"}
                <span>。</span>
              </h1>
              <p>
                {state?.world?.premise || "选择角色后，故事将根据模板生成。"}
              </p>
            </div>
            <div className="scene-top">
              <span>{locations[0]}</span>
              <span>{locations[1] || "模板场景"}</span>
            </div>
            <div className="scene-bottom">
              <span>{locations.join(" · ")}</span>
              <span>{state?.lifeStage?.label || "人生故事"}</span>
            </div>
          </div>
          <div className="reader" aria-busy={busy}>
            <div className="reader-head">
              <span>
                {node
                  ? `${String(Math.min((state?.nodes.length || 0) + (partial ? 1 : 0), totalStages)).padStart(2, "0")} / ${String(totalStages).padStart(2, "0")}`
                  : "PROLOGUE"}
              </span>
              <span>{node?.title || "等待第一段故事"}</span>
              <div className="dots">
                {Array.from({ length: totalStages }, (_, index) => (
                  <i
                    key={index}
                    className={
                      index < (state?.nodes.length || 0) ? "active" : ""
                    }
                  />
                ))}
              </div>
            </div>
            {!node ? (
              <div className="welcome">
                <h2>故事即将开始。</h2>
                <p>
                  {state?.world?.premise ||
                    "选择角色后，模型会按照模板生成第一段故事。"}
                </p>
                <button
                  id="start-btn"
                  className="primary"
                  disabled={busy || !ready}
                  onClick={() => act("start")}
                >
                  {busy ? "正在翻开故事…" : "走进校园往事"} <span>↗</span>
                </button>
              </div>
            ) : (
              <>
                <div
                  className="dialogue"
                  aria-live="polite"
                  onClick={advance}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      advance();
                    }
                  }}
                >
                  <div className="speaker">
                    {currentLine?.speaker || "旁白"}
                    <span>—</span>
                  </div>
                  <p key={`${node.title}-${line}`}>
                    {currentLine?.text ||
                      (busy ? "第一段故事正在生成…" : "这一页暂时没有对白。")}
                  </p>
                </div>
                <div className="read-controls">
                  <span>
                    {node.lines.length
                      ? `${line + 1} / ${node.lines.length} 句`
                      : ""}
                    {partial ? " · 继续传来中" : ""}
                  </span>
                  {!atEnd ? (
                    <span className="click-hint">点击对话继续</span>
                  ) : busy ? (
                    <span className="loading">
                      {status || "下一句话正在到来…"}
                    </span>
                  ) : null}
                </div>
                {atEnd && !waiting && !!node.choices.length && (
                  <div className="choices">
                    <small>这一次，我想……</small>
                    {node.choices.map((choice, index) => (
                      <button
                        key={`${choice.text}-${index}`}
                        data-choice={index}
                        disabled={busy}
                        onClick={() => act("choose", index)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        {choice.text}
                        <b>↗</b>
                      </button>
                    ))}
                  </div>
                )}
                {atEnd && state?.complete && (
                  <div className="ending">
                    <span>FIN · 这段人生，暂时写到这里。</span>
                    <button onClick={restartSelection}>重新选择一次 ↗</button>
                  </div>
                )}
              </>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
                <button disabled={busy} onClick={() => act("retry")}>
                  重试当前片段 →
                </button>
              </div>
            )}
            {waiting && !busy && !error && (
              <button className="resume" onClick={() => act("retry")}>
                继续未完成的生成 →
              </button>
            )}
          </div>
          <div className="bottom-note">
            <span>{state?.world?.premise || "根据模板生成的互动故事"}</span>
            <div className="bottom-toolbar">
              <button
                onClick={() => setPanelOpen((open) => !open)}
                aria-label="打开菜单"
              >
                ☰
              </button>
              <button
                onClick={() => setHistory(true)}
                disabled={!node}
                aria-label="回看故事"
              >
                ▤
              </button>
              <button
                onClick={() => setConfirm(true)}
                disabled={!node || busy}
                aria-label="重新开始"
              >
                ↻
              </button>
            </div>
            <span>点击对白 / 空格 / → 推进</span>
          </div>
        </section>
      </div>
      {history && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="回看故事"
        >
          <div className="history">
            <button className="close" onClick={() => setHistory(false)}>
              关闭 ×
            </button>
            <h2>我们说过的话</h2>
            {state?.nodes.map((entry, index) => (
              <article key={index}>
                <h3>
                  {index + 1}. {entry.title}
                </h3>
                {entry.lines.map((textEntry, lineIndex) => (
                  <p key={lineIndex}>
                    <b>{textEntry.speaker}</b>
                    {textEntry.text}
                  </p>
                ))}
              </article>
            ))}
            {partial && (
              <article>
                <h3>{partial.title} · 正在继续</h3>
                {partial.lines.map((textEntry, lineIndex) => (
                  <p key={lineIndex}>
                    <b>{textEntry.speaker}</b>
                    {textEntry.text}
                  </p>
                ))}
              </article>
            )}
          </div>
        </div>
      )}
      {confirm && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="重新开始"
        >
          <div className="confirm">
            <h2>重新走一遍这段人生？</h2>
            <p>
              将回到角色选择，重新选择同行者，并生成新的高中、本科与硕士事件。
            </p>
            <button onClick={() => setConfirm(false)}>再待一会儿</button>
            <button className="primary" onClick={restartSelection}>
              重新选择 ↗
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
