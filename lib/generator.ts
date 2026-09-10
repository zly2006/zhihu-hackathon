import 'server-only';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomInt} from 'node:crypto';
import {buildModelMessages,type State,type GameEvent,type StoryNode} from './story';
import {acceptRecord,finishPartial} from './protocol';
import {TaggedDecoder,parseTagged} from './tagged-protocol';
const DEFAULT_ENDPOINT='https://opencode.ai/zen/go/v1/chat/completions';
const DEFAULT_MODEL='deepseek-flash';
const DEFAULT_REASONING_EFFORT='none';
const MAX_ATTEMPTS=5;
async function credentials() {
 const provider=process.env.MODEL_PROVIDER?.trim()||'opencode';
 if(provider!=='opencode')throw new Error('MODEL_PROVIDER必须是opencode');
 const key=process.env.OPENCODE_API_KEY?.trim();
 if(!key)throw new Error('服务端尚未配置OPENCODE_API_KEY');
 return {
  key,
  endpoint:process.env.OPENCODE_ENDPOINT||DEFAULT_ENDPOINT,
  model:process.env.OPENCODE_MODEL||DEFAULT_MODEL,
  effort:process.env.OPENCODE_REASONING_EFFORT||DEFAULT_REASONING_EFFORT,
 };
}
export async function generate(state:State,emit:(e:GameEvent)=>void,persist:()=>Promise<void>):Promise<StoryNode> {
 const {key,endpoint,model,effort}=await credentials();const opencodeSession=randomUUID();let issue='';
 for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++) {
 emit({type:'status',phase:attempt?'repairing':'generating',message:attempt?'正在接着写这一段…':'故事正在继续…'});
  const msg=buildModelMessages(state,issue);
  const payload={model,reasoning_effort:effort,temperature:0.9,seed:randomInt(1_000_000_000),messages:msg,max_tokens:2800,stream:true,stream_options:{include_usage:true}};
  const started=Date.now();let raw='',finish='',done=false,ended=false,usage:Record<string,unknown>|null=null;let failure:string|undefined;
  try {
   const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-opencode-session':opencodeSession},body:JSON.stringify(payload),signal:AbortSignal.timeout(180_000)});
   if(!response.ok||!response.body)throw new Error(`模型服务HTTP ${response.status}`);
   const reader=response.body.getReader(),decoder=new TextDecoder(),tagged=new TaggedDecoder();let buffer='';
   const processLines=async(lines:string[])=>{for(const text of lines){const records=[text];for(const record of records){if(ended)throw new Error('end后不能再有记录');const taggedRecord=parseTagged(record);if(taggedRecord.type==='scene'&&state.partial?.title)continue;if(taggedRecord.type==='line'&&state.partial?.lines?.some(line=>line.speaker===taggedRecord.speaker&&line.text===taggedRecord.text))continue;const result=acceptRecord(JSON.stringify(taggedRecord.type==='line'?{type:'line',speaker:taggedRecord.speaker,text:taggedRecord.text}:taggedRecord.type==='scene'?{type:'scene',title:taggedRecord.title}:taggedRecord.type==='choices'?{type:'choices',items:taggedRecord.items}:taggedRecord.type==='memory'?{type:'memory',summary:taggedRecord.summary,facts:taggedRecord.facts}:{type:'end'}),state);await persist();if(result.event)emit(result.event);if(result.ended)ended=true;}}};
   try {while(!done) {
    const part=await reader.read();buffer+=decoder.decode(part.value,{stream:!part.done});const lines=buffer.split('\n');buffer=lines.pop()||'';if(part.done&&buffer){lines.push(buffer);buffer='';}
    for(const line of lines) {
     if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(data==='[DONE]'){done=true;break;}if(!data)continue;
     const event=JSON.parse(data);if(event.error)throw new Error('上游流异常');if(event.usage)usage=event.usage;
     for(const choice of event.choices||[]) {if(choice.finish_reason)finish=choice.finish_reason;const piece=choice.delta?.content;if(typeof piece==='string'){raw+=piece;await processLines(tagged.push(piece));}}
    }
    if(part.done)break;
   }
   await processLines(tagged.push('',true));
   }finally{await reader.cancel().catch(()=>{});}
   const details=usage?.completion_tokens_details as {reasoning_tokens?:number}|undefined;
   if(typeof details?.reasoning_tokens==='number')console.info('[OpenCode] reasoning_tokens:',details.reasoning_tokens);
   if(!done||finish!=='stop'||!ended)throw new Error('模型流未完整结束，继续尚缺的记录');
   return finishPartial(state);
  }catch(error){failure=error instanceof Error?error.message:'生成失败';issue=failure;console.warn('[JSONL check]',issue);if(attempt===MAX_ATTEMPTS-1)throw new Error('逐条生成暂时中断');}
  finally{
   const dir=path.join(process.cwd(),'.data','requests');await mkdir(dir,{recursive:true});
   await writeFile(path.join(dir,`${Date.now()}-${randomUUID()}.json`),JSON.stringify({payload,seconds:(Date.now()-started)/1000,finish,done,usage,response:raw,error:failure?.split(key).join('[REDACTED]')},null,2));
  }
 }
 throw new Error('无法继续当前片段');
}
