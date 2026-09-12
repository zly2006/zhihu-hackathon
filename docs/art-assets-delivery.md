# 角色单图与 Atlas 交付报告

生成日期：2026-09-12

## 处理结果

旧的 `f1.webp`–`f4.webp`、`m1.webp`–`m4.webp` 横向三姿态图已废弃并移入 `public/art/_trash/`。现在每个角色的 happy、surprised、thinking 都是独立的 512×1024 RGBA WebP；不再依赖雪碧图裁切。

## 风格与边缘验收

角色保持约 2–2.5 头身的日系 Q 版比例、大头大眼、清晰深色线稿、柔和赛璐璐分层和原有服装配色。每张图均为单角色，头发、手和鞋完整落在画布内；脚本校验了四角 Alpha 为 0，轮廓 Alpha 包围盒距离画布边缘至少 4px，避免发丝裁切或串入其他画面。

## 独立资产清单

| 文件模式 | 数量 | 尺寸 | 格式 |
|---|---:|---|---|
| `public/art/{f,m}{1-4}_{happy,surprised,thinking}.webp` | 24 | 512×1024 | WebP / RGBA / quality 80 |

## Atlas

`public/art/characters-atlas.webp` 为 4 列 × 6 行的大图，尺寸 2048×6144；`public/art/characters-atlas.json` 提供每个文件名的 `x/y/w/h` 坐标。排列顺序为 f1、f2、f3、f4、m1、m2、m3、m4，每个角色依次 happy、surprised、thinking。

## 目录清理日志

保留：

- 24 张独立角色表情 WebP。
- `characters-atlas.webp` 与 `characters-atlas.json`。
- `player.webp` 主角立绘。
- `cafe-rain.webp` 背景。

移入 `public/art/_trash/`：

- 旧横向雪碧图：`f1.webp`–`f4.webp`、`m1.webp`–`m4.webp`。
- 旧单人映射图：`lin.webp`、`tao.webp`、`shen.webp`。
- 旧 PNG 源稿目录、`cafe-rain.png` 和系统 `.DS_Store`。

## 管线脚本

运行 [`scripts/art_pipeline.py`](../scripts/art_pipeline.py)：

```bash
uv run --with pillow python scripts/art_pipeline.py --source-dir /path/to/independent-pngs
```

输入目录需要包含 24 个独立 PNG，命名为 `f1_happy.png` 到 `m4_thinking.png`。脚本会转换、生成 atlas 和坐标 JSON，并将 art 根目录中不符合白名单的遗留文件移动到 `_trash`。

## 前端接入建议

单图模式按 `${id}_${expression}.webp` 取资源，切换时使用同一容器的双层绝对定位图片做 120–180ms `opacity` 交叉淡入，避免布局跳动。需要减少请求时可读取 atlas JSON，通过 CSS `background-image`、`background-position` 和固定 512×1024 容器显示对应格；预加载当前角色的三张图片或 atlas，可避免对话推进时闪烁。
