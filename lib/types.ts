export type Stats = {
  snapshots: number;
  candidates: number;
  vectors: number;
  scenarios: number;
};

export type Profile = {
  name: string;
  birthYear: number;
  gender: string;
  hometown: string;
  family: string;
  precision: 1 | 3;
  talents: Record<"insight" | "charm" | "grit" | "learning" | "luck", number>;
};

export type LifeState = {
  age: number;
  cash: number;
  health: number;
  happiness: number;
  knowledge: number;
  connections: number;
  career: number;
  assets: number;
};

export type Effect = Partial<Omit<LifeState, "age">>;

export type ModelConversationMessage = {
  role: "assistant" | "user";
  content: string;
};

export type ResourceContext = {
  cashBand: "生存线" | "紧张" | "稳定" | "宽裕";
  healthBand: "危险" | "透支" | "一般" | "良好";
  incomeOpportunityRequired: boolean;
  recoveryOpportunityRequired: boolean;
  maxCashLoss: number;
  maxHealthLoss: number;
  developmentConversion: number;
};

export type Experience = {
  id: string;
  title: string;
  url: string;
  avatar: string | null;
  author: string;
  authorUrl: string | null;
  authorKnown: boolean;
  excerpt: string;
  action: string;
  outcome: string;
  similarity: number;
};

export type GameOption = {
  id: "A" | "B" | "C";
  label: string;
  description: string;
  tone: string;
  effects: Effect;
  setbackEffects: Effect;
  result: string;
  experienceIds: string[];
  strategyTag: string;
  baseRisk: number;
  stateFit: "顺势" | "可行" | "吃力";
  stateReason: string;
  setback: string;
};

export type GameEvent = {
  id: string;
  age: number;
  year: number;
  chapter: string;
  title: string;
  background: string;
  dilemma: string;
  detail: string;
  domain: string;
  options: GameOption[];
  experiences: Experience[];
  evidenceCount: number;
  modelEnhanced: boolean;
  timeShift?: string;
  resourceContext: ResourceContext;
  generationMetrics?: {
    retrievalMs: number;
    promptChars: number;
    firstTokenMs: number | null;
    modelDurationMs: number;
    completionTokens: number;
    tokenCountEstimated: boolean;
    tokensPerSecond: number;
    promptCacheHitTokens: number;
    promptCacheMissTokens: number;
    totalMs: number;
  };
  modelConversation: ModelConversationMessage[];
};

export type EventStreamProgress = {
  stage: "retrieval" | "prompt" | "connected" | "generating" | "retrying" | "validating";
  title: string;
  subtitle: string;
  message?: string;
  elapsedMs: number;
  evidenceCount?: number;
  promptChars?: number;
  firstTokenMs?: number;
  completionTokens?: number;
  tokenCountEstimated?: boolean;
  tokensPerSecond?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
};

export type TimelineEntry = {
  age: number;
  year: number;
  title: string;
  choice: string;
  result: string;
  effects: Effect;
  eventId: string;
  experienceIds: string[];
  eventExperienceIds?: string[];
  selectedOptionId: "A" | "B" | "C" | "CUSTOM";
  customAction?: string;
  modelConversation?: ModelConversationMessage[];
  eventSnapshot: {
    background: string;
    dilemma: string;
    detail: string;
    options: Array<
      Pick<
        GameOption,
        | "id"
        | "label"
        | "description"
        | "experienceIds"
        | "strategyTag"
        | "stateFit"
        | "stateReason"
      >
    >;
  };
};
