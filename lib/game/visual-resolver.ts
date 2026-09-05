import type { DialogueCharacter } from "../domain/dialogue";
import type { SceneCue } from "../domain/scene";

export type CharacterVisualProfile = {
  src?: string;
  assetUrl?: string;
  spriteUrl?: string;
  avatarUrl?: string;
  characterId?: string;
  emotion?: string;
  pose?: string;
  animation?: string;
  animationClass?: string;
  alt?: string;
  [key: string]: unknown;
};

export type VisualResolverInput = {
  characterId: string;
  emotion?: string;
  pose?: string;
  animation?: string;
  profileMap?: Record<string, CharacterVisualProfile | CharacterVisualProfile[]>;
  profiles?: Record<string, CharacterVisualProfile | CharacterVisualProfile[]>;
  avatarFallback?: string | { src?: string; assetUrl?: string; spriteUrl?: string; avatarUrl?: string; alt?: string } | null;
  name?: string;
};

export type ResolvedCharacterVisual = {
  kind: "exact" | "neutral" | "avatar" | "placeholder";
  characterId: string;
  src?: string;
  alt: string;
  animationClass?: string;
  profile?: CharacterVisualProfile;
};

export type SceneCharacterVisualProjection = {
  character: DialogueCharacter;
  cue?: SceneCue;
  visual: ResolvedCharacterVisual;
};

function usable(profile: CharacterVisualProfile | undefined): profile is CharacterVisualProfile {
  return Boolean(
    profile &&
      [profile.src, profile.assetUrl, profile.spriteUrl, profile.avatarUrl].some(
        (source) => typeof source === "string" && source.trim().length > 0,
      ),
  );
}

function entries(map: Record<string, CharacterVisualProfile | CharacterVisualProfile[]> | undefined) {
  return Object.entries(map ?? {}).flatMap(([key, value]) =>
    Array.isArray(value) ? value.map((profile) => ({ key, profile })) : [{ key, profile: value }],
  );
}

function matches(profile: CharacterVisualProfile, input: VisualResolverInput, exact: boolean): boolean {
  if (profile.characterId !== undefined && profile.characterId !== input.characterId) return false;
  if (exact) {
    return profile.emotion === input.emotion && profile.pose === input.pose && profile.animation === input.animation;
  }
  return profile.emotion === undefined || profile.emotion === "neutral" || profile.emotion === "平静";
}

function resolveProfile(input: VisualResolverInput, exact: boolean): CharacterVisualProfile | undefined {
  const map = input.profileMap ?? input.profiles;
  const requestedKeys = exact
    ? [
        `${input.characterId}|${input.emotion ?? ""}|${input.pose ?? ""}|${input.animation ?? ""}`,
        `${input.characterId}:${input.emotion ?? ""}:${input.pose ?? ""}:${input.animation ?? ""}`,
      ]
    : [`${input.characterId}|neutral`, `${input.characterId}:neutral`, `${input.characterId}|平静`, `${input.characterId}:平静`, input.characterId, "default"];
  for (const key of requestedKeys) {
    const value = map?.[key];
    const candidates = Array.isArray(value) ? value : value ? [value] : [];
    const found = candidates.find((profile) => usable(profile) && (key === requestedKeys[0] || matches(profile, input, exact)));
    if (found) return found;
  }
  return entries(map).find(({ profile, key }) => usable(profile) && (key === input.characterId || matches(profile, input, exact)))?.profile;
}

function sourceOf(profile: CharacterVisualProfile): string {
  return profile.src ?? profile.assetUrl ?? profile.spriteUrl ?? profile.avatarUrl ?? "";
}

export function resolveCharacterVisual(input: VisualResolverInput): ResolvedCharacterVisual {
  const exact = resolveProfile(input, true);
  if (exact) {
    return {
      kind: "exact",
      characterId: input.characterId,
      src: sourceOf(exact),
      alt: exact.alt ?? input.name ?? input.characterId,
      ...(exact.animationClass ? { animationClass: exact.animationClass } : {}),
      profile: exact,
    };
  }
  const neutral = resolveProfile(input, false);
  if (neutral) {
    return {
      kind: "neutral",
      characterId: input.characterId,
      src: sourceOf(neutral),
      alt: neutral.alt ?? input.name ?? input.characterId,
      ...(neutral.animationClass ? { animationClass: neutral.animationClass } : {}),
      profile: neutral,
    };
  }
  const avatar = input.avatarFallback;
  const avatarSrc = typeof avatar === "string" ? avatar : avatar?.src ?? avatar?.assetUrl ?? avatar?.spriteUrl ?? avatar?.avatarUrl;
  if (avatarSrc) {
    return { kind: "avatar", characterId: input.characterId, src: avatarSrc, alt: avatar && typeof avatar === "object" ? avatar.alt ?? input.name ?? input.characterId : input.name ?? input.characterId };
  }
  return { kind: "placeholder", characterId: input.characterId, alt: input.name ?? input.characterId };
}

export function resolveSceneCharacterVisuals(input: {
  characters: DialogueCharacter[];
  cues?: SceneCue[];
  profileMap?: Record<string, CharacterVisualProfile | CharacterVisualProfile[]>;
  profiles?: Record<string, CharacterVisualProfile | CharacterVisualProfile[]>;
  avatarFallbacks?: Record<string, string | null | undefined>;
}): SceneCharacterVisualProjection[] {
  const cueMap = new Map<string, SceneCue>();
  for (const cue of input.cues ?? []) cueMap.set(cue.characterId, cue);
  return input.characters.map((character) => {
    const cue = cueMap.get(character.id);
    const emotion = cue?.emotion ?? character.emotion;
    const avatarFallback = Object.prototype.hasOwnProperty.call(input.avatarFallbacks ?? {}, character.id)
      ? input.avatarFallbacks?.[character.id] ?? null
      : character.avatarUrl ?? null;
    const visual = resolveCharacterVisual({
      characterId: character.id,
      emotion,
      pose: cue?.pose,
      animation: cue?.animation,
      profileMap: input.profileMap ?? input.profiles,
      avatarFallback,
      name: character.name,
    });
    return {
      character: {
        ...character,
        ...(emotion ? { emotion } : {}),
        ...(visual.src ? { avatarUrl: visual.src } : {}),
      },
      ...(cue ? { cue } : {}),
      visual,
    };
  });
}
