// 视觉身份（V1.3 UI 层）
// 只影响展示，不进入世界模拟语义；缺省时 UI 使用占位头像。
// avatarUrl 为可选的远程/本地头像地址；avatarId 指向 avatar-registry 预设。

export type AvatarSource = "preset" | "zhihu" | "custom";

export type VisualIdentity = {
  avatarSource: AvatarSource;
  avatarId: string;
  avatarUrl?: string;
  avatarLabel?: string; // 中文气质标签，如 "沉静"
  fullPortrait?: boolean; // true = 头像来自整身立绘裁切，需特殊缩放
};

// Character 上的可选视觉字段（GameSave schemaVersion 保持 1，向后兼容）
export type CharacterVisual = {
  avatarId?: string;
  avatarLabel?: string;
  avatarUrl?: string;
  fullPortrait?: boolean;
};
