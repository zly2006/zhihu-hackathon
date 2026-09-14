import { z } from 'zod';
import {resolveAuthorAvatar} from './author-avatars';
import {AUTHOR_CAST_REGISTRATIONS,authorCastBackgroundRole,resolveAuthorCastRegistration,type AuthorCastRegistration} from './author-cast';
import {
  AUTHOR_CAST_ID_PATTERN,
  AUTHOR_URL_TOKEN_PATTERN,
  authorBindingHash,
  authorProfileUrl,
  deriveAuthorCastId,
  fictionalAuthorName,
  genderForCastId,
  invitedAuthorCapabilitiesFor,
  invitedAuthorDetails,
  invitedAuthorStageRole,
  normalizeAuthorDomain,
} from './author-identity';
import config from './story-config.json';
import storyPublic from './story-public.json';
import examples from './story-examples.json';
import storyReference from './story-reference.json';
import backgroundData from './story-backgrounds.json';
import routeData from './story-route-templates.json';
import moduleData from './story-modules.json';
import { LIFE_EVENT_LIBRARY, optionForEvent, renderLifeEvent, type LifeEventTemplate, type LifeStage, type ZhihuEvidence } from './life-events';

export type Gender = '男' | '女';
export type StageKind = 'common' | 'route' | 'ending';
export type RelationshipType = 'romance' | 'friendship';
export type CharacterKind = 'preset-npc' | 'zhihu-author';
export type Beat = { id: string; kind: StageKind; task: string };
export type PublicCastMember = { id: string; name: string; gender: Gender; age: number; identity: string };
export type CharacterCapabilities = { canChat: boolean; canEnterStory: boolean; canEnterRomance: boolean };
export type AuthorRefBinding = { provider: 'zhihu'; urlToken: string; profileUrl: string };
export type AuthorSnapshot = { authorUrlToken: string; profileHash: string; corpusVersion?: string; capturedAt: string };
export type CharacterProfile = {
  id: string;
  name: string;
  gender: Gender;
  background?: string;
  zhihuHandle?: string;
  authorAvatarId?: string;
  author?: { authorRef: AuthorRefBinding; authorSnapshot: AuthorSnapshot; domains: string[]; capabilities: CharacterCapabilities };
};
export type CastDetails = { voice: string; desire: string; object: string; route_event: string; payoff: string };
export type SelectableCharacter = PublicCastMember & {
  kind: CharacterKind;
  domains?: string[];
  personaStatus?: string;
  corpusStatus?: string;
  styleStatus?: string;
  disclosure?: string;
  authorAvatarId?: string;
  capabilities?: CharacterCapabilities;
  profileUrl?: string;
  sourceDisplayName?: string;
  voice?: string;
  desire?: string;
  object?: string;
  route_event?: string;
  payoff?: string;
};
export type CastMember = PublicCastMember & CastDetails & {
  kind: CharacterKind;
  background?: string;
  zhihuHandle?: string;
  authorAvatarId?: string;
  domains?: string[];
  capabilities?: CharacterCapabilities;
  authorRef?: AuthorRefBinding;
  authorSnapshot?: AuthorSnapshot;
};
export type Route = string;
export type EndingResolution = { id: string; label: string; summary: string; tone: 'bright' | 'warm' | 'bittersweet' | 'quiet' };
export type StoryState = {
  relationships: Record<string, number>;
  flags: string[];
  timeline: string[];
  usedLifeEventIds?: string[];
  endingId?: string;
  /** 剧情外聊天的有效互动得分（预设 NPC 与答主共用）。 */
  authorChatGains?: Record<string, number>;
  /** 每位角色上次通过聊天得分的时间，用于冷却判定。 */
  chatGainAt?: Record<string, string>;
  /** 已计分过的玩家消息哈希，防止复读刷分（不保存明文）。 */
  processedChatMessageHashes?: string[];
  processedChatExchangeIds?: string[];
};
export type PublicStoryState = Omit<StoryState, 'usedLifeEventIds'>;
export type PlayerSelection = { name: string; gender: Gender };
export type Player = { id: string; name: string; gender: Gender; age: number; identity: string };
export type LifeChoice = { title: string; question: string; pressure: string; directions: string[] };
export type StoryBackground = {
  id: string;
  lifeEventStage?: LifeStage;
  label: string;
  ordinal: string;
  kicker: string;
  summary: string;
  sceneAsset: string;
  player: { age: number; identity: string };
  premise: string;
  locations: string[];
  lifeChoice: LifeChoice;
  relationshipPressure: Record<RelationshipType, string>;
  cast: Record<string, { age: number; identity: string }>;
  constraints: string[];
};
export type RouteTemplate = {
  label: string;
  shortLabel: string;
  summary: string;
  contract: string;
  stages: Beat[];
  endingTask: string;
};
export type StoryModule = { id: string; title: string; situation: string; location: string; object: string };
export type StartOptions = { backgroundId?: string; playerName?: string; playerGender?: Gender; seed?: string };

const beats = config.BEATS as unknown as Beat[];
const privateCast = config.CAST as Record<string, CastDetails>;
const backgrounds = backgroundData.backgrounds as unknown as StoryBackground[];
const routeTemplates = routeData.routes as unknown as Record<RelationshipType, RouteTemplate>;
const modulePools = moduleData.backgrounds as unknown as Record<string, Record<'common' | RelationshipType, StoryModule[]>>;

export const total = beats.length;
export const maxStages = beats.length;
export const minStages = 6;
export const castPool = storyPublic.cast as unknown as PublicCastMember[];
export const ids = castPool.map((member) => member.id);
export const requiredCastCount = storyPublic.requiredCastCount;
export const defaultBackgroundId = storyPublic.defaultBackgroundId;
export const publicPlayer = storyPublic.player as { id: string; name: string };
export const publicBackgrounds = backgrounds;
export const limits = config.LIMITS;

const commonBeats = beats.filter((beat) => beat.kind === 'common');
const endingBeat = beats.find((beat) => beat.kind === 'ending');

if (!beats.length || beats.some((beat) => !beat.id || !beat.kind || !beat.task)) throw new Error('BEATS 配置不完整。');
if (commonBeats.length < 2 || !endingBeat || beats.filter((beat) => beat.kind === 'route').length !== 3) throw new Error('BEATS 必须包含至少两次共同选择、三次路线推进和一个结局。');
if (castPool.length !== 8 || new Set(ids).size !== castPool.length) throw new Error('公开角色池必须是 8 位不重复角色。');
if (castPool.some((member) => !privateCast[member.id])) throw new Error('公开角色池与私密角色资料不匹配。');
if (backgrounds.length !== 4 || new Set(backgrounds.map((item) => item.id)).size !== backgrounds.length) throw new Error('必须配置四套不重复的人生背景包。');
if (!backgrounds.some((item) => item.id === defaultBackgroundId)) throw new Error('默认人生背景包不存在。');
for (const background of backgrounds) {
  if (background.locations.length < 4 || background.lifeChoice.directions.length < 2) throw new Error(`背景包${background.id}的地点或人生方向不完整。`);
  if (castPool.some((member) => !background.cast[member.id]?.identity)) throw new Error(`背景包${background.id}没有覆盖全部角色。`);
  if (!modulePools[background.id]?.common.length || !modulePools[background.id]?.romance.length || !modulePools[background.id]?.friendship.length) throw new Error(`背景包${background.id}的剧情模块不完整。`);
}
for (const type of ['romance', 'friendship'] as const) {
  const template = routeTemplates[type];
  if (!template || template.stages.length !== 3 || template.stages.some((stage) => stage.kind !== 'route')) throw new Error(`${type}路线模板必须包含三个推进段。`);
}
for (const registration of AUTHOR_CAST_REGISTRATIONS) {
  if (ids.includes(registration.castId)) throw new Error('答主角色 ID 不能与预设角色池重复。');
  if (!resolveAuthorAvatar(registration.authorAvatarId)) throw new Error('答主角色必须绑定已注册的化身。');
  for (const background of backgrounds) {
    if (!authorCastBackgroundRole(registration, background.id)?.identity) throw new Error(`答主角色${registration.castId}没有覆盖背景${background.id}。`);
  }
}

