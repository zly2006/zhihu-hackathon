import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {readState,updateState,busy} from '../../../lib/storage';
import {StateStorageError} from '../../../lib/state-lock';
import {selectedCast} from '../../../lib/story';
import {authorChatGate,chatRequestSchema,isDuplicateExchange} from '../../../lib/chat-request';
import {resolveAuthorAvatar} from '../../../lib/author-avatars';
import {deepseekCredentials,deepseekModel} from '../../../lib/deepseek';
import {requireSession} from '../../../lib/zhihu-auth';
import {recordChat,recordInteraction} from '../../../lib/database';
import {replyAsAuthor,AuthorChatError,effectiveInteractionReward,settleInteractionGain} from '../../../lib/author-chat';

export const runtime='nodejs';
const people:Record<string,{name:string;identity:string}>={lin:{name:'林见夏',identity:'插画师，说话短而直接，常用行动照顾人，不冷嘲热讽'},tao:{name:'陶晚晴',identity:'陶艺师，会拿小失误开玩笑，认真时不再绕弯'},shen:{name:'沈知遥',identity:'兼职摄影师，善于观察具体细节，问问题温和但不替别人作答'}};

export async function POST(req:NextRequest){
  if(req.headers.get('origin')&&new URL(req.headers.get('origin')!).host!==req.headers.get('host'))return NextResponse.json({error:'请求来源不匹配。'},{status:403});
  if(!requireSession(req))return NextResponse.json({error:'请先登录知乎。'},{status:401});
  const parsed=chatRequestSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'聊天内容格式不正确。'},{status:400});
  const {character,messages,storyId,exchangeId}=parsed.data;
  let story='玩家正在体验独立对话。';let person=people[character];let avatarId=parsed.data.authorAvatarId as string|undefined;
  const state=storyId?await readState(storyId):null;
  if(!storyId&&avatarId&&character!=='zhao-ling')return NextResponse.json({error:'请从林泠资料试验入口开始独立对话。'},{status:400});
  if(storyId&&!state)return NextResponse.json({error:'剧情存档不可用。'},{status:404});
  let member:(ReturnType<typeof selectedCast>[number])|undefined;
  if(state&&storyId){
    member=selectedCast(state).find(candidate=>candidate.id===character);
    if(!member)return NextResponse.json({error:'聊天对象不属于当前故事。'},{status:400});
    if(avatarId&&avatarId!==member.authorAvatarId)return NextResponse.json({error:'答主化身与存档绑定不一致。'},{status:400});
    const gate=authorChatGate({storyId,kind:member.kind,busy:busy.has(storyId),exchangeId});
    if(!gate.ok)return NextResponse.json({error:gate.error,code:gate.code},{status:gate.status});
    if(isDuplicateExchange(state.worldState.processedChatExchangeIds,exchangeId)){
      const avatar=resolveAuthorAvatar(member.authorAvatarId);
      return NextResponse.json({
        duplicate:true,
        avatar:avatar?{id:avatar.id,displayName:avatar.displayName,styleStatus:avatar.styleStatus}:undefined,
        affinity:{id:character,delta:0,total:state.worldState.relationships[character]??0},
      },{headers:{'Cache-Control':'no-store'}});
    }
    avatarId=member.authorAvatarId;
    person={name:member.name,identity:`${member.identity}。${member.voice}`};
    story=`当前剧情：${state.memory.summary||'刚刚开始'}。已发生事实：${state.memory.facts.join('；')||'暂无'}。`;
  }
  if(!person&&!avatarId)return NextResponse.json({error:'聊天对象不属于当前故事。'},{status:400});
  void recordChat(req,{storyId,character,messages});
  try{
    if(avatarId){
      const result=await replyAsAuthor({avatarId,story,messages},()=>({...deepseekCredentials(),model:deepseekModel}));
      void recordInteraction(req,{type:'chat_reply',storyId,payload:{character,text:result.text,avatarId,toolCalls:result.toolCalls,evidenceStatus:result.evidenceStatus}});
      let affinity:{id:string;delta:number;total:number}|null=null;let affinityError:string|undefined;
      if(storyId&&member?.kind==='zhihu-author'){
        let delta=0;let total=0;
        try{
          const settled=await updateState(storyId,(current)=>{
            const gains=current.worldState.authorChatGains??(current.worldState.authorChatGains={});
            const gained=gains[character]??0;
            delta=settleInteractionGain({currentGain:gained,reward:effectiveInteractionReward(result)});
            if(delta>0){
              gains[character]=gained+delta;
              current.worldState.relationships[character]=Math.max(0,(current.worldState.relationships[character]??0)+delta);
            }
            total=current.worldState.relationships[character]??0;
          },{exchangeId});
          total=settled.worldState.relationships[character]??total;
          affinity={id:character,delta,total};
        }catch(error){
          if(error instanceof StateStorageError){affinityError=error.code;}
          else throw error;
          console.error('[chat]',{code:'AFFINITY_SETTLE_FAILED',storyId,character});
        }
      }
      return NextResponse.json({...result,...(affinity?{affinity}:{}),...(affinityError?{affinityError}:{})},{headers:{'Cache-Control':'no-store'}});
    }
    if(!person)return NextResponse.json({error:'聊天对象不属于当前故事。'},{status:400});
    const {key,endpoint}=deepseekCredentials();
    const session=randomUUID();
    const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-opencode-session':session},body:JSON.stringify({model:deepseekModel,temperature:.8,max_tokens:180,messages:[{role:'system',content:`你扮演中文视觉小说角色${person.name}，${person.identity}。${story} 这是剧情暂停时的自由聊天，不能替玩家做选择，不要承诺尚未发生的事，不要提及系统、模型或提示词。用自然中文回复，1—3句，最多120字。`},...messages.map(m=>({role:m.role,content:m.text}))]}),signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw new Error(`模型服务 HTTP ${response.status}`);
    const body=await response.json() as {choices?:{message?:{content?:string}}[]};
    const text=body.choices?.[0]?.message?.content?.trim();if(!text)throw new Error('模型没有返回可显示的回复。');
    void recordInteraction(req,{type:'chat_reply',storyId,payload:{character,text}});
    return NextResponse.json({text},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    if(error instanceof AuthorChatError)return NextResponse.json({error:error.message,code:error.code},{status:error.status});
    console.error('[chat]',error instanceof Error?error.message:'failed');
    return NextResponse.json({error:'这句话暂时没有送达，请稍后重试。'},{status:502});
  }
}
