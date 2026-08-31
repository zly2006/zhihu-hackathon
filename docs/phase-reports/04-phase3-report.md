# Phase 3 完成报告：知乎 EvidenceBundle

- **日期**：2026-08-31
- **分支**：`dev/mvp-v1-interactive-life`
- **方案依据**：§13、§14、§22、§30.3、§37（Phase 3）
- **阶段目标**：重构 `retrieveExperiences` → `retrieveEvidence(world + decision)`，保留 18 条真实数据库召回，组装为视角多样化的 `EvidenceBundle`

## 1. 交付内容

| 文件 | 内容 |
|---|---|
| `lib/database.ts`（新增，不改旧函数） | `retrieveEvidenceCandidates({domain, terms, anchorSeed, limit, excludedExperienceIds})`：复用现有 BGE `scenario-text-v2` 向量召回（domain 预过滤 + 关键词 + 确定性锚点 + cosine 排序 + URL 去重），返回 `EvidenceCandidate[]`。旧 `retrieveExperiences` 原样保留，旧 `/api/event` 不受影响 |
| `lib/game/experience-adapter.ts` | `blockingKeyToDomain`（career/education/health_life/family_relationship → LifeDomain）、`toLifeExperience`：把 DB 候选映射为 `LifeExperience`，缺失字段置 `null`、`uncertainties` 默认"单一个案，不能视为确定因果规律"（§13.3） |
| `lib/game/evidence-retriever.ts` | `deriveRetrievalContext`（年龄/资源/决策关键词/关系冲突 → domain + 关键词 + 确定性 anchorSeed）、`classifyOutcomeDirection`（正/负/混合/未知）、`assembleEvidenceBundle`（四类组装 + balance 计数 + 结果反例封顶 5 条）、`retrieveEvidence`（编排） |

## 2. 关键设计点

1. **视角多样性对抗幸存者偏差**：`assembleEvidenceBundle` 先按"关系 > 行动 > 背景"关键词归入三桶，再把负面/混合结果提取进 `outcomeContrasts`（最多 5 条），避免"辞职创业"纯相似度召回大量成功案例（§14.1）。
2. **不硬猜缺失字段**：Adapter 对年龄/城市/婚姻等未知信息置 `null`，不为了填满结构而虚构（§13.3）。
3. **确定性锚点**：`anchorSeed` 由 `protagonist.id : selectedOptionId : currentYear` 构成，同一存档/章节/选择召回稳定，可复现（为 Phase 4 的确定性随机铺路）。
4. **不破坏旧流程**：新增函数与旧 `retrieveExperiences` 完全解耦。

## 3. 验证结果

- ✅ `npm run lint`（tsc --noEmit）通过
- ✅ `npm run build`（next build）通过
- ✅ 冒烟测试 `test/phase3-evidence.smoke.mjs`（21 项全过）：Adapter 领域映射、缺失字段置 null、结果方向四分类、检索上下文推导（低现金→收入关键词、高冲突→关系关键词、决策关键词注入、anchorSeed 确定性）、EvidenceBundle 四类组装无重复、balance 计数、结果反例封顶
- ⚠️ `retrieveEvidence` 的真实数据库召回未做真机验证（需 `DK_DATABASE_URL` 可达的 PostgreSQL 实例，AGENTS.md 要求以只读角色 + 真实召回 + 18 条 + SSE complete 为准）

## 4. 遗留说明

- 真正对抗幸存者偏差的"结果反例召回"目前是关键词启发式，未做 outcome embedding / 负例召回（方案 §14.4 明确第一版不强制，后续 V2）。
- `retrieveEvidence` 将在 Phase 4 由 `/api/chapter/simulate` 调用，与 `DecisionResolution`、World Simulator 串联。
- 未触碰数据库写入，只读角色边界不受影响。
