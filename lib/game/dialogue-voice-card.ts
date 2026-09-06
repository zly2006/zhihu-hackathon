// 对话 Voice Card（V3.3）。
// 只从公开角色字段派生，供 Prompt 提升区分度；不是人格诊断，也不读取 privateState。

import type { DialogueVoiceCard } from "../domain/narrative-experience";
import type { Character } from "../domain/character";
import type { WorldState } from "../domain/world";

function compact(items: string[], maximum: number): string[] {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maximum);
}

function traitMoves(character: Character): string[] {
  const traits = character.core.personalityTraits.join("、");
  const moves: string[] = [];
  if (/(谨慎|理性|克制|务实)/.test(traits)) moves.push("先说具体事实，再说明判断");
  if (/(直接|坦率|果断|坚定)/.test(traits)) moves.push("明确说出分歧，不用含糊暗示替代");
  if (/(温和|体贴|照顾|共情)/.test(traits)) moves.push("先回应对方感受，再给出自己的边界");
  if (/(幽默|活泼|乐观)/.test(traits)) moves.push("可用轻微玩笑缓和气氛，但不能回避关键问题");
  return compact(moves, 2);
}

function emotionGuidance(emotion: string | undefined): string {
  switch (emotion?.trim()) {
    case "开心":
    case "高兴":
      return "情绪积极但不浮夸，允许保留现实顾虑。";
    case "愤怒":
    case "生气":
      return "句子可以短，但必须指出具体行为或事实，不能人身攻击。";
    case "难过":
    case "低落":
      return "表达可以克制，不要把沉默误写成同意。";
    case "思考":
      return "先停顿或追问信息，再给出暂定判断。";
    default:
      return "保持自然口语，用具体事实推进对话。";
  }
}

export function buildDialogueVoiceCard(character: Character): DialogueVoiceCard {
  const baseStyle = character.speechStyle?.trim() || "表达自然，先说当下事实";
  const values = compact(character.core.values, 2);
  const preferredMoves = traitMoves(character);
  if (!preferredMoves.length)
    preferredMoves.push("回应对方上一句中的具体信息", "给出可执行的下一步");
  return {
    characterId: character.id,
    characterName: character.identity.name,
    voiceSummary: `${baseStyle}${values.length ? `；重视：${values.join("、")}` : ""}`,
    preferredMoves,
    avoid: ["套话式安慰", "替玩家或其他角色作决定", "重复上一句的结论"],
    emotionGuidance: emotionGuidance(character.emotionState),
  };
}

export function buildDialogueVoiceCards(world: WorldState): DialogueVoiceCard[] {
  return Object.values(world.characters)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(buildDialogueVoiceCard);
}
