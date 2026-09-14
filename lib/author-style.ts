import {z} from 'zod';

export const MIN_STYLE_EVIDENCE_ANSWERS = 2;
export const STYLE_CARD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const STYLE_OBSERVATION_SCOPES = ['句式', '语气', '修辞', '称呼', '节奏', '用词'] as const;
export type StyleObservationScope = typeof STYLE_OBSERVATION_SCOPES[number];

export const styleObservationSchema = z.object({
  id: z.string().min(1).max(80),
  note: z.string().min(1).max(300),
  evidenceAnswerIds: z.array(z.string().regex(/^\d+$/)).min(MIN_STYLE_EVIDENCE_ANSWERS).max(20),
  scope: z.enum(STYLE_OBSERVATION_SCOPES).optional(),
}).strict();

export const styleCardSchema = z.object({
  version: z.number().int().min(1).max(99),
  authorUrlToken: z.string().min(1).max(100),
  status: z.enum(['draft', 'auto', 'reviewed']),
  reviewedAt: z.string().optional(),
  generatedAt: z.string().optional(),
  sampleCount: z.number().int().min(0).max(200).optional(),
  sampleSource: z.enum(['local', 'online', 'mixed']).optional(),
  model: z.string().max(80).optional(),
  corpusVersion: z.string().max(80).optional(),
  observations: z.array(styleObservationSchema).min(1).max(30),
}).strict().superRefine((card, context) => {
  const ids = card.observations.map((observation) => observation.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: '风格卡观察 id 不能重复。' });
  for (const [index, observation] of card.observations.entries()) {
    if (new Set(observation.evidenceAnswerIds).size < MIN_STYLE_EVIDENCE_ANSWERS) {
      context.addIssue({ code: 'custom', message: `风格观察 ${index + 1} 必须由至少两篇不同回答支持。` });
    }
  }
  if (card.status === 'reviewed' && !card.reviewedAt) context.addIssue({ code: 'custom', message: '已审核风格卡必须记录 reviewedAt。' });
  if (card.status === 'auto' && !card.generatedAt) context.addIssue({ code: 'custom', message: '自动归纳的风格卡必须记录 generatedAt。' });
});

export type AuthorStyleCard = z.infer<typeof styleCardSchema>;

export function parseStyleCard(raw: unknown): AuthorStyleCard {
  return styleCardSchema.parse(raw);
}

export function isStyleCardFresh(card: AuthorStyleCard | undefined, now = Date.now()): boolean {
  if (!card) return false;
  const stamp = card.status === 'reviewed' ? card.reviewedAt : card.generatedAt;
  if (!stamp) return false;
  const at = Date.parse(stamp);
  if (!Number.isFinite(at)) return false;
  return now - at <= STYLE_CARD_MAX_AGE_MS;
}

export function stylePromptFragment(card: AuthorStyleCard | undefined): string {
  if (!card) return '';
  if (card.status === 'reviewed') {
    return [
      `表达风格要求（已审核风格卡 v${card.version}）：`,
      ...card.observations.map((observation) => `- ${observation.note}`),
    ].join('\n');
  }
  if (card.status === 'auto') {
    return [
      `表达风格（由公开回答自动归纳，未人工审核，只模仿语气与句式，不得复制内容、不得替作者表达观点或编造经历）：`,
      ...card.observations.map((observation) => `- ${observation.note}`),
    ].join('\n');
  }
  return '';
}