function authorSelectableCharacter(registration: AuthorCastRegistration): SelectableCharacter {
  return {
    id: registration.castId,
    name: registration.displayName,
    gender: registration.gender,
    age: registration.age,
    identity: registration.identity,
    kind: 'zhihu-author',
    domains: [...registration.domains],
    personaStatus: registration.personaStatus,
    corpusStatus: registration.corpusStatus,
    styleStatus: registration.styleStatus,
    disclosure: registration.disclosure,
    authorAvatarId: registration.authorAvatarId,
    capabilities: {canChat: true, canEnterStory: true, canEnterRomance: registration.canEnterRomance},
  };
}

export function resolveSelectableCharacter(id: string): SelectableCharacter | undefined {
  const author = resolveAuthorCastRegistration(id);
  if (author) return authorSelectableCharacter(author);
  const preset = castPool.find((member) => member.id === id);
  return preset ? { ...preset, kind: 'preset-npc' } : undefined;
}

export function authorSelectableCharacters(): SelectableCharacter[] {
  return AUTHOR_CAST_REGISTRATIONS.map(authorSelectableCharacter);
}

export const REGISTERED_AUTHOR_SNAPSHOT_AT = '2026-01-01T00:00:00.000Z';

export function authorRefBinding(urlToken: string): AuthorRefBinding {
  if (!AUTHOR_URL_TOKEN_PATTERN.test(urlToken)) throw new Error('知乎主页标识不合法。');
  return {provider: 'zhihu', urlToken, profileUrl: authorProfileUrl(urlToken)};
}

type AuthorBinding = NonNullable<CharacterProfile['author']>;

function normalizeBindingDomains(domains: readonly string[], requireWhitelist: boolean): string[] {
  const normalized: string[] = [];
  for (const domain of domains) {
    const value: string | undefined = requireWhitelist ? normalizeAuthorDomain(domain) : String(domain).trim().slice(0, 40);
    if (!value) throw new Error('答主领域标签不合法。');
    if (!normalized.includes(value)) normalized.push(value);
  }
  if (!normalized.length || normalized.length > 3) throw new Error('答主领域标签不合法。');
  return normalized;
}

function registeredAuthorBinding(registration: AuthorCastRegistration): AuthorBinding {
  const avatar = resolveAuthorAvatar(registration.authorAvatarId);
  if (!avatar) throw new Error('答主化身未注册。');
  const urlToken = avatar.sourceAuthorUrlToken;
  return {
    authorRef: authorRefBinding(urlToken),
    authorSnapshot: {authorUrlToken: urlToken, profileHash: authorBindingHash(urlToken), capturedAt: REGISTERED_AUTHOR_SNAPSHOT_AT},
    domains: normalizeBindingDomains(registration.domains, false),
    capabilities: {canChat: true, canEnterStory: true, canEnterRomance: registration.canEnterRomance},
  };
}

/** 邀请答主的作者绑定与快照必须由服务端再次推导，客户端不能自证。 */
function invitedAuthorBinding(profile: CharacterProfile): AuthorBinding {
  const idGender = genderForCastId(profile.id);
  if (!idGender) throw new Error('答主角色 ID 不合法。');
  const binding = profile.author;
  if (!binding) throw new Error('答主角色缺少作者绑定。');
  const ref = binding.authorRef;
  if (!ref || ref.provider !== 'zhihu' || !AUTHOR_URL_TOKEN_PATTERN.test(ref.urlToken) || ref.profileUrl !== authorProfileUrl(ref.urlToken)) {
    throw new Error('答主作者绑定不合法。');
  }
  if (deriveAuthorCastId(ref.urlToken, idGender) !== profile.id) throw new Error('答主角色与作者标识不一致。');
  const snapshot = binding.authorSnapshot;
  if (!snapshot || snapshot.authorUrlToken !== ref.urlToken || snapshot.profileHash !== authorBindingHash(ref.urlToken)) throw new Error('答主快照校验失败。');
  if (!Number.isFinite(Date.parse(snapshot.capturedAt))) throw new Error('答主快照时间不合法。');
  const domains = normalizeBindingDomains(binding.domains ?? [], true);
  const expected = invitedAuthorCapabilitiesFor(ref.urlToken);
  const capabilities = binding.capabilities;
  if (!capabilities || capabilities.canChat !== expected.canChat || capabilities.canEnterStory !== expected.canEnterStory || capabilities.canEnterRomance !== expected.canEnterRomance) {
    throw new Error('答主能力配置不合法。');
  }
  return {
    authorRef: ref,
    authorSnapshot: {authorUrlToken: ref.urlToken, profileHash: snapshot.profileHash, capturedAt: snapshot.capturedAt},
    domains,
    capabilities: expected,
  };
}

function canonicalRegisteredAuthor(profile: CharacterProfile, registration: AuthorCastRegistration): CharacterProfile {
  const member = authorSelectableCharacter(registration);
  if (member.gender !== profile.gender) throw new Error('角色资料与当前角色池不一致。');
  if (profile.authorAvatarId && profile.authorAvatarId !== member.authorAvatarId) throw new Error('答主化身未注册。');
  return {
    id: member.id,
    name: member.name,
    gender: member.gender,
    background: profile.background?.trim().slice(0, 300) || undefined,
    authorAvatarId: member.authorAvatarId,
    author: registeredAuthorBinding(registration),
  };
}

function canonicalInvitedAuthor(profile: CharacterProfile): CharacterProfile {
  const idGender = genderForCastId(profile.id);
  if (!idGender) throw new Error('答主角色 ID 不合法。');
  const binding = invitedAuthorBinding(profile);
  const gender: Gender = idGender === '男' ? '男' : '女';
  if (profile.gender !== gender) throw new Error('答主角色性别与标识不一致。');
  return {
    id: profile.id,
    name: fictionalAuthorName(binding.authorRef.urlToken),
    gender,
    background: profile.background?.trim().slice(0, 300) || undefined,
    authorAvatarId: profile.id,
    author: binding,
  };
}

