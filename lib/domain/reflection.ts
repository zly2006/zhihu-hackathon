// CharacterReflection（V1.2 迭代方案 §5.2）
// 每章 canonical 模拟完成后，为真正受影响的角色生成的私有心理反思。
// 反思内容 private：不进入玩家可见 UI、不进入 NarrativePlan；只影响
// privateState（信念/情绪趋势）与目标优先级，供后续 World Simulator 读取。

import type { ChapterId, CharacterId, MemoryId } from "./shared";

export const EMOTIONAL_TRENDS = [
  "hopeful",
  "stable",
  "anxious",
  "resentful",
  "withdrawn",
  "attached",
  "ambivalent",
] as const;

export type EmotionalTrend = (typeof EMOTIONAL_TRENDS)[number];

export type ReflectionBeliefChange = {
  topic: string;
  from?: string;
  to: string;
  strength: number; // 0-100
};

export type ReflectionGoalPressure = {
  goalId: string;
  direction: "increase" | "decrease";
  amount: number; // 1-30
  reason: string;
};

export type CharacterReflection = {
  id: string;
  characterId: CharacterId;
  chapterId: ChapterId;
  year: number;
  basedOnMemoryIds: MemoryId[];
  insight: string;
  beliefChanges: ReflectionBeliefChange[];
  goalPressure: ReflectionGoalPressure[];
  emotionalTrend: EmotionalTrend;
  private: true;
};

// Reflection Batch 的一次输入上下文（Prompt 组装与校验共用）
export type ReflectionBatchContext = {
  chapterId: ChapterId;
  year: number;
  candidateIds: CharacterId[];
  // 角色可见信息 + 私有状态（反射输入允许读私有状态，输出仍私有）
  characters: Record<CharacterId, {
    name: string;
    age: number;
    personalityTraits: string[];
    privateState: {
      hiddenGoals: string[];
      hiddenConcerns: string[];
      privateBeliefs: string[];
      currentEmotionalTrend?: string;
    };
    currentGoals: Array<{ id: string; label: string; priority: number; status: string }>;
  }>;
  // 本章相关事件/关系变化摘要
  chapterDigest: string;
  // 合法 id 白名单
  allowedMemoryIds: MemoryId[];
  // 最近既往反思摘要（截断，防止 Prompt 无限增长）
  priorReflectionDigest: Record<CharacterId, string>;
};
