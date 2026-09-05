export type CharacterVisualProfile = {
  src?: string;
  assetUrl?: string;
  characterId?: string;
  emotion?: string;
  pose?: string;
  animation?: string;
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
  avatarFallback?: string | { src?: string; assetUrl?: string; alt?: string } | null;
  name?: string;
};

export type ResolvedCharacterVisual = {
  kind: "exact" | "neutral" | "avatar" | "placeholder";
  characterId: string;
  src?: string;
  alt: string;
  profile?: CharacterVisualProfile;
};

function usable(profile: CharacterVisualProfile | undefined): profile is CharacterVisualProfile {
  return Boolean(profile && (typeof profile.src === "string" || typeof profile.assetUrl === "string"));
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
  return profile.src ?? profile.assetUrl ?? "";
}

export function resolveCharacterVisual(input: VisualResolverInput): ResolvedCharacterVisual {
  const exact = resolveProfile(input, true);
  if (exact) {
    return { kind: "exact", characterId: input.characterId, src: sourceOf(exact), alt: exact.alt ?? input.name ?? input.characterId, profile: exact };
  }
  const neutral = resolveProfile(input, false);
  if (neutral) {
    return { kind: "neutral", characterId: input.characterId, src: sourceOf(neutral), alt: neutral.alt ?? input.name ?? input.characterId, profile: neutral };
  }
  const avatar = input.avatarFallback;
  const avatarSrc = typeof avatar === "string" ? avatar : avatar?.src ?? avatar?.assetUrl;
  if (avatarSrc) {
    return { kind: "avatar", characterId: input.characterId, src: avatarSrc, alt: avatar && typeof avatar === "object" ? avatar.alt ?? input.name ?? input.characterId : input.name ?? input.characterId };
  }
  return { kind: "placeholder", characterId: input.characterId, alt: input.name ?? input.characterId };
}
