import 'server-only';
import path from 'node:path';
import type {State} from './story';
import {createStateStore,validId} from './state-store';
import {updateLockedState,acquireStoryLock} from './state-lock';
export {acquireStoryLock,validId};
const store=createStateStore(path.join(process.cwd(),'.data','sessions'));
export const readState=store.read;
export const saveState=store.save;
export const saveJsonl=store.saveJsonl;
export async function updateState(id:string,mutator:(state:State)=>State|void|Promise<State|void>,options:{exchangeId?:string}={}):Promise<State> {
 return updateLockedState(id,store,mutator,options);
}
const globalStore=globalThis as typeof globalThis&{storyBusy?:Set<string>};
export const busy=globalStore.storyBusy??=new Set<string>();
