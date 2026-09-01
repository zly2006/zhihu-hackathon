# PRD · Restart Life Galgame Style Lab

文档状态.status: draft

## 产品目标

让用户在一个页面内公平比较“都市现实动画系”和“青春治愈动画系”，并验证桌面与移动端的 Galgame + RPG HUD 组合。

## P0

| ID | 需求 | screen-id |
|---|---|---|
| P0-1 | 两种视觉主题即时切换 | `scene-style-lab` |
| P0-2 | 两种主题并排比较 | `scene-style-lab` |
| P0-3 | 桌面/手机构图切换 | `scene-style-lab` |
| P0-4 | 三项对白选择与选中反馈 | `scene-style-lab` |
| P0-5 | Stage Goal、四项属性、关系趋势 | `scene-style-lab` |

## 非目标

不接入真实游戏状态，不替换现有 `/life` 页面，不实现章节生成。

## 验收

- 两种主题的剧情、数据与布局语义一致。
- 桌面为 Scene + 右侧 HUD；手机为 Scene + Dialogue + 底部 HUD Tabs。
- 中文由 HTML 排版；图片无文字、商标和既有版权角色。
- 支持键盘焦点、触控热区和 reduced motion。

