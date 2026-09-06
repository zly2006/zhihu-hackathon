import type { ZhaoLengBeatId, ZhaoLengWrittenLine } from "../domain/zhao-leng-runtime";
import { ZHAO_LENG_DEMO } from "./zhao-leng-demo";

export type ZhaoLengChoiceId = "A" | "B" | "C";
export type ZhaoLengRuleId =
  | "listen_without_promise"
  | "clarify_boundary"
  | "avoid_conversation"
  | "make_joint_plan"
  | "respect_distance"
  | "honest_talk"
  | "move_forward"
  | "separate_paths"
  | "zhao_leng_press_help";

export type ZhaoLengChoiceScript = {
  id: ZhaoLengChoiceId;
  label: string;
  prompt: string;
  ruleId: ZhaoLengRuleId;
};

export type ZhaoLengBeatScript = {
  id: ZhaoLengBeatId;
  phaseId: "first-meet" | "future-conflict" | "major-decision" | "ending";
  title: string;
  location: string;
  background: string;
  timeLabel: string;
  opening: ZhaoLengWrittenLine[];
  choicePrompt?: string;
  choices: ZhaoLengChoiceScript[];
  feedback: Partial<Record<ZhaoLengChoiceId, ZhaoLengWrittenLine[]>>;
};

const n = (text: string): ZhaoLengWrittenLine => ({ type: "narration", text });
const p = (text: string, emotion = "平静"): ZhaoLengWrittenLine => ({
  type: "dialogue",
  speakerId: "protagonist",
  text,
  emotion,
});
const z = (text: string, emotion = "克制"): ZhaoLengWrittenLine => ({
  type: "dialogue",
  speakerId: "npc-zhao-leng",
  text,
  emotion,
});

const choice = (
  id: ZhaoLengChoiceId,
  label: string,
  prompt: string,
  ruleId: ZhaoLengRuleId,
): ZhaoLengChoiceScript => ({ id, label, prompt, ruleId });

export const ZHAO_LENG_RULE_IDS = Object.freeze([
  "listen_without_promise",
  "clarify_boundary",
  "avoid_conversation",
  "make_joint_plan",
  "respect_distance",
  "honest_talk",
  "move_forward",
  "separate_paths",
  "zhao_leng_press_help",
] as const);

