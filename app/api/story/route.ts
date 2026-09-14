import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {castPool,initial,choose,limits,publicBackgrounds,publicState,recoverStoryProgress,requiredCastCount,maxStages,defaultBackgroundId,type GameEvent,type CharacterProfile,type Gender} from '../../../lib/story';
import {buildAuthorCatalog} from '../../../lib/author-catalogue';
import {defaultAuthorRegistryRoot,invitedAuthorProfileBinding,readInvitedAuthor} from '../../../lib/author-registry';
import {AUTHOR_CAST_ID_PATTERN} from '../../../lib/author-identity';
import {readState,saveState,saveJsonl,busy,acquireStoryLock} from '../../../lib/storage';
import {generate} from '../../../lib/generator';
import {requireSession} from '../../../lib/zhihu-auth';
import {recordInteraction,recordStorySnapshot} from '../../../lib/database';
export const runtime='nodejs';
export const maxDuration=600;
export async function GET(req:NextRequest) {
 const id=req.nextUrl.searchParams.get('storyId')||'';
 if(id&&!requireSession(req))return NextResponse.json({error:'知乎登录已失效，请重新登录后继续。'},{status:401,headers:{'Cache-Control':'no-store'}});
 const state=id?await readState(id):null;
 return NextResponse.json({
  storyId:id||null,
  state:state?publicState(state):null,
  pool:castPool,
  authors:await buildAuthorCatalog(),
  backgrounds:publicBackgrounds,
  requiredCastCount,
  maxStages,
  defaultBackgroundId,
 },{headers:{'Cache-Control':'no-store'}});
}
const authorBindingSchema=z.object({
 authorRef:z.object({provider:z.literal('zhihu'),urlToken:z.string().trim().min(1).max(100),profileUrl:z.string().trim().max(200)}).strict(),
 authorSnapshot:z.object({authorUrlToken:z.string().trim().min(1).max(100),profileHash:z.string().trim().min(1).max(64),corpusVersion:z.string().max(80).optional(),capturedAt:z.string().trim().min(1).max(40)}).strict(),
 domains:z.array(z.string().trim().min(1).max(40)).min(1).max(3),
 capabilities:z.object({canChat:z.boolean(),canEnterStory:z.boolean(),canEnterRomance:z.boolean()}).strict(),
}).strict();
const schema=z.object({storyId:z.string().uuid().optional(),action:z.enum(['start','choose','retry','restart']),choice:z.number().int().min(0).max(limits.totalChoiceMax-1).optional(),expected:z.number().int().optional(),profiles:z.array(z.object({id:z.string().trim().min(1).max(80),name:z.string().trim().min(1).max(80),gender:z.enum(['男','女']),background:z.string().max(300).optional(),zhihuHandle:z.string().max(80).optional(),authorAvatarId:z.string().max(80).optional(),author:authorBindingSchema.optional()}).strict()).optional(),backgroundId:z.string().optional(),player:z.object({name:z.string().min(1).max(16),gender:z.enum(['男','女'])}).strict().optional()}).strict();

/** 邀请答主的作者绑定只从服务端注册表读取，忽略客户端提交的 author 字段。 */
async function bindServerAuthorRefs(requested:z.infer<typeof schema>['profiles']){
 if(!requested)return requested;
 const registryRoot=defaultAuthorRegistryRoot();
 const bound=await Promise.all(requested.map(async (profile)=>{
  if(!AUTHOR_CAST_ID_PATTERN.test(profile.id))return {id:profile.id,name:profile.name,gender:profile.gender,background:profile.background,zhihuHandle:profile.zhihuHandle,authorAvatarId:profile.authorAvatarId};
  const entry=await readInvitedAuthor(registryRoot,profile.id);
  if(!entry)throw new Error('这位答主还没有完成邀请，请重新邀请后再开始。');
  return {id:entry.castId,name:profile.name,gender:profile.gender,background:profile.background,authorAvatarId:'',author:invitedAuthorProfileBinding(entry)};
 }));
 return bound;
}
export async function POST(req:NextRequest) {
 if(req.headers.get('origin') && new URL(req.headers.get('origin')!).host!==req.headers.get('host'))return NextResponse.json({error:'请求来源不匹配。'},{status:403});
 if(!requireSession(req))return NextResponse.json({error:'知乎登录已失效，请重新登录后继续。'},{status:401});
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'请求格式不正确。'},{status:400});
 const {action,choice,expected,profiles,backgroundId,player}=parsed.data;
 let id=parsed.data.storyId;let state=id?await readState(id):null;
 if(action==='restart'||!state){
  if(!['start','restart'].includes(action))return NextResponse.json({error:'请先开始故事。'},{status:400});
  if(!profiles||!backgroundId||!player)return NextResponse.json({error:`请先选择${requiredCastCount}位角色、人生阶段和玩家资料。`},{status:400});
  id=randomUUID();
  try{const bound=await bindServerAuthorRefs(profiles);state=initial(bound as CharacterProfile[],{backgroundId,playerName:player.name,playerGender:player.gender as Gender,seed:id});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'开局选择无效。'},{status:400});}
 }
 if(!id||!state)return NextResponse.json({error:'存档不可用。'},{status:400});
 if(busy.has(id))return NextResponse.json({error:'这一段正在生成，请稍候再继续。'},{status:409});
 busy.add(id);
 const releaseLock=await acquireStoryLock(id);let held=true;
 const release=()=>{if(held){held=false;releaseLock();}};
 try {
  const latest=await readState(id);if(latest&&action!=='restart')state=latest;
  recoverStoryProgress(state);
  if(action==='choose')choose(state,choice??-1,expected??-1);
  else if(!state.pending) {release();busy.delete(id);return NextResponse.json({state:publicState(state)});}
  await saveState(id,state);
  void recordInteraction(req,{type:`story_${action}`,storyId:id,payload:{choice,expected,profiles,backgroundId,player}});
  void recordStorySnapshot(req,id,state);
 } catch(e) {release();busy.delete(id);return NextResponse.json({error:e instanceof Error?e.message:'无法保存进度。'},{status:409});}
 const session=id,current=state;const journal:GameEvent[]=[];const encoder=new TextEncoder();
 const stream=new ReadableStream({start(controller){
  let open=true;const emit=(event:GameEvent)=>{journal.push(event);if(open)try{controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));}catch{open=false;}};
  const heartbeat=setInterval(()=>{if(open)try{controller.enqueue(encoder.encode(': keep-alive\n\n'));}catch{open=false;}},10_000);
  void (async()=>{try{
   const node=await generate(current,emit,()=>saveState(session,current));current.nodes.push(node);current.memory=node.memory;if(!current.storyTitle) current.storyTitle=node.title;current.pending=false;delete current.partial;
   await saveState(session,current);
   void recordInteraction(req,{type:'story_generated',storyId:session,payload:{nodeIndex:current.nodes.length-1,node,choice,action}});
   void recordStorySnapshot(req,session,current);
   emit({type:'done',state:publicState(current)});
  }catch(error){console.error('[story]',error instanceof Error?error.message:'generation failed');emit({type:'error',message:'这一段暂时没写好，进度已保存。请重试。'});}
  finally {await saveJsonl(session,current.nodes.length+(current.pending?1:0),journal).catch(e=>console.error('JSONL日志写入失败',e));clearInterval(heartbeat);busy.delete(session);release();if(open)try{controller.close();}catch{}}})();
 }});
 const res=new NextResponse(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
 res.headers.set('X-Story-Id',id);return res;
}