export function canonicalProfiles(input: CharacterProfile[] = defaultProfiles()): CharacterProfile[] {
  if (input.length !== requiredCastCount) throw new Error(`必须选择${requiredCastCount}位角色。`);
  const seen = new Set<string>();
  return input.map((profile) => {
    if (seen.has(profile.id)) throw new Error('角色不能重复选择。');
    seen.add(profile.id);
    const registration = resolveAuthorCastRegistration(profile.id);
    if (registration) return canonicalRegisteredAuthor(profile, registration);
    if (AUTHOR_CAST_ID_PATTERN.test(profile.id)) return canonicalInvitedAuthor(profile);
    const member = castPool.find((candidate) => candidate.id === profile.id);
    if (!member || member.gender !== profile.gender) throw new Error('角色资料与当前角色池不一致。');
    if (profile.authorAvatarId && !resolveAuthorAvatar(profile.authorAvatarId)) throw new Error('答主化身未注册。');
    return {
      id: member.id,
      name: member.name,
      gender: member.gender,
      background: profile.background?.trim().slice(0, 300) || undefined,
      zhihuHandle: profile.zhihuHandle?.trim().slice(0, 80) || undefined,
      authorAvatarId: resolveAuthorAvatar(profile.authorAvatarId || profile.zhihuHandle)?.id,
    };
  });
}

export function selectableCharacters(): SelectableCharacter[] {
  return [...authorSelectableCharacters(), ...castPool.map((member) => ({ ...member, kind: 'preset-npc' as const }))];
}

export function backgroundFor(id: string): StoryBackground {
  const background = backgrounds.find((item) => item.id === id);
  if (!background) throw new Error('人生背景包不存在。');
  return background;
}

export const count = (text: string) => [...text].filter((char) => /[\p{L}\p{N}]/u.test(char)).length;

export const nodeSchema = z.object({
  title: z.string().min(1).max(25),
  lines: z.array(z.object({ speaker: z.string(), text: z.string().min(1).max(limits.maxLineChars) }).strict()).min(4).max(22),
  choices: z.array(z.object({ text: z.string().min(4).max(30), target: z.string().nullable() }).strict()).max(limits.totalChoiceMax),
  evidenceIds: z.array(z.string().min(1).max(80)).max(6).optional(),
  lifeEventId: z.string().min(1).max(100).nullable().optional(),
  memory: z.object({ summary: z.string().max(240), facts: z.array(z.string().max(55)).max(6) }).strict(),
}).strict();

export type StoryNode = z.infer<typeof nodeSchema>;
export type Selection = { node: number; index: number; text: string; target: Route | null; eventId?: string; optionId?: 'A' | 'B' | 'C'; evidence?: ZhihuEvidence[]; outcome?: string; disclosure?: 'private' | 'confided' | 'shared' | 'co-decided' };
export type State = {
  version: 2;
  seed: string;
  backgroundId: string;
  player: Player;
  nodes: StoryNode[];
  selections: Selection[];
  commonRounds: number;
  needsTiebreak: boolean;
  route: Route | null;
  relationshipType: RelationshipType | null;
  pending: boolean;
  partial?: Partial<StoryNode>;
  memory: StoryNode['memory'];
  profiles?: CharacterProfile[];
  storyTitle?: string;
  storyTone?: string;
  plannedLifeEventIds?: Record<string, string>;
  worldState: StoryState;
};

function defaultProfiles(): CharacterProfile[] {
  return ['ling', 'm1', 'm3', 'f2'].map((id) => {
    const member = resolveSelectableCharacter(id);
    if (!member) throw new Error('默认角色池不完整。');
    return { id: member.id, name: member.name, gender: member.gender };
  });
}

export function selectedCast(state: Pick<State, 'profiles' | 'backgroundId'>): CastMember[] {
  const background = backgroundFor(state.backgroundId);
  return canonicalProfiles(state.profiles).map((profile) => {
    const author = resolveAuthorCastRegistration(profile.id);
    if (author) {
      const stageRole = authorCastBackgroundRole(author, background.id);
      if (!stageRole) throw new Error('答主角色资料不存在。');
      const binding = profile.author ?? registeredAuthorBinding(author);
      return {
        id: author.castId,
        name: author.displayName,
        gender: author.gender,
        age: stageRole.age,
        identity: stageRole.identity,
        kind: 'zhihu-author' as const,
        ...author.details,
        background: profile.background,
        authorAvatarId: author.authorAvatarId,
        domains: [...author.domains],
        capabilities: {...binding.capabilities},
        authorRef: {...binding.authorRef},
        authorSnapshot: {...binding.authorSnapshot},
      };
    }
    if (profile.author && AUTHOR_CAST_ID_PATTERN.test(profile.id)) {
      const binding = profile.author;
      const role = invitedAuthorStageRole(background.id, binding.domains, binding.authorRef.urlToken);
      return {
        id: profile.id,
        name: fictionalAuthorName(binding.authorRef.urlToken),
        gender: profile.gender,
        age: role.age,
        identity: role.identity,
        kind: 'zhihu-author' as const,
        ...invitedAuthorDetails(binding.domains),
        background: profile.background,
        authorAvatarId: profile.id,
        domains: [...binding.domains],
        capabilities: {...binding.capabilities},
        authorRef: {...binding.authorRef},
        authorSnapshot: {...binding.authorSnapshot},
      };
    }
    const member = castPool.find((candidate) => candidate.id === profile.id);
    const stageRole = member ? background.cast[member.id] : undefined;
    if (!member || !stageRole) throw new Error('角色资料不存在。');
    return {
      ...member,
      age: stageRole.age,
      identity: stageRole.identity,
      kind: 'preset-npc' as const,
      ...privateCast[member.id],
      background: profile.background,
      zhihuHandle: profile.zhihuHandle,
      authorAvatarId: profile.authorAvatarId,
    };
  });
}

export function selectedIds(state: Pick<State, 'profiles' | 'backgroundId'>): string[] {
  return selectedCast(state).map((member) => member.id);
}

function emptyRelationships(profiles: CharacterProfile[]): Record<string, number> {
  return Object.fromEntries(profiles.map((profile) => [profile.id, 0]));
}

function normalizedPlayer(name: string | undefined, gender: Gender, background: StoryBackground): Player {
  const safeName = (name?.trim() || publicPlayer.name).slice(0, 16);
  if (!safeName) throw new Error('玩家姓名不能为空。');
  return { id: publicPlayer.id, name: safeName, gender, age: background.player.age, identity: background.player.identity };
}

function plannedEvents(seed: string, backgroundId: string) {
  const lifeEventStage = backgroundFor(backgroundId).lifeEventStage;
  if (!lifeEventStage) return {};
  const candidates = LIFE_EVENT_LIBRARY.events.filter((event) => event.lifeStages.includes(lifeEventStage));
  const used = new Set<string>();
  return Object.fromEntries(
    beats.filter((beat) => beat.kind !== 'ending').map((beat, index) => {
      if (!candidates.length) return [beat.id, ''];
      const start = stableHash(`${seed}:${backgroundId}:${beat.id}`) % candidates.length;
      let event = candidates.find((candidate, offset) => !used.has(candidate.id) && (offset + candidates.length - start) % candidates.length === 0);
      if (!event) event = candidates[(start + index) % candidates.length];
      used.add(event.id);
      return [beat.id, event.id];
    }),
  );
}

function ensureWorldState(state: State) {
  const canonical = canonicalProfiles(state.profiles);
  state.worldState ??= { relationships: emptyRelationships(canonical), flags: [], timeline: [], usedLifeEventIds: [] };
  state.worldState.relationships ??= emptyRelationships(canonical);
  state.worldState.flags ??= [];
  state.worldState.timeline ??= [];
  state.worldState.usedLifeEventIds ??= [];
  for (const id of selectedIds(state)) state.worldState.relationships[id] ??= 0;
  state.plannedLifeEventIds ??= plannedEvents(state.seed, state.backgroundId);
  return state.worldState;
}

