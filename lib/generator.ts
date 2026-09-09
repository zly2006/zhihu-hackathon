import 'server-only';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {messages,count,type State,type GameEvent,type StoryNode} from './story';
import {JsonlDecoder,acceptRecord,finishPartial} from './protocol';
const model='gpt-5.6-luna';
async function credentials() {
 let source='';if(!process.env.CPA_API_KEY)source=await readFile(/* turbopackIgnore: true */ process.env.CPA_REFERENCE||'/Users/zhaoliyan/test_cpa_chat_completion.py','utf8').catch(()=> '');
 const literal=(name:string)=>source.match(new RegExp(`^${name}\\s*=\\s*(['"])(.*?)\\1\\s*$`,'m'))?.[2];
 const key=process.env.CPA_API_KEY||literal('API_KEY');if(!key)throw new Error('服务端尚未配置CPA_API_KEY');
 return {key,endpoint:process.env.CPA_ENDPOINT||literal('ENDPOINT')||'https://cpa.codex.fintechedu.cn/v1/chat/completions'};
}
const format=`你必须输出JSONL：每个物理行是一个完整JSON对象，每写完一条就换行。禁止Markdown、代码围栏、JSON数组和外层包装。严格按以下顺序：
{"type":"scene","title":"标题"}
{"type":"line","speaker":"旁白或角色姓名","text":"一条中文对白或叙述"}
重复line，整段正文225—300有效字，目标255字、8—9条。每条25—35字左右。说话者本人说出口的话才能放人物框，动作和心理必须旁白。
{"type":"choices","items":[{"text":"行动","target":"lin"},{"text":"行动","target":"tao"},{"text":"行动","target":"shen"}]}
共同篇固定3选项分别target三人；个人线2—3个选项且target为JSON null；结局items=[]。
{"type":"memory","summary":"累计已发生事实，240字以内","facts":["最多6条每条55字"]}
{"type":"end"}
只生成当前片段。外语内容用自然中文表达。不要输出推理。玩家未选的动作不能发生。若提供已发送内容，只补足尚未输出的记录，不得重复scene、对白或选项，不得改写已发送内容。`;
export async function generate(state:State,emit:(e:GameEvent)=>void,persist:()=>Promise<void>):Promise<StoryNode> {
 const {key,endpoint}=await credentials();let issue='';
 for(let attempt=0;attempt<3;attempt++) {
  emit({type:'status',phase:attempt?'repairing':'generating',message:attempt?'正在接着写这一段…':'雨还在下，故事正在继续…'});
  const msg=messages(state);msg[0].content=msg[0].content.split('只输出如下字段：')[0].replace('只输出一个JSON对象，不输出解释或推理。','逐条输出JSONL，不输出解释或推理。').replace('输出本段选项后立刻停止','完成本段JSONL协议后立刻停止')+'\n'+format;
  const written=(state.partial?.lines||[]).reduce((n,l)=>n+count(l.text),0);
  const next=state.partial?.memory?'只输出end':state.partial?.choices?'只输出memory，然后end':written>=225?'正文已够，直接输出choices，然后memory和end':`正文目前${written}字，还缺至少${225-written}字；必须先补line对白记录达到225字，不能提前输出choices。可再写最多${300-written}字。`;
  msg.push({role:'user',content:JSON.stringify({already_sent:state.partial||null,correction:issue||null,instruction:`已发送记录不可重写。${next}`})});
  const payload={model,reasoning_effort:'none',messages:msg,max_tokens:2800,stream:true,stream_options:{include_usage:true}};
  const started=Date.now();let raw='',finish='',done=false,ended=false,usage:Record<string,unknown>|null=null;let failure:string|undefined;
  try {
   const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(180_000)});
   if(!response.ok||!response.body)throw new Error(`模型服务HTTP ${response.status}`);
   const reader=response.body.getReader(),decoder=new TextDecoder(),jsonl=new JsonlDecoder();let buffer='';
   const processLines=async(lines:string[])=>{for(const text of lines){if(ended)throw new Error('end后不能再有记录');const result=acceptRecord(text,state);await persist();if(result.event)emit(result.event);if(result.ended)ended=true;}};
   try {while(!done) {
    const part=await reader.read();buffer+=decoder.decode(part.value,{stream:!part.done});const lines=buffer.split('\n');buffer=lines.pop()||'';if(part.done&&buffer){lines.push(buffer);buffer='';}
    for(const line of lines) {
     if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(data==='[DONE]'){done=true;break;}if(!data)continue;
     const event=JSON.parse(data);if(event.error)throw new Error('上游流异常');if(event.usage)usage=event.usage;
     for(const choice of event.choices||[]) {if(choice.finish_reason)finish=choice.finish_reason;const piece=choice.delta?.content;if(typeof piece==='string'){raw+=piece;await processLines(jsonl.push(piece));}}
    }
    if(part.done)break;
   }
   await processLines(jsonl.push('',true));
   }finally{await reader.cancel().catch(()=>{});}
   const details=usage?.completion_tokens_details as {reasoning_tokens?:number}|undefined;
   if(details?.reasoning_tokens!==0)console.warn('[CPA] none requested; reasoning_tokens:',details?.reasoning_tokens);
   if(!done||finish!=='stop'||!ended)throw new Error('模型流未完整结束，继续尚缺的记录');
   return finishPartial(state);
  }catch(error){failure=error instanceof Error?error.message:'生成失败';issue=failure;console.warn('[JSONL check]',issue);if(attempt===2)throw new Error('逐条生成暂时中断');}
  finally{
   const dir=path.join(process.cwd(),'.data','requests');await mkdir(dir,{recursive:true});
   await writeFile(path.join(dir,`${Date.now()}-${randomUUID()}.json`),JSON.stringify({payload,seconds:(Date.now()-started)/1000,finish,done,usage,response:raw,error:failure?.split(key).join('[REDACTED]')},null,2));
  }
 }
 throw new Error('无法继续当前片段');
}
