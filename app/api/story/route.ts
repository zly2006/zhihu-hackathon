import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {initial,choose,publicState,type GameEvent} from '../../../lib/story';
import {readState,saveState,saveJsonl,busy} from '../../../lib/storage';
import {generate} from '../../../lib/generator';
export const runtime='nodejs';
export const maxDuration=600;
const cookie='lamplight_session';
export async function GET(req:NextRequest) {const id=req.cookies.get(cookie)?.value;const state=id?await readState(id):null;return NextResponse.json({state:state?publicState(state):null},{headers:{'Cache-Control':'no-store'}});}
const schema=z.object({action:z.enum(['start','choose','retry','restart']),choice:z.number().int().min(0).max(2).optional(),expected:z.number().int().optional()}).strict();
export async function POST(req:NextRequest) {
 if(req.headers.get('origin') && new URL(req.headers.get('origin')!).host!==req.headers.get('host'))return NextResponse.json({error:'请求来源不匹配。'},{status:403});
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'请求格式不正确。'},{status:400});
 const {action,choice,expected}=parsed.data;
 let id=req.cookies.get(cookie)?.value;let state=id?await readState(id):null;
 if(action==='restart'||!state){if(!['start','restart'].includes(action))return NextResponse.json({error:'请先开始故事。'},{status:400});id=randomUUID();state=initial();}
 if(!id||!state)return NextResponse.json({error:'存档不可用。'},{status:400});
 if(busy.has(id))return NextResponse.json({error:'这一段正在生成，请稍候再继续。'},{status:409});
 busy.add(id);
 try {
  const latest=await readState(id);if(latest&&action!=='restart')state=latest;
  if(action==='choose')choose(state,choice??-1,expected??-1);
  else if(!state.pending) {busy.delete(id);return NextResponse.json({state:publicState(state)});}
  await saveState(id,state);
 } catch(e) {busy.delete(id);return NextResponse.json({error:e instanceof Error?e.message:'无法保存进度。'},{status:409});}
 const session=id,current=state;const journal:GameEvent[]=[];const encoder=new TextEncoder();
 const stream=new ReadableStream({start(controller){
  let open=true;const emit=(event:GameEvent)=>{journal.push(event);if(open)try{controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));}catch{open=false;}};
  const heartbeat=setInterval(()=>{if(open)try{controller.enqueue(encoder.encode(': keep-alive\n\n'));}catch{open=false;}},10_000);
  void (async()=>{try{
   const node=await generate(current,emit,()=>saveState(session,current));current.nodes.push(node);current.memory=node.memory;current.pending=false;delete current.partial;
   await saveState(session,current);
   emit({type:'done',state:publicState(current)});
  }catch(error){console.error('[story]',error instanceof Error?error.message:'generation failed');emit({type:'error',message:'这一段暂时没写好，进度已保存。请重试。'});}
  finally {await saveJsonl(session,current.nodes.length+(current.pending?1:0),journal).catch(e=>console.error('JSONL日志写入失败',e));clearInterval(heartbeat);busy.delete(session);if(open)try{controller.close();}catch{}}})();
 }});
 const res=new NextResponse(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
 res.cookies.set(cookie,id,{httpOnly:true,sameSite:'strict',secure:req.nextUrl.protocol==='https:',path:'/',maxAge:60*60*24*30});return res;
}
