import { NextResponse } from "next/server";
import { validateWorldState } from "@/lib/domain/validate";
import { validateScenePackage } from "@/lib/game/scene-package-validator";
import { createNeutralScenePackages } from "@/lib/game/neutral-scene-package";
import { createNeutralDemoSave } from "@/lib/game/neutral-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOW = "2026-01-01T00:00:00.000Z";

export async function GET() {
  const packages = createNeutralScenePackages(2026);
  const gameSave = createNeutralDemoSave(2026, NOW);
  validateWorldState(gameSave.worldState);
  packages.forEach((packageItem, index) => {
    validateScenePackage(packageItem, {
      world: { ...gameSave.worldState, currentYear: gameSave.worldState.currentYear + index },
      currentYear: gameSave.worldState.currentYear + index,
      flags: {},
    });
  });
  const scenePackage = gameSave.scenePackages?.[gameSave.sceneRuntime?.chapterId ?? packages[0].chapterId] ?? packages[0];
  return NextResponse.json({
    synthetic: true,
    saveKey: "restart-life-neutral-scene-demo-v1",
    gameSave,
    scenePackage,
    packageIds: packages.map((packageItem) => packageItem.id),
  });
}
