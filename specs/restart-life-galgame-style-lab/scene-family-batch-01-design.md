# Restart Life 第一批通用场景族与背景设计方案

> 文档用途：交给后续 agent 生成背景资源、建立场景目录并接入实验台。
>
> 当前状态：`design-approved-input / implementation-pending`
>
> 基准页面：`docs/ui-prototypes/galgame-style-lab/index.html`

## 1. 范围与计数口径

本批次建立 **3 个通用场景族、共 4 张背景**。当前已经确认的“深圳出租屋·夜”计入四张背景，因此后续只需新增三张。

| 场景族 | 背景变体 | 数量 | 本批状态 |
|---|---|---:|---|
| 居所 / 私人空间 | 都市公寓·夜、都市公寓·日 | 2 | 夜景复用现有资源，日景新增 |
| 职场 / 学习空间 | 现代办公室·日 | 1 | 新增 |
| 公共 / 第三空间 | 临窗咖啡馆·雨夜 | 1 | 新增 |

本方案只定义背景资源和场景元数据，不修改当前 HTML，不生成角色立绘，不把场景切换接入业务页，也不扩展数据库 schema。

## 2. 已冻结的视觉基准

后续背景必须继承当前已确认页面，而不是另起一套 UI 或画风。

- 类型：现代中国都市、成年人生、Galgame 视觉小说 RPG。
- 画风：高完成度二维动画插画，成熟人物语境，克制赛璐璐渲染，轻写实空间比例。
- UI 框架：顶部、底部、左侧、右侧均为暖米白半透明纸张材质；深棕文字、香槟金描边。
- 中央视觉：允许明显的时间与天气色彩，但避免高饱和霓虹、纯黑压暗和写实摄影感。
- 图片职责：背景只描述环境。人物、头像、对白、选项、地点文字、状态和 UI 全部由独立资源或 HTML 叠加。
- 基准资源：`docs/ui-prototypes/galgame-style-lab/assets/urban-background.png`，1672×941，约 16:9。

## 3. 通用构图契约

### 3.1 输出规格

- 最终比例：16:9。
- 最低有效尺寸：1536×864；推荐 2048×1152。
- 色彩：sRGB PNG；背景不要求 Alpha。
- 文件中不得出现文字、商标、品牌标志、UI、人物或人物倒影。
- 画面必须支持 `background-size: cover`，不能依赖完整显示四角才能理解地点。

### 3.2 安全区域

以单张背景自身宽高为 100%：

- `x=32%–58%`：人物立绘区。使用墙面、窗帘、玻璃、过道等低细节区域，不放关键道具。
- `y=68%–100%`：对白遮挡区。不放必须被玩家识别的叙事线索。
- `x=35%–65%`：手机竖屏裁切保留区。必须仍能辨认场景类型与时间气氛。
- 主要空间线条保持水平与垂直稳定，不用夸张广角、鱼眼或倾斜镜头。
- 摄像机高度约为成人坐姿至站姿视线高度，避免俯拍模型屋或过低仰拍。

### 3.3 光照契约

- 背景光源必须能为后续角色立绘提供明确的主光方向。
- 每张图记录 `portrait_light`，供角色生成或合成时使用。
- 暖米白 UI 已占据四边，背景高光不得接近纯白，避免中央舞台与框架粘连。
- 最暗区域保留环境细节，不使用大面积死黑。

## 4. 场景族 A：居所 / 私人空间

### 4.1 叙事用途

适用于伴侣谈话、家庭冲突、独处、搬家、休息、财务压力、远程工作、人生阶段收束等情节。空间应具有生活痕迹，但不能绑定某个固定职业、收入等级或角色性别。

### 4.2 A1 都市公寓·夜（现有基准）

- `scene_id`: `urban-home-apartment-night-v1`
- 资源路径：`docs/ui-prototypes/galgame-style-lab/assets/urban-background.png`
- 操作：复用，不重新生成，不覆盖原文件。
- 时间：夜晚 / 蓝调时刻之后。
- 天气：默认晴到多云，不突出天气。
- 主光：室内暖灯从右侧和后侧进入，窗外冷蓝环境光。
- 可承载标签：`relationship-talk`、`private-decision`、`moving`、`financial-pressure`、`quiet-night`。
- 适用年代：2015–2035 的现代都市章节。

### 4.3 A2 都市公寓·日（新增）

- `scene_id`: `urban-home-apartment-day-v1`
- 建议路径：`docs/ui-prototypes/galgame-style-lab/assets/urban-home-apartment-day-v1.png`
- 时间：上午 9 点至下午 4 点的柔和自然光。
- 天气：薄云或晴间多云。
- 主光：窗户左后方进入的柔和日光，室内仅有弱暖色补光。
- 空间连续性：尽量保持现有夜景中的窗、餐桌、沙发、落地灯和空调位置，让玩家理解为同一居所，而不是另一间房。
- 可承载标签：`daily-life`、`family-visit`、`remote-work`、`packing`、`recovery`、`weekend`。

执行方式应优先把现有夜景作为编辑目标，只改变时间、光照和少量可见窗外状态；不得重排房间几何。

