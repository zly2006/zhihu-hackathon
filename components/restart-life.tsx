"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  ExternalLink,
  Feather,
  Heart,
  Home,
  Landmark,
  LoaderCircle,
  LogOut,
  RotateCcw,
  Save,
  Sparkles,
  UserRound,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import type {
  Effect,
  EventStreamProgress,
  Experience,
  GameEvent,
  GameOption,
  LifeState,
  Profile,
  Stats,
  TimelineEntry,
} from "@/lib/types";
import { advanceAge, projectedLifeEndAge, settleChoice } from "@/lib/mechanics";
import { readJsonResponse } from "@/lib/http-response";

type Screen = "landing" | "setup" | "game" | "ending";
type ChoiceResult = {
  label: string;
  result: string;
  effects: Effect;
  experienceIds: string[];
  optionId: "A" | "B" | "C" | "CUSTOM";
  strategyTag: string;
  stateFit: GameOption["stateFit"];
  stateReason: string;
  effectiveRisk: number;
  riskOccurred: boolean;
  customAction?: string;
  modelEnhanced?: boolean;
};
type AuthStatus = {
  configured: boolean;
  missingConfiguration: string[];
  authorized: boolean;
  profile: {
    name: string | null;
    avatarUrl: string | null;
    headline: string | null;
    url: string | null;
  } | null;
  stateVerified: boolean | null;
  error: { code: string; message: string } | null;
};
type CustomActionResponse = Omit<GameOption, "id" | "description" | "tone"> & {
  sanitizedAction: string;
  modelEnhanced: boolean;
};
type BrowserTestWindow = Window & {
  render_game_to_text?: () => string;
  advanceTime?: (milliseconds: number) => void;
};

const defaultTalents = { insight: 3, charm: 3, grit: 3, learning: 3, luck: 3 };
const statMeta = [
  ["cash", "现金", WalletCards],
  ["health", "健康", Heart],
  ["happiness", "心气", Sparkles],
  ["knowledge", "见识", BookOpen],
  ["connections", "人脉", Users],
  ["career", "事业", Landmark],
  ["assets", "资产", Home],
] as const;

function initialState(profile: Profile): LifeState {
  const familyBonus: Record<string, number> = {
    拮据但温暖: 8,
    普通工薪: 18,
    小有余裕: 28,
    家境优渥: 42,
  };
  return {
    age: 0,
    cash: familyBonus[profile.family] || 18,
    health: 68 + profile.talents.grit * 2,
    happiness: 52 + profile.talents.charm,
    knowledge: 8 + profile.talents.learning * 2,
    connections: 8 + profile.talents.charm * 2,
    career: 2,
    assets: Math.max(0, (familyBonus[profile.family] || 18) - 12),
  };
}

function applyEffects(state: LifeState, effects: Effect, age = state.age) {
  const next = { ...state, age };
  for (const [key, value] of Object.entries(effects)) {
    const typedKey = key as keyof Omit<LifeState, "age">;
    next[typedKey] = Math.max(0, Math.min(100, next[typedKey] + Number(value || 0)));
  }
  return next;
}

function number(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

async function readEventStream(
  response: Response,
  onProgress: (progress: EventStreamProgress) => void,
) {
  if (!response.ok) return readJsonResponse<GameEvent>(response, "事件生成");
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error(
      `事件生成失败：HTTP ${response.status} ${response.statusText || "OK"}，服务没有返回 SSE 流`,
    );
  }
  if (!response.body) throw new Error("事件生成失败：SSE 响应正文为空");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: GameEvent | null = null;
  const consume = (block: string) => {
    let eventName = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      throw new Error("事件生成失败：SSE 数据不是有效 JSON");
    }
    if (eventName === "progress") onProgress(payload as EventStreamProgress);
    if (eventName === "complete") completed = payload as GameEvent;
    if (eventName === "error")
      throw new Error(String((payload as { message?: unknown }).message || "事件生成失败"));
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) consume(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (!completed) throw new Error("事件生成失败：SSE 流在完整事件返回前结束");
  return completed;
}

function visibleControls() {
  return Array.from(
    document.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("button,input,select,textarea"),
  )
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => ({
      kind: element.tagName.toLowerCase(),
      label:
        element instanceof HTMLButtonElement
          ? element.innerText.trim()
          : element.getAttribute("aria-label") ||
            element.closest("label")?.childNodes[0]?.textContent?.trim() ||
            "",
      value: element instanceof HTMLButtonElement ? undefined : element.value,
      disabled: element.disabled,
    }));
}

function AuthorAvatar({ item }: { item: Experience }) {
  return item.avatar ? (
    <img
      src={`/api/avatar?url=${encodeURIComponent(item.avatar)}`}
      alt={`${item.author} 的真实知乎头像`}
    />
  ) : (
    <span className="missing-avatar">无头像</span>
  );
}

