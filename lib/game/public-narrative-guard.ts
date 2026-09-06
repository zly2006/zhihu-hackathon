import type { WorldState } from "../domain/world";

function privateTexts(world: WorldState): string[] {
  return Object.values(world.characters)
    .flatMap((character) => [
      ...(character.privateState?.hiddenGoals ?? []),
      ...(character.privateState?.hiddenConcerns ?? []),
      ...(character.privateState?.privateBeliefs ?? []),
      ...(character.privateState?.currentEmotionalTrend ? [character.privateState.currentEmotionalTrend] : []),
    ])
    .map((text) => text.trim())
    .filter((text) => text.length >= 4);
}

/**
 * Narrative writers receive only public world facts. This guard is deliberately
 * generic: diagnostics must say that a leak was blocked without echoing the
 * sensitive value into logs, responses, or correction prompts.
 */
export function assertNoPrivateNarrativeLeak(
  value: unknown,
  world: WorldState,
  label = "叙事产物",
): void {
  const rendered = JSON.stringify(value);
  for (const secret of privateTexts(world)) {
    if (rendered.includes(secret)) {
      throw new Error(`${label} 泄漏 NPC 私密状态，已被程序拦截`);
    }
  }
}
