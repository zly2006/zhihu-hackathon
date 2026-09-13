import assert from 'node:assert/strict';
import test from 'node:test';
import {NO_MATCH_TEXT,authorSerializeBytes,runAuthorAgent,type AuthorModelMessage} from './author-agent';
import {AuthorChatError} from './author-errors';
import type {AuthorAnswer} from './author-corpus';

const answer:AuthorAnswer={
  answerId:'1001',authorName:'合成测试作者',authorUrlToken:'MarryMea',
  authorProfileUrl:'https://www.zhihu.com/people/MarryMea',
  questionTitle:'远程工作如何减少孤独',sourceUrl:'https://www.zhihu.com/answer/1001',
  body:'合成测试：远程工作需要明确休息安排。\n合成测试：孤独时可以安排定期交流。',
  completeness:'stored_body_unverified_against_live_page',
};
const input={answers:[answer],authorToken:'MarryMea',story:'公开剧情摘要',history:[{role:'user' as const,text:'远程工作如何休息？'}]};

function scripted(replies:string[]){
  const calls:AuthorModelMessage[][]=[];
  let index=0;
  const call=async(messages:readonly AuthorModelMessage[])=>{
    calls.push(messages.map(message=>({...message})));
    return replies[Math.min(index++,replies.length-1)];
  };
  return {call,calls};
}
const search=(query='远程工作')=>JSON.stringify({tool:'search_corpus',args:{query}});
const read=(answerId='1001')=>JSON.stringify({tool:'read_answer',args:{answerId}});
const finish=(citationIds=['1001:p1'])=>JSON.stringify({tool:'finish',args:{text:'合成回复',citationIds}});

test('agent searches once and finishes with a program-built citation',async()=>{
  const {call,calls}=scripted([search(),finish()]);
  const result=await runAuthorAgent(input,call);
  assert.equal(result.evidenceStatus,'matched');
  assert.equal(result.text,'合成回复');
  assert.deepEqual(result.sources.map(source=>source.answerId),['1001']);
  assert.equal(result.toolCalls,1);
  assert.equal(result.turns,2);
  assert.ok(calls.every(messages=>messages.every(message=>typeof message.content==='string')));
  const toolResult=JSON.parse(calls[1].at(-1)!.content) as {type:string;tool:string;ok:boolean};
  assert.equal(toolResult.type,'tool_result');
  assert.equal(toolResult.tool,'search_corpus');
  assert.equal(toolResult.ok,true);
});

test('agent may read one searched answer before finishing',async()=>{
  const {call}=scripted([search(),read(),finish(['1001:p2'])]);
  const result=await runAuthorAgent(input,call);
  assert.equal(result.evidenceStatus,'matched');
  assert.equal(result.toolCalls,2);
  assert.equal(result.turns,3);
});

test('two empty searches stop the loop without another model call',async()=>{
  const {call,calls}=scripted([search('量子引力黑洞'),search('暗物质探测'),finish()]);
  const result=await runAuthorAgent(input,call);
  assert.equal(result.evidenceStatus,'no-match');
  assert.equal(result.text,NO_MATCH_TEXT);
  assert.deepEqual(result.sources,[]);
  assert.equal(calls.length,2);
  assert.equal(result.toolCalls,2);
});

test('fabricated citations are rejected and the model gets a chance to repair',async()=>{
  const {call,calls}=scripted([search(),finish(['fabricated:p1']),finish(['1001:p1'])]);
  const result=await runAuthorAgent(input,call);
  assert.equal(result.evidenceStatus,'matched');
  assert.equal(result.turns,3);
  assert.ok(calls[2].at(-1)!.content.includes('CITATION_OUT_OF_RANGE'));
});

test('tool budget errors are reported back instead of silently ignored',async()=>{
  const {call,calls}=scripted([search(),search('远程工作的边界'),search('远程工作孤独'),finish()]);
  const result=await runAuthorAgent(input,call);
  assert.equal(result.evidenceStatus,'matched');
  assert.equal(result.toolCalls,2);
  assert.ok(calls[3].at(-1)!.content.includes('TOOL_BUDGET_EXCEEDED'));
});

test('repeated invalid model output fails with a distinct error state',async()=>{
  const {call}=scripted(['不是 JSON','还是不是 JSON']);
  await assert.rejects(runAuthorAgent(input,call),(error:unknown)=>{
    assert.ok(error instanceof AuthorChatError);
    assert.equal(error.code,'INVALID_MODEL_REPLY');
    return true;
  });
});

test('a model that never finishes ends in TOOL_BUDGET_EXCEEDED',async()=>{
  const {call}=scripted(Array.from({length:12},()=>search()));
  await assert.rejects(runAuthorAgent(input,call),(error:unknown)=>{
    assert.ok(error instanceof AuthorChatError);
    assert.equal(error.code,'TOOL_BUDGET_EXCEEDED');
    return true;
  });
});

test('model timeouts keep their own error state',async()=>{
  const call=async()=>{throw new AuthorChatError('模型服务响应超时，请稍后重试。',504,'MODEL_TIMEOUT');};
  await assert.rejects(runAuthorAgent(input,call),(error:unknown)=>{
    assert.ok(error instanceof AuthorChatError);
    assert.equal(error.code,'MODEL_TIMEOUT');
    return true;
  });
});

test('serialized agent messages stay inside the input byte budget',async()=>{
  const longHistory=Array.from({length:20},(_,index)=>({role:index%2?'user' as const:'assistant' as const,text:'合成历史'.repeat(80)}));
  const seen:AuthorModelMessage[][]=[];
  let index=0;
  const call=async(messages:readonly AuthorModelMessage[])=>{
    seen.push(messages.map(message=>({...message})));
    return index++===0?search():finish();
  };
  await runAuthorAgent({...input,history:[...longHistory,{role:'user',text:'远程工作如何休息？'}]},call);
  assert.ok(seen.length>=1);
  assert.ok(authorSerializeBytes(seen[0])<=6000);
});