export const ZHAO_LENG_BEAT_SCRIPTS: readonly ZhaoLengBeatScript[] = Object.freeze([
  {
    id: "zl-01-message",
    phaseId: "first-meet",
    title: "雨夜借阅",
    location: "远程消息",
    background: "urban-home-apartment-night-v1",
    timeLabel: "第 1 周 · 雨夜 · 远程消息",
    opening: [
      n("雨点敲着窗外的铁皮。你把刚改完的稿件发出去，手机在杯子旁震了一下。"),
      z("还醒着吗？上次那张渡口照片，我找到另一份登记，日期对不上。"),
      n("紧接着是一张裁过边的照片。两个年份被细细圈起，旁边留着一个问号。"),
      p("要我帮你认字？"),
      z("认字，也认路。你说小时候走过那条街。"),
      z("不过今天太晚了。明天也行。"),
      n("你点开照片。旧站牌只露出半截，位置倒还是记忆里的位置。输入框中的“我现在过去”打到一半，你看了一眼桌上还没吃的饭。"),
      z("不用跑一趟。先告诉我，照片里的台阶是不是朝河的。"),
    ],
    choicePrompt: "今晚，你能帮她做到哪一步？",
    choices: [
      choice("A", "先看照片，听她说疑点", "“我先看看。你觉得哪一处不对？”", "listen_without_promise"),
      choice("B", "约明天下午一起核对", "“今晚脑子不太转了。明天下午三点，图书馆？”", "make_joint_plan"),
      choice("C", "说明这周无法参与", "“这周赶稿，可能帮不上。你先按自己的进度来。”", "respect_distance"),
    ],
    feedback: {
      A: [z("右边那块路牌。我把清楚一点的发你。"), n("核对完，她提议次日下午在图书馆见面。你接受了这次约定，没有把它写成额外的承诺。")],
      B: [z("三点可以。先吃饭吧，照片不急着跑。"), n("她接受了明天下午的安排。共同计划从一个具体的时间开始，而不是从一句保证开始。")],
      C: [z("知道了。我先查登记簿。忙完再说。"), n("几天后你完成稿件，主动问能否再去。她确认了新的时间，原来的明天下午并没有被伪装成已经发生。" )],
    },
  },
  {
    id: "zl-02-library",
    phaseId: "first-meet",
    title: "图书馆",
    location: "图书馆整理桌",
    background: "urban-home-apartment-day-v1",
    timeLabel: "第 1 周 · 次日下午 · 图书馆",
    opening: [
      n("你收起伞，桌角已经放着一块干毛巾。赵冷把两份登记摊开，先挪走了离你最近的一杯水。"),
      z("旧纸怕这个。人倒是可以先喝一口。"),
      p("我记得那条路下去就是河，夏天有人卖冰棍。"),
      z("我第一次去的时候，那里已经围起来了。"),
      n("她把照片转向你。你记得的路口，在登记上只剩一个新名字。"),
      p("原来我们说的“以前”，不是同一个以前。"),
      z("所以我才想找你核对。记忆也要有人对照着看。"),
      n("纸袋边缘露出一张旧借阅卡。卡片属于这份公开档案的附件，不是她的私人物品。"),
      z("附件可以看，编号别弄丢了。"),
    ],
    choicePrompt: "这次核对，你想怎样继续？",
    choices: [
      choice("A", "先听她解释登记的差异", "“你查到的那部分，能从头讲一下吗？”", "listen_without_promise"),
      choice("B", "说明自己的记忆也有空缺", "“路我记得，年份可能记错了。我能带你认位置，但不能给日期打包票。”", "honest_talk"),
      choice("C", "先完成材料，暂不谈私事", "“今天先把这两页理清吧，过去的事以后有机会再聊。”", "clarify_boundary"),
    ],
    feedback: {
      A: [z("这一行改过。我想先弄清是谁补的日期。"), n("你们沿着材料继续，没有急着给记忆下结论。")],
      B: [z("这就够用了。能确认什么、不能确认什么，分开记。"), n("她给你的说法留下一条注明来源的记录，空缺仍然被保留下来。")],
      C: [z("好。我也不想把校对做成问卷。"), n("话题回到桌上的登记簿，亲近没有被强行推进。")],
    },
  },
  {
    id: "zl-03-boundary",
    phaseId: "first-meet",
    title: "边界",
    location: "图书馆整理桌",
    background: "urban-home-apartment-day-v1",
    timeLabel: "第 2 周 · 图书馆整理桌",
    opening: [
      n("几次核对后，表格剩下的空格不多，你顺手把她的笔记也拢到自己这一边。"),
      p("这些我一起补完，你能早点回去。"),
      n("赵冷伸手按住了纸角。"),
      z("先别。这几条我还没确认。"),
      p("我是想替你省点事。"),
      z("我知道。但最后署的是我的名字。哪些能留，得由我来定。"),
      n("你把笔停在空格上。她没有把纸抽走，也没有松开手。"),
      z("你可以帮我找证据。不用替我把结尾写好。"),
    ],
    choicePrompt: "她说明了边界，你怎样回应？",
    choices: [
      choice("A", "确认分工，把决定交还", "“我只标疑点，结论你来写。这样行吗？”", "clarify_boundary"),
      choice("B", "承认刚才越界", "“我刚才把帮忙当成了替你做完。抱歉，这几页还给你。”", "honest_talk"),
      choice("C", "坚持先替她补完", "“可就剩这几行，我写完你再改也一样。”", "zhao_leng_press_help"),
    ],
    feedback: {
      A: [z("行。你有不同意见，就写在旁边。"), n("分工被重新写清楚，结论仍由她决定。")],
      B: [z("下一次先问我。"), n("她松开纸角。道歉没有把刚才的越界抹掉，但你们有了下一次可以遵守的分工。")],
      C: [z("对你一样，对我不一样。"), n("她收回笔记，你们各自整理。帮助没有得到她的接受，纸上的空格也没有替她被填满。")],
    },
  },
  {
    id: "zl-04-opportunity",
    phaseId: "future-conflict",
    title: "去留的分歧",
    location: "图书馆外",
    background: "urban-public-cafe-rain-v1",
    timeLabel: "第 3 周 · 图书馆外",
    opening: [
      n("赵冷出来得比约定晚。她把门拉住，让最后一位读者先过去，才递给你一页打印的项目说明。"),
      z("外地有个短期档案项目，问我愿不愿意去。"),
      p("你想去？"),
      z("想。材料是我一直想做的那一批。可原来的工作还要交接，住宿也得自己重新安排。"),
      n("你看到回执日期就在几天之后。那段时间，你的日历上已经排满了交稿。"),
      z("我还没答复。先把条件看明白。"),
    ],
    choicePrompt: "面对这个机会，你先回应什么？",
    choices: [
      choice("A", "先听她的判断", "“最让你想去的是什么？最难处理的又是什么？”", "listen_without_promise"),
      choice("B", "一起核对条件", "“今晚一起查住宿和交接清单，去不去仍然由你决定。”", "make_joint_plan"),
      choice("C", "先说明自己的担忧", "“我希望常见面，但这段时间我很难离开这里。我怕我答应了又做不到。”", "honest_talk"),
    ],
    feedback: {
      A: [z("想去的理由很清楚，难的是把手头的事交出去。"), n("她开始逐项说实际安排，机会和代价同时被放在桌面上。")],
      B: [z("可以。信息看全一点，我自己答复。"), n("你们完成了一次具体共同核对，但没有把查住宿写成答应异地恋。")],
      C: [z("你说清楚，比让我猜你能来几次好。"), n("担忧没有消失，但它成为了双方都知道的公开事实。")],
    },
  },
  {
    id: "zl-05-argument",
    phaseId: "future-conflict",
    title: "讨论安排",
    location: "讨论安排",
    background: "urban-home-apartment-night-v1",
    timeLabel: "第 3 周 · 讨论安排",
    opening: [
      n("你说出了一个尚未征得同意的建议：“要不我先把你周末的安排空出来。”"),
      z("空哪一项？我周末还有交接。"),
      p("我只是觉得这样见面方便一些。"),
      z("可你还没问我方便不方便。"),
      n("她合上日历，手仍放在封面上。"),
      p("我没想拦着你。"),
      z("那就别先替我排掉别的事。"),
    ],
    choicePrompt: "你怎样继续这场已经起了分歧的谈话？",
    choices: [
      choice("A", "澄清并撤回未经同意的安排", "“我没有联系任何人，也不该先替你空时间。你的交接照原计划。”", "clarify_boundary"),
      choice("B", "承认害怕距离", "“我怕你去了以后，我们就只剩下偶尔一句消息。但我不能拿这个替你决定。”", "honest_talk"),
      choice("C", "请求暂停并约定再谈", "“现在越说越急。我们停两天，周五再联系，可以吗？”", "respect_distance"),
    ],
    feedback: {
      A: [z("好。我们从各自真正能空出的时间谈。"), n("你撤回了未经同意的安排，之前第三场的记录没有被自动改写。")],
      B: [z("这个可以谈。替我安排不行。"), n("冲突仍有余温，但害怕距离终于被说成了可以讨论的事实。")],
      C: [z("周五晚上吧。"), n("暂停是双方同意的冷静期，不是失联。")],
    },
  },
  {
    id: "zl-06-distance",
    phaseId: "future-conflict",
    title: "冷静期",
    location: "冷静期",
    background: "urban-home-apartment-night-v1",
    timeLabel: "第 3 周 · 冷静期",
    opening: [
      n("周四夜里，你点开聊天框。上一条消息还停在时间约定上。"),
      n("桌上是自己的交稿清单。你删掉刚输入的“睡了吗”，把第二天要交的那一份重新打开。"),
      n("周五到了。手机上的分钟跳过整点，你终于需要回答的，不只是要不要发消息。"),
    ],
    choicePrompt: "到了约定的时间，你怎么做？",
    choices: [
      choice("A", "按约联系，先给她选择谈话时间", "“我这边想过了。今晚你方便时再说，不急着现在回。”", "respect_distance"),
      choice("B", "准时说明自己的结论", "“我不能保证每周都去，但可以提前把空档告诉你。这个答案不够漂亮，是我能做到的。”", "honest_talk"),
      choice("C", "继续拖延，不解释", "“等我想好再说吧。”这句话最终也没有发出去。", "avoid_conversation"),
    ],
    feedback: {
      A: [z("九点以后可以。"), n("你守住了约定的联系时间，也给她留下了选择什么时候谈的空间。")],
      B: [z("我想听的就是这个。"), n("结论不漂亮，却是可以被日历检验的答案。")],
      C: [z("回执快到期了。我会先按自己的计划处理。"), n("第二天她发来消息。她没有被写成无限等待，失约和尊重冷静期被分开记录。")],
    },
  },
  {
    id: "zl-07-return",
    phaseId: "major-decision",
    title: "最后一班夜车",
    location: "车站外",
    background: "urban-public-cafe-rain-v1",
    timeLabel: "第 4 周 · 车站外",
    opening: [
      n("赵冷主动约你在进站前谈一会儿。她的行李箱停在脚边，拉杆没有收下去。"),
      z("我不想在检票口听“以后总有办法”。你这两个月真正能空出来多少时间？"),
      n("你翻出日历。空白的几格散在交稿日期之间，看起来比记忆里少。"),
      z("少一点没关系。别为了现在好听，把以后借过来。"),
    ],
    choicePrompt: "你能给出什么样的真实回答？",
    choices: [
      choice("A", "给出可兑现的范围", "“周日晚上能留出来，见面要提前两周商量。赶稿变动，我会先说。”", "honest_talk"),
      choice("B", "说明只能偶尔联系", "“这段时间我能回消息，但不能答应固定见面。”", "clarify_boundary"),
      choice("C", "说明不想建立异地共同安排", "“我现在承担不了这段关系往前走的责任。”", "separate_paths"),
    ],
    feedback: {
      A: [z("我也把排班给你。先试一个月，再看哪里不合适。"), n("你们拥有了一份可兑现的试行安排，下一场仍要由双方确认是否承担。")],
      B: [z("知道了。那就别把它说成固定安排。"), n("联系仍然可以继续，但固定见面不能被当作已经存在的承诺。")],
      C: [z("那我们把这个说清楚。"), n("你没有用一句漂亮话替自己承担一份做不到的责任，礼貌道别仍然是可行的路。")],
    },
  },
  {
    id: "zl-08-choice",
    phaseId: "major-decision",
    title: "检票前",
    location: "车站检票口",
    background: "urban-public-cafe-rain-v1",
    timeLabel: "第 4 周 · 检票前",
    opening: [
      n("广播开始提醒检票。赵冷看了一眼手机上的回执，又把屏幕转回自己面前。"),
      z("我决定去。这个项目，我想自己做完。"),
      p("嗯。"),
      z("你不用用“留下”证明在意，我也不会用“等我”替你做决定。"),
      n("她按下发送，才重新看向你。行李箱的轮子被过路的人碰了一下，她伸手扶稳。"),
    ],
    choicePrompt: "她已经决定出发，你怎样说明自己的选择？",
    choices: [
      choice("A", "支持出发，确认双方能承担的安排", "“按刚才说的试一个月。变动提前说，谁都不用猜。”", "make_joint_plan"),
      choice("B", "支持出发，暂以朋友身份联系", "“项目好好做。我们先保持朋友的联系，不急着答应更多。”", "respect_distance"),
      choice("C", "支持她的决定，说明自己暂不继续", "“我希望你顺利，但我现在不想继续发展这段关系。”", "separate_paths"),
    ],
    feedback: {
      A: [z("好。我们先把能做到的写清楚。"), n("赵冷的出发没有被改变。只有在双方明确接受安排后，共同计划才成为事实。")],
      B: [z("好。路上到了，我报个平安。"), n("你们保留了朋友的联系，没有默认一份更高的关系承诺。")],
      C: [z("我明白。谢谢你直接告诉我。"), n("她的自主决定被保留下来，你也没有留下等她回来续恋的默认承诺。")],
    },
  },
  {
    id: "zl-09-consequence",
    phaseId: "major-decision",
    title: "远程联系",
    location: "远程联系",
    background: "urban-home-apartment-night-v1",
    timeLabel: "第 6 周 · 远程联系",
    opening: [
      n("赵冷发来一张档案库房外的照片。若你们已有共同安排，她又补了一句：“今天交接拖晚了，能往后半小时吗？”"),
      z("这边比我想的忙。材料是真的好，时间也是真的不够。"),
      n("你看着尚未完成的文档，终于理解日历上的空格不会自己长出来。"),
    ],
    choicePrompt: "你怎样面对现在的时间与责任？",
    choices: [
      choice("A", "执行已经谈好的安排", "“我先交掉这一版，十点再聊。今晚不行就照约提前说。”", "move_forward"),
      choice("B", "诚实重新协商能做到的部分", "“最近返工多，我能稳定留出的只有隔周周日。你觉得合适吗？”", "honest_talk"),
      choice("C", "承认各自的生活需要优先", "“我现在不适合共同排日程，我们都先把自己的事做好。”", "separate_paths"),
    ],
    feedback: {
      A: [z("十点可以，我也先把手头做完。"), n("双方都为这次联系腾挪了时间，成本没有被隐藏。")],
      B: [z("先这样试。"), n("旧安排被明确替换，或者一份新的联系安排被明确建立。你只重新协商了一次，没有把它重复算成共同计划。")],
      C: [z("好。之前那些时间就不再互相留着了。"), n("共同排日程结束了，各自的生活需要被放回原来的位置。")],
    },
  },
  {
    id: "zl-10-letter",
    phaseId: "ending",
    title: "新的日常",
    location: "展览邀请",
    background: "urban-public-cafe-rain-v1",
    timeLabel: "第 9 周 · 展览邀请",
    opening: [
      n("你收到一张展览票。照片旁边的说明写着当初反复核对的那个渡口名字。"),
      n("附言：这部分有你的帮忙。愿意的话，来看看最后做成什么样了。——赵冷"),
      p("最后用的是哪一年的日期？"),
      z("两个都没直接用。找到第三份记录了。来我讲给你听。"),
    ],
    choicePrompt: "你怎样回应这次邀请？",
    choices: [
      choice("A", "赴约并说明真实感受", "“周六我能到。我想看看它，也想听听你这段时间怎么过的。”", "honest_talk"),
      choice("B", "说明当天无暇，另约时间", "“开幕那天要交稿。周末后还能看吗？”", "clarify_boundary"),
      choice("C", "婉拒现场邀请，保留远程交流", "“这次去不了。谢谢你记着，我想看看公开介绍。”", "respect_distance"),
    ],
    feedback: {
      A: [z("下午两点。正好错开开幕最忙的时候。"), n("你们约定在展厅外见面。")],
      B: [z("能，展一周。我把安静一点的时段发你。"), n("邀约被改到展期内的另一天，赴约事实没有被提前伪造。")],
      C: [z("好，链接发你。"), n("你们保留远程交流。下一场仍在远程通话，不会突然出现在展厅。")],
    },
  },
  {
    id: "zl-11-future",
    phaseId: "ending",
    title: "下一季度",
    location: "展厅外或远程通话",
    background: "urban-public-cafe-rain-v1",
    timeLabel: "第 10 周 · 展厅外",
    opening: [
      n("人群散去，赵冷把工作证翻到背面。远程通话里，她回到住处才接通，手机另一端传来放下钥匙的声音。"),
      z("下一季度的安排出来了。我想先听听，你怎么想我们以后的联系。"),
      p("你是问见面的时间？"),
      z("也问我们是不是都愿意把时间留出来。不是我发一张表，你照着填。"),
    ],
    choicePrompt: "你愿意怎样把这段关系放进下一季度？",
    choices: [
      choice("A", "提议双方共同安排", "“先商量下个月，见面和忙不过来的时候都写进去。我们都可以提修改。”", "make_joint_plan"),
      choice("B", "明确保留朋友联系", "“我珍惜这些事，但现在更愿意做朋友。有空再分享近况。”", "respect_distance"),
      choice("C", "结束共同计划，各自前进", "“下一季度不再互相预留时间了。之前的合作和心意，我都记得。”", "separate_paths"),
    ],
    feedback: {
      A: [z("好。先写你真正空得出的那几天。"), n("共同安排来自双方可以修改的现实日历，而不是一方发送、另一方照填。")],
      B: [z("可以。不把每次联系都当成一道需要答对的题。"), n("朋友联系被明确保留，称谓没有被写成恋人。")],
      C: [z("嗯。那就各自把日子过好。"), n("共同计划结束，合作和心意仍被保留在已经发生的事实里。")],
    },
  },
  {
    id: "zl-12-hook",
    phaseId: "ending",
    title: "归还档案附件",
    location: "归还档案附件",
    background: "urban-home-apartment-day-v1",
    timeLabel: "第 10 周 · 归还档案附件",
    opening: [
      n("档案附件准备归还。你又看到了那张未署名的旧借阅卡，边角比照片里更旧一点。"),
      n("如果你曾经认真观察过它，背面的模糊归还地点已经和最初图书馆的旧阅览室对应起来；否则，你只看见附件清单上的“借阅卡”。"),
      z("有些附件最后还是要回到原来的地方。"),
      p("包括这张？"),
      z("包括。"),
    ],
    choices: [],
    feedback: {},
  },
]);