function affinityDelta(option: { strategyTag: string }, isCommon: boolean) {
  if (isCommon) return 1;
  if (/(共同|照护|陪伴|关系|协商|交换|友情|同情|家庭|远程|亲自|团队)/.test(option.strategyTag)) return 2;
  if (/(回避|掩盖|隐性|短期服从|退出)/.test(option.strategyTag)) return 0;
  return 1;
}

function benefitForLifeChoice(option: ReturnType<typeof optionForEvent>) {
  const tag = option.strategyTag;
  if (/(证据|规则|程序|验证|信息|可信度|能力|结构化|契约|制度|透明|审计|正式)/.test(tag)) return '获得更清晰的信息、证据和可复盘的依据';
  if (/(共同|照护|陪伴|关系|协商|交换|友情|同情|家庭|远程|亲自|团队)/.test(tag)) return '保留了沟通、协商和共同承担的空间';
  if (/(公开|直接|机会|押注|迁移|转向|竞选|申诉|兴趣|主动|创业)/.test(tag)) return '把主动权握在自己手里，争取了一次明确机会';
  if (/(回避|掩盖|透支|隐性|短期服从|延期|延迟|现金换强度|退出)/.test(tag)) return '先保护了当下的关系、资源或心理空间，争取到缓冲时间';
  return '把模糊的困境变成了一次具体行动，获得继续判断的依据';
}

function resultForLifeChoice(option: ReturnType<typeof optionForEvent>) {
  return `已执行“${option.action}”。收益：${benefitForLifeChoice(option)}。后续影响：${option.tradeoff}（这是需要观察的可能变化，不代表玩家做错了）。`;
}

export function resolveEnding(state: State): EndingResolution {
  const world = ensureWorldState(state);
  const affinity = state.route ? world.relationships[state.route] ?? 0 : 0;
  if (state.relationshipType === 'romance' && affinity >= 5) return { id: 'mutual-commitment', label: '并肩向前', summary: '你们在一次次具体选择里确认了彼此，最后把未来写成了共同计划。', tone: 'bright' };
  if (affinity >= 4) return { id: 'steady-companions', label: '把答案留给明天', summary: '关系没有被一句承诺定格，但你们学会了用坦诚和行动继续靠近。', tone: 'warm' };
  if (affinity >= 2) return { id: 'shared-shelter', label: '留一盏灯', summary: '你们接住了彼此的一部分处境，即使道路不同，也愿意保留回来的位置。', tone: 'warm' };
  return { id: 'honest-beginning', label: '从诚实开始', summary: '这一次没有完美结局，但你终于把真正想要的人生和关系说清楚了。', tone: 'quiet' };
}

export function initial(profiles: CharacterProfile[] = defaultProfiles(), options: StartOptions = {}): State {
  const canonical = canonicalProfiles(profiles);
  const background = backgroundFor(options.backgroundId || defaultBackgroundId);
  const player = normalizedPlayer(options.playerName, options.playerGender || '女', background);
  return {
    version: 2,
    seed: options.seed || 'preview-story',
    backgroundId: background.id,
    player,
    nodes: [],
    selections: [],
    commonRounds: 0,
    needsTiebreak: false,
    route: null,
    relationshipType: null,
    pending: true,
    memory: { summary: '', facts: [] },
    profiles: canonical,
    plannedLifeEventIds: plannedEvents(options.seed || 'preview-story', background.id),
    worldState: { relationships: emptyRelationships(canonical), flags: [], timeline: [], usedLifeEventIds: [] },
  };
}

function routeTemplate(state: Pick<State, 'relationshipType'>): RouteTemplate | null {
  return state.relationshipType ? routeTemplates[state.relationshipType] : null;
}

export function beatForState(state: Pick<State, 'nodes' | 'route' | 'relationshipType' | 'commonRounds'>): Beat {
  if (state.route) {
    const template = routeTemplate(state);
    if (!template) throw new Error('已经锁定角色，却没有关系线模板。');
    const routeIndex = state.nodes.length - state.commonRounds;
    if (routeIndex < template.stages.length) return template.stages[routeIndex];
    return { ...endingBeat!, task: template.endingTask };
  }
  // `commonRounds` counts submitted common choices, while `nodes.length`
  // also includes the final common node that is waiting for its tie-break
  // choice. Using nodes.length here made a valid tie-break state (three
  // common nodes, two submitted choices, no route yet) throw and strand the
  // story. The next beat is determined by the number of completed choices.
  const commonIndex = state.commonRounds;
  if (commonIndex < commonBeats.length) return commonBeats[commonIndex];
  // A full State is repaired before generation/public projection. Keep this
  // readonly helper total as well so a legacy snapshot can never crash the UI.
  return commonBeats[commonBeats.length - 1]!;
}

export function beatAtNode(state: Pick<State, 'route' | 'relationshipType' | 'commonRounds'>, nodeIndex: number): Beat {
  if (nodeIndex < state.commonRounds || !state.route) return commonBeats[nodeIndex];
  const template = routeTemplate(state);
  const routeIndex = nodeIndex - state.commonRounds;
  const beat = template?.stages[routeIndex];
  if (!beat) throw new Error('找不到该段对应的路线阶段。');
  return beat;
}

export function totalForState(state: Pick<State, 'route' | 'relationshipType' | 'commonRounds' | 'needsTiebreak'>) {
  const routeCount = routeTemplate(state)?.stages.length || 3;
  if (state.route) return state.commonRounds + routeCount + 1;
  return (state.needsTiebreak ? commonBeats.length : Math.min(2, commonBeats.length)) + routeCount + 1;
}

export const stageKind = (state: Pick<State, 'nodes' | 'route' | 'relationshipType' | 'commonRounds'>) => beatForState(state).kind;
export const isCommonStage = (state: Pick<State, 'nodes' | 'route' | 'relationshipType' | 'commonRounds'>) => stageKind(state) === 'common';
export const isEndingStage = (state: Pick<State, 'nodes' | 'route' | 'relationshipType' | 'commonRounds'>) => stageKind(state) === 'ending';

function lockRoute(state: State, target: Route) {
  const member = selectedCast(state).find((candidate) => candidate.id === target);
  if (!member) throw new Error('锁定角色不存在。');
  state.route = target;
  state.needsTiebreak = false;
  const romanceAllowed = member.kind !== 'zhihu-author' || member.capabilities?.canEnterRomance === true;
  state.relationshipType = romanceAllowed && state.player.gender !== member.gender ? 'romance' : 'friendship';
  state.worldState.timeline.push(`锁定${member.name}，进入${routeTemplates[state.relationshipType].label}`);
}

export function recoverStoryProgress(state: State) {
  if (state.route || state.commonRounds < commonBeats.length) return false;
  const routeIds = selectedIds(state);
  const scores = Object.fromEntries(routeIds.map((id) => [id, state.selections.filter((selection) => selection.target === id).length]));
  const max = Math.max(0, ...Object.values(scores));
  const leaders = routeIds.filter((id) => scores[id] === max);
  const latest = [...state.selections].reverse().find((selection) => selection.target && leaders.includes(selection.target));
  lockRoute(state, latest?.target || leaders[0] || routeIds[0]);
  state.pending = true;
  return true;
}

