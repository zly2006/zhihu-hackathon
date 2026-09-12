# 角色表情资产交付报告

生成日期：2026-09-12

## 风格分析

原始角色表采用 1536×1024 的横向三姿态画布，每个姿态占 512×1024，约 2–2.5 头身。画面是日系 Q 版赛璐璐风：头部比例大、轮廓线清晰、阴影分层柔和，服装配色和发丝细节保持统一。三格语义按原稿保留为：左侧 `normal`、中间 `happy`、右侧 `playful`（调皮）。

## 新增资产

原始横向图 `public/art/f1.webp`–`f4.webp`、`m1.webp`–`m4.webp` 已恢复并继续保留，作为比例和姿态基准。每格从原始画布精确拆出后统一缩放到 90% 并居中留出透明安全边距，再移除独立的邻格 Alpha 连通块，避免发丝串格或被裁切。

| 文件模式 | 数量 | 尺寸 | 格式 |
|---|---:|---|---|
| `public/art/{f,m}{1-4}_{normal,happy,playful}.webp` | 24 | 512×1024 | WebP / RGBA / quality 80 |

逐文件压缩结果（WebP 字节数；对应临时 PNG 输入未保留在产品目录）：

| 文件 | WebP 大小 |
|---|---:|
| `public/art/f1_normal.webp` | 68,246 B |
| `public/art/f1_happy.webp` | 70,052 B |
| `public/art/f1_playful.webp` | 66,662 B |
| `public/art/f2_normal.webp` | 54,478 B |
| `public/art/f2_happy.webp` | 55,504 B |
| `public/art/f2_playful.webp` | 55,722 B |
| `public/art/f3_normal.webp` | 83,046 B |
| `public/art/f3_happy.webp` | 84,212 B |
| `public/art/f3_playful.webp` | 80,532 B |
| `public/art/f4_normal.webp` | 72,926 B |
| `public/art/f4_happy.webp` | 72,640 B |
| `public/art/f4_playful.webp` | 74,886 B |
| `public/art/m1_normal.webp` | 58,780 B |
| `public/art/m1_happy.webp` | 58,810 B |
| `public/art/m1_playful.webp` | 60,248 B |
| `public/art/m2_normal.webp` | 50,396 B |
| `public/art/m2_happy.webp` | 51,028 B |
| `public/art/m2_playful.webp` | 52,196 B |
| `public/art/m3_normal.webp` | 59,818 B |
| `public/art/m3_happy.webp` | 61,194 B |
| `public/art/m3_playful.webp` | 64,670 B |
| `public/art/m4_normal.webp` | 57,970 B |
| `public/art/m4_happy.webp` | 55,214 B |
| `public/art/m4_playful.webp` | 64,674 B |
| **24 张合计** | **1,533,904 B** |

Atlas 大小为 1,525,916 B；8 张原始横向表合计 2,511,750 B。

本次单图文件均由原始姿态裁切得到，保留原有头身比例和服装细节。之前的 `surprised`、`thinking` 文件已移入 `public/art/_trash/`，不再参与运行时加载。

## Atlas

`public/art/characters-atlas.webp` 为 4 列 × 6 行、2048×6144 的透明 WebP；`public/art/characters-atlas.json` 提供每个单图的 `x/y/w/h` 坐标。排列顺序为 `f1`–`f4`、`m1`–`m4`，每个角色依次 `normal`、`happy`、`playful`。

## 目录清理日志

保留：

- 8 张原始横向三姿态图 `f1.webp`–`f4.webp`、`m1.webp`–`m4.webp`。
- 24 张独立表情 WebP、`characters-atlas.webp`、`characters-atlas.json`。
- `player.webp` 和 `cafe-rain.webp`。

移入 `public/art/_trash/`：

- 旧的 `surprised`、`thinking` 表情及旧映射图。

从产品目录移除（不进入运行时资源）：

- `public/art/cafe-rain.png`。
- 历史 `public/art/_source/*.png` 临时源稿。

## 管线脚本

脚本位于 [`scripts/art_pipeline.py`](../scripts/art_pipeline.py)，输入目录需包含 24 个临时 PNG，命名为 `f1_normal.png` 到 `m4_playful.png`。运行：

```bash
uv run --with pillow python scripts/art_pipeline.py --source-dir /path/to/independent-pngs
```

脚本会检查并转换为带 Alpha 的 WebP，生成 Atlas 与坐标 JSON，再把 art 根目录中不符合白名单的遗留文件移动到 `_trash`。PNG 仅作为临时输入，不作为产品资源提交。

## 前端接入建议

单图模式按 `${id}_${pose}.webp` 加载，使用同一容器的两层绝对定位图片做 120–180ms `opacity` 交叉淡入。需要减少请求时读取 Atlas JSON，以固定 512×1024 容器配合 `background-image` 和 `background-position` 显示对应格；进入对话前预加载当前角色的三种姿态即可避免闪烁。
