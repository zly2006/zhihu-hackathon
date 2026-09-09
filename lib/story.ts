import { z } from 'zod';
import config from './story-config.json';
import examples from './story-examples.json';
export const ids = ['lin', 'tao', 'shen'] as const;
export type Route = typeof ids[number];
export const total = config.BEATS.length;
export const cast = config.WORLD.cast.map(({ id, name, identity }) => ({ id, name, identity }));
export const count = (text: string) => [...text].filter(c => /[\p{L}\p{N}]/u.test(c)).length;
export const nodeSchema = z.object({
 title:z.string().min(1).max(25),
 lines:z.array(z.object({speaker:z.string(),text:z.string().min(1).max(150)}).strict()).min(4).max(22),
 choices:z.array(z.object({text:z.string().min(4).max(30),target:z.enum(ids).nullable()}).strict()).max(3),
 memory:z.object({summary:z.string().max(240),facts:z.array(z.string().max(55)).max(6)}).strict()
}).strict();
export type StoryNode = z.infer<typeof nodeSchema>;
export type Selection = {node:number;index:number;text:string;target:Route|null};
export type CharacterProfile={id:string;name:string;gender:'男'|'女';background?:string;zhihuHandle?:string};
export type State = {version:1;nodes:StoryNode[];selections:Selection[];route:Route|null;pending:boolean;partial?:Partial<StoryNode>;memory:StoryNode['memory'];profiles?:CharacterProfile[];storyTitle?:string;storyTone?:string};
export function initial(profiles:CharacterProfile[]=[]):State {return {version:1,nodes:[],selections:[],route:null,pending:true,memory:{summary:'',facts:[]},profiles,storyTitle:undefined,storyTone:undefined};}
export function choose(state:State, index:number, expected:number) {
 if (expected!==state.nodes.length || state.pending || state.nodes.length===total) throw new Error('剧情进度已变化，请刷新后继续。');
 const choices=state.nodes.at(-1)?.choices;
 if (!Number.isInteger(index)||!choices?.[index]) throw new Error('无效的选项。');
 state.selections.push({node:state.nodes.length-1,index,...choices[index]});
 if (state.selections.length===3) {
  const scores=Object.fromEntries(ids.map(id=>[id,state.selections.filter(s=>s.target===id).length]));
  const max=Math.max(...Object.values(scores));
  state.route=[...state.selections].reverse().find(s=>s.target && scores[s.target]===max)!.target;
 }
 state.pending=true;
}
export function validate(raw:unknown,state:State):StoryNode {
 const node=nodeSchema.parse(raw);
 for (const line of node.lines) {
  if(line.speaker==='我') line.speaker=config.WORLD.player.name;
  if(!['旁白',config.WORLD.player.name,...cast.map(c=>c.name)].includes(line.speaker)) throw new Error('speaker必须使用设定姓名或旁白');
 }
 const length=node.lines.reduce((n,l)=>n+count(l.text),0);
 if(length<225||length>300) throw new Error(`正文${length}字，要求225—300字，请修改至255字左右`);
 const stage=state.nodes.length;
 if(stage===total-1 ? node.choices.length!==0 : node.choices.length<2) throw new Error('非结局需2—3个选项，结局无选项');
 if(new Set(node.choices.map(c=>c.text)).size!==node.choices.length) throw new Error('选项不能重复');
 if(stage<3 && (node.choices.length!==3 || ids.some(id=>!node.choices.some(c=>c.target===id)))) throw new Error('共同篇选项必须分别对应三位人物');
 if(stage>=3 && node.choices.some(c=>c.target!==null)) throw new Error('个人线target必须为null');
 if(stage===0 && cast.some(c=>!node.lines.some(l=>l.speaker===c.name))) throw new Error('开场三人必须各有台词');
 return node;
}

function selectExamples(stage:number) {
 const groups=Object.entries(examples.categories);
 const start=Math.min(stage*3,Math.max(0,groups.length-3));
 return groups.slice(start,start+3).flatMap(([category,items])=>items.slice(0,3).map(item=>({category,source:item.source,text:item.text})));
}

export function messages(state:State) {
 const world=structuredClone(config.WORLD);
 const cards=world.cast.map(c=>state.route&&c.id!==state.route?{id:c.id,name:c.name,identity:c.identity,voice:c.voice}:c);
 const latest=state.selections.at(-1);
 return [{role:'system',content:config.SYSTEM}, {role:'user',content:JSON.stringify({
 must_execute_first:latest?`玩家刚选【${latest.text}】；前3条先执行并给具体结果，询问必须回答。`:'开场未选择。',
 world:{...world,cast:cards},stage:state.nodes.length+1,total_stages:total,task:config.BEATS[state.nodes.length],story_title_instruction:state.nodes.length===0?'本段title同时作为整部故事标题：请根据模板世界观、角色和你自行判断的基调生成，不要使用固定标题。后续保持标题与基调一致。':'沿用已生成的故事标题与基调，不要改写。',
 locked_route:state.route,budget:'只写当前一段225—300有效字，目标255字，约45—60秒；不写下一段。',
 allowed_speakers:['旁白',world.player.name,...cast.map(c=>c.name)],choice_targets:state.route?'所有target为JSON null':'分别lin/tao/shen',
 past_choices:state.selections,conversation_history:state.nodes.map((node,index)=>({stage:index+1,title:node.title,lines:node.lines,choices:node.choices,memory:node.memory})),reference_examples:selectExamples(state.nodes.length),previous_text_tail:state.nodes.at(-1)?.lines.map(l=>l.text).join('\n').slice(-240)||'',memory:state.memory
 })}];
}
export function publicState(state:State) {return {storyTitle:state.storyTitle,storyTone:state.storyTone,world:{premise:config.WORLD.premise,locations:config.WORLD.locations},partial:state.partial?{title:state.partial.title,lines:state.partial.lines||[],choices:state.partial.choices?.map(c=>({text:c.text}))||[]}:null,nodes:state.nodes.map(n=>({title:n.title,lines:n.lines,choices:n.choices.map(c=>({text:c.text})),readingSeconds:n.lines.reduce((v,l)=>v+count(l.text),0)/5})),route:state.route,selections:state.selections.map(s=>({node:s.node,index:s.index})),pending:state.pending,total,complete:state.nodes.length===total};}
export type PublicState=ReturnType<typeof publicState>;
export type GameEvent = {type:'status';phase:'generating'|'validating'|'repairing'|'translating';message:string}|{type:'scene';segment:number;title:string;readingSeconds:number}|{type:'line';index:number;speaker:string;text:string}|{type:'choices';items:{text:string}[]}|{type:'done';state:PublicState}|{type:'error';message:string};
export function eventsFor(node:StoryNode,state:State):GameEvent[] {return [
 {type:'scene',segment:state.nodes.length,title:node.title,readingSeconds:node.lines.reduce((v,l)=>v+count(l.text),0)/5},
 ...node.lines.map((l,index)=>({type:'line' as const,index,...l})),
 {type:'choices',items:node.choices.map(c=>({text:c.text}))}, {type:'done',state:publicState(state)}
];}
