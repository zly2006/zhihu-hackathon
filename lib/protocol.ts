import {z} from 'zod';
import {cast,count,ids,total,validate,type State,type StoryNode,type GameEvent} from './story';
const line=z.object({type:z.literal('line'),speaker:z.string(),text:z.string().min(1).max(150)}).strict();
const schema=z.discriminatedUnion('type',[
 z.object({type:z.literal('scene'),title:z.string().min(1).max(25)}).strict(),line,
 z.object({type:z.literal('choices'),items:z.array(z.object({text:z.string().min(4).max(30),target:z.enum(ids).nullable()}).strict()).max(3)}).strict(),
 z.object({type:z.literal('memory'),summary:z.string().max(240),facts:z.array(z.string().max(55)).max(6)}).strict(),
 z.object({type:z.literal('end')}).strict()
]);
export class JsonlDecoder {
 private buffer='';
 push(chunk:string,final=false):string[] {this.buffer+=chunk;if(this.buffer.length>20000)throw new Error('JSONL记录过长');const lines=this.buffer.split('\n');this.buffer=lines.pop()||'';if(final&&this.buffer.trim()){lines.push(this.buffer);this.buffer='';}return lines.map(l=>l.trim()).filter(Boolean);}
}
export function acceptRecord(raw:string,state:State):{event?:GameEvent;ended?:boolean} {
 const record=schema.parse(JSON.parse(raw));
 const p=structuredClone(state.partial||{lines:[]});
 const length=(p.lines||[]).reduce((n,l)=>n+count(l.text),0);
 let event:GameEvent|undefined;
 if(record.type==='scene') {
  if(p.title)throw new Error('已经发送标题，禁止重写已显示内容');p.title=record.title;
  event={type:'scene',segment:state.nodes.length+1,title:record.title,readingSeconds:0};
 } else if(record.type==='line') {
  if(!p.title||p.choices)throw new Error('对白顺序错误：标题之后、选项之前才能发送对白');
  const speaker=record.speaker==='我'?'许澄':record.speaker;
  if(!['旁白','许澄',...cast.map(c=>c.name)].includes(speaker))throw new Error('说话者必须为旁白或设定姓名');
  if(length+count(record.text)>300)throw new Error(`剩余正文最多${300-length}字，不可修改已显示对白`);
  if((p.lines||[]).length>=22)throw new Error('对白条数过多');
  event={type:'line',index:(p.lines||[]).length,speaker,text:record.text};
  p.lines=[...(p.lines||[]),{speaker,text:record.text}];
 } else if(record.type==='choices') {
  if(p.choices)throw new Error('选项已发送，不得重复');
  // Full body and route checks run before exposing selectable actions.
  const normalizedItems=state.nodes.length>=3?record.items.map(item=>({...item,target:null})):record.items;
  const draft={title:p.title,lines:p.lines,choices:normalizedItems,memory:{summary:'',facts:[]}};
  validate(draft,state);p.choices=normalizedItems;event={type:'choices',items:normalizedItems.map(c=>({text:c.text}))};
 } else if(record.type==='memory') {
  if(!p.choices)throw new Error('memory必须在choices之后');p.memory={summary:record.summary,facts:record.facts};
 } else {
  validate(p,state);state.partial=p;return {ended:true};
 }
 state.partial=p;return {event};
}
export function finishPartial(state:State):StoryNode{return validate(state.partial,state);}
