import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {AuthorChatError} from './author-errors';
import {resolveAuthorAvatar} from './author-avatars';
import {CorpusError,loadAuthorCorpus,type CorpusErrorCode} from './author-corpus';
import {AUTHOR_INPUT_BYTE_LIMIT,runAuthorAgent,type AuthorHistory,type AuthorModelMessage} from './author-agent';
import {parseStyleCard,stylePromptFragment,type AuthorStyleCard} from './author-style';
import type {AuthorSource} from './author-citations';

export {AuthorChatError,AUTHOR_INPUT_BYTE_LIMIT};
export const AUTHOR_AFFINITY_CAP=10;
export type AuthorChatReply={
  text:string;sources:AuthorSource[];evidenceStatus:'matched'|'no-match';
  avatar:{id:string;displayName:string;styleStatus:'unreviewed'};
  toolCalls:number;turns:number;
};

export function effectiveInteractionReward(result:Pick<AuthorChatReply,'evidenceStatus'|'sources'>):number {
  if(result.evidenceStatus!=='matched')return 0;
  return result.sources.length>0?2:1;
}

export function settleInteractionGain(input:{currentGain:number;reward:number;cap?:number}):number {
  const cap=input.cap??AUTHOR_AFFINITY_CAP;
  return Math.max(0,Math.min(input.reward,cap-input.currentGain));
}

const corpusErrors:Record<CorpusErrorCode,{message:string;code:string}> = {
  CORPUS_MISSING:{message:'这位化身的资料暂不可用，请先完成离线采集后重试。',code:'CORPUS_UNAVAILABLE'},
  CORPUS_MANIFEST_INVALID:{message:'这位化身的语料清单损坏，请联系维护者重新采集。',code:'CORPUS_MANIFEST_INVALID'},
  CORPUS_HASH_MISMATCH:{message:'这位化身的语料校验失败，请重新采集后重试。',code:'CORPUS_HASH_MISMATCH'},
  CORPUS_LIMIT_EXCEEDED:{message:'这位化身的语料超过当前读取上限，请缩小问题范围后重试。',code:'CORPUS_LIMIT_EXCEEDED'},
};

export async function replyAsAuthor(
  input:{avatarId:string;story:string;messages:readonly AuthorHistory[]},
  getCredentials:()=>{key:string;endpoint:string;model:string},
):Promise<AuthorChatReply>{
  const avatar=resolveAuthorAvatar(input.avatarId);
  if(!avatar)throw new AuthorChatError('这个答主化身尚未注册。',400,'UNKNOWN_AVATAR');
  const publicAvatar={id:avatar.id,displayName:avatar.displayName,styleStatus:avatar.styleStatus};
  const authorDirectory=path.join(process.cwd(),'.data','author-avatars',avatar.sourceAuthorUrlToken);
  let answers;
  try{
    const corpus=await loadAuthorCorpus(authorDirectory,avatar.sourceAuthorUrlToken);
    answers=corpus.answers;
  }catch(error){
    if(error instanceof CorpusError){const mapped=corpusErrors[error.code];throw new AuthorChatError(mapped.message,503,mapped.code);}
    throw new AuthorChatError('这位化身的资料暂不可用，请稍后重试。',503,'CORPUS_UNAVAILABLE');
  }
  let styleCard:AuthorStyleCard|undefined;
  try{
    const raw=JSON.parse(await readFile(path.join(authorDirectory,'style','style-card.json'),'utf8'));
    const parsed=parseStyleCard(raw);
    if(parsed.authorUrlToken===avatar.sourceAuthorUrlToken)styleCard=parsed;
    else console.warn('[author-chat]',{code:'STYLE_CARD_AUTHOR_MISMATCH'});
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')console.warn('[author-chat]',{code:'STYLE_CARD_UNAVAILABLE'});
  }
  const credentials=getCredentials();
  const session=randomUUID();
  const callModel=async(messages:readonly AuthorModelMessage[]):Promise<string>=>{
    let response:Response;
    try{
      response=await fetch(credentials.endpoint,{
        method:'POST',
        headers:{Authorization:`Bearer ${credentials.key}`,'Content-Type':'application/json','x-opencode-session':session},
        body:JSON.stringify({model:credentials.model,temperature:.3,max_tokens:900,messages}),
        signal:AbortSignal.timeout(45_000),
      });
    }catch(error){
      if(error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError'))throw new AuthorChatError('模型服务响应超时，请稍后重试。',504,'MODEL_TIMEOUT');
      throw new AuthorChatError('回复暂时没有送达，请稍后重试。',502,'MODEL_UNAVAILABLE');
    }
    if(!response.ok){console.error('[author-chat]',{code:'MODEL_HTTP',status:response.status});throw new AuthorChatError('模型服务暂不可用，请稍后重试。',502,'MODEL_UNAVAILABLE');}
    const body=await response.json() as {choices?:{message?:{content?:unknown}}[];usage?:Record<string,unknown>};
    const raw=body.choices?.[0]?.message?.content;
    if(typeof raw!=='string')throw new AuthorChatError('模型回复内容必须是字符串。',502,'INVALID_MODEL_REPLY');
    const usage=Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'].filter(key=>typeof body.usage?.[key]==='number').map(key=>[key,body.usage![key]]));
    console.info('[author-chat]',{avatarId:avatar.id,budgetUnit:'utf8-bytes',...usage});
    return raw;
  };
  const result=await runAuthorAgent({answers,authorToken:avatar.sourceAuthorUrlToken,story:input.story,history:input.messages,style:stylePromptFragment(styleCard)},callModel);
  return {...result,avatar:publicAvatar};
}
