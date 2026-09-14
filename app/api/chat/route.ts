import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {readState,busy} from '../../../lib/storage';
import {selectedCast} from '../../../lib/story';
import {authorChatGate,chatRequestSchema,isDuplicateExchange} from '../../../lib/chat-request';
import {resolveAuthorAvatar,authorRefForAvatar} from '../../../lib/author-avatars';
import {AUTHOR_CAST_ID_PATTERN} from '../../../lib/author-identity';
import {defaultAuthorRegistryRoot,readInvitedAuthor} from '../../../lib/author-registry';
import {settleChatReward} from '../../../lib/chat-settlement';
import {StateStorageError} from '../../../lib/state-lock';
import {modelCredentials} from '../../../lib/model-config';
import {requireSession} from '../../../lib/zhihu-auth';
import {recordChat,recordInteraction} from '../../../lib/database';
import {replyAsAuthor,loadAuthorChatRuntime,AuthorChatError,type AuthorChatTarget} from '../../../lib/author-chat';
import {prepareAuthorStyle} from '../../../lib/author-style-runtime';
import {createSessionAuthorProvider} from '../../../lib/author-runtime-config';

export const runtime='nodejs';
const people:Record<string,{name:string;identity:string}>={lin:{name:'林见夏',identity:'插画师，说话短而直接，常用行动照顾人，不冷嘲热讽'},tao:{name:'陶晚晴',identity:'陶艺师，会拿自己的小失误开玩笑，认真时不再绕弯'},shen:{name:'沈知遥',identity:'兼职摄影师，善于观察具体细节，问问题温和但不替别人作答'}};

/** 剧情内聊天统一结算：NPC 与答主共用聊天奖励通道，客户端不能提交 delta/total。 */
async function settleForStory(options:{storyId?:string;character:string;messageText:string;replyOk:boolean;cited:boolean;exchangeId?:string}):Promise<{affinity?:{id:string;delta:number;total:number;reason:string};affinityError?:string}> {
  if(!options.storyId)return {};
  try{
    const settled=await settleChatReward({storyId:options.storyId,characterId:options.character,messageText:options.messageText,replyOk:options.replyOk,cited:options.cited,exchangeId:options.exchangeId});
    return {affinity:{id:settled.id,delta:settled.delta,total:settled.total,reason:settled.reason}};
  }catch(error){
    console.error('[chat]',{code:'AFFINITY_SETTLE_FAILED',storyId:options.storyId,character:options.character});
    return {affinityError:error instanceof StateStorageError?error.code:'AFFINITY_SETTLE_FAILED'};
  }
}


/** 林泠资料试验使用同一个 AuthorChatTarget 结构，但不属于任何剧情存档。 */
function trialTarget():AuthorChatTarget|null {
  const avatar=resolveAuthorAvatar('zhao-ling');
  if(!avatar)return null;
  return {
    castId:'ling',displayName:avatar.displayName,
    authorRef:authorRefForAvatar(avatar),
    authorSnapshot:{authorUrlToken:avatar.sourceAuthorUrlToken,capturedAt:'trial'},
    domains:['生物','科研方法论','职业规划'],
    sourceDisplayName:avatar.sourceAuthorName,
  };
}

/** 公开来源昵称：注册答主取化身登记，邀请答主取注册表；读不到就不披露。 */
async function sourceLabelFor(member:{id:string;authorAvatarId?:string}):Promise<string|undefined> {
  const avatar=resolveAuthorAvatar(member.authorAvatarId);
  if(avatar)return avatar.sourceAuthorName;
  if(!AUTHOR_CAST_ID_PATTERN.test(member.id))return undefined;
  try{
    const entry=await readInvitedAuthor(defaultAuthorRegistryRoot(),member.id);
    return entry?.source.displayName;
  }catch{return undefined;}
}