export const ZHAO_LENG_ENDINGS = Object.freeze([
  {
    id: "mutual-trust" as const,
    title: "一起规划",
    summary: "你们只先圈出几天，允许变化提前说，不用急着用承诺填满空白。",
  },
  {
    id: "kind-distance" as const,
    title: "各自远行",
    summary: "你们承认现实限制，保留温和联系或各自前进，不把礼貌当成挽留。",
  },
  {
    id: "library-letter" as const,
    title: "借阅卡背面",
    summary: "借阅卡归还了，未寄出的信在双方准备好的时候有了下文。",
  },
]);

export type ZhaoLengRelationshipIntent = "undecided" | "together" | "friends" | "apart";

export function buildZhaoLengHiddenLines(intent: ZhaoLengRelationshipIntent): ZhaoLengWrittenLine[] {
  const intentLines: ZhaoLengWrittenLine[] =
    intent === "together"
      ? [
          n("信里写着第一次核对时她记住的小事，以及“下一次，不只是为了补日期”。"),
          z("下一次见面，轮到你提地方。"),
          p("我先问你哪天方便。"),
        ]
      : intent === "friends"
        ? [
            n("信里感谢你陪她把一段不确定的日子走完，没有强行告白。"),
            z("以后碰见这种认不清的旧照片，可能还要问你。"),
            p("那就把清楚一点的发我。"),
          ]
        : [
            n("信里把合作、争执和告别都留在原位。"),
            z("交给你，是想让这件事完整，不是让你改答案。"),
            p("我知道。谢谢你让我看到。"),
          ];
  return [
    n("图书馆的台灯换过一只，桌角的划痕还在。你把借阅卡放到旧登记簿旁，赵冷拿出一个薄信封。"),
    z("卡是档案里的。信是我的。别弄混了。"),
    p("写了很久？"),
    z("去车站前写的。后来觉得，有些话应该看我们怎么做，再决定要不要交给你。"),
    n("你没有直接拆开。她把信封往你这边推了一点。"),
    z("现在可以看了。"),
    ...intentLines,
    n("你把信按原来的折痕收好。窗外没有下雨，桌上的纸却依旧被两个人小心地避开了水杯。"),
  ];
}