function AuthorName({ item }: { item: Experience }) {
  return item.authorUrl ? (
    <a className="author-link" href={item.authorUrl} target="_blank" rel="noreferrer">
      {item.author}
    </a>
  ) : (
    <b>{item.author}</b>
  );
}

function ZhihuAccount({
  auth,
  onLogin,
  onLogout,
}: {
  auth: AuthStatus | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  if (auth?.authorized)
    return (
      <div className="zhihu-account signed-in">
        {auth.profile?.avatarUrl ? (
          <img
            src={`/api/avatar?url=${encodeURIComponent(auth.profile.avatarUrl)}`}
            alt="知乎账号头像"
          />
        ) : (
          <span>
            <UserRound size={15} />
          </span>
        )}
        <div>
          <b>{auth.profile?.name || "已登录知乎"}</b>
          <small>{auth.profile?.headline || "知乎账号已连接"}</small>
        </div>
        <button aria-label="退出知乎登录" onClick={onLogout}>
          <LogOut size={14} />
        </button>
      </div>
    );
  return (
    <button className="zhihu-login" disabled={!auth?.configured} onClick={onLogin}>
      <span>知</span>
      {auth?.configured ? "使用知乎账号登录" : "知乎登录待配置"}
    </button>
  );
}

function Landing({
  stats,
  auth,
  oauthMessage,
  onStart,
  onResume,
  onLogin,
  onLogout,
}: {
  stats: Stats;
  auth: AuthStatus | null;
  oauthMessage: string;
  onStart: () => void;
  onResume?: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <main className="landing-shell">
      <div className="grain" />
      <nav className="masthead">
        <div className="brand-mark">
          <span>知</span>
          <div>
            人生重启
            <br />
            实验室
          </div>
        </div>
        <div className="masthead-right">
          <div className="edition">
            第 1998—∞ 期<br />
            命运增刊
          </div>
          <ZhihuAccount auth={auth} onLogin={onLogin} onLogout={onLogout} />
        </div>
      </nav>
      {oauthMessage && <div className="oauth-message">{oauthMessage}</div>}
      <section className="hero">
        <div className="hero-kicker">
          <span>ZH</span> 上万段真实经历，借你重走一遍
        </div>
        <h1>
          如果那年，
          <br />
          <em>我选了另一条路</em>
        </h1>
        <p className="hero-copy">
          你带着今天的记忆出生。但时代会轻轻错位，运气不会重复开奖。
          <br />
          没有标准答案，只有别人走过之后，留下的真实回声。
        </p>
        <div className="hero-actions">
          <button className="primary-button" onClick={onStart}>
            开始重启 <ArrowRight size={18} />
          </button>
          {onResume && (
            <button className="text-button" onClick={onResume}>
              <Save size={16} /> 继续上一次人生
            </button>
          )}
        </div>
        <div className="hero-proof">
          <div>
            <strong>{number(stats.snapshots)}</strong>
            <span>份回答快照</span>
          </div>
          <div>
            <strong>{number(stats.candidates)}</strong>
            <span>段决策经历</span>
          </div>
          <div>
            <strong>{number(stats.vectors)}</strong>
            <span>组人生向量</span>
          </div>
        </div>
      </section>
      <aside className="future-note">
        <div className="pin" />
        <span className="note-label">致未来穿越者</span>
        <p>你记得房价、风口和崩盘，但历史在这里会产生偏移。你能带走判断，带不走彩票号码。</p>
        <small>—— 命运公平委员会</small>
      </aside>
      <div className="ticker">
        <span>有人在 30 岁换了行业</span>
        <span>有人毕业时拒绝了最稳的 offer</span>
        <span>有人买了房，也有人买回了自由</span>
        <span>你的那一年，会怎么选？</span>
      </div>
    </main>
  );
}

function Setup({
  accountName,
  onBack,
  onBegin,
}: {
  accountName?: string | null;
  onBack: () => void;
  onBegin: (profile: Profile) => void;
}) {
  const [profile, setProfile] = useState<Profile>({
    name: accountName || "未命名的人",
    birthYear: 1998,
    gender: "不设定",
    hometown: "一座普通城市",
    family: "普通工薪",
    precision: 3,
    talents: defaultTalents,
  });
  const talentNames: Record<keyof Profile["talents"], string> = {
    insight: "洞察",
    charm: "亲和",
    grit: "韧性",
    learning: "学习",
    luck: "运气",
  };
  const total = Object.values(profile.talents).reduce((sum, item) => sum + item, 0);
  const updateTalent = (key: keyof Profile["talents"], delta: number) => {
    const next = profile.talents[key] + delta;
    if (next < 1 || next > 7 || (delta > 0 && total >= 15)) return;
    setProfile({ ...profile, talents: { ...profile.talents, [key]: next } });
  };
  return (
    <main className="setup-shell">
      <button className="back-button" onClick={onBack}>
        <ChevronLeft size={17} /> 返回头版
      </button>
      <header className="setup-header">
        <span>PERSONAL FILE / 001</span>
        <h1>
          请填写你的
          <br />
          出生档案
        </h1>
        <p>它不会决定结局，只会决定你从哪里出发。</p>
      </header>
      <section className="setup-grid">
        <div className="form-paper">
          <label>
            你希望别人怎样称呼你
            <input
              value={profile.name}
              maxLength={12}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </label>
          <div className="field-row">
            <label>
              出生年份
              <input
                type="number"
                min="1970"
                max="2010"
                value={profile.birthYear}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    birthYear: Math.max(1970, Math.min(2010, Number(e.target.value))),
                  })
                }
              />
            </label>
            <label>
              性别
              <select
                value={profile.gender}
                onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
              >
                <option>不设定</option>
                <option>女</option>
                <option>男</option>
              </select>
            </label>
          </div>
          <label>
            出生地
            <select
              value={profile.hometown}
              onChange={(e) => setProfile({ ...profile, hometown: e.target.value })}
            >
              <option>一座普通城市</option>
              <option>北上广深</option>
              <option>省会城市</option>
              <option>县城与小镇</option>
              <option>乡村</option>
            </select>
          </label>
          <label>
            家庭底色
            <div className="choice-chips">
              {["拮据但温暖", "普通工薪", "小有余裕", "家境优渥"].map((item) => (
                <button
                  key={item}
                  className={profile.family === item ? "active" : ""}
                  onClick={() => setProfile({ ...profile, family: item })}
                >
                  {item}
                </button>
              ))}
            </div>
          </label>
          <label>
            人生精度
            <div className="precision-cards">
              <button
                className={profile.precision === 3 ? "active" : ""}
                onClick={() => setProfile({ ...profile, precision: 3 })}
              >
                <Clock3 />
                <b>三年一幕</b>
                <small>推荐 · 约 20 次选择</small>
              </button>
              <button
                className={profile.precision === 1 ? "active" : ""}
                onClick={() => setProfile({ ...profile, precision: 1 })}
              >
                <Feather />
                <b>一年一幕</b>
                <small>细腻 · 完整长人生</small>
              </button>
            </div>
          </label>
        </div>
        <div className="talent-paper">
          <div className="talent-heading">
            <span>初始天赋</span>
            <strong>
              {total}
              <small>/15</small>
            </strong>
          </div>
          <p>每项至少 1 点，最多 7 点。人生不公平，但这张表暂时公平。</p>
          {(Object.keys(profile.talents) as Array<keyof Profile["talents"]>).map((key) => (
            <div className="talent-row" key={key}>
              <span>{talentNames[key]}</span>
              <button onClick={() => updateTalent(key, -1)}>−</button>
              <div className="talent-dots">
                {Array.from({ length: 7 }, (_, index) => (
                  <i key={index} className={index < profile.talents[key] ? "filled" : ""} />
                ))}
              </div>
              <button onClick={() => updateTalent(key, 1)}>＋</button>
              <b>{profile.talents[key]}</b>
            </div>
          ))}
          <div className="setup-quote">
            “命运发的牌不一样，
            <br />
            但你可以决定怎么出。”
          </div>
          <button
            className="primary-button full"
            disabled={total !== 15 || !profile.name.trim()}
            onClick={() => onBegin({ ...profile, name: profile.name.trim() })}
          >
            签字并出生 <ArrowRight size={18} />
          </button>
        </div>
      </section>
    </main>
  );
}

