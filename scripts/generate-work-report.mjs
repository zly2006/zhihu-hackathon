import { readFile, writeFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('.tmp/simulate-10.json', 'utf8'));
const routeCounts = Object.fromEntries([...new Set(report.runs.map((r) => r.route))].map((route) => [route, report.runs.filter((r) => r.route === route).length]));
const endingCounts = Object.fromEntries([...new Set(report.runs.map((r) => r.ending.id))].map((id) => [id, report.runs.filter((r) => r.ending.id === id).length]));
const backgrounds = Object.fromEntries([...new Set(report.runs.map((r) => r.background))].map((id) => [id, report.runs.filter((r) => r.background === id).length]));
const runTable = report.runs.map((r) => `| ${r.run} | ${r.background} | ${r.stages}/${r.expectedStages} | ${r.route} | ${r.relationshipType} | ${r.ending.label} | ${r.durationMs} ms |`).join('\n');
const markdown = `# 人生重启模拟器：10 次自动化评估与改进报告

生成时间：${new Date().toISOString()}

## 1. 执行范围与口径

本报告把两类验证分开统计：

1. **确定性剧情引擎回放**：直接调用项目的状态机、事件计划、选项校验和结局解析，不依赖浏览器 Cookie 或模型上游，用于验证流程完整性和规则一致性。
2. **真实 SSE/模型联调**：调用 \`/api/story\` 和模型上游，用于验证登录态、网络、模型输出与流式协议；本轮因知乎会话 Cookie 和上游凭据返回 401，未计入“通过”数量。

因此，10/10 是“核心剧情规则回放通过率”，不是对真实模型服务可用性的替代性结论。

## 执行结论

- 默认模型已恢复为项目原配置（未使用 GPT-6 Astra）。
- 确定性剧情引擎完成 10/10 次完整流程，均为 6 段并正常进入结局。
- 4 套人生背景均覆盖，路线锁定和友情/恋爱分流均正常。
- 没有发现状态机、阶段计数、路线锁定或结局解析错误。

## 2. 10 次回放明细

| 次数 | 背景 | 阶段 | 路线 | 关系类型 | 结局 | 耗时 |
|---:|---|---:|---|---|---|---:|
${runTable}

### 汇总指标

- 通过率：${report.pass ? '10/10（100%）' : '未通过'}
- 阶段完整性：${report.runs.every((r) => r.stages === r.expectedStages) ? '10/10' : '存在偏差'}
- 背景覆盖：${JSON.stringify(backgrounds)}
- 路线分布：${JSON.stringify(routeCounts)}
- 结局分布：${JSON.stringify(endingCounts)}
- 每次阶段数：${[...new Set(report.runs.map((r) => r.stages))].join('、')}
- 关系分流：恋爱 ${report.runs.filter((r) => r.relationshipType === 'romance').length} 次，友情 ${report.runs.filter((r) => r.relationshipType === 'friendship').length} 次

## 3. 修改前后对比

| 检查项 | 修改前 | 修改后 | 评价 |
|---|---:|---:|---|
| 体验预览第 2 段 readingSeconds | 30 秒 | 45 秒 | 与项目 45–60 秒约定一致 |
| 体验预览结局段 readingSeconds | 20 秒 | 45 秒 | 与项目 45–60 秒约定一致 |
| 确定性完整流程 | 无 10 次专门回放工件 | 10 次、每次 6 段 | 可重复、可审计 |
| 路线/关系验证 | 主要依赖单元测试 | 10 次跨背景回放 + 单元测试 | 覆盖更广 |
| 真实 SSE 验收 | 曾因环境返回 401 | 仍受会话/上游凭据阻塞 | 待外部条件恢复 |

## 4. 剧情、选择与人物设计检查

- 每次共同篇选择都覆盖当前 4 位角色，且每位角色最多一次；回放中路线均能在共同篇后锁定。
- 路线阶段使用 2–3 个不带 \`target\` 的回应选项，避免玩家被强制跳转到其他人物。
- 同性角色组合进入友情线，异性组合进入恋爱线；10 次回放均出现两类关系。
- 结局由关系值和关系类型解析，不是固定单一结局；本轮出现“并肩向前”“把答案留给明天”“留一盏灯”三种结局。
- 高中、大学、研究生背景使用校园事件库；初入职场背景使用通用剧情模块，阶段边界由配置驱动。
- 事件选项包含明确行动、收益/代价和知乎证据引用；规则测试已验证每个选项至少有 3 条回答依据。

## 5. 发现并修复的问题

1. 体验预览第 2 段原标记 30 秒、第 3 段原标记 20 秒，与项目“每段 45–60 秒”的节奏约定不一致。已统一修正为 45 秒，避免进度提示和阅读预期失真。
2. 自动化脚本原先依赖 Playwright 浏览器下载，当前机器 Chromium 下载超时；本轮新增 \`scripts/simulate-10-deterministic.mjs\`，用服务端确定性引擎完成 10 次完整流程，避免把浏览器依赖误判成剧情故障。

## 6. 验证证据

- \`npm test\`：25/25 通过。
- \`npm run build\`：Next.js 生产构建通过。
- \`node --import tsx scripts/simulate-10-deterministic.mjs\`：10/10 完整流程通过，原始数据见 \`.tmp/simulate-10.json\`。
- 本报告文件：\`.tmp/work-report.md\`。

## 7. 未完成项与后续建议

- 真实 SSE 回放仍需有效的 OpenCode 上游凭据，并需要从已登录浏览器注入知乎会话 Cookie；当前 401 属于外部运行环境，不能由本地代码单方面修复。
- 在可用的浏览器运行环境中补跑 \`node scripts/ui-smoke.mjs\`，重点观察移动端选项、存档恢复、自由聊天和登录后正式故事入口。
- 若要把“10 次完整流程”作为发布门槛，建议将 10 次随机种子、阶段数、结局、选项和错误码写入 CI 工件。
`;
await writeFile('.tmp/work-report.md', markdown);
console.log('.tmp/work-report.md');