export function choose(state: State, index: number, expected: number) {
  const routeIds = selectedIds(state);
  ensureWorldState(state);
  if (expected !== state.nodes.length || state.pending || state.nodes.length >= totalForState(state)) throw new Error('剧情进度已变化，请刷新后继续。');
  const choices = state.nodes.at(-1)?.choices;
  const picked = choices?.[index];
  if (!Number.isInteger(index) || !picked) throw new Error('无效的选项。');
  const currentBeat = beatAtNode(state, state.nodes.length - 1);
  const completedLifeEvent = getNodeLifeEvent(state.nodes.at(-1));
  const lifeChoice = currentBeat.kind === 'route' && completedLifeEvent
    ? optionForEvent(completedLifeEvent, index)
    : null;
  const evidenceOption = lifeChoice;
  const confidantId = picked.target || state.route;
  const selectedAffinityDelta = lifeChoice ? affinityDelta(lifeChoice, false) : (picked.target ? 1 : 0);
  const nextAffinity = confidantId ? (state.worldState.relationships[confidantId] ?? 0) + selectedAffinityDelta : 0;
  const disclosure = nextAffinity >= 3 ? 'co-decided' : nextAffinity >= 2 ? 'shared' : nextAffinity >= 1 ? 'confided' : 'private';
  const outcome = lifeChoice ? resultForLifeChoice(lifeChoice) : undefined;
  state.selections.push({ node: state.nodes.length - 1, index, ...picked, eventId: completedLifeEvent?.id, optionId: evidenceOption?.id, evidence: evidenceOption ? structuredClone(evidenceOption.zhihuEvidence) : undefined, outcome, disclosure });
  if (picked.target) {
    if (!routeIds.includes(picked.target)) throw new Error('选项目标不属于当前角色。');
    state.worldState.relationships[picked.target] = Math.max(0, state.worldState.relationships[picked.target] + selectedAffinityDelta);
  } else if (state.route) {
    state.worldState.relationships[state.route] = Math.max(0, (state.worldState.relationships[state.route] ?? 0) + selectedAffinityDelta);
  }
  const usedLifeEventIds = state.worldState.usedLifeEventIds || (state.worldState.usedLifeEventIds = []);
  if (completedLifeEvent && !usedLifeEventIds.includes(completedLifeEvent.id)) usedLifeEventIds.push(completedLifeEvent.id);
  state.worldState.timeline.push(`第${state.nodes.length}段选择：${picked.text}${outcome ? `｜${outcome}` : ''}`);

  if (currentBeat.kind === 'common') {
    state.commonRounds += 1;
    if (state.commonRounds >= 2) {
      const scores = Object.fromEntries(routeIds.map((id) => [id, state.selections.filter((selection) => selection.target === id).length]));
      const max = Math.max(...Object.values(scores));
      const leaders = routeIds.filter((id) => scores[id] === max);
      if (leaders.length === 1) lockRoute(state, leaders[0]);
      else if (state.commonRounds < commonBeats.length) state.needsTiebreak = true;
      else {
        const latest = [...state.selections].reverse().find((selection) => selection.target && leaders.includes(selection.target));
        if (!latest?.target) throw new Error('平票后没有形成可锁定的人物。');
        lockRoute(state, latest.target);
      }
    }
  }
  if (currentBeat.kind === 'route' && beatForState(state).kind === 'ending') state.worldState.endingId = resolveEnding(state).id;
  state.pending = true;
}

function commonFallback(member: CastMember, index: number) {
  const texts = [
    `先回应${member.name}`,
    `和${member.name}一起处理`,
    `接住${member.name}的提议`,
    `请${member.name}说说想法`,
  ];
  return { text: texts[index % texts.length], target: member.id };
}

function normalizeChoices(state: State, input: StoryNode['choices']): StoryNode['choices'] {
  const beat = beatForState(state);
  if (beat.kind === 'ending') return [];

  const event = selectedLifeEvent(state, beat);
  if (!event) return input;

  if (beat.kind === 'common') {
    const members = selectedCast(state);
    const byTarget = new Map(input.map((choice) => [choice.target, choice]));
    return members.map((member, index) => {
      const choice = byTarget.get(member.id) || commonFallback(member, index);
      return { text: choice.text, target: member.id };
    });
  }
  return event.options.slice(0, limits.routeChoiceMax).map((option) => ({ text: option.label, target: null }));
}

export function validate(raw: unknown, state: State): StoryNode {
  const parsed = nodeSchema.parse(raw);
  const beat = beatForState(state);
  const choices = normalizeChoices(state, parsed.choices);
  const lifeEvent = selectedLifeEvent(state, beat);
  const requiredSources = requiredEvidenceIds(state);
  const receivedSources = parsed.evidenceIds?.length ? parsed.evidenceIds : requiredSources;
  if (requiredSources.some((id) => !receivedSources.includes(id)) || receivedSources.some((id) => !requiredSources.includes(id))) throw new Error('本段必须完整回指程序提供的知乎回答，不能编造或漏掉来源');
  const node: StoryNode = {
    ...parsed,
    choices,
    evidenceIds: receivedSources,
    lifeEventId: lifeEvent?.id || null,
    lines: parsed.lines.map((line) => ({ ...line, speaker: line.speaker === '我' ? state.player.name : line.speaker })),
  };

  const allowedSpeakers = ['旁白', state.player.name, ...selectedCast(state).map((member) => member.name)];
  for (const line of node.lines) {
    if (!allowedSpeakers.includes(line.speaker)) throw new Error('speaker必须使用当前所选角色姓名或旁白');
  }

  const length = node.lines.reduce((sum, line) => sum + count(line.text), 0);
  if (state.nodes.length && node.lines.map((line) => line.text).join('\n') === state.nodes.at(-1)!.lines.map((line) => line.text).join('\n')) throw new Error('本段正文与上一段完全重复，必须推进上一选择及当前事件');
  if (length < limits.minEffectiveChars || length > limits.maxEffectiveChars) throw new Error(`正文${length}字，要求${limits.minEffectiveChars}至${limits.maxEffectiveChars}字，建议${limits.targetEffectiveChars}字左右`);

  if (beat.kind === 'ending' ? node.choices.length !== 0 : node.choices.length < limits.routeChoiceMin) throw new Error('选项数量不符合当前阶段要求');
  if (new Set(node.choices.map((choice) => choice.text)).size !== node.choices.length) throw new Error('选项不能重复');
  if (beat.kind === 'common') {
    const routeIds = selectedIds(state);
    if (node.choices.length !== requiredCastCount || routeIds.some((id) => !node.choices.some((choice) => choice.target === id))) throw new Error('共同篇选项必须分别对应当前全部角色');
  }
  if (beat.kind === 'route' && node.choices.some((choice) => choice.target !== null)) throw new Error('个人线target必须为null');
  if (state.nodes.length === 0) {
    const names = selectedCast(state).map((member) => member.name);
    if (names.some((name) => !node.lines.some((line) => line.speaker === name))) throw new Error('开场四位角色必须各有台词');
  }
  return node;
}

type ExampleEntry = { example: number; text: string; effective_chars: number };
type ExampleStory = { id: string; stageKey: string; label: string; source: string; examples: ExampleEntry[] };
type ReferenceSegment = { id: string; order: number; stageKey: string; heading: string; text: string; effective_chars: number };
type ReferenceStory = { version: number; title: string; source: string; note: string; segments: ReferenceSegment[] };
const exampleStories = (examples as unknown as { stories: ExampleStory[] }).stories;
const referenceStory = storyReference as ReferenceStory;

