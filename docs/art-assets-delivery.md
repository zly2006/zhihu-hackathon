# Galgame 美术资产交付报告

生成日期：2026-09-12

## 风格分析总结

现有角色表采用约 2.5 头身的 Q 版比例：大头大眼、短四肢、轮廓线清晰，使用柔和的赛璐璐分层与高光；服装保留校园制服、针织衫、领结和皮鞋等识别点。新差分沿用原始发色、服装配色、线稿和透明边缘，仅改变脸部表情与手势，并保留头顶的轻量情绪符号。原始角色表为 1536×1024 三姿态布局，拆出的单姿态交付图为 512×1024。

## 新增资产清单

| 文件 | PNG 源大小 | WebP 大小 | 尺寸 / Alpha |
|---|---:|---:|---|
| `public/art/f1_happy.webp` | 504,285 B | 83,132 B | 512×1024 / RGBA |
| `public/art/f1_surprised.webp` | 1,409,486 B | 100,446 B | 512×1024 / RGBA |
| `public/art/f1_thinking.webp` | 1,370,898 B | 95,604 B | 512×1024 / RGBA |
| `public/art/f2_happy.webp` | 449,732 B | 67,314 B | 512×1024 / RGBA |
| `public/art/f2_surprised.webp` | 1,397,272 B | 79,358 B | 512×1024 / RGBA |
| `public/art/f2_thinking.webp` | 1,388,119 B | 79,604 B | 512×1024 / RGBA |
| `public/art/f3_happy.webp` | 599,374 B | 100,028 B | 512×1024 / RGBA |
| `public/art/f3_surprised.webp` | 1,645,082 B | 114,760 B | 512×1024 / RGBA |
| `public/art/f3_thinking.webp` | 1,592,861 B | 107,748 B | 512×1024 / RGBA |
| `public/art/f4_happy.webp` | 607,024 B | 90,136 B | 512×1024 / RGBA |
| `public/art/f4_surprised.webp` | 1,643,676 B | 104,158 B | 512×1024 / RGBA |
| `public/art/f4_thinking.webp` | 1,628,919 B | 101,250 B | 512×1024 / RGBA |
| `public/art/m1_happy.webp` | 496,763 B | 72,692 B | 512×1024 / RGBA |
| `public/art/m1_surprised.webp` | 1,431,229 B | 85,804 B | 512×1024 / RGBA |
| `public/art/m1_thinking.webp` | 1,365,163 B | 81,854 B | 512×1024 / RGBA |
| `public/art/m2_happy.webp` | 391,942 B | 63,486 B | 512×1024 / RGBA |
| `public/art/m2_surprised.webp` | 1,260,282 B | 75,312 B | 512×1024 / RGBA |
| `public/art/m2_thinking.webp` | 1,197,771 B | 67,192 B | 512×1024 / RGBA |
| `public/art/m3_happy.webp` | 442,331 B | 75,848 B | 512×1024 / RGBA |
| `public/art/m3_surprised.webp` | 1,375,346 B | 79,878 B | 512×1024 / RGBA |
| `public/art/m3_thinking.webp` | 1,333,556 B | 76,142 B | 512×1024 / RGBA |
| `public/art/m4_happy.webp` | 432,943 B | 69,498 B | 512×1024 / RGBA |
| `public/art/m4_surprised.webp` | 1,374,980 B | 76,528 B | 512×1024 / RGBA |
| `public/art/m4_thinking.webp` | 1,346,698 B | 72,192 B | 512×1024 / RGBA |

共 24 张（4 女 × 3 表情 + 4 男 × 3 表情）。PNG 源文件保存在 `public/art/_source/`，该目录仅用于源稿归档；运行时使用 WebP。

## 目录清理日志

保留：

- `f1.webp`–`f4.webp`、`m1.webp`–`m4.webp` 原始角色表。
- 24 张 `*_happy.webp`、`*_surprised.webp`、`*_thinking.webp` 差分图。
- `player.webp` 主角立绘。
- `cafe-rain.png` 与 `cafe-rain.webp` 背景。
- `public/art/_source/` PNG 源稿归档。

移入 `public/art/_trash/` 备份：

- `lin.webp`、`tao.webp`、`shen.webp`：旧的单人映射素材，运行时由 f/m 角色表替代。
- `_trash/player.webp`：清理过程生成的备份；运行时所需的 `public/art/player.webp` 已保留。
- `public/art/.DS_Store`：系统元数据文件。

## 管线脚本与运行说明

脚本位于 [`scripts/art_pipeline.py`](../scripts/art_pipeline.py)。它会校验 24 个命名规范的 PNG、复制到 `_source`、缩放为 512×1024、以 WebP quality=80 保留 Alpha，并把 art 根目录中不符合白名单的文件移动到 `_trash`。

```bash
uv run --with pillow python scripts/art_pipeline.py --source-dir /path/to/png-sources
```

源目录应包含 `f1_happy.png` 到 `m4_thinking.png` 共 24 个文件。

## 前端适配建议

按 `${character}_${expression}.webp` 生成资源 URL，并在 `<img>` 上使用 `loading="eager"`（当前对话角色）和 `decoding="async"`；透明图可直接叠在场景背景上。切换表情时保留同一图片容器，使用 `opacity` 与 `transform: scale(1.0 → 1.02)` 的 120–180ms ease-out 过渡，避免布局跳动；切换结束后再替换 `src`，或用两层绝对定位图片做交叉淡入。移动端可用 `srcset`/预加载当前角色的三张差分，减少首次切换延迟。
