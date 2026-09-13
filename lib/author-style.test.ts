import assert from 'node:assert/strict';
import test from 'node:test';
import {authorSystemText,runAuthorAgent,type AuthorModelMessage} from './author-agent';
import {parseStyleCard,stylePromptFragment} from './author-style';
import type {AuthorAnswer} from './author-corpus';

const card=(overrides:Record<string,unknown>={})=>({
  version:1,authorUrlToken:'MarryMea',status:'draft',
  observations:[{id:'o1',note:'先给结论再补充前提。',evidenceAnswerIds:['1001','1002']}],
  ...overrides,
});
const answer:AuthorAnswer={
  answerId:'1001',authorName:'合成测试作者',authorUrlToken:'MarryMea',
  questionTitle:'合成问题',sourceUrl:'https://www.zhihu.com/answer/1001',
  body:'合成测试：远程工作需要休息。',completeness:'fetched_api_content_unverified',
};

test('draft style cards keep the neutral prompt',()=>{
  const parsed=parseStyleCard(card());
  assert.equal(parsed.status,'draft');
  assert.equal(stylePromptFragment(parsed),'');
  assert.ok(authorSystemText().includes('风格尚未校准'));
});

test('reviewed cards require a review date and at least two answers per observation',()=>{
  assert.throws(()=>parseStyleCard(card({status:'reviewed'})),/reviewedAt/);
  const reviewed=parseStyleCard(card({status:'reviewed',reviewedAt:'2026-09-13T00:00:00.000Z'}));
  assert.ok(stylePromptFragment(reviewed).includes('先给结论'));
  assert.throws(()=>parseStyleCard(card({observations:[{id:'o1',note:'单篇观察',evidenceAnswerIds:['1001']}]})),/两篇/);
  assert.throws(()=>parseStyleCard(card({observations:[{id:'o1',note:'重复证据',evidenceAnswerIds:['1001','1001']}]})),/两篇/);
  assert.throws(()=>parseStyleCard(card({observations:[{id:'o1',note:'观察',evidenceAnswerIds:['1001','1002']},{id:'o1',note:'重复 id',evidenceAnswerIds:['1001','1002']}]})),/重复/);
});

test('reviewed style fragments reach the model while drafts never do',async()=>{
  const seen:AuthorModelMessage[][]=[];
  const call=async(messages:readonly AuthorModelMessage[])=>{
    seen.push(messages.map(message=>({...message})));
    return JSON.stringify({tool:'finish',args:{text:'合成回复',citationIds:[]}});
  };
  const input={answers:[answer],authorToken:'MarryMea',story:'摘要',history:[{role:'user' as const,text:'远程工作如何休息？'}]};
  const reviewed=parseStyleCard(card({status:'reviewed',reviewedAt:'2026-09-13T00:00:00.000Z'}));
  await runAuthorAgent({...input,style:stylePromptFragment(reviewed)},call);
  assert.ok(seen[0][0].content.includes('先给结论'));
  seen.length=0;
  await runAuthorAgent({...input,style:stylePromptFragment(parseStyleCard(card()))},call);
  assert.ok(seen[0][0].content.includes('风格尚未校准'));
  assert.ok(!seen[0][0].content.includes('先给结论'));
});
