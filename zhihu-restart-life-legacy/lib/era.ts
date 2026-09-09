import type {
  Effect,
  EraContext,
  EraMechanism,
  EraSettlementAdjustments,
  LifeState,
  Profile,
  TimelineEntry,
} from "./types";

type EraFrame = {
  minAge: number;
  maxAge: number;
  domain: string;
  ageFrame: string;
  keywords: string[];
  mechanisms: string[];
};

type EraDefinition = {
  id: string;
  title: string;
  startYear: number;
  endYear: number;
  summary: string;
  baseRelevance: number;
  sensitivity: Array<keyof Omit<LifeState, "age">>;
  frames: EraFrame[];
  settlement: EraSettlementAdjustments;
};

const eraDefinitions: EraDefinition[] = [
  {
    id: "sars-2003",
    title: "非典时期",
    startYear: 2003,
    endYear: 2003,
    summary: "公共卫生事件改变了学校、工作、就医与家庭照护安排，但具体影响因地区和生活阶段而异。",
    baseRelevance: 0.68,
    sensitivity: ["health", "cash", "happiness"],
    frames: [
      {
        minAge: 0,
        maxAge: 17,
        domain: "education",
        ageFrame: "学校秩序和家庭照护可能变化，未成年人主要通过监护人和学校作出应对。",
        keywords: ["非典", "停课", "居家", "学校", "家庭照护", "健康"],
        mechanisms: ["调整学习安排", "家庭防护", "寻求学校支持"],
      },
      {
        minAge: 18,
        maxAge: 59,
        domain: "career",
        ageFrame: "工作、出行和收入可能受到扰动，需要在健康防护与生计之间重新安排。",
        keywords: ["非典", "工作", "停工", "收入", "防护", "家庭"],
        mechanisms: ["降低暴露", "调整工作方式", "利用新需求"],
      },
      {
        minAge: 60,
        maxAge: 100,
        domain: "health_life",
        ageFrame: "就医、慢性病管理和家庭联系受到更直接的公共卫生压力。",
        keywords: ["非典", "就医", "健康", "隔离", "家人", "照护"],
        mechanisms: ["医疗防护", "家庭协作", "调整生活节奏"],
      },
    ],
    settlement: {
      protect: { risk: -5, success: { health: 1, happiness: 1 }, setback: { health: 1 } },
      adapt: { risk: 0, success: { knowledge: 1 }, setback: {} },
      leverage: { risk: 4, success: { career: 1, connections: 1 }, setback: { cash: -1 } },
    },
  },
  {
    id: "financial-crisis-2008",
    title: "全球金融危机",
    startYear: 2008,
    endYear: 2009,
    summary: "就业、投资和家庭收入预期转弱，稳定现金流与调整职业路径变得更加重要。",
    baseRelevance: 0.7,
    sensitivity: ["cash", "career", "assets"],
    frames: [
      {
        minAge: 0,
        maxAge: 17,
        domain: "family_relationship",
        ageFrame: "宏观冲击主要通过父母收入、家庭支出和教育预算传导给未成年人。",
        keywords: ["金融危机", "家庭收入", "失业", "教育支出", "节省"],
        mechanisms: ["调整家庭预算", "寻求公共支持", "保留教育机会"],
      },
      {
        minAge: 18,
        maxAge: 29,
        domain: "career",
        ageFrame: "毕业、求职和职业起步遇到招聘收缩，需要在稳定与转向之间取舍。",
        keywords: ["金融危机", "求职", "毕业", "裁员", "转行", "收入"],
        mechanisms: ["保住现金流", "补充技能", "逆周期求职"],
      },
      {
        minAge: 30,
        maxAge: 100,
        domain: "career",
        ageFrame: "工作稳定性、家庭负担和资产价格同时承压，风险敞口需要重新评估。",
        keywords: ["金融危机", "裁员", "投资", "房贷", "家庭", "现金流"],
        mechanisms: ["降低负债", "职业转向", "逆周期配置"],
      },
    ],
    settlement: {
      protect: { risk: -4, success: { cash: 1, assets: 1 }, setback: { cash: 1 } },
      adapt: { risk: 0, success: { knowledge: 1, career: 1 }, setback: {} },
      leverage: { risk: 6, success: { cash: 1, career: 1 }, setback: { cash: -2, assets: -1 } },
    },
  },
  {
    id: "mobile-internet-2012",
    title: "移动互联网扩张期",
    startYear: 2012,
    endYear: 2016,
    summary: "智能手机、平台经济和线上服务快速普及，学习、社交与职业机会开始向线上迁移。",
    baseRelevance: 0.58,
    sensitivity: ["knowledge", "connections", "career"],
    frames: [
      {
        minAge: 6,
        maxAge: 17,
        domain: "education",
        ageFrame: "网络学习与线上娱乐进入日常，需要在新工具、注意力和家庭规则之间建立边界。",
        keywords: ["智能手机", "网络学习", "互联网", "社交平台", "兴趣"],
        mechanisms: ["利用网络学习", "管理注意力", "线上创作"],
      },
      {
        minAge: 18,
        maxAge: 39,
        domain: "career",
        ageFrame: "新平台和新职业扩张，转行、创业和线上积累都出现窗口，同时伴随泡沫与竞争。",
        keywords: ["移动互联网", "创业", "平台", "转行", "产品", "线上业务"],
        mechanisms: ["学习数字技能", "迁移线上业务", "抓住平台窗口"],
      },
      {
        minAge: 40,
        maxAge: 100,
        domain: "career",
        ageFrame: "原有工作和生活服务逐渐数字化，需要决定适应速度与投入程度。",
        keywords: ["互联网", "数字化", "线上业务", "学习", "工作转型"],
        mechanisms: ["渐进适应", "补充技能", "整合原有资源"],
      },
    ],
    settlement: {
      protect: { risk: -3, success: { happiness: 1 }, setback: {} },
      adapt: { risk: -1, success: { knowledge: 1, connections: 1 }, setback: {} },
      leverage: {
        risk: 5,
        success: { career: 1, connections: 1 },
        setback: { cash: -1, happiness: -1 },
      },
    },
  },
  {
    id: "covid-2019",
    title: "新冠疫情时期",
    startYear: 2019,
    endYear: 2022,
    summary: "公共卫生措施、出行限制和经济波动改变了学习、工作、照护与社交方式，影响并非人人相同。",
    baseRelevance: 0.76,
    sensitivity: ["health", "cash", "happiness", "career"],
    frames: [
      {
        minAge: 0,
        maxAge: 5,
        domain: "family_relationship",
        ageFrame: "幼儿照护、父母工作与家庭空间互相挤压，选择主要由监护人完成。",
        keywords: ["疫情", "居家", "幼儿", "父母工作", "家庭照护"],
        mechanisms: ["家庭分工", "减少暴露", "建立居家节奏"],
      },
      {
        minAge: 6,
        maxAge: 17,
        domain: "education",
        ageFrame: "停课和网课改变学习节奏，也放大了设备、空间、自律与家庭支持的差异。",
        keywords: ["疫情", "网课", "停课", "居家学习", "高考", "家庭"],
        mechanisms: ["重建网课节奏", "向学校求助", "保护身心健康"],
      },
      {
        minAge: 18,
        maxAge: 25,
        domain: "career",
        ageFrame: "大学、毕业、实习和求职受到扰动，线上学习与远程机会同时扩大。",
        keywords: ["疫情", "毕业", "实习", "求职", "网课", "远程"],
        mechanisms: ["转向远程机会", "延迟关键决定", "降低生活成本"],
      },
      {
        minAge: 26,
        maxAge: 59,
        domain: "career",
        ageFrame: "收入、远程办公、家庭照护和经营压力交织，需要重新配置现金与时间。",
        keywords: ["疫情", "停工", "远程办公", "收入", "裁员", "家庭照护"],
        mechanisms: ["保住现金流", "调整工作方式", "发展线上渠道"],
      },
      {
        minAge: 60,
        maxAge: 100,
        domain: "health_life",
        ageFrame: "健康风险、就医安排和社会隔离更加突出，家庭支持的重要性上升。",
        keywords: ["疫情", "就医", "健康", "隔离", "老人", "家庭联系"],
        mechanisms: ["降低健康暴露", "安排替代就医", "维持社会联系"],
      },
    ],
    settlement: {
      protect: { risk: -6, success: { health: 1, happiness: 1 }, setback: { health: 1 } },
      adapt: { risk: -1, success: { knowledge: 1, career: 1 }, setback: {} },
      leverage: {
        risk: 5,
        success: { career: 1, connections: 1 },
        setback: { cash: -1, health: -1 },
      },
    },
  },
  {
    id: "education-policy-2021",
    title: "教育培训转型期",
    startYear: 2021,
    endYear: 2022,
    summary: "校外培训行业和家庭教育安排快速变化，学生、家长和从业者面对不同的调整压力。",
    baseRelevance: 0.82,
    sensitivity: ["cash", "knowledge", "career", "happiness"],
    frames: [
      {
        minAge: 6,
        maxAge: 17,
        domain: "education",
        ageFrame: "培训安排和课外时间变化，家庭需要重新决定学习投入、兴趣与休息的边界。",
        keywords: ["双减", "培训班", "学习", "课外", "家长", "教育支出"],
        mechanisms: ["调整学习计划", "发展兴趣", "利用校内支持"],
      },
    ],
    settlement: {
      protect: { risk: -4, success: { cash: 1, happiness: 1 }, setback: { cash: 1 } },
      adapt: { risk: 0, success: { knowledge: 1, career: 1 }, setback: {} },
      leverage: { risk: 5, success: { career: 1, connections: 1 }, setback: { cash: -1 } },
    },
  },
  {
    id: "employment-slowdown-2022",
    title: "就业承压期",
    startYear: 2022,
    endYear: 2026,
    summary: "招聘节奏、行业景气和收入预期承压，稳定生计、延长准备期与职业迁移成为常见选择。",
    baseRelevance: 0.68,
    sensitivity: ["cash", "career", "happiness"],
    frames: [
      {
        minAge: 16,
        maxAge: 25,
        domain: "career",
        ageFrame: "升学、毕业和首次就业竞争加剧，继续准备与尽快获得现金流之间出现张力。",
        keywords: ["就业", "毕业", "求职", "考研", "考公", "收入"],
        mechanisms: ["先获得现金流", "延长准备期", "进入紧缺领域"],
      },
      {
        minAge: 26,
        maxAge: 59,
        domain: "career",
        ageFrame: "行业波动、降薪和岗位收缩增加，需要评估转行成本与家庭安全垫。",
        keywords: ["就业", "降薪", "裁员", "转行", "行业", "现金流"],
        mechanisms: ["守住主业", "低成本转行", "利用既有人脉"],
      },
    ],
    settlement: {
      protect: { risk: -4, success: { cash: 1, happiness: 1 }, setback: { cash: 1 } },
      adapt: { risk: 0, success: { knowledge: 1, career: 1 }, setback: {} },
      leverage: {
        risk: 5,
        success: { career: 1, connections: 1 },
        setback: { cash: -1, happiness: -1 },
      },
    },
  },
];

