import {z} from 'zod';

export const MIN_STYLE_EVIDENCE_ANSWERS = 2;

export const styleObservationSchema = z.object({
  id: z.string().min(1).max(80),
  note: z.string().min(1).max(300),
  evidenceAnswerIds: z.array(z.string().regex(/^\d+$/)).min(MIN_STYLE_EVIDENCE_ANSWERS).max(20),
  scope: z.string().max(120).optional(),
}).strict();

export const styleCardSchema = z.object({
  version: z.number().int().min(1).max(99),
  authorUrlToken: z.string().min(1).max(100),
  status: z.enum(['draft', 'reviewed']),
  reviewedAt: z.string().optional(),
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
});

export type AuthorStyleCard = z.infer<typeof styleCardSchema>;

export function parseStyleCard(raw: unknown): AuthorStyleCard {
  return styleCardSchema.parse(raw);
}

export function stylePromptFragment(card: AuthorStyleCard | undefined): string {
  if (!card || card.status !== 'reviewed') return '';
  return [
    `表达风格要求（已审核风格卡 v${card.version}）：`,
    ...card.observations.map((observation) => `- ${observation.note}`),
  ].join('\n');
}
