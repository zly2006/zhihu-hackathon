import type { GameSave } from "../domain/chapter";
import type { ScenePackage, SceneRuntimeState } from "../domain/scene";

export type LiveSceneSession = {
  package: ScenePackage;
  runtime: SceneRuntimeState;
};

export function hasLiveScene(packageItem: ScenePackage): boolean {
  return packageItem.scenes.some((scene) => scene.mode === "live");
}

export function getLiveSceneSession(
  save: Pick<GameSave, "sceneRuntime" | "scenePackages">,
  chapterId: string,
): LiveSceneSession | null {
  const runtime = save.sceneRuntime;
  if (!runtime || runtime.chapterId !== chapterId) return null;
  const packageItem = save.scenePackages?.[chapterId];
  if (
    !packageItem ||
    packageItem.chapterId !== chapterId ||
    packageItem.id !== runtime.packageId ||
    packageItem.version !== runtime.packageVersion
  ) {
    return null;
  }
  const activeScene = packageItem.scenes.find((scene) => scene.id === runtime.sceneId);
  if (!activeScene || activeScene.mode !== "live") return null;
  return { package: packageItem, runtime };
}
