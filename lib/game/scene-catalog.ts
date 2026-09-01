// 生产场景目录（V1.3）
// 与 docs/ui-prototypes/galgame-style-lab/scene-catalog.json 同源契约（batch-01，3 族 4 张）。
// 资源副本位于 public/life/scenes/（生产可访问）；该表是 /life 运行时场景匹配的唯一来源。
// 新增背景时：生成图片 → 复制到 public/life/scenes/ → 在 SCENES 追加条目 → 同步实验台 JSON。

export type SceneFamilyId = "home" | "work" | "public";

export type SceneDef = {
  id: string;
  familyId: SceneFamilyId;
  label: string;
  assetUrl: string; // 生产 URL（/life/scenes/...）
  timeOfDay: "day" | "evening" | "night";
  weather: "clear" | "cloudy" | "rain";
  eraMin: number;
  eraMax: number;
  narrativeTags: string[];
  backgroundPositionDesktop: string;
  backgroundPositionMobile: string;
  portraitLight: string;
};

export const SCENES: SceneDef[] = [
  {
    id: "urban-home-apartment-night-v1",
    familyId: "home",
    label: "都市公寓 · 夜",
    assetUrl: "/life/scenes/urban-background.png",
    timeOfDay: "night",
    weather: "clear",
    eraMin: 2015,
    eraMax: 2035,
    narrativeTags: ["relationship-talk", "private-decision", "moving", "financial-pressure", "quiet-night"],
    backgroundPositionDesktop: "center center",
    backgroundPositionMobile: "44% center",
    portraitLight: "cool-left + warm-right-rim",
  },
  {
    id: "urban-home-apartment-day-v1",
    familyId: "home",
    label: "都市公寓 · 日",
    assetUrl: "/life/scenes/urban-home-apartment-day-v1.png",
    timeOfDay: "day",
    weather: "cloudy",
    eraMin: 2015,
    eraMax: 2035,
    narrativeTags: ["daily-life", "family-visit", "remote-work", "packing", "recovery", "weekend"],
    backgroundPositionDesktop: "center center",
    backgroundPositionMobile: "44% center",
    portraitLight: "soft-left-daylight",
  },
  {
    id: "urban-work-office-day-v1",
    familyId: "work",
    label: "现代办公室 · 日",
    assetUrl: "/life/scenes/urban-work-office-day-v1.png",
    timeOfDay: "day",
    weather: "clear",
    eraMin: 2015,
    eraMax: 2035,
    narrativeTags: ["interview", "career-choice", "team-conflict", "promotion", "layoff", "overtime", "training"],
    backgroundPositionDesktop: "center center",
    backgroundPositionMobile: "48% center",
    portraitLight: "soft-left-daylight + top-fill",
  },
  {
    id: "urban-public-cafe-rain-v1",
    familyId: "public",
    label: "临窗咖啡馆 · 雨夜",
    assetUrl: "/life/scenes/urban-public-cafe-rain-v1.png",
    timeOfDay: "evening",
    weather: "rain",
    eraMin: 2015,
    eraMax: 2035,
    narrativeTags: ["date", "reunion", "confession", "breakup", "friend-talk", "waiting", "chance-encounter"],
    backgroundPositionDesktop: "center center",
    backgroundPositionMobile: "46% center",
    portraitLight: "cool-left-window + warm-right-key",
  },
];

export function findScene(id: string): SceneDef | undefined {
  return SCENES.find((scene) => scene.id === id);
}

export const DEFAULT_SCENE_ID = "urban-home-apartment-night-v1";

// 依据章节/场景文本关键字匹配背景；无匹配回退默认夜景。
// 关键字优先级：地点 > 时间/天气。纯规则、确定性，供测试与 UI 复用。
const SCENE_KEYWORD_RULES: Array<{ sceneId: string; keywords: string[] }> = [
  { sceneId: "urban-work-office-day-v1", keywords: ["办公室", "公司", "职场", "工位", "会议室", "面试", "上班"] },
  { sceneId: "urban-public-cafe-rain-v1", keywords: ["咖啡馆", "咖啡厅", "咖啡", "临窗", "雨夜", "雨天", "下雨", "约会"] },
  { sceneId: "urban-home-apartment-day-v1", keywords: ["日", "白天", "上午", "下午", "清晨", "正午", "周末"] },
];

export function pickSceneForNovelScene(input: {
  timeLabel?: string;
  heading?: string;
  text?: string;
}): SceneDef {
  const haystack = [input.timeLabel, input.heading, input.text].filter(Boolean).join(" ");
  for (const rule of SCENE_KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      const scene = findScene(rule.sceneId);
      if (scene) return scene;
    }
  }
  return findScene(DEFAULT_SCENE_ID) as SceneDef;
}
