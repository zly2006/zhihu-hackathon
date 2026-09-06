// 赵冷恋爱 Demo（V3.3，原创、全员成年人、Teen 分级）。
// 只提供结构化剧情模板，不复用任何外部 Galgame 的角色、台词或情节。

import type { HiddenEventEvaluation } from "../domain/narrative-experience";

type DemoBeat = {
  id: string;
  scene: string;
  purpose:
    | "setup"
    | "bonding"
    | "development"
    | "conflict"
    | "turning_point"
    | "climax"
    | "aftermath"
    | "hook";
  tension: 1 | 2 | 3 | 4 | 5;
  playerQuestion: string;
};

type DemoPhase = {
  id: string;
  title: string;
  theme: string;
  beats: DemoBeat[];
};

export type ZhaoLengDemoDefinition = {
  id: "zhao-leng-adult-romance-v1";
  contentRating: "teen";
  safetyRules: string[];
  cast: Array<{ id: string; name: string; age: number; role: string }>;
  phases: DemoPhase[];
  hiddenEvent: {
    id: "zhao-leng-library-letter";
    title: string;
    onceOnly: true;
    playerHint: string;
  };
  endings: Array<{ id: string; title: string; requirement: string }>;
};

export const ZHAO_LENG_DEMO: ZhaoLengDemoDefinition = {
  id: "zhao-leng-adult-romance-v1",
  contentRating: "teen",
  safetyRules: [
    "所有恋爱参与者均为成年人（18 岁及以上）。",
    "只写情感、日常与轻度亲密，不包含露骨性内容。",
    "玩家不能替赵冷作决定；关系推进必须来自双方明确选择。",
  ],
  cast: [
    { id: "protagonist", name: "主角", age: 24, role: "自由职业者" },
    { id: "npc-zhao-leng", name: "赵冷", age: 26, role: "城市档案编辑" },
  ],
  phases: [
    {
      id: "first-meet",
      title: "第一阶段：雨夜借阅",
      theme: "建立一段不急于定义的信任。",
      beats: [
        {
          id: "zl-01-message",
          scene: "赵冷主动发来消息，请主角帮忙核对一份公开档案。",
          purpose: "hook",
          tension: 1,
          playerQuestion: "要立刻回应，还是约定合适的时间？",
        },
        {
          id: "zl-02-library",
          scene: "两人在图书馆整理材料，发现对同一座城市的记忆并不相同。",
          purpose: "setup",
          tension: 1,
          playerQuestion: "是追问她的过去，还是先谈眼前的材料？",
        },
        {
          id: "zl-03-boundary",
          scene: "赵冷明确表示她不需要别人替她收尾。",
          purpose: "bonding",
          tension: 2,
          playerQuestion: "如何表达愿意帮忙，同时尊重她的边界？",
        },
      ],
    },
    {
      id: "future-conflict",
      title: "第二阶段：去留的分歧",
      theme: "稳定与重要机会都需要付出代价。",
      beats: [
        {
          id: "zl-04-opportunity",
          scene: "赵冷得到外地档案项目的机会，期限很短。",
          purpose: "development",
          tension: 2,
          playerQuestion: "提供信息、分享担忧，还是先听她的判断？",
        },
        {
          id: "zl-05-argument",
          scene: "两人因“替对方着想”的方式不同发生争执。",
          purpose: "conflict",
          tension: 3,
          playerQuestion: "是澄清事实、承认害怕，还是暂时停下对话？",
        },
        {
          id: "zl-06-distance",
          scene: "赵冷没有要求答案，只约定各自想清楚后再联系。",
          purpose: "hook",
          tension: 3,
          playerQuestion: "是否尊重冷静期，并完成自己答应的事？",
        },
      ],
    },
    {
      id: "major-decision",
      title: "第三阶段：最后一班夜车",
      theme: "亲密不是替对方放弃，而是一起承担真实后果。",
      beats: [
        {
          id: "zl-07-return",
          scene: "赵冷主动约主角在车站短谈，先询问主角真正能承诺什么。",
          purpose: "turning_point",
          tension: 4,
          playerQuestion: "能否用具体计划代替空泛保证？",
        },
        {
          id: "zl-08-choice",
          scene: "项目截止与车站检票同时到来，赵冷必须自己作出决定。",
          purpose: "climax",
          tension: 5,
          playerQuestion: "支持她的选择，同时说明自己愿意承担的部分。",
        },
        {
          id: "zl-09-consequence",
          scene: "无论结果如何，两人都承认这次选择会改变日常。",
          purpose: "aftermath",
          tension: 3,
          playerQuestion: "如何面对距离、时间和各自的责任？",
        },
      ],
    },
    {
      id: "ending",
      title: "第四阶段：新的日常",
      theme: "关系以持续行动而非一句告白被确认。",
      beats: [
        {
          id: "zl-10-letter",
          scene: "赵冷寄来一张展览票，邀请主角看她完成的工作。",
          purpose: "aftermath",
          tension: 1,
          playerQuestion: "是否赴约，并说出自己这段时间真正学到的事？",
        },
        {
          id: "zl-11-future",
          scene: "两人讨论下一个季度的安排，不承诺不可能的事。",
          purpose: "bonding",
          tension: 2,
          playerQuestion: "怎样把关系写进现实计划？",
        },
        {
          id: "zl-12-hook",
          scene: "档案中一张未署名的借阅卡留下新的线索。",
          purpose: "hook",
          tension: 1,
          playerQuestion: "是否回到最初的图书馆，开启隐藏后续？",
        },
      ],
    },
  ],
  hiddenEvent: {
    id: "zhao-leng-library-letter",
    title: "隐藏事件：未寄出的借阅卡",
    onceOnly: true,
    playerHint: "有些没有立刻说出口的话，值得在恰当的时候回去确认。",
  },
  endings: [
    {
      id: "mutual-trust",
      title: "结局：一起规划",
      requirement: "信任与亲密足够，且主角尊重赵冷的自主决定。",
    },
    {
      id: "kind-distance",
      title: "结局：各自远行",
      requirement: "双方坦诚现实限制，关系保留温和的联系。",
    },
    {
      id: "library-letter",
      title: "隐藏结局：借阅卡背面",
      requirement: "满足隐藏事件条件后，在图书馆重新相见。",
    },
  ],
};

