// 预设头像注册表（V1.3）
// 与 docs/ui-prototypes/protagonist-creation-lab 的头像预设保持同一契约：
// 6 个预设复用 4 张本地人物资源，只代表视觉身份，不推断人格。
// 资源副本位于 public/life/avatars/（生产可访问）。

export type AvatarPreset = {
  id: string;
  label: string; // 气质标签
  src: string; // 生产路径
  fullPortrait?: boolean;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "calm", label: "沉静", src: "/life/avatars/urban-zhou-avatar-v1.png" },
  { id: "bright", label: "明朗", src: "/life/avatars/urban-wanghao-avatar-v1.png" },
  { id: "gentle", label: "温柔", src: "/life/avatars/urban-linyu.png", fullPortrait: true },
  { id: "resolute", label: "坚定", src: "/life/avatars/healing-linyu.png", fullPortrait: true },
  { id: "rational", label: "理性", src: "/life/avatars/urban-wanghao-avatar-v1.png" },
  { id: "free", label: "自由", src: "/life/avatars/healing-linyu.png", fullPortrait: true },
];

export function findAvatarPreset(id: string): AvatarPreset | undefined {
  return AVATAR_PRESETS.find((preset) => preset.id === id);
}

// 角色头像解析：优先 Character.visual，其次预设注册表，最后占位。
export function resolveAvatarUrl(args: {
  avatarId?: string;
  avatarUrl?: string;
}): string | null {
  if (args.avatarUrl) return args.avatarUrl;
  if (args.avatarId) return findAvatarPreset(args.avatarId)?.src ?? null;
  return null;
}
