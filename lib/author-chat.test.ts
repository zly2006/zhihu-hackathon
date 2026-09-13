import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareAuthorMessages,parseAuthorReply} from './author-chat';
import {canonicalProfiles,initial,publicState,selectedCast} from './story';
import {isSaveSlot,demoOpening} from './ui-story';
import type {AuthorEvidence} from './author-retrieval';

const evidence:AuthorEvidence={id:'1001:p1',answerId:'1001',authorName:'合成测试作者',authorUrlToken:'MarryMea',title:'远程工作',sourceUrl:'https://www.zhihu.com/answer/1001',text:'合成测试内容：远程工作需要休息。',completeness:'stored_body_unverified_against_live_page'};
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
test('author prompt keeps string messages and enforces 6000 UTF-8 bytes',()=>{
  const history=Array.from({length:12},(_,i)=>({role:i%2?'user' as const:'assistant' as const,text:'很长的合成历史'.repeat(50)}));
  const prepared=prepareAuthorMessages('公开剧情'.repeat(500),history,[evidence]);
  assert.ok(prepared.messages.every(m=>typeof m.content==='string'));
  assert.ok(Buffer.byteLength(JSON.stringify(prepared.messages),'utf8')<=6000);
  assert.equal(prepared.messages.at(-1)?.content,history.at(-1)?.text);
  assert.ok(prepared.messages[0].content.includes('风格尚未校准'));
});
test('oversized current user question fails instead of silent truncation',()=>{
  assert.throws(()=>prepareAuthorMessages('',[{role:'user',text:'超长'.repeat(4000)}],[evidence]),/输入过长/);
});
test('reply validation requires citations for evidence claims and rejects fake links',()=>{
  assert.equal(parseAuthorReply(JSON.stringify({text:'合成测试回复',citationIds:[evidence.id]}),[evidence]).sources[0].answerId,'1001');
  assert.throws(()=>parseAuthorReply(JSON.stringify({text:'声称有依据',citationIds:[]}),[evidence]),/引用/);
  assert.throws(()=>parseAuthorReply(JSON.stringify({text:'https://evil.test',citationIds:[evidence.id]}),[evidence]),/链接/);
});
test('version-1 saves support optional citation metadata and reject unsafe URLs',()=>{
  const slot={version:1,mode:'demo',state:demoOpening,line:0,partner:'lin',time:'synthetic',chats:{lin:[{role:'assistant',text:'测试',sources:[{answerId:'1001',title:'测试',author:'测试',authorUrlToken:'MarryMea',url:'https://www.zhihu.com/answer/1001',completeness:'stored_body_unverified_against_live_page'}],avatar:{id:'zhao-ling',displayName:'泠泠',styleStatus:'unreviewed'},evidenceStatus:'matched'}]}};
  assert.equal(isSaveSlot(JSON.parse(JSON.stringify(slot))),true);
  slot.chats.lin[0].sources[0].url='javascript:alert(1)';assert.equal(isSaveSlot(slot),false);
});