**图像生成提示词：**

```text
Use case: lighting-weather
Asset type: reusable 16:9 Galgame environment background
Primary request: Transform the approved modern Shenzhen apartment night interior into a calm daytime version of the same room.
Input image: urban-background.png is the edit target and spatial identity reference.
Scene/backdrop: contemporary lived-in Chinese city apartment; preserve the exact window, dining table, sofa, floor lamp, air conditioner and circulation layout.
Style/medium: polished contemporary Chinese anime visual-novel background, restrained cel shading, lightly realistic architecture.
Composition/framing: wide eye-level shot; keep the central character-safe zone low-detail and preserve the mobile center crop.
Lighting/mood: soft late-morning daylight through the window, pale blue sky, gentle warm bounce indoors, calm and reflective.
Constraints: change lighting and exterior time only; no people, silhouettes, reflections, text, logos, UI, legible screens or new major furniture.
Avoid: photorealism, overexposure, sterile showroom, dramatic sunset, neon cyberpunk, altered room geometry.
```

## 5. 场景族 B：职场 / 学习空间

### 5.1 叙事用途

适用于入职、晋升、项目冲突、裁员、面试、团队关系、加班、职业转型以及成年教育。首张背景采用办公室，但构图要能兼容“公司、共享办公、培训空间”等文本解释。

### 5.2 B1 现代办公室·日（新增）

- `scene_id`: `urban-work-office-day-v1`
- 建议路径：`docs/ui-prototypes/galgame-style-lab/assets/urban-work-office-day-v1.png`
- 时间：工作日上午或下午。
- 天气：普通晴天，不以天气作为剧情主角。
- 主光：左侧或左后方玻璃窗自然光，顶部灯带为柔和补光。
- 空间锚点：玻璃会议室、整洁工位、白板或软木板、城市轮廓；所有屏幕和板面保持不可读。
- 可承载标签：`interview`、`career-choice`、`team-conflict`、`promotion`、`layoff`、`overtime`、`training`。
- 适用年代：2015–2035 的现代都市章节。

**图像生成提示词：**

```text
Use case: stylized-concept
Asset type: reusable 16:9 Galgame environment background
Primary request: Create an original daytime modern Chinese office background for adult career stories.
Scene/backdrop: a believable medium-sized product or technology company in Shenzhen, with glass meeting room, neutral workstations, one soft-focus whiteboard and distant city windows; lived-in but tidy.
Style/medium: match the approved Restart Life apartment background; polished contemporary Chinese anime visual-novel illustration, restrained cel shading, realistic adult-world proportions.
Composition/framing: wide eye-level shot, strong depth, central 32%–58% zone kept visually quiet for a standing character, important office anchors remain visible in a narrow center crop.
Lighting/mood: soft daylight from the left, warm neutral interior fill, thoughtful rather than corporate-glossy.
Color palette: ivory, warm gray, pale wood, muted blue, small champagne-gold highlights.
Constraints: empty environment; no people, faces, silhouettes, readable text, company logos, branded devices, UI or watermarks.
Avoid: photorealism, cyberpunk, luxury executive office, classroom stereotypes, extreme wide angle, sterile 3D render, clutter behind the character-safe zone.
```

## 6. 场景族 C：公共 / 第三空间

### 6.1 叙事用途

适用于约会、重逢、朋友谈心、等待消息、偶遇、分手、谈判以及短暂逃离家庭和职场。首张背景采用临窗咖啡馆，后续同族可以扩展车站、医院等候区、社区餐馆和城市公园。

### 6.2 C1 临窗咖啡馆·雨夜（新增）

- `scene_id`: `urban-public-cafe-rain-v1`
- 建议路径：`docs/ui-prototypes/galgame-style-lab/assets/urban-public-cafe-rain-v1.png`
- 时间：傍晚至夜晚。
- 天气：明确雨天，窗上有雨迹，室外反光柔和。
- 主光：右侧室内暖灯，左侧窗外冷蓝雨光。
- 空间锚点：临窗座位、木桌、未使用的杯具、朦胧街灯；不得出现可读菜单或品牌标识。
- 可承载标签：`date`、`reunion`、`confession`、`breakup`、`friend-talk`、`waiting`、`chance-encounter`。
- 适用年代：2015–2035 的现代都市章节。

**图像生成提示词：**

```text
Use case: stylized-concept
Asset type: reusable 16:9 Galgame environment background
Primary request: Create an original rainy-evening window-side café background for adult urban relationship scenes.
Scene/backdrop: contemporary unbranded Chinese city café with rain trails on a large window, warm pendant lights, pale wood table, two unused cups, soft street reflections outside.
Style/medium: match the approved Restart Life apartment background; polished contemporary Chinese anime visual-novel illustration, restrained cel shading, lightly realistic materials.
Composition/framing: wide eye-level shot; keep the central standing-character zone low-detail; retain window, table and warm lamp cues in the mobile center crop; dialogue area at the bottom may be obscured.
Lighting/mood: warm interior against cool blue rainy exterior, intimate, restrained and slightly melancholic.
Color palette: cream, walnut brown, muted amber, rain blue, desaturated rose accents.
Constraints: empty environment; no people, reflections shaped like people, readable menus, text, logos, UI or watermarks.
Avoid: photorealism, neon cyberpunk bar, crowded tables, romantic heart motifs, extreme bokeh, black crushed shadows, dominant red lighting.
```