export async function POST(req:NextRequest){
  if(req.headers.get('origin')&&new URL(req.headers.get('origin')!).host!==req.headers.get('host'))return NextResponse.json({error:'请求来源不匹配。'},{status:403});
  const session=requireSession(req);
  if(!session)return NextResponse.json({error:'知乎登录已失效，请重新登录后继续。'},{status:401});
  const parsed=chatRequestSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'聊天内容格式不正确。'},{status:400});
  const {character,messages,storyId,exchangeId}=parsed.data;
  const input=messages.at(-1)?.text??'';
  let story='玩家正在体验独立对话。';let person=people[character];let avatarId=parsed.data.authorAvatarId;
  const state=storyId?await readState(storyId):null;
  if(!storyId&&avatarId&&character!=='zhao-ling')return NextResponse.json({error:'请从林泠资料试验入口开始独立对话。'},{status:400});
  if(storyId&&!state)return NextResponse.json({error:'剧情存档不可用。'},{status:404});
  let member:(ReturnType<typeof selectedCast>[number])|undefined;
  let target:AuthorChatTarget|undefined;
  if(state&&storyId){
    member=selectedCast(state).find(candidate=>candidate.id===character);
    if(!member)return NextResponse.json({error:'聊天对象不属于当前故事。'},{status:400});
    if(avatarId&&member.kind!=='zhihu-author')return NextResponse.json({error:'答主化身与存档绑定不一致。'},{status:400});
    if(avatarId&&member.kind==='zhihu-author'&&avatarId!==member.authorAvatarId&&avatarId!=='zhao-ling')return NextResponse.json({error:'答主化身与存档绑定不一致。'},{status:400});
    const gate=authorChatGate({storyId,kind:member.kind,busy:busy.has(storyId),exchangeId});
    if(!gate.ok)return NextResponse.json({error:gate.error,code:gate.code},{status:gate.status});
    if(isDuplicateExchange(state.worldState.processedChatExchangeIds,exchangeId)){
      return NextResponse.json({
        duplicate:true,
        avatar:member.kind==='zhihu-author'?{id:member.id,displayName:member.name,styleStatus:'unreviewed'}:undefined,
        affinity:{id:character,delta:0,total:state.worldState.relationships[character]??0},
      },{headers:{'Cache-Control':'no-store'}});
    }
    if(member.kind==='zhihu-author'&&member.authorRef){
      target={
        castId:member.id,displayName:member.name,
        authorRef:member.authorRef,
        authorSnapshot:member.authorSnapshot??{authorUrlToken:member.authorRef.urlToken},
        domains:member.domains,
        sourceDisplayName:await sourceLabelFor({id:member.id,authorAvatarId:member.authorAvatarId}),
      };
      avatarId=member.authorAvatarId;
      person={name:member.name,identity:`${member.identity}。${member.voice}`};
      story=`当前剧情：${state.memory.summary||'刚刚开始'}。已发生事实：${state.memory.facts.join('；')||'暂无'}。`;
    }else if(member.kind==='preset-npc'){
      avatarId=undefined;
      person={name:member.name,identity:`${member.identity}。${member.voice}`};
      story=`当前剧情：${state.memory.summary||'刚刚开始'}。已发生事实：${state.memory.facts.join('；')||'暂无'}。`;
    }
  }
  if(!storyId&&avatarId==='zhao-ling'){
    target=trialTarget()??undefined;
    if(!target)return NextResponse.json({error:'答主化身未注册。'},{status:400});
  }
  if(!person&&!target)return NextResponse.json({error:'聊天对象不属于当前故事。'},{status:400});
  void recordChat(req,{storyId,character,messages});
  try{
    if(target){
      const runtime=await loadAuthorChatRuntime(target,{provider:createSessionAuthorProvider(session)});
      if(runtime.styleStale){
        const styleCredentials=modelCredentials();
        void prepareAuthorStyle({authorRef:runtime.authorRef,displayName:runtime.displayName,provider:runtime.provider},{root:runtime.root,credentials:styleCredentials}).catch(()=>undefined);
      }
      const result=await replyAsAuthor({runtime,story,messages,context:storyId?'story':'trial'},()=>{
        const config=modelCredentials();
        return {key:config.key,endpoint:config.endpoint,model:config.model,provider:config.provider,effort:config.effort};
      });
      void recordInteraction(req,{type:'chat_reply',storyId,payload:{character,text:result.text,castId:result.avatar.id,modelCalls:result.modelCalls,evidenceStatus:result.evidenceStatus,providerStatus:result.providerStatus}});
      const settlement=await settleForStory({storyId,character,messageText:input,replyOk:true,cited:result.sources.length>0,exchangeId});
      return NextResponse.json({...result,...settlement},{headers:{'Cache-Control':'no-store'}});
    }
    if(!person)return NextResponse.json({error:'聊天对象不属于当前故事。'},{status:400});
    const {key,endpoint,model,provider,effort}=modelCredentials();
    const headers:Record<string,string>={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
    if(provider==='opencode')headers['x-opencode-session']=randomUUID();
    const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({model,reasoning_effort:effort,temperature:.8,max_tokens:400,messages:[{role:'system',content:`你扮演中文视觉小说角色${person.name}，${person.identity}。${story} 这是剧情暂停时的自由聊天，不能替玩家做选择，不要承诺尚未发生的事，不要提及系统、模型或提示词。用自然中文回复，1—3句，最多120字。`},...messages.map(m=>({role:m.role,content:m.text}))]}),signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw new Error(`模型服务 HTTP ${response.status}`);
    const body=await response.json() as {choices?:{message?:{content?:string}}[]};
    const text=body.choices?.[0]?.message?.content?.trim();if(!text)throw new Error('模型没有返回可显示的回复。');
    void recordInteraction(req,{type:'chat_reply',storyId,payload:{character,text}});
    const settlement=await settleForStory({storyId,character,messageText:input,replyOk:true,cited:false,exchangeId});
    return NextResponse.json({text,...settlement},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    if(error instanceof AuthorChatError)return NextResponse.json({error:error.message,code:error.code},{status:error.status});
    console.error('[chat]',error instanceof Error?error.message:'failed');
    return NextResponse.json({error:'这句话暂时没有送达，请稍后重试。'},{status:502});
  }
}
