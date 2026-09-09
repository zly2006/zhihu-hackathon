import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const url='http://127.0.0.1:3000/api/story';let cookie='',state=null;
const proof=[];
try {const saved=JSON.parse(await fs.readFile('test-output/browser-state.json','utf8'));cookie='lamplight_session='+saved.cookies[0].value;state=(await(await fetch(url,{headers:{cookie}})).json()).state;}catch{}
for(let turn=state?.nodes.length||0;turn<7;turn++) {
 const begin=Date.now();const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(!state?{action:'start'}:{action:state.pending?'retry':'choose',...(state.pending?{}:{choice:0,expected:state.nodes.length})})});
 assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/event-stream/);cookie=res.headers.get('set-cookie')?.split(';')[0]||cookie;
 const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='',events=[];
 while(true){const p=await reader.read();buffer+=decoder.decode(p.value,{stream:!p.done});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const l of lines)if(l.startsWith('data:')){const event=JSON.parse(l.slice(5));events.push({ms:Date.now()-begin,...event});if(event.type==='line')console.log(`turn ${turn+1} line ${event.index+1} @ ${Date.now()-begin}ms`);if(event.type==='done')state=event.state;}if(p.done)break;}
 await fs.writeFile(`test-output/live-${turn+1}.jsonl`,events.map(e=>JSON.stringify(e)).join('\n')+'\n');
 assert.ok(state&&!state.pending,JSON.stringify(events.at(-1)));
 const first=events.find(e=>e.type==='line'),last=events.find(e=>e.type==='done');assert.ok(first&&last&&first.ms<last.ms,'first dialogue must precede completion');
 assert.equal(state.nodes.length,turn+1);assert.ok(state.nodes.at(-1).readingSeconds>=45&&state.nodes.at(-1).readingSeconds<=60);
 const reread=await (await fetch(url,{headers:{cookie}})).json();assert.deepEqual(reread.state,state);
 proof.push({turn:turn+1,firstDialogueMs:first.ms,completeMs:last.ms,readingSeconds:state.nodes.at(-1).readingSeconds,route:state.route});
 await fs.writeFile('test-output/live-summary.json',JSON.stringify(proof,null,2));
 await fs.writeFile('test-output/browser-state.json',JSON.stringify({cookies:[{name:'lamplight_session',value:cookie.split('=')[1],domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Strict'}],origins:[]}));
 console.log(JSON.stringify(proof.at(-1)));
}
assert.equal(state.complete,true);console.log('Complete 7-turn SSE route verified.');