## 7. 共用反向限制

每次生图或编辑都追加：

```text
No characters, crowds, human silhouettes, faces, hands, readable text, numbers, logos, watermarks, UI panels, dialogue boxes, game icons, subtitles, branded products, legible computer screens, broken architecture, tilted horizon, fisheye lens, extreme perspective, oversaturated neon, photorealistic photography, flat vector art, low-resolution texture, duplicate furniture, or story-critical object hidden in the dialogue occlusion zone.
```

## 8. 场景目录契约（供后续 agent 实现）

后续实现可建立 `scene-catalog.json`，但本轮不创建该文件。每条记录至少包含：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定场景 ID |
| `familyId` | `home` / `work` / `public` | 场景族 |
| `label` | string | 中文显示名 |
| `assetPath` | string | 项目内相对路径 |
| `timeOfDay` | string | `day` / `evening` / `night` |
| `weather` | string | `clear` / `cloudy` / `rain` |
| `eraMin` / `eraMax` | number | 推荐使用年代 |
| `narrativeTags` | string[] | 召回与匹配标签 |
| `backgroundPositionDesktop` | string | 桌面 `background-position` |
| `backgroundPositionMobile` | string | 手机裁切位置 |
| `portraitLight` | string | 角色立绘配光描述 |
| `status` | string | `existing` / `generated` / `reviewed` |

推荐默认值：

| ID | Desktop position | Mobile position | Portrait light |
|---|---|---|---|
| `urban-home-apartment-night-v1` | `center center` | `44% center` | `cool-left + warm-right-rim` |
| `urban-home-apartment-day-v1` | `center center` | `44% center` | `soft-left-daylight` |
| `urban-work-office-day-v1` | `center center` | `48% center` | `soft-left-daylight + top-fill` |
| `urban-public-cafe-rain-v1` | `center center` | `46% center` | `cool-left-window + warm-right-key` |

## 9. 与当前场景页的接入边界

- 保留当前四边暖米白 UI、对白框、选项、左右收起逻辑和人物头像系统。
- 背景切换只替换中央 `.scene-stage` 的图片和场景元数据，不复制整份页面。
- 角色立绘与背景独立；同一背景必须支持主角单人、NPC 单人和双人对话。
- 地点、日期、天气由 HTML 显示，不烘焙进图片。
- 当前 `urban-background.png` 路径继续有效；若目录采用新 ID，通过 catalog 做别名映射，不移动或覆盖原文件。
- 场景选择逻辑后续应根据年代、地点类型、时间、天气和叙事标签匹配，不从剧情文本中临时拼文件名。

## 10. 验收标准

### 10.1 单张背景

- [ ] 16:9，最低 1536×864，PNG，sRGB。
- [ ] 无人物、文字、品牌、UI 和水印。
- [ ] 场景类型、时间和天气在 3 秒内可辨认。
- [ ] 中央人物安全区没有高对比关键道具。
- [ ] 底部被对白框遮挡后仍能识别场景。
- [ ] 使用手机中心裁切后仍保留至少两个空间锚点。
- [ ] 光向可被角色立绘复现，不出现互相矛盾的多重主光。
- [ ] 与现有都市公寓夜景属于同一动画视觉体系。

### 10.2 整批背景

- [ ] 3 个场景族和 4 张背景计数准确。
- [ ] 居所日/夜具有可感知的同一空间连续性。
- [ ] 办公室与咖啡馆不会被误认为住宅。
- [ ] 三族能覆盖私人关系、职业发展和公共社交三类高频叙事。
- [ ] 文件名、manifest 与未来 catalog 的 ID 一致。
- [ ] 当前已确认页面没有被视觉或代码回归破坏。

## 11. 后续 agent 的建议执行顺序

1. 读取本文件、当前 HTML、`style-contract.yaml` 和现有 `urban-background.png`。
2. 先以现有夜景为编辑目标生成公寓日景，验证空间连续性。
3. 再分别生成办公室日景和咖啡馆雨夜。
4. 对三张新增背景逐张检查 16:9、文字污染、人物污染、中央安全区和手机裁切。
5. 将通过的文件复制到本方案规定的项目路径，不覆盖现有夜景。
6. 更新 `asset-manifest.yaml`，再创建并校验 `scene-catalog.json`。
7. 只有在资源验收完成后，才给实验台增加场景切换；不得顺带重构已冻结的页面布局。

## 12. 非目标

- 不为每个剧情事件单独生图。
- 不生成角色立绘、头像、表情差分或 CG。
- 不覆盖当前夜景和已确认四边 UI。
- 不在本批处理历史年代、乡村、校园、医院、车站或户外公园。
- 不把场景选择写死在单个章节或角色姓名上。
- 不修改数据库、提示词业务逻辑或存档 schema。
