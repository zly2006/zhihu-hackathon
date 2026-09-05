# B 玩法系统交接报告：V3 Scene Runtime

日期：2026-09-05
负责人：B（Galgame 玩法系统）
工作分支：`feature/scene-runtime`
范围：可验证的通用场景运行时、场景选择结算、可靠存档/恢复、分支检查点、关系展示、A/C 交接接口与中性夹具。

## 交付结论

B 范围的 V3 场景玩法链路已在现有 `/life` 中落地，并提供独立的中性验证入口：

```text
http://127.0.0.1:3000/life?demo=neutral
```

入口使用独立的 `restart-life-neutral-scene-demo-v1` 存档键，不读取或覆盖玩家正式存档。夹具包含 3 个 package、11 个稳定 `test-*` 场景节点、分支汇合、公开关系门槛、锁定回退和两个独立结局。

本报告中的中性夹具只证明 B 的运行能力，不是正式赵冷 Demo。正式赵冷人设、对白、关系初值、结局语义仍等待 C；正式立绘、表情和动作资源仍等待 A。

## 已实现能力

- `ScenePackage` 契约、版本校验、背景/角色/说话人/提示引用校验、选择数量与 DAG 可达性校验。
- 旧章节对白通过 adapter 进入只读回顾模式；回顾节点不会执行 live choice。
- 纯场景状态机支持阅读、自动、跳过、选择暂停、反馈、完成和错误重试；自动/跳过不会替未提交的选择作决定。
- 服务端 rule registry + resolver + canonical `SimulationEvent` + world reducer；客户端不能提交伪造的 delta、flags 或跳转。
- 选择接口按 `branchId/packageId/sceneId/blockId` 做幂等保护：同槽位同选择重放返回 replay，不同选择冲突，不重复应用实际关系变化。
- 选择前后场景检查点、序列号、分支复制和分支切换；刷新/重写小说不会丢失已执行场景元数据。
- 进入可执行 choice block 时自动落盘选择前检查点；正式 `/life` 与中性 Demo 均提供分支列表、检查点新建分支和分支切换控件，提交中的选择会锁定分支操作。
- `pendingChapter` 分阶段落盘：模拟、规划/反思、小说、对白、ready、completed、error；刷新后可从已有材料恢复而不重复模拟。
- 关系 HUD 只投影主角关系，展示 closeness/trust/conflict/commitment 四轴、五级关系层级和本章实际变化。
- `compileSceneActionContext` 向 C 暴露当前分支上一章最多 3 条已提交公开动作，并保留稳定 action ID、实际效果和下一步标记；未提交动作和私密字段不进入公开上下文。
- 主动场景触发队列按稳定 `triggerId` 在分支内去重，只在安全边界激活，不打断提交中/反馈中/选择中的 live runtime。
- VisualProfile resolver 提供精确资源 → 中性/默认资源 → avatar → placeholder 的回退顺序；缺资源时仍可完成玩法。
- 中性 Demo 的宏观推进通过标记为 `synthetic` 的输出进入统一 reducer：首个 live 场景前先登记宏观 Chapter；`/api/life/demo/advance` 拒绝未完成章节，并在通过后推进年份、登记下一章再创建 runtime。

## 大模型 provider 配置

项目默认 provider 已切换为 DeepSeek 官方 Chat Completions 接口，默认模型为 `deepseek-v4-flash`，保留 `MODEL_PROVIDER=opencodego` 作为显式兼容回退。真实密钥只放在本地 `.env` 的 `DEEPSEEK_API_KEY`，不进入版本库、日志摘要或交接文本。

## 真实运行验证

以下验证均在本地真实 Next 运行实例完成；SSE 以最终 `complete` 为业务成功标准，流中未出现 `error`。

正式 `/life` 入口已完成 live 场景接线：仅当正式存档包含与当前章节、版本和游标匹配的 `live ScenePackage` 时，才切换到 Scene Runtime；旧对白生成的 `retrospective` 包继续走原有只读展示。中性夹具仍通过 `/life?demo=neutral` 隔离验证，不会写入正式存档。

| 检查 | 结果 |
|---|---|
| `GET /api/life/demo` | HTTP 200；`synthetic=true`；返回 3 个 package，首包为 `test-package-1`，初始运行时可读。 |
| `POST /api/life/demo/advance` | 未完成当前章节时 HTTP 409；将内存中的测试 runtime 标记为 completed 后 HTTP 200，进入 `test-package-2`，宏观章节为 `test-chapter-1,test-chapter-2`，年份推进到 2027。 |
| `POST /api/chapter/scene-choice` | HTTP 200；真实服务端结算 1 次；返回 `scene_choice` canonical event、revision 递增和实际四轴 delta。 |
| `GET /api/event` | HTTP 200 SSE；最终 `complete`；`experienceCount=18`、`optionCount=3`。 |
| `POST /api/chapter/choices` | HTTP 200 SSE；最终 `complete`；返回 3 个选项。 |
| `POST /api/chapter/simulate` | HTTP 200 SSE；最终 `complete`；模拟结果包含 evidence、canonical events 和更新后的世界状态。 |
| `/life` 与中性入口 | HTTP 200。 |

浏览器冒烟已走通：正式 `/life` 进入已有 live 场景后展开功能面板可看到主线与场景检查点；隔离的 `localhost` 中性 Demo 可跳至首个 choice，在提交前看到检查点并创建“中性测试分支 1”，再在主线提交 B 选项，关系面板观察到目标关系信任 `50 → 48`、冲突 `10 → 13`，完成章节后进入 2027 年的 `test-package-2`。中性 Demo 的新建分支不会改变正式存档；未发现浏览器错误日志或重复结算。

## 自动化验证

交付前串行执行：

```text
npm run lint
node scripts/test-all.mjs
npm run build
npm run lint
```

`scripts/test-all.mjs` 已注册 V3 contract/runtime/choice/save/relationship/neutral-fixture/trigger/recovery 套件，与既有套件一起执行。build 中保留既有 `lib/narrative/query-adapter.ts:46` 动态文件追踪 warning；该 warning 不由本次 B 场景运行时引入，也没有被隐瞒为“零 warning”。

## 交接与边界

- A：提供正式角色 `VisualProfile`、立绘/表情/动作资源和资源 ID；B 已提供 resolver 与缺省回退接口。
- C：提供正式 live `ScenePackage`、稳定 `triggerId`、`ruleId`、对白与分支语义；B 已提供 validator、触发队列、`sceneActionContext` 的路由输入边界。C 的生成器/模拟器 Prompt、缓存 key 和正式内容仍需 C 完成并联合验收。
- B 不创建或修改数据库 schema，不改变 `DK_DATABASE_URL`，不解析 `raw_envelope.payload` 作者字段，也不接管上游内容管线。
- B 不把中性夹具通关写成正式赵冷内容完成；联合验收要在 A/C 正式资源和内容接入后另行执行。
- 未实现账号级云存档、服务端防篡改存档和正式内容的模型样本验收；这些属于独立集成/基础设施工作。

## 回滚说明

旧存档缺少 V3 scene 字段时仍走原有章节路径。若需要关闭 V3 入口，应保持含未完成互动存档只读或走恢复页，不得静默跳过未提交的关键选择。本次提交不包含工作区既有 `.env`，未推送远程，也未执行数据库写操作。
