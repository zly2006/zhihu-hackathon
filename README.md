# 留一盏灯 · Next.js Galgame

前后端统一为Next.js 16 App Router + TypeScript。服务端直接请求CPA，运行时不调用Python；原Python样板保留在 `/Users/zhaoliyan/魔女的夜宴_xp3解包/galgame_llm/` 供对照。

## 启动

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:3000 。生产构建：`npm run build && npm start`。默认只监听本机；这是单实例本地原型，存档在 `.data/`，不适合直接放到无持久磁盘的serverless环境。

服务端使用 `MODEL_PROVIDER=opencode`，通过 `OPENCODE_API_KEY`、`OPENCODE_ENDPOINT` 和 `OPENCODE_MODEL` 调用 OpenCode Go。OpenCode 模式不会读取 CPA 凭证，避免把另一套密钥发往错误上游。密钥不进入前端bundle、浏览器响应或请求日志；部署时配置服务端环境变量即可。

模型为 `deepseek-flash`，请求携带 `x-opencode-session` 路由头，`reasoning_effort` 默认 `none`。上游返回的推理token数只写后台日志，不影响正文流。

## 一句一推的协议

`POST /api/story` 返回 `text/event-stream`。每一个 `data:` 都是一个完整JSON事件，保持SSE要求的空行分隔。SSE外层不是裸JSONL；事件内容使用JSON对象，落盘时一行一个对象，形成JSONL。

```text
data: {"type":"scene","segment":1,"title":"先把这一页翻过去","readingSeconds":0}

data: {"type":"line","index":0,"speaker":"旁白","text":"展示桌收好以后，走廊里只剩四个人。"}

data: {"type":"line","index":1,"speaker":"顾言川","text":"最后一版还可以再改，但今晚得先定方向。"}

data: {"type":"choices","items":[{"text":"请顾言川先定方向"},{"text":"和陶晚晴核对方案"},{"text":"留下听完沈屿的顾虑"},{"text":"陪苏棠把现场收好"}]}

data: {"type":"done","state":{"...":"当前公开进度"}}
```

后端流程是：

1. LLM逐条输出JSONL，token到达时增量解码；遇到完整换行才形成一条记录。
2. 立即检查该条JSON、字段、说话者、顺序、单条长度与累计字数。明确的“我”映射为玩家姓名。
3. 检查通过后先保存已接收部分，再发送对应SSE事件；后面的对白可以仍在生成。
4. 选项出现时检查正文225—300字、共同篇四个角色目标或个人线2—3个选项；结局无选项。选项在整段确认完成后才能点击。
5. 内部memory记录仅保存在服务端。`end`、上游`finish_reason=stop`和`[DONE]`全部到齐，才提交完整片段并发`done`。

这不是等完整片段生成完再拆句发送。`lib/protocol.ts` 负责逐条校验与转换，`lib/generator.ts` 负责模型流和续写，`app/api/story/route.ts` 负责SSE及会话。

当前“翻译”按 **模型记录 → 游戏事件协议转换** 实现，模型直接输出中文；没有额外调用第二个模型做外文翻译。结构校验不等于文学审稿：代词、语气、细节连续性仍可能需要进一步审核。

不合法的记录不显示，最多进行两次续写修复。已显示对白不回滚、不重写；重试只补剩余记录。若仍失败，前端显示重试入口，保留已收到内容。中途关闭网页时服务器完成当前已授权片段，刷新可读回结果；不会自动选择或生成下一片段。

## 游戏与状态

- 开局先选择高中、大学、研究生或毕业到工作的人生阶段，再从8位角色中选择4位，并填写玩家姓名与性别。
- 共同篇通常两次选择锁定唯一领先者；两人同票时追加第三次共同选择。同性进入友情线，异性进入恋爱线。
- 通常共6轮，平票时7轮：共同篇2或3轮、关系线3轮、结局1轮。模板中的事件模块按固定种子选择，重放同一故事时保持一致。
- 每轮正文225—300有效字，按300字/分钟约45—60秒；选项、思考、接口等待另计，不能保证实际总墙钟时间小于10分钟。
- 点击对话区域、空格/右方向键推进；F全屏，Esc退出；回看历史、重新开始确认。
- 客户端用本地保存的 `storyId` 定位服务端存档。客户端只提交开局选择、选项编号和期望进度，不上传生成后的剧情状态。
- 单进程生成互斥与进度校验防止重复点击；读档不触发模型。服务端重启后可从已保存的partial恢复。多实例部署需要将文件存储与互斥改为共享数据库/锁。

接口请求：`{action:"start",profiles,backgroundId,player}`、`{action:"choose",choice:0,expected:1}`、`{action:"retry"}`、`{action:"restart"}`。`GET /api/story?storyId=...` 仅读公开存档。

`.data/sessions/*.json` 保存私有状态；`*.jsonl`追加保存对外事件；`.data/requests/`记录真实提示、原始模型输出、usage与耗时，不含认证头。目录应按私人数据保护，不作为静态资源发布。

## 验证

```bash
npm test
npm run build
# 真实OpenCode测试，会产生token费用，逐轮走完一条路线
node scripts/test-live.mjs
```

单元测试覆盖27种分流组合、锁线、重复选择拒绝、分块JSONL解析、对白在end前发出、无效记录不污染状态、选项与记忆隔离。真实流测试结果在 `test-output/live-summary.json`，逐事件时间戳见 `live-*.jsonl`；测试包含一次从断续状态恢复的开场，不应当作纯新会话延迟基准。

浏览器测试使用develop-web-game技能的官方客户端副本 `scripts/web-game-client.mjs`，仅增加DOM选择器、存档复用和移动视口支持。文字视觉小说采用可访问DOM与SVG场景，避免把对白绘入不可选择的canvas。测试浏览器由该客户端统一创建和关闭。

版本接口参考：[Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)。
