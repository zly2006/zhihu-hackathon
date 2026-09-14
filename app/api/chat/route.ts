import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {readState} from '../../../lib/storage';
import {selectedCast} from '../../../lib/story';
import {modelCredentials} from '../../../lib/model-config';
import {requireSession} from '../../../lib/zhihu-auth';
import {recordChat,recordInteraction} from '../../../lib/database';

export const runtime='nodejs';
const schema=z.object({storyId:z.string().uuid().optional(),character:z.string().trim().min(1).max(80),line:z.number().int().min(0),messages:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().trim().min(1).max(500)})).min(1).max(12)}).strict();
const people:Record<string,{name:string;identity:string}>={lin:{name:'林见夏',identity:'插画师，说话短而直接，常用行动照顾人，不冷嘲热讽'},tao:{name:'陶晚晴',identity:'陶艺师，会拿小失误开玩笑，认真时不再绕弯'},shen:{name:'沈知遥',identity:'兼职摄影师，善于观察具体细节，问问题温和但不替别人作答'}};
export async function POST(req:NextRequest){
 if(req.headers.get('origin')&&new URL(req.headers.get('origin')!).host!==req.headers.get('host'))return NextResponse.json({error:'请求来源不匹配。'},{status:403});
 if(!requireSession(req))return NextResponse.json({error:'知乎登录已失效，请重新登录后继续。'},{status:401});
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'聊天内容格式不正确。'},{status:400});
 const {character,messages,storyId}=parsed.data;let story='玩家正在体验独立对话。';let person=people[character];
 void recordChat(req,{storyId,character,messages});
 const state=storyId?await readState(storyId):null;
 if(storyId&&!state)return NextResponse.json({error:'剧情存档不可用。'},{status:404});
 if(state){story=`当前剧情：${state.memory.summary||'刚刚开始'}。已发生事实：${state.memory.facts.join('；')||'暂无'}。`;const member=selectedCast(state).find((candidate)=>candidate.id===character);if(member)person={name:member.name,identity:`${member.identity}。${member.voice}`};}
 if(!person)return NextResponse.json({error:'聊天对象不属于当前故事。'},{status:400});
 try{
  const {key,endpoint,model,provider}=modelCredentials();
  const headers:Record<string,string>={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  if(provider==='opencode')headers['x-opencode-session']=randomUUID();
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({model,temperature:.8,max_tokens:180,messages:[{role:'system',content:`你扮演中文视觉小说角色${person.name}，${person.identity}。${story} 这是剧情暂停时的自由聊天，不能替玩家做选择，不要承诺尚未发生的事，不要提及系统、模型或提示词。用自然中文回复，1—3句，最多120字。`},...messages.map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.text}))]}),signal:AbortSignal.timeout(30_000)});
  if(!response.ok)throw new Error(`模型服务 HTTP ${response.status}`);const body=await response.json() as {choices?:{message?:{content?:string}}[]};const text=body.choices?.[0]?.message?.content?.trim();if(!text)throw new Error('模型没有返回可显示的回复。');void recordInteraction(req,{type:'chat_reply',storyId,payload:{character,text}});return NextResponse.json({text},{headers:{'Cache-Control':'no-store'}});
 }catch(error){console.error('[chat]',error instanceof Error?error.message:'failed');return NextResponse.json({error:'这句话暂时没有送达，请稍后重试。'},{status:502});}
}
