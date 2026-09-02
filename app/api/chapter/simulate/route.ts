import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { ChapterChoice, ChapterDecision } from "@/lib/domain/chapter";
import type { ChapterSpan } from "@/lib/domain/shared";
import type { WorldState } from "@/lib/domain/world";
import { resolveDecision } from "@/lib/game/decision-resolver";
import { retrieveEvidence } from "@/lib/game/evidence-retriever";
import { selectRelevantMemories } from "@/lib/game/memory-selector";
import { runWorldSimulator } from "@/lib/game/world-simulator";
import { validateSimulationOutput, type ValidationContext } from "@/lib/game/simulation-validator";
import { reduceWorldState } from "@/lib/game/world-reducer";
import { runReflectionBatch, applyReflections } from "@/lib/game/reflection-engine";
import { hashState } from "@/lib/game/hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SimulateRequest = {
  worldState: WorldState;
  choice: ChapterChoice;
  selection: { optionId: "A" | "B" | "C" | "CUSTOM"; customAction?: string };
  span: ChapterSpan;
  usedExperienceIds?: string[];
};

export async function POST(request: Request) {
  let body: SimulateRequest;
  try {
    body = (await request.json()) as SimulateRequest;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  const { worldState, choice, selection, span, usedExperienceIds = [] } = body;
  if (!worldState || worldState.schemaVersion !== 1 || !worldState.protagonistId) {
    return NextResponse.json({ error: "无效的 WorldState" }, { status: 400 });
  }
  if (!choice || !Array.isArray(choice.options) || choice.options.length !== 3) {
    return NextResponse.json({ error: "无效的 ChapterChoice" }, { status: 400 });
  }
  if (span !== 1 && span !== 3) return NextResponse.json({ error: "span 必须是 1 或 3" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: "progress" | "complete" | "error", data: object) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const protagonist = worldState.characters[worldState.protagonistId];
        const selectedOption = choice.options.find((option) => option.id === selection.optionId);

        // 1. 组装完整决策
        const decision: ChapterDecision = {
          id: choice.id,
          promptTitle: choice.promptTitle,
          context: choice.context,
          options: choice.options,
          selectedOptionId: selection.optionId,
          customAction: selection.customAction,
          normalizedAction:
            selection.optionId === "CUSTOM"
              ? (selection.customAction ?? "").trim()
              : (selectedOption?.label ?? "").trim(),
        };

        const chapterIndex = worldState.chapterIds.length;
        const startYear = worldState.currentYear;
        const endYear = startYear + span;
        const chapterId = `chapter-${randomUUID()}`;

        // 2. 确定性结果锚点
        send("progress", { stage: "resolving", message: "正在计算本章结果锚点" });
        const resolution = resolveDecision({
          saveId: worldState.gameId,
          chapterIndex,
          decisionId: decision.id,
          normalizedAction: decision.normalizedAction,
          estimatedRisk: selectedOption?.estimatedRisk ?? 50,
          stateFit: selectedOption?.stateFit ?? "可行",
          protagonist,
          eraContext: worldState.eraContext ?? null,
        });

        // 3. 知乎证据召回
        send("progress", { stage: "retrieval", message: "正在召回知乎真实经历" });
        const evidenceBundle = await retrieveEvidence({
          world: worldState,
          decision: choice,
          selectedOptionId: selection.optionId,
          usedExperienceIds,
        });

        // 4. 相关记忆
        const relevantMemories = selectRelevantMemories(worldState);

        const input = {
          chapter: { id: chapterId, startYear, endYear, span },
          protagonistId: worldState.protagonistId,
          characters: Object.values(worldState.characters),
          relationships: Object.values(worldState.relationships),
          relevantMemories,
          openThreads: worldState.openThreads,
          decision,
          resolution,
          evidenceBundle,
          eraContext: worldState.eraContext ?? null,
        };

        const evidenceIds = new Set(
          [
            ...evidenceBundle.backgroundSimilar,
            ...evidenceBundle.decisionSimilar,
            ...evidenceBundle.relationshipRelevant,
            ...evidenceBundle.outcomeContrasts,
          ].map((experience) => experience.id),
        );
        const validationContext: ValidationContext = {
          chapterId,
          startYear,
          endYear,
          span,
          characterIds: new Set(Object.keys(worldState.characters)),
          relationshipIds: new Set(Object.keys(worldState.relationships)),
          evidenceIds,
          currentRealYear: new Date().getFullYear(),
        };

        // 5. World Simulator（校验失败追加具体项重试）
        send("progress", { stage: "generating", message: "正在推演本章世界" });
        let output: import("@/lib/domain/simulation").WorldSimulationOutput | undefined;
        let correction = "";
        for (let attempt = 0; attempt <= 3; attempt += 1) {
          try {
            output = await runWorldSimulator(input, correction ? { correction } : {});
            validateSimulationOutput(output, validationContext);
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : "未通过校验";
            if (attempt === 3) throw error;
            correction = `上次输出未通过程序校验：${message}。请保持原始上下文与引用 id 不变，逐项修正后重新输出完整 JSON。`;
            send("progress", { stage: "validating", message: `第 ${attempt + 1} 次修正：${message}` });
          }
        }
        if (!output) throw new Error("世界推演未能产出有效结果");

        // 6. 应用 delta，产生 stateAfter
        const worldStateAfter = reduceWorldState(worldState, output, { chapterId, endYear });

        // 7. V1.2 角色反思（每章至多一次 Batch；失败 fail-open，不阻断、不修改 canonical）
        send("progress", { stage: "reflecting", message: "正在生成角色内心反思" });
        let finalWorldState = worldStateAfter;
        try {
          const reflectionResult = await runReflectionBatch({
            chapterId,
            year: endYear,
            worldBefore: worldState,
            worldAfter: worldStateAfter,
            events: output.events,
          });
          if (reflectionResult.applied && reflectionResult.reflections.length) {
            finalWorldState = applyReflections(worldStateAfter, reflectionResult.reflections);
            send("progress", {
              stage: "reflecting",
              message: `已生成 ${reflectionResult.reflections.length} 条角色反思`,
            });
          }
        } catch (reflectionError) {
          console.warn("reflection batch fail-open:", reflectionError);
        }

        send("complete", {
          chapterId,
          evidenceBundle,
          resolution,
          simulation: output,
          worldStateAfter: finalWorldState,
          stateBeforeHash: hashState(worldState),
          stateAfterHash: hashState(finalWorldState),
        });
      } catch (error) {
        console.error("world simulation failed", error);
        send("error", { message: error instanceof Error ? error.message : "世界推演失败，请重试" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
