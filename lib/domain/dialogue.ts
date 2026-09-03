import type { CharacterId } from "./shared";

export type DialogueChoiceId = "A" | "B" | "C";

export type DialogueChoice = {
  id: DialogueChoiceId;
  label: string;
};

export type DialogueCharacter = {
  id: CharacterId;
  name: string;
  avatarId?: string;
  avatarUrl?: string;
  position?: "left" | "center" | "right";
  emotion?: string;
};

export type DialogueBlock =
  | {
      type: "narration";
      text: string;
    }
  | {
      type: "dialogue";
      speaker: string;
      speakerId: CharacterId;
      text: string;
      emotion: string;
      avatar?: string;
    }
  | {
      type: "choice";
      text: string;
      choices: DialogueChoice[];
    };

export type DialogueScene = {
  id: string;
  background: string;
  timeLabel?: string;
  characters: DialogueCharacter[];
  blocks: DialogueBlock[];
  choices: DialogueChoice[];
};