export function buildZhaoLengEndingLines(
  endingId: "mutual-trust" | "kind-distance" | "library-letter",
  intent: ZhaoLengRelationshipIntent,
): ZhaoLengWrittenLine[] {
  if (endingId === "mutual-trust") {
    return [
      n("你们没有把下一个季度填满，只先圈出几天。赵冷在其中一个日期旁写了“可调整”，把笔递给你。"),
      p("那就有变化提前说。"),
      z("嗯。别失踪，也别硬撑。"),
      n("日历仍有许多空白。你们终于不用急着拿承诺把它们涂满。"),
    ];
  }
  if (endingId === "library-letter") return buildZhaoLengHiddenLines(intent);
  return [
    n("你把原来留出的时间重新写回自己的日历。赵冷的项目介绍仍在收藏里，渡口的日期也终于有了出处。"),
    ...(intent === "friends"
      ? [
          n("偶尔你们还会发一张照片，问一句近况。回复不再背着未说清的要求。"),
        ]
      : [n("最后一条消息停在一句祝顺利。你没有把礼貌当成挽留，也没有把已经发生的事说成白费。")]),
    n("这座城市留下了你们一起核对过的一页。接下来的路，各自走。"),
  ];
}

export function getZhaoLengBeatScript(beatId: ZhaoLengBeatId): ZhaoLengBeatScript {
  const beat = ZHAO_LENG_BEAT_SCRIPTS.find((item) => item.id === beatId);
  if (!beat) throw new Error(`找不到赵冷节拍：${beatId}`);
  return beat;
}

