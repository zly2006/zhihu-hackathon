import type { GameSave } from "../domain/chapter";
import type { ZhaoLengBeatId } from "../domain/zhao-leng-runtime";
import {
  ZHAO_LENG_BEAT_SCRIPTS,
  type ZhaoLengRelationshipIntent,
} from "../narrative/zhao-leng-script";
import { getZhaoLengRelationship } from "./zhao-leng-demo";

export type ZhaoLengFacts = {
  choiceByBeat: Partial<Record<ZhaoLengBeatId, "A" | "B" | "C">>;
  firstMeetingWeekend: boolean;
  boundaryRespected: boolean;
  coolingPromiseKept: boolean;
  autonomyRespected: boolean;
  jointArrangementActive: boolean;
  remoteFuture: boolean;
  relationshipIntent: ZhaoLengRelationshipIntent;
  canTogether: boolean;
  completedBeatIds: ZhaoLengBeatId[];
  observedLibraryCard: boolean;
};

function beatIdFromPackageId(packageId: string): ZhaoLengBeatId | undefined {
  return ZHAO_LENG_BEAT_SCRIPTS.find((beat) => packageId.includes(`:${beat.id}:`))?.id;
}

function selectedChoices(save: Pick<GameSave, "sceneActions">): ZhaoLengFacts["choiceByBeat"] {
  const result: ZhaoLengFacts["choiceByBeat"] = {};
  for (const action of save.sceneActions ?? []) {
    const beatId = beatIdFromPackageId(action.packageId);
    if (beatId) result[beatId] = action.choiceId;
  }
  return result;
}

function canTogether(save: GameSave, facts: Omit<ZhaoLengFacts, "canTogether">): boolean {
  const scores = getZhaoLengRelationship(save).scores;
  return (
    scores.closeness >= 55 &&
    scores.trust >= 60 &&
    scores.commitment >= 20 &&
    facts.boundaryRespected &&
    facts.autonomyRespected &&
    facts.jointArrangementActive
  );
}

export function deriveZhaoLengFacts(save: GameSave): ZhaoLengFacts {
  const choiceByBeat = selectedChoices(save);
  const boundaryChoice = choiceByBeat["zl-03-boundary"];
  const coolingChoice = choiceByBeat["zl-06-distance"];
  const choice08 = choiceByBeat["zl-08-choice"];
  const choice09 = choiceByBeat["zl-09-consequence"];
  const choice11 = choiceByBeat["zl-11-future"];
  const base = {
    choiceByBeat,
    firstMeetingWeekend: choiceByBeat["zl-01-message"] === "C",
    boundaryRespected: boundaryChoice === "A" || boundaryChoice === "B",
    coolingPromiseKept: coolingChoice === "A" || coolingChoice === "B",
    autonomyRespected: choice08 !== undefined,
    jointArrangementActive:
      choice09 === "C"
        ? false
        : choice09 === "B"
          ? true
          : choice08 === "A",
    remoteFuture: choiceByBeat["zl-10-letter"] === "C",
    relationshipIntent:
      choice11 === "A"
        ? ("together" as const)
        : choice11 === "B"
          ? ("friends" as const)
          : choice11 === "C"
            ? ("apart" as const)
            : ("undecided" as const),
    completedBeatIds: [...(save.zhaoLeng?.completedBeatIds ?? [])],
    observedLibraryCard: (save.zhaoLeng?.observedClueIds ?? []).includes("library-card"),
  };
  return { ...base, canTogether: canTogether(save, base) };
}

export function zhaoLengFlags(save: GameSave): Record<string, boolean> {
  const facts = deriveZhaoLengFacts(save);
  return {
    ...(save.sceneFlags ?? {}),
    zhaoFirstMeetingWeekend: facts.firstMeetingWeekend,
    zhaoBoundaryRespected: facts.boundaryRespected,
    zhaoCoolingPromiseKept: facts.coolingPromiseKept,
    zhaoAutonomyRespected: facts.autonomyRespected,
    zhaoJointArrangementActive: facts.jointArrangementActive,
    zhaoRemoteFuture: facts.remoteFuture,
    zhaoCanTogether: facts.canTogether,
  };
}
