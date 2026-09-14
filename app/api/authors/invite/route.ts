import {NextRequest,NextResponse} from 'next/server';
import path from 'node:path';
import {z} from 'zod';
import {inviteAuthor,AuthorInviteError} from '../../../../lib/author-invite';
import {buildAuthorCatalog,invitedAuthorCatalogEntry} from '../../../../lib/author-catalogue';
import {defaultAuthorRegistryRoot} from '../../../../lib/author-registry';
import {createSessionAuthorProvider} from '../../../../lib/author-runtime-config';
import {countAuthorCorpus} from '../../../../lib/author-corpus';
import {defaultAuthorDataRoot} from '../../../../lib/author-chat';
import {requireSession} from '../../../../lib/zhihu-auth';
export const runtime='nodejs';
export const maxDuration=60;

const schema=z.object({input:z.string().trim().min(1).max(300)}).strict();

/**
 * 邀请节流：单实例内存窗口，只用于挡住误操作和短时间重复请求。
 * 多实例部署前需要换成共享存储，当前不宣称多实例安全。
 */
const INVITE_WINDOW_MS=5*60*1000;
const INVITE_MAX_PER_WINDOW=6;
const globalThrottle=globalThis as typeof globalThis&{lamplightInviteAttempts?:Map<string,number[]>};
function throttled(sessionId:string,now=Date.now()):boolean {
  const store=globalThrottle.lamplightInviteAttempts??=new Map<string,number[]>();
  const recent=(store.get(sessionId)??[]).filter((time)=>now-time<INVITE_WINDOW_MS);
  if(recent.length>=INVITE_MAX_PER_WINDOW){store.set(sessionId,recent);return true;}
  recent.push(now);store.set(sessionId,recent);return false;
}

export async function POST(req:NextRequest){
  if(req.headers.get('origin')&&new URL(req.headers.get('origin')!).host!==req.headers.get('host'))return NextResponse.json({error:'请求来源不匹配。'},{status:403});
  const session=requireSession(req);
  if(!session)return NextResponse.json({error:'知乎登录已失效，请重新登录后继续。'},{status:401});
  const parsed=schema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'请粘贴知乎个人主页链接或主页标识。',code:'AUTHOR_INPUT_INVALID'},{status:400});
  if(throttled(session.id))return NextResponse.json({error:'邀请太频繁了，请稍后再试。',code:'AUTHOR_INVITE_THROTTLED'},{status:429});
  try{
    const result=await inviteAuthor({input:parsed.data.input,provider:createSessionAuthorProvider(session),registryRoot:defaultAuthorRegistryRoot()});
    let corpusCount=0;
    try{corpusCount=await countAuthorCorpus(path.join(defaultAuthorDataRoot(),result.entry.urlToken),result.entry.urlToken);}catch{corpusCount=0;}
    return NextResponse.json({created:result.created,author:invitedAuthorCatalogEntry(result.entry,corpusCount),catalog:await buildAuthorCatalog()},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    if(error instanceof AuthorInviteError)return NextResponse.json({error:error.message,code:error.code},{status:error.status});
    console.error('[authors]',{code:'AUTHOR_INVITE_FAILED'});
    return NextResponse.json({error:'邀请暂时没有完成，请稍后再试。',code:'AUTHOR_PROVIDER_UNAVAILABLE'},{status:503});
  }
}