export function validateZhaoLengScript(): string[] {
  const errors: string[] = [];
  const expectedBeatIds = ZHAO_LENG_DEMO.phases.flatMap((phase) => phase.beats.map((beat) => beat.id));
  const actualBeatIds = ZHAO_LENG_BEAT_SCRIPTS.map((beat) => beat.id);
  if (actualBeatIds.join("|") !== expectedBeatIds.join("|")) errors.push("节拍 ID 与 C 的赵冷定义不一致");
  if (new Set(actualBeatIds).size !== 12) errors.push("赵冷剧本必须包含 12 个唯一节拍");
  for (const beat of ZHAO_LENG_BEAT_SCRIPTS.slice(0, 11)) {
    if (beat.choices.length !== 3) errors.push(`${beat.id} 必须有三个选择`);
    for (const item of beat.choices) {
      if (!beat.feedback[item.id]?.every((line) => typeof line.text === "string" && line.text.trim())) {
        errors.push(`${beat.id}/${item.id} 缺少完整反馈`);
      }
      if (!ZHAO_LENG_RULE_IDS.includes(item.ruleId)) errors.push(`${beat.id}/${item.id} 使用未注册规则`);
    }
  }
  const last = ZHAO_LENG_BEAT_SCRIPTS.at(-1);
  if (!last || last.id !== "zl-12-hook" || last.choices.length !== 0) errors.push("第十二节拍必须是无关系选择的收束操作");
  if (ZHAO_LENG_ENDINGS.length !== 3) errors.push("赵冷 Demo 必须有三个结局");
  return errors;
}
