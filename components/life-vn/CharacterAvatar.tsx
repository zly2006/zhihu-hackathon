"use client";

import type { CSSProperties } from "react";
import type { DialogueCharacter } from "@/lib/domain/dialogue";
import type { SceneCue } from "@/lib/domain/scene";

type CharacterPosition = NonNullable<DialogueCharacter["position"]>;

function getPosition(character: DialogueCharacter): CharacterPosition {
  return character.position ?? "center";
}

function getInitial(name: string): string {
  return name.trim().slice(0, 1) || "?";
}

// 角色立绘层只消费 DialogueScene 的公开角色信息，不读取 Character.privateState。
export function CharacterAvatar({
  characters,
  activeCharacterId,
  fallbackCharacter,
  cues,
  cueKey,
}: {
  characters?: DialogueCharacter[];
  activeCharacterId?: string | null;
  fallbackCharacter?: DialogueCharacter;
  cues?: SceneCue[];
  cueKey?: string;
}) {
  const visibleCharacters = characters?.length ? characters : fallbackCharacter ? [fallbackCharacter] : [];
  const positionCounts = visibleCharacters.reduce<Map<CharacterPosition, number>>((counts, character) => {
    const position = getPosition(character);
    counts.set(position, (counts.get(position) ?? 0) + 1);
    return counts;
  }, new Map());
  const positionSlots = new Map<CharacterPosition, number>();
  const cueMap = new Map((cues ?? []).map((cue) => [cue.characterId, cue]));
  return (
    <div className="life-vn-character-layer" aria-label="场景角色">
      {visibleCharacters.map((character) => {
        const position = getPosition(character);
        const active = activeCharacterId ? activeCharacterId === character.id : true;
        const slot = positionSlots.get(position) ?? 0;
        positionSlots.set(position, slot + 1);
        const count = positionCounts.get(position) ?? 1;
        const cue = cueMap.get(character.id);
        const animation = cue?.animation;
        const style: CSSProperties & Record<string, string> = {
          "--lv-character-offset": `${(slot - (count - 1) / 2) * 18}px`,
        };
        return (
          <div
            key={character.id}
            className={`life-vn-character life-vn-character-${position}${active ? " active" : ""}${animation ? ` life-vn-character-animation-${animation}` : ""}`}
            data-character-id={character.id}
            data-character-position={position}
            data-character-animation={animation}
            data-character-pose={cue?.pose}
            data-cue-key={cueKey}
            aria-current={active ? "true" : undefined}
            aria-label={`${character.name}${character.emotion ? ` · ${character.emotion}` : ""}`}
            style={style}
          >
            <div key={`${character.id}:${cueKey ?? "base"}:${animation ?? "idle"}:${cue?.pose ?? ""}`} className="life-vn-character-figure">
              {character.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={character.avatarUrl} alt="" />
              ) : (
                <span className="life-vn-character-placeholder" aria-hidden="true">
                  {getInitial(character.name)}
                </span>
              )}
            </div>
            <div className="life-vn-character-caption">
              <b>{character.name}</b>
              {character.emotion && <small>{character.emotion}</small>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
