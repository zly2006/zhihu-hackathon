import assert from 'node:assert/strict';
import test from 'node:test';
import {buildAuthorMessages} from './author-agent';
import {runAuthorAgent} from './author-agent';
import {AUTHOR_AFFINITY_CAP,effectiveInteractionReward,settleInteractionGain} from './author-chat';
import type {AuthorSource} from './author-citations';
import {canonicalProfiles,initial,publicState,selectedCast} from './story';
import {isSaveSlot,demoOpening} from './ui-story';

test('avatar binding survives canonicalization and public-state projection',()=>{
  const profiles=canonicalProfiles();profiles[0].authorAvatarId='zhao-ling';
  const state=initial(profiles);
  assert.equal(selectedCast(state)[0].authorAvatarId,'zhao-ling');
  assert.equal(publicState(state).world.cast[0].authorAvatarId,'zhao-ling');
  assert.throws(()=>canonicalProfiles(profiles.map((p,i)=>i? p:{...p,authorAvatarId:'unknown'})),/化身/);
});
test('known old zhihuHandle migrates to a registered binding only',()=>{
  const profiles=canonicalProfiles();profiles[0].zhihuHandle='赵泠';profiles[1].zhihuHandle='未注册答主';
  const resolved=canonicalProfiles(profiles);
  assert.equal(resolved[0].authorAvatarId,'zhao-ling');assert.equal(resolved[1].authorAvatarId,undefined);
});
test('author prompt keeps string messages and states the unreviewed neutral style',()=>{
  const history=Array.from({length:12},(_,i)=>({role:i%2?'user' as const:'assistant' as const,text:'很长的合成历史'.repeat(50)}));
  const messages=buildAuthorMessages('公开剧情'.repeat(500),history);
  assert.ok(messages.every(m=>typeof m.content==='string'));
  assert.equal(messages.at(-1)?.content,history.at(-1)?.text);
  assert.ok(messages[0].content.includes('风格尚未校准'));
  assert.ok(messages[0].content.includes('search_corpus'));
});
test('oversized current user question fails instead of silent truncation',async()=>{
  await assert.rejects(runAuthorAgent({answers:[],authorToken:'MarryMea',story:'',history:[{role:'user',text:'超长'.repeat(4000)}]},async()=>'{}'),/输入过长/);
});
test('version-1 saves support optional citation metadata and reject unsafe URLs',()=>{
  const slot={version:1,mode:'demo',state:demoOpening,line:0,partner:'lin',time:'synthetic',chats:{lin:[{role:'assistant',text:'测试',sources:[{answerId:'1001',title:'测试',author:'测试',authorUrlToken:'MarryMea',url:'https://www.zhihu.com/answer/1001',completeness:'stored_body_unverified_against_live_page'}],avatar:{id:'zhao-ling',displayName:'林泠',styleStatus:'unreviewed'},evidenceStatus:'matched'}]}};
  assert.equal(isSaveSlot(JSON.parse(JSON.stringify(slot))),true);
  slot.chats.lin[0].sources[0].url='javascript:alert(1)';assert.equal(isSaveSlot(slot),false);
});
test('effective interaction reward follows evidence status and caps at ten per game',()=>{
  const source={answerId:'1001',title:'合成',author:'合成',authorUrlToken:'MarryMea',url:'https://www.zhihu.com/answer/1001',completeness:'stored_body_unverified_against_live_page'} as AuthorSource;
  assert.equal(effectiveInteractionReward({evidenceStatus:'no-match',sources:[]}),0);
  assert.equal(effectiveInteractionReward({evidenceStatus:'matched',sources:[]}),1);
  assert.equal(effectiveInteractionReward({evidenceStatus:'matched',sources:[source]}),2);
  assert.equal(settleInteractionGain({currentGain:0,reward:2}),2);
  assert.equal(settleInteractionGain({currentGain:9,reward:2}),1);
  assert.equal(settleInteractionGain({currentGain:AUTHOR_AFFINITY_CAP,reward:2}),0);
  assert.equal(settleInteractionGain({currentGain:0,reward:0}),0);
});
