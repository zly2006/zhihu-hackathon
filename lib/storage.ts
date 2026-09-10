import 'server-only';
import {mkdir,readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import path from 'node:path';
import type {State} from './story';
const root=path.join(process.cwd(),'.data','sessions');
export const validId=(id:string)=>/^[0-9a-f-]{36}$/.test(id);
export async function readState(id:string):Promise<State|null> {if(!validId(id))return null;try{const state=JSON.parse(await readFile(path.join(root,`${id}.json`),'utf8')) as State;return state.version===2?state:null;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export async function saveState(id:string,state:State) {await mkdir(root,{recursive:true});const file=path.join(root,`${id}.json`);await writeFile(file+'.tmp',JSON.stringify(state));await rename(file+'.tmp',file);}
export async function saveJsonl(id:string,segment:number,events:unknown[]) {await mkdir(root,{recursive:true});await appendFile(path.join(root,`${id}-${segment}.jsonl`),events.map(e=>JSON.stringify(e)).join('\n')+'\n');}
const globalStore=globalThis as typeof globalThis&{storyBusy?:Set<string>};
export const busy=globalStore.storyBusy??=new Set<string>();
