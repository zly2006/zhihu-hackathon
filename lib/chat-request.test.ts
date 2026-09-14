import assert from 'node:assert/strict';
import test from 'node:test';
import {authorChatGate,chatRequestSchema,isDuplicateExchange,isValidExchangeId} from './chat-request';

const baseMessage={role:'user' as const,text:'远程工作怎么休息？'};

test('chat schema rejects client-supplied affinity values and invalid exchange ids', () => {
  assert.equal(chatRequestSchema.safeParse({character:'ling',line:0,messages:[baseMessage]}).success,true);
  assert.equal(chatRequestSchema.safeParse({character:'ling',line:0,exchangeId:'not-a-uuid',messages:[baseMessage]}).success,false);
  assert.equal(chatRequestSchema.safeParse({character:'ling',line:0,delta:2,total:99,messages:[baseMessage]}).success,false);
  assert.equal(chatRequestSchema.safeParse({character:'ling',line:0,affinity:{delta:2},messages:[baseMessage]}).success,false);
  assert.equal(chatRequestSchema.safeParse({character:'ling',line:0,messages:[{role:'assistant',text:'我先说'}]}).success,false);
});

test('exchange ids require a UUID and are trimmed before validation', () => {
  assert.equal(isValidExchangeId('2bd61ff8-e71c-4a81-b342-3569f66233cc'),true);
  assert.equal(isValidExchangeId(' 2bd61ff8-e71c-4a81-b342-3569f66233cc '),true);
  assert.equal(isValidExchangeId('123'),false);
  assert.equal(isValidExchangeId(''),false);
  assert.equal(isValidExchangeId(42),false);
});

test('story chat during generation is refused for答主 and预设 NPC alike', () => {
  const exchangeId='2bd61ff8-e71c-4a81-b342-3569f66233cc';
  const gateOf=(input:Parameters<typeof authorChatGate>[0])=>{
    const result=authorChatGate(input);
    return result.ok?{ok:true as const}:{ok:false as const,status:result.status,code:result.code,error:result.error};
  };
  assert.deepEqual(gateOf({storyId:'11111111-1111-4111-8111-111111111111',kind:'zhihu-author',busy:true,exchangeId}),{
    ok:false,status:409,code:'STORY_GENERATION_IN_PROGRESS',error:'剧情正在生成，这条消息先留着，稍后再发。',
  });
  assert.deepEqual(gateOf({storyId:'11111111-1111-4111-8111-111111111111',kind:'preset-npc',busy:true,exchangeId}),{
    ok:false,status:409,code:'STORY_GENERATION_IN_PROGRESS',error:'剧情正在生成，这条消息先留着，稍后再发。',
  });
  assert.deepEqual(gateOf({storyId:'11111111-1111-4111-8111-111111111111',kind:'zhihu-author',busy:false,exchangeId}),{ok:true});
  assert.deepEqual(gateOf({kind:'zhihu-author',busy:true}),{ok:true});
  const missing=gateOf({storyId:'11111111-1111-4111-8111-111111111111',kind:'preset-npc',busy:false});
  assert.equal(missing.ok?undefined:missing.code,'EXCHANGE_ID_REQUIRED');
  const invalid=gateOf({storyId:'11111111-1111-4111-8111-111111111111',kind:'preset-npc',busy:false,exchangeId:'nope'});
  assert.equal(invalid.ok?undefined:invalid.code,'INVALID_EXCHANGE_ID');
});

test('duplicate exchange detection only depends on the persisted id list', () => {
  const exchangeId='2bd61ff8-e71c-4a81-b342-3569f66233cc';
  assert.equal(isDuplicateExchange([exchangeId],exchangeId),true);
  assert.equal(isDuplicateExchange([],exchangeId),false);
  assert.equal(isDuplicateExchange(undefined,exchangeId),false);
  assert.equal(isDuplicateExchange([exchangeId],undefined),false);
});