export type ZhaoLengHiddenEventInput = {
  relationship: { closeness: number; trust: number; conflict: number };
  completedBeatIds: string[];
  observedClueIds: string[];
  consumedEventIds: string[];
};

export function evaluateZhaoLengHiddenEvent(
  input: ZhaoLengHiddenEventInput,
): HiddenEventEvaluation {
  const event = ZHAO_LENG_DEMO.hiddenEvent;
  if (input.consumedEventIds.includes(event.id)) {
    return { eventId: event.id, status: "consumed", playerHint: "这段隐藏故事已经被完整看见。" };
  }
  const eligible =
    input.relationship.closeness >= 55 &&
    input.relationship.trust >= 60 &&
    input.relationship.conflict <= 48 &&
    input.completedBeatIds.includes("zl-03-boundary") &&
    input.completedBeatIds.includes("zl-09-consequence") &&
    input.observedClueIds.includes("library-card");
  return {
    eventId: event.id,
    status: eligible ? "eligible" : "locked",
    playerHint: eligible ? event.playerHint : "继续通过行动建立信任，新的线索会在合适的时候出现。",
  };
}

export function validateZhaoLengDemo(demo: ZhaoLengDemoDefinition = ZHAO_LENG_DEMO): string[] {
  const errors: string[] = [];
  if (demo.contentRating !== "teen") errors.push("Demo 内容分级必须为 teen");
  if (demo.cast.some((character) => character.age < 18))
    errors.push("恋爱 Demo 参与者必须全部成年");
  if (demo.phases.length < 4 || demo.phases.some((phase) => phase.beats.length < 3)) {
    errors.push("Demo 必须包含四个阶段，且每阶段至少三个场景节拍");
  }
  if (demo.endings.length < 2) errors.push("Demo 至少需要两个结局");
  if (!demo.safetyRules.some((rule) => rule.includes("露骨")))
    errors.push("Demo 必须声明无露骨内容规则");
  return errors;
}