function StatRail({ state }: { state: LifeState }) {
  return (
    <aside className="stat-rail">
      <div className="rail-title">
        实时状态 <span>LIVE</span>
      </div>
      {statMeta.map(([key, label, Icon]) => (
        <div className="stat-item" key={key}>
          <Icon size={17} />
          <div>
            <span>{label}</span>
            <div className="bar">
              <i style={{ width: `${state[key]}%` }} />
            </div>
          </div>
          <b>{state[key]}</b>
        </div>
      ))}
    </aside>
  );
}

function TimelineRail({ history }: { history: TimelineEntry[] }) {
  return (
    <aside className="timeline-rail">
      <div className="rail-title">
        人生年表 <span>{history.length}</span>
      </div>
      <div className="timeline-list">
        {history
          .slice()
          .reverse()
          .map((item, index) => (
            <div className="timeline-item" key={`${item.eventId}-${index}`}>
              <i />
              <span>{item.age} 岁</span>
              <b>{item.choice}</b>
              <p>{item.title}</p>
            </div>
          ))}
        {!history.length && (
          <p className="timeline-empty">
            第一笔还没写下。
            <br />
            人生正等你落款。
          </p>
        )}
      </div>
    </aside>
  );
}

function SourceDrawer({ event, onClose }: { event: GameEvent; onClose: () => void }) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="source-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={onClose}>
          <X />
        </button>
        <header>
          <span>VECTOR RECALL / {event.domain.toUpperCase()}</span>
          <h2>这一幕，来自他们的人生</h2>
          <p>
            昵称、头像与主页均直接读取同一回答的知乎原始数据；缺失时明确标记，不生成替代身份。相似不代表同意，更不代表因果。
          </p>
        </header>
        <div className="source-list">
          {event.experiences.map((item, index) => (
            <article className="source-card" key={item.id}>
              <div className="source-person">
                <AuthorAvatar item={item} />
                <div>
                  <AuthorName item={item} />
                  <span>
                    {index === 0 ? "锚点经历" : `${Math.round(item.similarity * 100)}% 情景相似`}
                  </span>
                </div>
              </div>
              <h3>{item.title}</h3>
              <p>{item.excerpt}</p>
              {item.action && (
                <div>
                  <label>TA 的行动</label>
                  {item.action}
                </div>
              )}
              {item.outcome && (
                <div>
                  <label>后来的回声</label>
                  {item.outcome}
                </div>
              )}
              <a href={item.url} target="_blank" rel="noreferrer">
                查看知乎原回答 <ExternalLink size={13} />
              </a>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function ResultPanel({
  result,
  event,
  onNext,
  ending,
  precision,
}: {
  result: ChoiceResult;
  event: GameEvent;
  onNext: () => void;
  ending: boolean;
  precision: Profile["precision"];
}) {
  const fellowTravelers = event.experiences.filter((item) =>
    result.experienceIds.includes(item.id),
  );
  return (
    <div className="result-panel">
      <div className="result-stamp">已选择</div>
      <span className="result-label">{result.label}</span>
      <div className="result-mechanics">
        <span>{result.strategyTag}</span>
        <span>{result.stateFit}</span>
        <span className={result.riskOccurred ? "risk-hit" : "risk-safe"}>
          实际风险 {result.effectiveRisk}% · {result.riskOccurred ? "已兑现" : "未兑现"}
        </span>
      </div>
      <p>{result.result}</p>
      <small className="state-reason">状态影响：{result.stateReason}</small>
      <div className="effect-list">
        {Object.entries(result.effects)
          .filter(([, value]) => value)
          .map(([key, value]) => {
            const meta = statMeta.find(([id]) => id === key);
            return (
              <span className={Number(value) > 0 ? "positive" : "negative"} key={key}>
                {meta?.[1]} {Number(value) > 0 ? "+" : ""}
                {value}
              </span>
            );
          })}
      </div>
      <section className="fellow-trajectories">
        <header>
          <div className="avatar-stack">
            {fellowTravelers.map((item) => (
              <AuthorAvatar key={item.id} item={item} />
            ))}
          </div>
          <div>
            <b>
              {fellowTravelers.filter((item) => item.authorKnown).length}{" "}
              位可核验知乎作者走过相近的路
            </b>
            <span>下方身份与轨迹均来自原回答数据，不代表你的必然结局</span>
          </div>
        </header>
        {fellowTravelers.map((item) => (
          <article key={item.id}>
            <div className="trajectory-user">
              <AuthorAvatar item={item} />
              <AuthorName item={item} />
              <a href={item.url} target="_blank" rel="noreferrer">
                原回答 <ExternalLink size={12} />
              </a>
            </div>
            <div className="trajectory-flow">
              <div>
                <label>当时</label>
                <p>{item.excerpt}</p>
              </div>
              <i>→</i>
              <div>
                <label>选择</label>
                <p>{item.action}</p>
              </div>
              <i>→</i>
              <div>
                <label>后来</label>
                <p>{item.outcome || "答主没有交代更远的结果"}</p>
              </div>
            </div>
          </article>
        ))}
      </section>
      <button className="primary-button" onClick={onNext}>
        {ending ? "查看人生结卷" : precision === 3 ? "去往三年后" : "去往下一年"}{" "}
        <ArrowRight size={17} />
      </button>
    </div>
  );
}

function Game({
  profile,
  initial,
  initialHistory,
  onEnd,
  onRestart,
}: {
  profile: Profile;
  initial: LifeState;
  initialHistory: TimelineEntry[];
  onEnd: (state: LifeState, history: TimelineEntry[]) => void;
  onRestart: () => void;
}) {
  const [state, setState] = useState(initial);
  const [history, setHistory] = useState<TimelineEntry[]>(initialHistory);
  const [event, setEvent] = useState<GameEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTick, setLoadingTick] = useState(0);
  const [eventProgress, setEventProgress] = useState<EventStreamProgress | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [result, setResult] = useState<ChoiceResult | null>(null);
  const [custom, setCustom] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [error, setError] = useState("");

  const fetchEvent = async (nextState = state, nextHistory = history) => {
    setLoading(true);
    setError("");
    setEvent(null);
    setEventProgress({ stage: "retrieval", message: "正在连接事件生成服务", elapsedMs: 0 });
    try {
      const response = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, state: nextState, history: nextHistory }),
      });
      const payload = await readEventStream(response, setEventProgress);
      setEvent(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "事件生成失败");
    } finally {
      setLoading(false);
      setEventProgress(null);
    }
  };

  useEffect(() => {
    fetchEvent(initial, initialHistory);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => setLoadingTick((value) => value + 1), 1700);
    return () => window.clearInterval(timer);
  }, [loading]);
  useEffect(() => {
    localStorage.setItem("restart-life-save", JSON.stringify({ profile, state, history }));
  }, [profile, state, history]);
  useEffect(() => {
    const browser = window as BrowserTestWindow;
    const render = () =>
      JSON.stringify({
        coordinateSystem:
          "DOM viewport with origin at top-left; controls follow visual reading order",
        screen: "game",
        profile: { name: profile.name, birthYear: profile.birthYear, precision: profile.precision },
        state,
        loading,
        eventProgress,
        error: error || null,
        event: event
          ? {
              id: event.id,
              title: event.title,
              chapter: event.chapter,
              background: event.background,
              dilemma: event.dilemma,
              options: event.options.map((option) => ({
                id: option.id,
                label: option.label,
                strategyTag: option.strategyTag,
                baseRisk: option.baseRisk,
                stateFit: option.stateFit,
                sourceCount: option.experienceIds.length,
              })),
              recalledAuthors: event.experiences
                .filter((item) => item.authorKnown)
                .map((item) => item.author),
            }
          : null,
        result: result
          ? {
              label: result.label,
              effectiveRisk: result.effectiveRisk,
              riskOccurred: result.riskOccurred,
              effects: result.effects,
            }
          : null,
        history: history
          .slice(-3)
          .map((item) => ({ age: item.age, title: item.title, choice: item.choice })),
        drawerOpen: drawer,
        customInputOpen: customOpen,
        controls: visibleControls(),
      });
    const advance = (milliseconds: number) => {
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
      setLoadingTick((value) => value + Math.floor(milliseconds / 1700));
    };
    browser.render_game_to_text = render;
    browser.advanceTime = advance;
    return () => {
      if (browser.render_game_to_text === render) delete browser.render_game_to_text;
      if (browser.advanceTime === advance) delete browser.advanceTime;
    };
  }, [profile, state, loading, eventProgress, error, event, result, history, drawer, customOpen]);

  const commitChoice = (choice: ChoiceResult) => {
    if (!event) return;
    const nextState = applyEffects(state, choice.effects);
    const nextHistory = [
      ...history,
      {
        age: state.age,
        year: profile.birthYear + state.age,
        title: event.title,
        choice: choice.label,
        result: choice.result,
        effects: choice.effects,
        eventId: event.id,
        experienceIds: choice.experienceIds,
        eventExperienceIds: event.experiences.map((experience) => experience.id),
        selectedOptionId: choice.optionId,
        customAction: choice.customAction,
        eventSnapshot: {
          background: event.background,
          dilemma: event.dilemma,
          detail: event.detail,
          options: event.options.map(
            ({ id, label, description, experienceIds, strategyTag, stateFit, stateReason }) => ({
              id,
              label,
              description,
              experienceIds,
              strategyTag,
              stateFit,
              stateReason,
            }),
          ),
        },
      },
    ];
    setState(nextState);
    setHistory(nextHistory);
    setResult(choice);
  };
  const choose = (option: GameOption) => {
    const settled = settleChoice(state, profile, option);
    const consequence = settled.consequences.length
      ? ` 后果：${settled.consequences.join("；")}。`
      : "";
    commitChoice({
      label: option.label,
      result: `${settled.riskOccurred ? `${option.result} 风险兑现：${option.setback}` : option.result}${consequence}`,
      effects: settled.effects,
      experienceIds: option.experienceIds,
      optionId: option.id,
      strategyTag: option.strategyTag,
      stateFit: option.stateFit,
      stateReason: option.stateReason,
      effectiveRisk: settled.effectiveRisk,
      riskOccurred: settled.riskOccurred,
    });
  };
  const resolveCustom = async () => {
    if (!event || !custom.trim()) return;
    setLoading(true);
    try {
      const response = await fetch("/api/custom-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, state, action: custom }),
      });
      const resolved = await readJsonResponse<CustomActionResponse>(response, "自由行动");
      const settled = settleChoice(state, profile, {
        ...resolved,
        id: "A",
        description: resolved.result,
        tone: "自",
      });
      commitChoice({
        ...resolved,
        optionId: "CUSTOM",
        customAction: resolved.sanitizedAction,
        effects: settled.effects,
        result: `${settled.riskOccurred ? `${resolved.result} 风险兑现：${resolved.setback}` : resolved.result}${settled.consequences.length ? ` 后果：${settled.consequences.join("；")}。` : ""}`,
        effectiveRisk: settled.effectiveRisk,
        riskOccurred: settled.riskOccurred,
      });
      setCustomOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "自由行动失败");
    } finally {
      setLoading(false);
    }
  };
  const next = () => {
    if (state.age >= projectedLifeEndAge(state, profile) || state.age >= 100)
      return onEnd(state, history);
    const nextState = { ...state, age: advanceAge(state.age, profile.precision) };
    setState(nextState);
    setResult(null);
    setCustom("");
    fetchEvent(nextState, history);
  };
  const loadingMessages = [
    "正在翻阅相似的人生卷宗",
    "从 6,263 组向量中寻找同路人",
    "比对那些不同选择的后来",
    "主笔正在把证据写成这一幕",
  ];

  if (loading)
    return (
      <main className="game-shell">
        <header className="game-topbar">
          <div className="mini-brand">知 / 重启人生</div>
          <div className="game-date">
            <b>{profile.birthYear + state.age}</b>
            <span>{state.age} YEAR OLD</span>
          </div>
          <button className="restart-button" onClick={onRestart}>
            <RotateCcw size={14} /> 重新投胎
          </button>
        </header>
        <div className="game-layout">
          <StatRail state={state} />
          <section className="event-stage">
            <div className="loading-file">
              <LoaderCircle className="spin" size={42} />
              <span>LIVE GENERATION</span>
              <h2>
                {eventProgress?.message || loadingMessages[loadingTick % loadingMessages.length]}
              </h2>
              <div className="stream-metrics">
                <b>{((eventProgress?.elapsedMs || 0) / 1000).toFixed(1)}s</b>
                {eventProgress?.evidenceCount !== undefined && (
                  <span>{eventProgress.evidenceCount} 条经历</span>
                )}
                {eventProgress?.firstTokenMs !== undefined && (
                  <span>首 token {(eventProgress.firstTokenMs / 1000).toFixed(1)}s</span>
                )}
                {eventProgress?.completionTokens !== undefined &&
                  eventProgress.completionTokens > 0 && (
                    <span>
                      {eventProgress.tokenCountEstimated ? "约 " : ""}
                      {eventProgress.completionTokens} tokens
                    </span>
                  )}
                {eventProgress?.tokensPerSecond !== undefined &&
                  eventProgress.tokensPerSecond > 0 && (
                    <span>
                      {eventProgress.tokenCountEstimated ? "约 " : ""}
                      {eventProgress.tokensPerSecond} token/s
                    </span>
                  )}
              </div>
              <div className="loading-lines">
                <i />
                <i />
                <i />
              </div>
            </div>
          </section>
          <TimelineRail history={history} />
        </div>
      </main>
    );

  const projectedEndAge = projectedLifeEndAge(state, profile);
  const shouldEnd = state.age >= projectedEndAge || state.age >= 100;
  return (
    <main className="game-shell">
      <header className="game-topbar">
        <div className="mini-brand">知 / 重启人生</div>
        <div className="game-date">
          <b>{profile.birthYear + state.age}</b>
          <span>{state.age} YEAR OLD</span>
        </div>
        <button className="restart-button" onClick={onRestart}>
          <RotateCcw size={14} /> 重新投胎
        </button>
      </header>
      <div className="game-layout">
        <StatRail state={state} />
        <section className="event-stage">
          {error ? (
            <div className="error-file">
              <h2>事件生成失败</h2>
              <p>{error}</p>
              <button className="primary-button" onClick={() => fetchEvent()}>
                重新生成
              </button>
            </div>
          ) : (
            event && (
              <>
                <div className="chapter-line">
                  <span>{event.chapter}</span>
                  <button onClick={() => setDrawer(true)}>
                    <Database size={14} />{" "}
                    {event.experiences.filter((item) => item.authorKnown).length}{" "}
                    位真实答主的人生切片
                  </button>
                </div>
                <article className="event-paper">
                  <div className="paper-index">
                    CASE {String(history.length + 1).padStart(2, "0")}
                  </div>
                  <header>
                    <span>AI 编剧 · 真实证据约束</span>
                    <h1>{event.title}</h1>
                  </header>
                  <div className="event-background">
                    <label>此前的人生</label>
                    <p>{event.background}</p>
                  </div>
                  <div className="event-dilemma">
                    <span className="quote-mark">“</span>
                    <p>{event.dilemma}</p>
                  </div>
                  <p className="event-detail">{event.detail}</p>
                  <div className="resource-pressure">
                    <span>现金：{event.resourceContext.cashBand}</span>
                    <span>健康：{event.resourceContext.healthBand}</span>
                    <span>基础风险修正：+{event.resourceContext.riskModifier}%</span>
                    <span>
                      发展转化：{Math.round(event.resourceContext.developmentConversion * 100)}%
                    </span>
                    <span>当前预期结卷：约 {projectedEndAge} 岁</span>
                  </div>
                  {result ? (
                    <ResultPanel
                      result={result}
                      event={event}
                      onNext={next}
                      ending={shouldEnd}
                      precision={profile.precision}
                    />
                  ) : (
                    <div className="options">
                      <span className="options-label">你会怎么选？</span>
                      {event.options.map((option) => {
                        const matched = event.experiences.filter((item) =>
                          option.experienceIds.includes(item.id),
                        );
                        const knownAuthors = matched.filter((item) => item.authorKnown);
                        const shownRisk = Math.max(
                          3,
                          Math.min(
                            95,
                            Math.round(
                              option.baseRisk +
                                event.resourceContext.riskModifier -
                                profile.talents.insight * 0.8 -
                                profile.talents.luck * 0.7 -
                                profile.talents.grit * 0.35,
                            ),
                          ),
                        );
                        return (
                          <button
                            className="option-card"
                            key={option.id}
                            onClick={() => choose(option)}
                          >
                            <i>{option.id}</i>
                            <div>
                              <b>{option.label}</b>
                              <span>{option.description}</span>
                              <small className="option-mechanics">
                                <strong>{option.strategyTag}</strong>
                                <em>{option.stateFit}</em>
                                <i>风险 {shownRisk}%</i>
                              </small>
                              <small className="state-reason">{option.stateReason}</small>
                              <small className="option-people">
                                <span className="avatar-stack">
                                  {knownAuthors.slice(0, 4).map((item) => (
                                    <AuthorAvatar key={item.id} item={item} />
                                  ))}
                                </span>
                                <strong>
                                  {knownAuthors.length
                                    ? `${knownAuthors.length} 位真实答主做过相近选择`
                                    : `${matched.length} 篇回答支持这条分支`}
                                </strong>
                              </small>
                            </div>
                            <em>{option.tone}</em>
                            <ChevronRight size={19} />
                          </button>
                        );
                      })}
                      <button
                        className="custom-trigger"
                        onClick={() => setCustomOpen((value) => !value)}
                      >
                        <Feather size={16} /> 我有自己的走法
                      </button>
                      {customOpen && (
                        <div className="custom-box">
                          <textarea
                            autoFocus
                            value={custom}
                            maxLength={300}
                            onChange={(e) => setCustom(e.target.value)}
                            placeholder="比如：我先请一个月假，去目标行业做几次访谈，再决定要不要辞职……"
                          />
                          <div>
                            <span>{custom.length}/300</span>
                            <button disabled={!custom.trim() || loading} onClick={resolveCustom}>
                              让人生回应 <ArrowRight size={15} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
                <div className="evidence-footnote">
                  <span>＊</span>{" "}
                  昵称、头像、主页和回答链接均来自知乎原始数据；缺失时不会生成替代身份。
                </div>
              </>
            )
          )}
        </section>
        <TimelineRail history={history} />
      </div>
      {drawer && event && <SourceDrawer event={event} onClose={() => setDrawer(false)} />}
    </main>
  );
}

function Ending({
  profile,
  state,
  history,
  onRestart,
}: {
  profile: Profile;
  state: LifeState;
  history: TimelineEntry[];
  onRestart: () => void;
}) {
  const score = Math.round(
    (state.health +
      state.happiness +
      state.knowledge +
      state.connections +
      state.career +
      state.assets +
      state.cash) /
      7,
  );
  const title =
    score >= 75
      ? "把选择活成了自己的答案"
      : score >= 58
        ? "在几次转弯后找到了节奏"
        : score >= 42
          ? "没有标准结局的普通英雄"
          : "仍愿意为下一次选择醒来";
  const top = [...statMeta].sort((a, b) => state[b[0]] - state[a[0]]).slice(0, 3);
  return (
    <main className="ending-shell">
      <div className="ending-card">
        <span className="ending-kicker">LIFE FILE / CLOSED</span>
        <h1>
          {profile.name}，<br />
          你这一生——<em>{title}</em>
        </h1>
        <p>
          你从 {profile.birthYear} 年走到 {profile.birthYear + state.age} 年，一共亲手作出{" "}
          {history.length} 次选择。这里没有“人生赢家”判定，只有你最终保留下来的东西。
        </p>
        <div className="ending-score">
          <strong>{score}</strong>
          <span>
            人生丰度
            <br />
            LIFE DENSITY
          </span>
        </div>
        <div className="ending-highlights">
          {top.map(([key, label, Icon]) => (
            <div key={key}>
              <Icon />
              <span>{label}</span>
              <b>{state[key]}</b>
            </div>
          ))}
        </div>
        <div className="ending-quotes">
          {history.slice(-3).map((item) => (
            <blockquote key={item.eventId}>
              <span>
                {item.age} 岁 · {item.choice}
              </span>
              {item.result}
            </blockquote>
          ))}
        </div>
        <button className="primary-button" onClick={onRestart}>
          带着记忆，再活一次 <RotateCcw size={17} />
        </button>
      </div>
    </main>
  );
}

export function RestartLife({ stats }: { stats: Stats }) {
  const [screen, setScreen] = useState<Screen>("landing");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<LifeState | null>(null);
  const [history, setHistory] = useState<TimelineEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [oauthMessage, setOauthMessage] = useState("");
  useEffect(() => setSaved(Boolean(localStorage.getItem("restart-life-save"))), []);
  const refreshAuth = async () => {
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      const payload = await readJsonResponse<AuthStatus>(response, "读取知乎登录状态");
      setAuth(payload);
      if (payload.error) setOauthMessage(payload.error.message);
      else if (payload.authorized)
        setOauthMessage(
          payload.stateVerified === false
            ? "知乎账号已连接；平台回调未返回 state，本次仅作为黑客松联调登录。"
            : "知乎账号已连接。",
        );
      else if (!payload.configured)
        setOauthMessage(
          `知乎登录缺少服务端配置：${payload.missingConfiguration.join("、") || "未知配置"}。`,
        );
    } catch (error) {
      setOauthMessage(error instanceof Error ? error.message : "暂时无法读取知乎登录状态");
    }
  };
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("oauth");
    if (result === "configuration")
      setOauthMessage("知乎登录服务端凭据不完整，请查看缺失配置后重试。");
    if (result === "error") setOauthMessage("知乎授权失败，请查看登录状态后重试。");
    void refreshAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (screen === "game") return;
    const browser = window as BrowserTestWindow;
    const render = () =>
      JSON.stringify({
        coordinateSystem:
          "DOM viewport with origin at top-left; controls follow visual reading order",
        screen,
        stats,
        profile,
        state,
        historyCount: history.length,
        savedGameAvailable: saved,
        visibleText:
          document.querySelector("main")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 1800) ||
          "",
        controls: visibleControls(),
      });
    const advance = (_milliseconds: number) => {};
    browser.render_game_to_text = render;
    browser.advanceTime = advance;
    return () => {
      if (browser.render_game_to_text === render) delete browser.render_game_to_text;
      if (browser.advanceTime === advance) delete browser.advanceTime;
    };
  }, [screen, stats, profile, state, history, saved]);
  const begin = (nextProfile: Profile) => {
    const nextState = initialState(nextProfile);
    setProfile(nextProfile);
    setState(nextState);
    setHistory([]);
    setScreen("game");
  };
  const resume = () => {
    try {
      const data = JSON.parse(localStorage.getItem("restart-life-save") || "");
      setProfile(data.profile);
      setState(data.state);
      setHistory(data.history || []);
      setScreen("game");
    } catch {
      setSaved(false);
    }
  };
  const restart = () => {
    localStorage.removeItem("restart-life-save");
    setSaved(false);
    setProfile(null);
    setState(null);
    setHistory([]);
    setScreen("setup");
  };
  const finish = (finalState: LifeState, finalHistory: TimelineEntry[]) => {
    setState(finalState);
    setHistory(finalHistory);
    setScreen("ending");
  };
  const login = () => window.location.assign("/api/auth/start");
  const logout = async () => {
    try {
      await readJsonResponse<{ ok: boolean }>(
        await fetch("/api/auth/logout", { method: "POST" }),
        "退出知乎登录",
      );
      setOauthMessage("已退出知乎账号。");
      await refreshAuth();
    } catch (error) {
      setOauthMessage(error instanceof Error ? error.message : "退出知乎登录失败");
    }
  };
  if (screen === "landing")
    return (
      <Landing
        stats={stats}
        auth={auth}
        oauthMessage={oauthMessage}
        onStart={() => setScreen("setup")}
        onResume={saved ? resume : undefined}
        onLogin={login}
        onLogout={logout}
      />
    );
  if (screen === "setup")
    return (
      <Setup
        accountName={auth?.profile?.name}
        onBack={() => setScreen("landing")}
        onBegin={begin}
      />
    );
  if (screen === "ending" && profile && state)
    return <Ending profile={profile} state={state} history={history} onRestart={restart} />;
  if (profile && state)
    return (
      <Game
        profile={profile}
        initial={state}
        initialHistory={history}
        onEnd={finish}
        onRestart={restart}
      />
    );
  return null;
}