function vulnerabilityScore(definition: EraDefinition, state: LifeState) {
  return definition.sensitivity.reduce((score, key) => {
    const value = state[key];
    return score + (value < 15 ? 0.08 : value < 35 ? 0.04 : 0);
  }, 0);
}

function hometownAdjustment(profile: Profile, definition: EraDefinition) {
  if (definition.id === "mobile-internet-2012") {
    if (profile.hometown === "北上广深" || profile.hometown === "省会城市") return 0.05;
    if (profile.hometown === "乡村") return -0.03;
  }
  if (definition.id === "covid-2019" && profile.hometown === "北上广深") return 0.03;
  return 0;
}

export function selectEraContext(
  profile: Profile,
  state: LifeState,
  history: TimelineEntry[],
): EraContext | null {
  const year = profile.birthYear + state.age;
  const recentEraIds = history
    .slice(-2)
    .map((entry) => entry.eraContextId)
    .filter(Boolean);
  const candidates = eraDefinitions.flatMap((definition) => {
    if (year < definition.startYear || year > definition.endYear) return [];
    const frame = definition.frames.find(
      (candidate) => state.age >= candidate.minAge && state.age <= candidate.maxAge,
    );
    if (!frame || recentEraIds.at(-1) === definition.id) return [];
    const cooldownPenalty = recentEraIds.includes(definition.id) ? 0.22 : 0;
    const relevance = Math.max(
      0,
      Math.min(
        1,
        definition.baseRelevance +
          vulnerabilityScore(definition, state) +
          hometownAdjustment(profile, definition) -
          cooldownPenalty,
      ),
    );
    return [{ definition, frame, relevance }];
  });
  const selected = candidates.sort((left, right) => right.relevance - left.relevance)[0];
  if (!selected || selected.relevance < 0.5) return null;
  const { definition, frame, relevance } = selected;
  return {
    id: definition.id,
    title: definition.title,
    startYear: definition.startYear,
    endYear: definition.endYear,
    year,
    domain: frame.domain,
    summary: definition.summary,
    ageFrame: frame.ageFrame,
    relevance: Math.round(relevance * 100) / 100,
    intensity: relevance >= 0.82 ? "强烈" : relevance >= 0.66 ? "显著" : "背景",
    keywords: frame.keywords,
    mechanisms: frame.mechanisms,
    adjustments: definition.settlement,
  };
}

export function eraRiskAdjustment(
  context: EraContext | null | undefined,
  option: {
    eraContextId?: string | null;
    eraMechanism?: EraMechanism;
  },
) {
  if (!context || option.eraContextId !== context.id || !option.eraMechanism) return 0;
  if (option.eraMechanism === "none") return 0;
  return (
    eraDefinitions.find((item) => item.id === context.id)?.settlement[option.eraMechanism].risk || 0
  );
}

export function eraEffectAdjustment(
  context: EraContext | null | undefined,
  option: { eraContextId?: string | null; eraMechanism?: EraMechanism },
  riskOccurred: boolean,
) {
  if (!context || option.eraContextId !== context.id || !option.eraMechanism) return {};
  if (option.eraMechanism === "none") return {};
  const settlement = eraDefinitions.find((item) => item.id === context.id)?.settlement[
    option.eraMechanism
  ];
  return settlement ? (riskOccurred ? settlement.setback : settlement.success) : {};
}

export function eraMechanismLabel(mechanism: EraMechanism | undefined) {
  if (mechanism === "protect") return "保护基本盘";
  if (mechanism === "adapt") return "适应变化";
  if (mechanism === "leverage") return "利用时代窗口";
  return "个人选择";
}
