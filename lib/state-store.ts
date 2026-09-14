import {mkdir,readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import path from 'node:path';
import type {State} from './story';
import type {StateStore} from './state-lock';

export const validId=(id:string)=>/^[0-9a-f-]{36}$/.test(id);

export type FileStateStore=StateStore<State>&{saveJsonl:(id:string,segment:number,events:unknown[])=>Promise<void>};

export function createStateStore(root:string):FileStateStore {
  return {
    isValidId: validId,
    read: async (id) => {
      if (!validId(id)) return null;
      try {
        const state = JSON.parse(await readFile(path.join(root, `${id}.json`), 'utf8')) as State;
        return state.version === 2 ? state : null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    save: async (id, state) => {
      await mkdir(root, {recursive: true});
      const file = path.join(root, `${id}.json`);
      await writeFile(`${file}.tmp`, JSON.stringify(state));
      await rename(`${file}.tmp`, file);
    },
    saveJsonl: async (id, segment, events) => {
      await mkdir(root, {recursive: true});
      await appendFile(path.join(root, `${id}-${segment}.jsonl`), events.map((event) => JSON.stringify(event)).join('\n') + '\n');
    },
  };
}
