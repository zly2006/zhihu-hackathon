import {z} from 'zod';
import type {AuthorAnswer} from './author-corpus';
import {retrieveAuthorEvidence,type AuthorEvidence} from './author-retrieval';
import {normalizeAuthorCitations,type AuthorSource} from './author-citations';

export const MAX_TOOL_CALLS = 2;
export const MAX_AGENT_TURNS = 6;
export const SEARCH_EVIDENCE_BUDGET = 3000;
export const SEARCH_EXCERPT_CHARS = 160;
export const READ_PARAGRAPH_LIMIT = 6;
export const READ_BYTE_LIMIT = 1200;

export const searchArgsSchema=z.object({query:z.string().trim().min(1).max(200),limit:z.number().int().min(1).max(5).optional()}).strict();
export const readArgsSchema=z.object({answerId:z.string().regex(/^\d+$/)}).strict();
export const finishArgsSchema=z.object({text:z.string().trim().min(1).max(450),citationIds:z.array(z.string().min(1).max(80)).max(5)}).strict();
export const decisionSchema=z.discriminatedUnion('tool',[
  z.object({tool:z.literal('search_corpus'),args:searchArgsSchema}).strict(),
  z.object({tool:z.literal('read_answer'),args:readArgsSchema}).strict(),
  z.object({tool:z.literal('finish'),args:finishArgsSchema}).strict(),
]);
export type AuthorToolDecision=z.infer<typeof decisionSchema>;

export class AuthorToolError extends Error {
  constructor(message:string,readonly code:string){super(message);this.name='AuthorToolError';}
}

export type AuthorToolResult=
  | {ok:true;data:Record<string,unknown>}
  | {ok:false;error:{code:string;message:string}};

const paragraphs=(body:string)=>body.split(/\r?\n+/).map(part=>part.trim()).filter(Boolean);
const truncate=(text:string,limit:number)=>[...text].slice(0,limit).join('');

export function parseAuthorToolDecision(raw:string):AuthorToolDecision {
  let parsed:unknown;
  try{parsed=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}
  catch{throw new AuthorToolError('模型输出必须是严格 JSON。','INVALID_MODEL_REPLY');}
  const result=decisionSchema.safeParse(parsed);
  if(!result.success)throw new AuthorToolError('模型工具调用不符合契约。','INVALID_TOOL_ARGS');
  return result.data;
}

export class AuthorToolSession {
  private evidence=new Map<string,AuthorEvidence>();
  private searchedAnswerIds=new Set<string>();
  toolCalls=0;

  constructor(private readonly answers:readonly AuthorAnswer[],private readonly authorToken:string){}

  get allowedEvidence():AuthorEvidence[] {return [...this.evidence.values()];}
  get searchedAnswers():string[] {return [...this.searchedAnswerIds];}

  execute(decision:AuthorToolDecision):AuthorToolResult {
    if(decision.tool==='finish')return this.finish(decision.args);
    if(this.toolCalls>=MAX_TOOL_CALLS)return {ok:false,error:{code:'TOOL_BUDGET_EXCEEDED',message:'本轮工具调用次数已用完，请直接使用已有证据回答。'}};
    this.toolCalls+=1;
    if(decision.tool==='search_corpus')return this.search(decision.args);
    return this.read(decision.args);
  }

  private search(args:{query:string;limit?:number}):AuthorToolResult {
    const retrieval=retrieveAuthorEvidence(this.answers,{
      authorUrlToken:this.authorToken,query:args.query,sizeBudget:SEARCH_EVIDENCE_BUDGET,
      budgetUnit:'utf8-bytes',measureInput:text=>Buffer.byteLength(text,'utf8'),maxItems:args.limit??5,
    });
    if(retrieval.status==='no-match')return {ok:true,data:{status:'no-match',hint:'可以换一种说法再检索一次；如果仍然没有命中，必须直接说明资料不足。'}};
    if(retrieval.status==='budget-exceeded')return {ok:false,error:{code:'EVIDENCE_TOO_LARGE',message:'相关资料超过当前输入上限，请换一个更具体的问题。'}};
    for(const item of retrieval.items){this.evidence.set(item.id,item);this.searchedAnswerIds.add(item.answerId);}
    return {ok:true,data:{status:'matched',items:retrieval.items.map(item=>({id:item.id,answerId:item.answerId,title:item.title,excerpt:truncate(item.text,SEARCH_EXCERPT_CHARS)}))}};
  }

  private read(args:{answerId:string}):AuthorToolResult {
    if(!this.searchedAnswerIds.has(args.answerId))return {ok:false,error:{code:'ANSWER_NOT_SEARCHED',message:'只能读取本轮 search_corpus 返回过的 answerId。'}};
    const answer=this.answers.find(item=>item.answerId===args.answerId);
    if(!answer)return {ok:false,error:{code:'ANSWER_NOT_FOUND',message:'该回答不在当前作者的语料中。'}};
    const items:{id:string;text:string}[]=[];let bytes=0;
    const parts=paragraphs(answer.body);
    for(let index=0;index<parts.length&&items.length<READ_PARAGRAPH_LIMIT;index+=1){
      const text=parts[index];const size=Buffer.byteLength(text,'utf8');
      if(bytes+size>READ_BYTE_LIMIT)break;
      bytes+=size;
      const item:AuthorEvidence={id:`${answer.answerId}:p${index+1}`,answerId:answer.answerId,authorName:answer.authorName,authorUrlToken:answer.authorUrlToken,title:answer.questionTitle,sourceUrl:answer.sourceUrl,text,completeness:answer.completeness};
      this.evidence.set(item.id,item);
      items.push({id:item.id,text:item.text});
    }
    return {ok:true,data:{answerId:answer.answerId,title:answer.questionTitle,paragraphs:items,truncated:parts.length>items.length}};
  }

  private finish(args:{text:string;citationIds:string[]}):AuthorToolResult {
    if(/https?:\/\/|javascript:|www\./i.test(args.text))return {ok:false,error:{code:'INVALID_REPLY_TEXT',message:'正文不能包含链接，来源由程序根据 citationIds 生成。'}};
    let sources:AuthorSource[];
    try{sources=normalizeAuthorCitations(args.citationIds,this.allowedEvidence,this.authorToken);}
    catch{return {ok:false,error:{code:'CITATION_OUT_OF_RANGE',message:'citationIds 只能引用本轮工具返回过的证据。'}};}
    return {ok:true,data:{text:args.text,sources}};
  }
}
