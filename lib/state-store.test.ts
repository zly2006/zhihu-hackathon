import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {authorChatGate} from './chat-request';
import {initial} from './story';
import {createStateStore} from './state-store';
import {withStoryLock,updateLockedState,MAX_PROCESSED_EXCHANGE_IDS} from './state-lock';

const storyId='11111111-1111-4111-8111-111111111111';
const delay=(ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));
let tempRoot='';

test.before(async()=>{tempRoot=await mkdtemp(path.join(tmpdir(),'lamplight-state-'));});
test.after(async()=>{if(tempRoot)await rm(tempRoot,{recursive:true,force:true});});

async function freshStore(){
  const root=await mkdtemp(path.join(tempRoot,'case-'));
  const store=createStateStore(root);
  await store.save(storyId,initial());
  return store;
}

function storyWrite(store:ReturnType<typeof createStateStore>) {
  return withStoryLock(storyId,async()=>{
    const state=await store.read(storyId);
    assert.ok(state);
    await delay(25);
    state.nodes.push({title:'并发剧情',lines:[{speaker:'林泠',text:'先坐一会儿。'}],choices:[],memory:{summary:'',facts:[]}});
    state.selections.push({node:0,index:0,text:'和林泠说话',target:'ling'});
    state.memory={summary:'共同完成了一段对话',facts:['林泠在场']};
    state.route='ling';
    state.relationshipType='romance';
    await store.save(storyId,state);
  });
}

function chatUpdate(store:ReturnType<typeof createStateStore>,exchangeId:string) {
  return updateLockedState(storyId,store,(state)=>{
    const gains=state.worldState.authorChatGains??(state.worldState.authorChatGains={});
    gains.ling=(gains.ling??0)+2;
    state.worldState.relationships.ling=(state.worldState.relationships.ling??0)+2;
  },{exchangeId});
}

test('interleaved story generation and chat updates preserve every field', async()=>{
  const store=await freshStore();
  const exchangeId=randomUUID();
  await Promise.all([storyWrite(store),chatUpdate(store,exchangeId)]);
  const final=await store.read(storyId);
  assert.ok(final);
  assert.equal(final.nodes.length,1);
  assert.equal(final.nodes[0].title,'并发剧情');
  assert.equal(final.selections.length,1);
  assert.equal(final.selections[0].target,'ling');
  assert.deepEqual(final.memory,{summary:'共同完成了一段对话',facts:['林泠在场']});
  assert.equal(final.route,'ling');
  assert.equal(final.relationshipType,'romance');
  assert.equal(final.worldState.relationships.ling,2);
  assert.equal(final.worldState.authorChatGains?.ling,2);
  assert.deepEqual(final.worldState.processedChatExchangeIds,[exchangeId]);
});

test('generation busy refuses both author and npc chat and allows them again after release', async()=>{
  const store=await freshStore();
  const exchangeId=randomUUID();
  let blockedStatus=0;
  await withStoryLock(storyId,async()=>{
    blockedStatus=authorChatGate({storyId,kind:'zhihu-author',busy:true,exchangeId}).ok?200:409;
    const npcGate=authorChatGate({storyId,kind:'preset-npc',busy:true,exchangeId});
    assert.equal(npcGate.ok,false);
    if(!npcGate.ok)assert.equal(npcGate.code,'STORY_GENERATION_IN_PROGRESS');
  });
  assert.equal(blockedStatus,409);
  const before=await store.read(storyId);
  assert.equal(before?.worldState.authorChatGains?.ling,undefined);
  assert.equal(before?.worldState.relationships.ling,0);
  await chatUpdate(store,exchangeId);
  assert.equal(authorChatGate({storyId,kind:'zhihu-author',busy:false,exchangeId}).ok,true);
  const final=await store.read(storyId);
  assert.equal(final?.worldState.authorChatGains?.ling,2);
});

test('the same exchange id settles only once against the real file store', async()=>{
  const store=await freshStore();
  const exchangeId=randomUUID();
  await chatUpdate(store,exchangeId);
  await chatUpdate(store,exchangeId);
  const final=await store.read(storyId);
  assert.equal(final?.worldState.authorChatGains?.ling,2);
  assert.equal(final?.worldState.relationships.ling,2);
  assert.equal(final?.worldState.processedChatExchangeIds?.length,1);
});

test('distinct exchange ids settle separately and keep the latest 500', async()=>{
  const store=await freshStore();
  const seeded=await store.read(storyId);
  assert.ok(seeded);
  seeded.worldState.processedChatExchangeIds=Array.from({length:MAX_PROCESSED_EXCHANGE_IDS},(_,index)=>`old-${index}`);
  await store.save(storyId,seeded);
  const newest=randomUUID();
  await updateLockedState(storyId,store,(state)=>{
    const gains=state.worldState.authorChatGains??(state.worldState.authorChatGains={});
    gains.ling=(gains.ling??0)+1;
  },{exchangeId:newest});
  const final=await store.read(storyId);
  const processed=final?.worldState.processedChatExchangeIds??[];
  assert.equal(processed.length,MAX_PROCESSED_EXCHANGE_IDS);
  assert.equal(processed.at(-1),newest);
  assert.ok(!processed.includes('old-0'));
  assert.ok(processed.includes('old-1'));
});

test('both serialization orders keep story progress and chat gains', async()=>{
  const store=await freshStore();
  await chatUpdate(store,randomUUID());
  await storyWrite(store);
  const chatFirst=await store.read(storyId);
  assert.equal(chatFirst?.worldState.authorChatGains?.ling,2);
  assert.equal(chatFirst?.worldState.relationships.ling,2);
  assert.equal(chatFirst?.nodes.length,1);
  assert.equal(chatFirst?.route,'ling');
  await chatUpdate(store,randomUUID());
  const storyFirst=await store.read(storyId);
  assert.equal(storyFirst?.worldState.authorChatGains?.ling,4);
  assert.equal(storyFirst?.nodes.length,1);
  assert.equal(storyFirst?.relationshipType,'romance');
});
