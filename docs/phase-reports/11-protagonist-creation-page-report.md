# 主角创建页 HTML 实验台完成报告（2026-09-01）

## 1. 本次完成内容

本次在当前窗口完成了《Restart Life》主角创建页的独立 HTML 视觉实验台，基于已经确认的浅色 Galgame 四边面板风格实现。

页面定位为“18 岁人生档案”创建页，玩家完成档案后进入三位核心关系生成。当前页面是可直接查看和操作的前端演示，不连接生产 API、不写入数据库，也不替换现有 `/life` 页面。

## 2. 页面产出

### 2.1 已实现的页面结构

- 顶部：品牌、`序章 · 建立人生档案`、副标题 `18 岁是起点，不是判决`。
- 左侧：基本身份、出身起点、人格内核、初始天赋、最终确认五阶段进度栏。
- 中央：结构化人生档案表单，使用暖米白纸张质感和 HTML 中文排版。
- 右侧：可收起的真实人物头像、年龄、起始年份、城市、方向、人格标签、目标、天赋和困境摘要。
- 底部：返回首页、保存草稿、清空草稿、草稿状态和 `生成三位核心关系` 主操作。

### 2.2 已实现的交互

- 桌面 / 手机预览切换。
- 左右面板独立收起与展开。
- 五个表单分区点击跳转与折叠。
- 姓名、出生年份、家乡、城市、方向等字段实时同步到右侧预览。
- 性别、家庭背景单选。
- 性格标签限制 3—5 个，价值观限制 2—4 个。
- 六个预设人物头像选择，头像使用仓库本地 PNG，不使用文字占位。
- 五项天赋 0—100、单项 20—80、步长 5、总预算 250。
- 均衡、社交型、学习型、坚韧型四种天赋预设。
- 本地草稿保存、恢复、清空。
- 不完整档案的字段级错误标记和顶部错误摘要。
- 完整档案的模拟提交状态和生成关系提示。

## 3. 产出文件路径

以下是本次新增或更新的文件：

1. 页面 HTML：
   [F:/260824zhihuihekes/docs/ui-prototypes/protagonist-creation-lab/index.html](F:/260824zhihuihekes/docs/ui-prototypes/protagonist-creation-lab/index.html)

2. 页面交互与结构测试：
   [F:/260824zhihuihekes/test/protagonist-creation-lab.test.mjs](F:/260824zhihuihekes/test/protagonist-creation-lab.test.mjs)

3. 页面生成记录：
   [F:/260824zhihuihekes/specs/restart-life-galgame-style-lab/prompts/pages/protagonist-creation.md](F:/260824zhihuihekes/specs/restart-life-galgame-style-lab/prompts/pages/protagonist-creation.md)

4. 资源清单：
   [F:/260824zhihuihekes/specs/restart-life-galgame-style-lab/asset-manifest.yaml](F:/260824zhihuihekes/specs/restart-life-galgame-style-lab/asset-manifest.yaml)

5. 本次实施计划：
   [F:/260824zhihuihekes/specs/restart-life-galgame-style-lab/protagonist-creation-html-implementation-plan.md](F:/260824zhihuihekes/specs/restart-life-galgame-style-lab/protagonist-creation-html-implementation-plan.md)

6. 前一轮页面设计方案：
   [F:/260824zhihuihekes/specs/restart-life-galgame-style-lab/protagonist-creation-page-design.md](F:/260824zhihuihekes/specs/restart-life-galgame-style-lab/protagonist-creation-page-design.md)

## 4. 本地查看地址

当前实验台通过本地只读预览服务打开：

[http://127.0.0.1:4175/protagonist-creation-lab/index.html](http://127.0.0.1:4175/protagonist-creation-lab/index.html)

浏览器当前窗口已保留该页面，可直接切换“桌面”和“手机”查看两种构图。

## 5. 复用与边界

本页面沿用已有设计文档确认的复用策略：

- 数据字段参考新版 `ProtagonistDraft`，包括姓名、出生年份、性别、家乡、家庭背景、初始城市、初始方向、性格、价值观、长期目标、初始困境和五项天赋。
- 头像复用当前场景实验台中的本地人物资源：`urban-zhou-avatar-v1.png`、`urban-wanghao-avatar-v1.png`、`urban-linyu.png`、`healing-linyu.png`。
- 视觉语言复用当前场景页的暖米白顶部、左右侧栏、底部栏、香槟金描边和深棕文字规则。
- 没有复用旧版 1—7 天赋数值作为新版天赋值；当前实验台保持 0—100 展示，并在界面中提示正式接入前需要完成结算层归一化。
- 没有根据姓名或性别自动推断头像、人格、职业或家庭背景。

## 6. 验证结果

已执行以下验证：

```text
node --test test/protagonist-creation-lab.test.mjs test/ui-style-lab.test.mjs
5 tests passed, 0 failed

npm run lint
tsc --noEmit completed successfully

npm run build
Next.js production build completed successfully
```

浏览器交互验收结果：

- 桌面首屏显示四边框架、表单、真实人物头像和底部主操作。
- 手机模式计算宽度为 430px，右侧预览隐藏，顶部进度栏和底部主操作保留。
- 右侧面板和左侧进度面板均可独立收起。
- 姓名、头像和天赋调整会实时更新预览；天赋预算保持 250。
- 空白姓名会显示“还需要确认：姓名”，并将字段标记为无效。
- 完整档案点击主操作后进入模拟生成状态，随后恢复可操作状态。
- 浏览器控制台无 error 或 warning。

## 7. 当前限制与后续接入点

- 页面目前是独立实验台，`生成三位核心关系` 使用模拟提交，不调用 `/api/life/npc/generate`。
- 正式接入时需要把头像视觉身份字段与 `ProtagonistDraft` 或独立存档元数据连接起来。
- 正式接入时需要补齐服务端对性格、价值观、目标、困境和天赋预算的共享校验。
- 正式接入时必须先处理 `Talents` 0—100 与结算公式之间的尺度归一化问题。
- 当前资源清单和页面均保持 `approved: false`，等待产品最终确认后再进入正式资源制作流程。

## 8. 未修改范围

本次没有修改：

- 已冻结的场景实验台页面逻辑和背景资源。
- 生产 `/life` 页面和主角创建 React 组件。
- API、数据库 schema、只读数据库角色或 `.env` 内容。