if (referenceStory.segments.length !== beats.length || referenceStory.segments.some((segment, index) => segment.stageKey !== beats[index]?.id || !segment.text.trim())) throw new Error('完整范本故事必须按 BEATS 顺序覆盖全部剧情阶段。');

export function selectExamplesForBeat(beatId: string) {
  const stories = exampleStories.filter((story) => story.stageKey === beatId);
  if (!stories.length) throw new Error(`阶段${beatId}没有可用的写作范例。`);
  return stories.flatMap((story) => story.examples.map((item) => ({
    stageKey: story.stageKey,
    sourceId: story.id,
    label: story.label,
    source: story.source,
    example: item.example,
    effective_chars: item.effective_chars,
    text: item.text,
  })));
}

export function selectExamples(stage: number) {
  const beat = beats[stage];
  if (!beat) throw new Error(`无效的剧情阶段：${stage}`);
  return selectExamplesForBeat(beat.id);
}

export function selectReferenceStory() {
  return structuredClone(referenceStory);
}

export function selectedModule(state: Pick<State, 'backgroundId' | 'seed' | 'relationshipType' | 'nodes'>, beat: Beat): StoryModule | null {
  if (beat.kind === 'ending') return null;
  const category = beat.kind === 'common' ? 'common' : state.relationshipType || 'romance';
  const modules = modulePools[state.backgroundId]?.[category];
  if (!modules?.length) throw new Error('当前背景包没有可用剧情模块。');
  return modules[stableHash(`${state.seed}:${beat.id}:${state.nodes.length}`) % modules.length];
}

export function selectedLifeEvent(state: Pick<State, 'backgroundId' | 'seed' | 'nodes' | 'worldState' | 'plannedLifeEventIds'>, beat: Beat): LifeEventTemplate | null {
  if (beat.kind === 'ending') return null;
  const lifeEventStage = backgroundFor(state.backgroundId).lifeEventStage;
  if (!lifeEventStage) return null;
  const candidates = LIFE_EVENT_LIBRARY.events.filter((event) => event.lifeStages.includes(lifeEventStage));
  if (!candidates.length) return null;
  const plannedId = state.plannedLifeEventIds?.[beat.id];
  const planned = plannedId ? candidates.find((event) => event.id === plannedId) : undefined;
  if (planned) return planned;
  const used = new Set(state.worldState?.usedLifeEventIds || []);
  const unused = candidates.filter((event) => !used.has(event.id));
  const pool = unused.length ? unused : candidates;
  return pool[stableHash(`${state.seed}:${beat.id}:${state.nodes.length}:${lifeEventStage}`) % pool.length];
}

function getNodeLifeEvent(node: StoryNode | undefined) {
  return node?.lifeEventId ? LIFE_EVENT_LIBRARY.events.find((event) => event.id === node.lifeEventId) || null : null;
}

