import {z} from 'zod';
import {ids,type State,type GameEvent} from './story';

const choiceSchema=z.object({items:z.array(z.object({text:z.string().min(4).max(30),target:z.enum(ids).nullable()}).strict()).max(3)}).strict();
const memorySchema=z.object({summary:z.string().max(240),facts:z.array(z.string().max(55)).max(6)}).strict();
function parseBlockJson(value:string) {
 let source=value.trim();
 const first=source.indexOf('{'); if(first>0) source=source.slice(first);
 let depth=0, quote=false, escaped=false, end=-1;
 for(let i=0;i<source.length;i++){const c=source[i];if(escaped){escaped=false;continue;}if(c==='\\'&&quote){escaped=true;continue;}if(c==='"'){quote=!quote;continue;}if(quote)continue;if(c==='{')depth++;if(c==='}') {depth--;if(depth===0){end=i+1;break;}}}
 if(end>0)source=source.slice(0,end);
 let parsed:any; try{parsed=JSON.parse(source);} catch { parsed=JSON.parse(source.replace(/\]\.$/,']}')); }
 if(parsed&&Array.isArray(parsed.facts)) parsed.facts=parsed.facts.slice(0,6); return parsed;
}
export type TaggedRecord={type:'scene';title:string}|{type:'line';speaker:string;text:string}|{type:'choices';items:z.infer<typeof choiceSchema>['items']}|{type:'memory';summary:string;facts:string[]}|{type:'end'};

export class TaggedDecoder {
 private buffer='';
 push(chunk:string,final=false):string[] {
  this.buffer+=chunk;
  const rows=this.buffer.split(/\r?\n/);
  this.buffer=rows.pop()||'';
  if(final&&this.buffer.trim()){rows.push(this.buffer);this.buffer='';}
  return rows.map(row=>row.trim()).filter(Boolean);
 }
}
export function parseTagged(raw:string):TaggedRecord {
 const line=raw.trim();
 if(line==='[END]')return {type:'end'};
 const scene=line.match(/^\[SCENE\]\s*(.+)$/);if(scene)return {type:'scene',title:scene[1].trim()};
 const npc=line.match(/^\[(?:NPC:([^\]]+)|PLAYER)\]\s*(.+)$/);if(npc)return {type:'line',speaker:npc[1]?.trim()||'许澄',text:npc[2].trim()};
 if(line==='[CHOICES]')throw new Error('choices标签必须紧跟JSON对象');
 if(line.startsWith('[CHOICES]'))return {type:'choices',...choiceSchema.parse(parseBlockJson(line.slice(9).trim()))};
 if(line.startsWith('[MEMORY]'))return {type:'memory',...memorySchema.parse(parseBlockJson(line.slice(8).trim()))};
 throw new Error('无法识别的标签记录');
}