export function requiredEvidenceIds(state: State) {
  const latest = state.selections.at(-1);
  if (latest?.evidence?.length) return [...new Set(latest.evidence.map((item) => item.contentId))].slice(0, 6);
  const event = selectedLifeEvent(state, beatForState(state));
  return [...new Set((event?.zhihuEvidence || []).map((item) => item.contentId))].slice(0, 6);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function listOrNone(items: string[]) {
  return items.length ? items.join('、') : '无';
}

function renderWorldState(state: State) {
  ensureWorldState(state);
  const relationships = selectedCast(state).map((member) => `${member.id}(${member.name})=${state.worldState.relationships[member.id] ?? 0}`);
  const timeline = state.worldState.timeline.length ? state.worldState.timeline.map((entry, index) => `${index + 1}. ${entry}`).join('\n') : '暂无';
  return [
    `角色关系：${listOrNone(relationships)}`,
    `已记录事实：${listOrNone(state.worldState.flags)}`,
    `行动时间线：\n${timeline}`,
  ].join('\n');
}

function renderHistory(state: State) {
  if (!state.nodes.length) return '暂无。';
  return state.nodes.map((node, index) => [
    `第${index + 1}段：${node.title}`,
    ...node.lines.map((line) => `[${line.speaker}] ${line.text}`),
    `选项：${listOrNone(node.choices.map((choice) => `${choice.text}${choice.target ? ` -> ${choice.target}` : ''}`))}`,
    state.selections.find((selection) => selection.node === index)?.outcome ? `已产生结果：${state.selections.find((selection) => selection.node === index)?.outcome}` : '结果：本段尚未选择。',
  ].join('\n')).join('\n\n');
}

function renderReference(stageId: string) {
  return [
    `标题：${referenceStory.title}`,
    `用途：${referenceStory.note}`,
    ...referenceStory.segments.map((segment) => `## ${segment.heading}${segment.stageKey === stageId ? '（当前阶段对应段落）' : ''}\n${segment.text}`),
  ].join('\n\n');
}

function renderExamples(beatId: string) {
  const selected = selectExamplesForBeat(beatId);
  return selected.map((example, index) => [
    `参考片段 ${String(index + 1).padStart(2, '0')}｜${example.label}｜${example.sourceId}｜${example.effective_chars}字`,
    `事件：${example.source}`,
    example.text,
  ].join('\n')).join('\n\n');
}

function renderChoiceContract(beat: Beat, routeIds: string[]) {
  if (beat.kind === 'common') return `输出${requiredCastCount}个选项，target 分别覆盖 ${routeIds.join('、')}，每个当前角色恰好一次；选项写具体行动，不写“进入某人路线”。`;
  if (beat.kind === 'route') return `输出${limits.routeChoiceMin}至${limits.routeChoiceMax}个选项，所有 target 均为 null；至少一个选项允许放慢关系，不能只写询问或查看。`;
  return '结局不输出选项，choices 必须为空数组。';
}

function renderBackground(state: State) {
  const background = backgroundFor(state.backgroundId);
  return [
    `阶段：${background.label}｜${background.kicker}`,
    `玩家：${state.player.name}，${state.player.gender}，${state.player.age}岁，${state.player.identity}`,
    `故事前提：${background.premise}`,
    `可用地点：${listOrNone(background.locations)}`,
    `人生选择：${background.lifeChoice.title}`,
    `核心问题：${background.lifeChoice.question}`,
    `现实压力：${background.lifeChoice.pressure}`,
    `可选方向：${listOrNone(background.lifeChoice.directions)}`,
    `禁止元素：${listOrNone(background.constraints)}`,
  ].join('\n');
}

function renderRoutePlan(state: State, beat: Beat) {
  if (!state.relationshipType) {
    return [
      '当前尚未锁线。第二次共同选择后若唯一领先则直接锁定；平票时只能再给一次共同选择，不能提前写私人线。',
      `恋爱线规则：${routeTemplates.romance.contract}`,
      `友情线规则：${routeTemplates.friendship.contract}`,
    ].join('\n');
  }
  const template = routeTemplates[state.relationshipType];
  const locked = selectedCast(state).find((member) => member.id === state.route);
  return [
    `关系类型：${template.label}`,
    `锁定角色：${locked ? `${locked.id}(${locked.name})` : '未知'}`,
    `路线规则：${template.contract}`,
    `路线总目标：${template.summary}`,
    `当前任务：${beat.task}`,
  ].join('\n');
}

function renderModule(state: State, beat: Beat) {
  const module = selectedModule(state, beat);
  if (!module) return '结局不再选择新模块，只收束已经发生的具体事件。';
  return [
    `模块编号：${module.id}`,
    `事件骨架：${module.title}`,
    `起因：${module.situation}`,
    `主要地点：${module.location}`,
    `关键物件：${module.object}`,
    '可以替换人物、物件和动作来贴合当前背景与关系，但必须先完整完成这个模块的因果，再推进人生选择。',
  ].join('\n');
}

function renderLifeEventModule(state: State, beat: Beat) {
  const event = selectedLifeEvent(state, beat);
  if (!event) return '当前人生背景没有独立事件库条目，以本段剧情模块和核心人生选择推进。';
  const lifeEventStage = backgroundFor(state.backgroundId).lifeEventStage!;
  return [
    renderLifeEvent(event, lifeEventStage),
    '使用规则：把该事件作为本段现实因果骨架。事件背景、行动与结果只能综合上方知乎回答；禁止虚构具体经历、数字、政策或必然结果。可选行动由程序固定为 A/B/C（共同篇第4人复用C），模型不得另编选项。',
  ].join('\n');
}

function disclosureRule(state: State) {
  const latest = state.selections.at(-1);
  const member = selectedCast(state).find((candidate) => candidate.id === (latest?.target || state.route));
  const name = member?.name || '同行者';
  if (!latest?.eventId) return '困境尚未分享。NPC 只能回应现场可见事实。';
  if (latest.disclosure === 'co-decided') return `${name}已进入共同决策阶段：可以知道完整顾虑与三条知乎依据、提出异议并共同承担后果。`;
  if (latest.disclosure === 'shared') return `${name}已进入完整分享阶段：可以知道完整困境与三条依据并讨论代价，但不能替玩家决定。`;
  if (latest.disclosure === 'confided') return `${name}只处于部分倾诉阶段：只能知道部分处境和一种担忧，不能知道全部依据。`;
  return `${name}尚未获知私人困境：不能读心、不能知道知乎依据、不能直接给答案。`;
}

function renderSelectedEvidence(state: State) {
  const evidence = state.selections.at(-1)?.evidence;
  return evidence?.length ? evidence.map((item, index) => `${index + 1}. ${item.title}｜${item.author}\n${item.excerpt}\n${item.url}`).join('\n\n') : '暂无已选择的知乎证据。';
}

export function promptText(state: State) {
  const beat = beatForState(state);
  const selected = selectedCast(state);
  const cards = selected.map((member) => state.route && member.id !== state.route ? {
    id: member.id,
    name: member.name,
    gender: member.gender,
    age: member.age,
    identity: member.identity,
    kind: member.kind,
    domains: member.domains,
    background: member.background,
    zhihuHandle: member.zhihuHandle,
  } : member);
  const latest = state.selections.at(-1);
  const routeIds = selected.map((member) => member.id);
  const castText = cards.map((member) => [
    `- ${member.id}｜${member.name}｜${member.gender}｜${member.age}岁｜${member.identity}`,
    member.background ? `背景：${member.background}` : null,
    member.zhihuHandle ? `知乎账号：${member.zhihuHandle}` : null,
    member.kind === 'zhihu-author' ? '化身设定：基于知乎公开回答改编的虚构角色，只使用公开语料中的观点，不编造真实经历或私人关系' : null,
    'desire' in member && member.desire ? `当下愿望：${member.desire}` : null,
    'object' in member && member.object ? `关键物件：${member.object}` : null,
  ].filter(Boolean).join('\n')).join('\n');
  const history = renderHistory(state);
  const previousTail = state.nodes.at(-1)?.lines.map((line) => line.text).join('\n').slice(-240) || '暂无。';
  const nextAction = latest
    ? `先执行玩家刚选择的【${latest.text}】。程序记录的结果是【${latest.outcome || '本段行动已经发生，必须补出具体结果'}】；必须写出行动如何改变现场、NPC如何反应、接下来出现什么新问题，不能重写或跳过。`
    : '这是开场片段，必须建立当前人生阶段里的第一件具体小事，并让四位角色各有独特行动或台词。';

  return [
    `【本轮必须执行】\n${nextAction}`,
    `【阶段】\n第 ${state.nodes.length + 1} / ${totalForState(state)} 段｜${beat.id}｜${beat.kind}${state.relationshipType ? `｜${routeTemplates[state.relationshipType].label}` : ''}\n任务：${beat.task}`,
    `【人生背景与核心冲突】\n${renderBackground(state)}`,
    `【当前角色】\n${castText}`,
    `【关系线模板】\n${renderRoutePlan(state, beat)}`,
    `【本段剧情模块】\n${renderModule(state, beat)}`,
    `【本段人生事件库｜具体处境】\n${renderLifeEventModule(state, beat)}`,
    `【上次选择的知乎回答依据｜结果唯一事实源】\n${renderSelectedEvidence(state)}`,
    `【好感度与分享边界】\n${disclosureRule(state)}`,
    `【标题规则】\n${state.nodes.length === 0 ? '本段 title 同时作为整部故事标题；根据当前人生阶段、角色和基调生成，不使用固定标题。' : `沿用已生成标题「${state.storyTitle || '未命名'}」与基调，不改写。`}`,
    `【选择规则】\n${renderChoiceContract(beat, routeIds)}`,
    `【当前状态】\n${renderWorldState(state)}`,
    `【完整范本故事｜全文完整注入】\n${renderReference(beat.id)}`,
    `【同阶段参考片段｜完整注入】\n以下共 ${selectExamplesForBeat(beat.id).length} 条，均来自当前阶段 ${beat.id}。只学习结构、节奏、动作和因果，不复制原句、人名、世界观或专有名词。\n\n${renderExamples(beat.id)}`,
    `【已经发生的剧情｜不可改写】\n${history}`,
    `【上一段收尾】\n${previousTail}`,
    `【长期记忆】\n摘要：${state.memory.summary || '暂无'}\n事实：${listOrNone(state.memory.facts)}`,
    '【因果闭环】每段都必须完成“选择 → 行动 → 收益/即时结果 → NPC反应 → 新问题/关系变化”。先明确玩家通过这次选择获得了什么，再写需要观察的可能变化；不要把每个选择写成惩罚，也不要暗示玩家做错了。结局段必须收束最后一个结果，并完成告白、关系确认或诚实告别。',
  ].join('\n\n');
}

export function continuationMessage(state: State, issue: string, next: string) {
  const partial = state.partial;
  const delivered = partial?.lines?.length
    ? partial.lines.map((line) => `[${line.speaker}] ${line.text}`).join('\n')
    : '暂无。';
  return [
    `【续写要求｜最高优先级】\n${next}`,
    `【已发送且不可重写】\n标题：${partial?.title || '尚未发送'}\n${delivered}`,
    `【纠错信息】\n${issue || '无。'}`,
    '【输出硬约束】\n只从下一条缺失记录开始续写。已经发送的标题和正文禁止再次输出；如果标题已存在，本次绝不能再次输出 [SCENE]。不要重新生成整段，不要解释，不要输出 Markdown。',
  ].join('\n\n');
}

export function protocolInstruction(state: State) {
  const beat = beatForState(state);
  const selected = selectedCast(state);
  const targetRule = beat.kind === 'common'
    ? `必须输出${requiredCastCount}个选项，target分别覆盖${selected.map((member) => `${member.id}(${member.name})`).join('、')}，每个角色恰好一次`
    : beat.kind === 'route'
      ? `必须输出${limits.routeChoiceMin}至${limits.routeChoiceMax}个选项，所有target均为JSON null`
      : '结局必须输出空数组：[CHOICES] {"items":[]}';
  return `你必须输出固定标签文本协议，每行一条记录，禁止Markdown围栏。严格顺序：
[SCENE] 本段短标题
[NPC:旁白] 一条叙述
[NPC:角色名] 一句对白
重复NPC，整段正文${limits.minEffectiveChars}至${limits.maxEffectiveChars}有效字，目标${limits.targetEffectiveChars}字、${limits.targetLinesMin}至${limits.targetLinesMax}条。
[CHOICES] {"items":[{"text":"行动","target":null}]}
[EVIDENCE] {"ids":${JSON.stringify(requiredEvidenceIds(state))}}
[MEMORY] {"summary":"累计事实","facts":["事实"]}
[END]
${targetRule}；只生成当前片段，不输出解释。每段必须写清上次选择的行动、收益/结果、NPC反应和新的推进，不能只复述选择，也不能把人生选择写成单向惩罚。`;
}

export function nextInstruction(state: State) {
  const written = (state.partial?.lines || []).reduce((sum, line) => sum + count(line.text), 0);
  if (!state.partial?.title) return '本次必须先输出scene标题，然后继续输出新的line对白记录；标题已经缺失时禁止只输出line。';
  if (state.partial?.memory) return '本次必须只输出end；禁止输出scene、line、choices、evidence或memory。';
  if (state.partial?.evidenceIds) return '本次必须只输出memory，然后end；禁止输出scene、line、choices或evidence。';
  if (state.partial?.choices) return `本次必须只输出evidence，ids严格等于 ${JSON.stringify(requiredEvidenceIds(state))}；然后输出memory和end。`;
  if (written >= limits.minEffectiveChars) return '本次直接输出choices、evidence、memory和end；禁止输出scene或line。';
  return `正文目前${written}字，还缺至少${Math.max(0, limits.minEffectiveChars - written)}字。本次只能继续输出新的line对白记录，不能输出scene或choices；达到${limits.minEffectiveChars}字后再进入下一轮。最多可写到${limits.maxEffectiveChars}字。`;
}

export function buildModelMessages(state: State, issue = '') {
  const messages = [{
    role: 'system' as const,
    content: `${config.SYSTEM}\n\n${protocolInstruction(state)}`,
  }, {
    role: 'user' as const,
    content: promptText(state),
  }, {
    role: 'user' as const,
    content: continuationMessage(state, issue, nextInstruction(state)),
  }];
  if (messages.some((message) => typeof message.content !== 'string')) throw new Error('消息content必须是字符串');
  return messages;
}

export function messages(state: State) {
  return [{
    role: 'system',
    content: config.SYSTEM,
  }, {
    role: 'user',
    content: promptText(state),
  }];
}

export function publicState(state: State) {
  recoverStoryProgress(state);
  ensureWorldState(state);
  const background = backgroundFor(state.backgroundId);
  const route = state.relationshipType ? routeTemplates[state.relationshipType] : null;
  const currentBeat = beatForState(state);
  const visibleNode = state.nodes.at(-1);
  const event = getNodeLifeEvent(visibleNode) || selectedLifeEvent(state, currentBeat);
  const latestSelection = state.selections.at(-1);
  const ending = state.route ? resolveEnding(state) : null;
  const publicEvidence = (items: ZhihuEvidence[]) => items.map(({ contentId, title, author, url, authorAvatarUrl, authorProfileUrl }) => ({ contentId, title, author, url, authorAvatarUrl, authorProfileUrl }));
  return {
    storyTitle: state.storyTitle,
    storyTone: state.storyTone,
    worldState: {
      relationships: state.worldState.relationships,
      flags: state.worldState.flags,
      timeline: state.worldState.timeline,
      endingId: state.worldState.endingId,
    } satisfies PublicStoryState,
    ending: ending ? { ...ending, id: state.worldState.endingId || ending.id } : null,
    lifeEvent: event ? { id: event.id, title: event.title, domain: event.domain, evidence: publicEvidence(event.zhihuEvidence), options: event.options.map((option) => ({ id: option.id, label: option.label, action: option.action, evidence: publicEvidence(option.zhihuEvidence) })), minimumEvidencePerOption: event.sourcePolicy.minimumAnswersPerOption } : null,
    relationshipProgress: selectedCast(state).map((member) => { const affinity = state.worldState.relationships[member.id] ?? 0; return { id: member.id, name: member.name, affinity, disclosure: affinity >= 3 ? '共同决策' : affinity >= 2 ? '完整分享' : affinity >= 1 ? '部分倾诉' : '尚未分享' }; }),
    selectedEvidence: publicEvidence(latestSelection?.evidence || []),
    world: {
      player: state.player,
      background: {
        id: background.id,
        label: background.label,
        ordinal: background.ordinal,
        kicker: background.kicker,
        summary: background.summary,
        sceneAsset: background.sceneAsset,
        lifeChoice: background.lifeChoice,
        constraints: background.constraints,
      },
      premise: background.premise,
      locations: background.locations,
      cast: selectedCast(state).map(({ id, name, gender, age, identity, kind, domains, background: profileBackground, zhihuHandle, authorAvatarId, capabilities }):PublicCastMember & {kind:CharacterKind;domains?:string[];background?:string;zhihuHandle?:string;authorAvatarId?:string;capabilities?:CharacterCapabilities} => ({ id, name, gender, age, identity, kind, ...(domains?{domains}:{}), background: profileBackground, zhihuHandle, ...(authorAvatarId?{authorAvatarId}:{}), ...(capabilities?{capabilities}:{}) })),
    },
    partial: state.partial ? {
      title: state.partial.title,
      lines: state.partial.lines || [],
      choices: state.partial.choices?.map((choice) => ({ text: choice.text })) || [],
    } : null,
    nodes: state.nodes.map((node) => ({
      title: node.title,
      lines: node.lines,
      choices: node.choices.map((choice) => ({ text: choice.text })),
      readingSeconds: node.lines.reduce((sum, line) => sum + count(line.text), 0) / 5,
    })),
    route: state.route,
    relationshipType: state.relationshipType,
    routeLabel: route?.label || null,
    stageId: currentBeat.id,
    stageKind: currentBeat.kind,
    selections: state.selections.map((selection) => ({ node: selection.node, index: selection.index })),
    pending: state.pending,
    total: totalForState(state),
    minTotal: minStages,
    maxTotal: maxStages,
    complete: state.nodes.length >= totalForState(state),
  };
}

export type PublicState = ReturnType<typeof publicState>;
export type GameEvent = { type: 'status'; phase: 'generating' | 'validating' | 'repairing' | 'translating'; message: string } | { type: 'scene'; segment: number; title: string; readingSeconds: number } | { type: 'line'; index: number; speaker: string; text: string } | { type: 'choices'; items: { text: string }[] } | { type: 'done'; state: PublicState } | { type: 'error'; message: string };

export function eventsFor(node: StoryNode, state: State): GameEvent[] {
  return [
    { type: 'scene', segment: state.nodes.length, title: node.title, readingSeconds: node.lines.reduce((sum, line) => sum + count(line.text), 0) / 5 },
    ...node.lines.map((line, index) => ({ type: 'line' as const, index, ...line })),
    { type: 'choices', items: node.choices.map((choice) => ({ text: choice.text })) },
    { type: 'done', state: publicState(state) },
  ];
}
