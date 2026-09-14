import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {CorpusError,countAuthorCorpus,listAuthorBatches,loadAuthorCorpus} from './author-corpus';

const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const answerBody=(answerId:string)=>({
  answerId,authorName:'合成测试作者',authorUrlToken:'MarryMea',
  authorProfileUrl:'https://www.zhihu.com/people/MarryMea',
  questionTitle:`合成问题${answerId}`,sourceUrl:`https://www.zhihu.com/answer/${answerId}`,
  body:`合成测试正文${answerId}：远程工作需要休息。`,
  completeness:'stored_body_unverified_against_live_page',
});

async function writeBatch(directory:string,batchId:string,answerIds:string[],options:{corruptManifest?:boolean;hashMismatch?:boolean;collection?:Record<string,unknown>}={}){
  const batchDirectory=path.join(directory,batchId);
  await mkdir(batchDirectory,{recursive:true});
  const records=[];
  for(const answerId of answerIds){
    const raw=Buffer.from(`${JSON.stringify(answerBody(answerId))}\n`,'utf8');
    await writeFile(path.join(batchDirectory,`answer-${answerId}.json`),raw);
    records.push({answerId,inputFile:`answer-${answerId}.json`,sha256:options.hashMismatch?digest('tampered'):digest(raw)});
  }
  const manifest:Record<string,unknown>={schemaVersion:1,batchId,authorUrlToken:'MarryMea',recordCount:records.length,records};
  if(options.collection)manifest.collection=options.collection;
  const manifestText=options.corruptManifest?'{ not-json':'';
  await writeFile(path.join(batchDirectory,'manifest.json'),manifestText||JSON.stringify(manifest));
}

async function fixture(run:(directory:string)=>Promise<void>){
  const directory=await mkdtemp(path.join(tmpdir(),'zhihu-corpus-batches-'));
  try{await run(directory);}
  finally{await rm(directory,{recursive:true,force:true});}
}

test('corpus loader merges every batch in order and deduplicates answers',async()=>{
  await fixture(async directory=>{
    await writeBatch(directory,'batch-001',['1001','1002']);
    await writeBatch(directory,'batch-002',['1003','1001'],{collection:{method:'profile-search',query:'远程工作',sort:'created',collectedAt:'2026-09-13T00:00:00.000Z'}});
    const batches=await listAuthorBatches(directory);
    assert.deepEqual(batches.map(batch=>batch.batchId),['batch-001','batch-002']);
    const corpus=await loadAuthorCorpus(directory,'MarryMea');
    assert.deepEqual(corpus.answers.map(answer=>answer.answerId),['1001','1002','1003']);
    assert.equal(corpus.batchCount,2);
    assert.equal(corpus.recordCount,3);
    assert.equal(await countAuthorCorpus(directory,'MarryMea'),3);
  });
});

test('broken manifests, tampered hashes and missing corpus fail with distinct codes',async()=>{
  for(const scenario of ['manifest','hash'] as const){
    await fixture(async directory=>{
      await writeBatch(directory,'batch-001',['1001']);
      await writeBatch(directory,'batch-002',['1002'],scenario==='manifest'?{corruptManifest:true}:{hashMismatch:true});
      await assert.rejects(loadAuthorCorpus(directory,'MarryMea'),(error:unknown)=>{
        assert.ok(error instanceof CorpusError);
        assert.equal(error.code,scenario==='manifest'?'CORPUS_MANIFEST_INVALID':'CORPUS_HASH_MISMATCH');
        return true;
      });
    });
  }
  await fixture(async directory=>{
    await assert.rejects(loadAuthorCorpus(directory,'MarryMea'),(error:unknown)=>{
      assert.ok(error instanceof CorpusError);
      assert.equal(error.code,'CORPUS_MISSING');
      return true;
    });
  });
});

test('corpus record limits are enforced before retrieval',async()=>{
  await fixture(async directory=>{
    await writeBatch(directory,'batch-001',['1001','1002']);
    await assert.rejects(loadAuthorCorpus(directory,'MarryMea',{maxRecords:1}),(error:unknown)=>{
      assert.ok(error instanceof CorpusError);
      assert.equal(error.code,'CORPUS_LIMIT_EXCEEDED');
      return true;
    });
  });
});

test('duplicate batch indexes are rejected as corrupt manifests',async()=>{
  await fixture(async directory=>{
    await writeBatch(directory,'batch-001',['1001']);
    await mkdir(path.join(directory,'batch-01'),{recursive:true});
    await assert.rejects(listAuthorBatches(directory),(error:unknown)=>{
      assert.ok(error instanceof CorpusError);
      assert.equal(error.code,'CORPUS_MANIFEST_INVALID');
      return true;
    });
  });
});

test('corpus hashes accept windows line endings for identical content',async()=>{
  await fixture(async directory=>{
    const batchDirectory=path.join(directory,'batch-001');
    await mkdir(batchDirectory,{recursive:true});
    const lf=`${JSON.stringify(answerBody('1001'),null,2)}\n`;
    await writeFile(path.join(batchDirectory,'answer-1001.json'),lf.replace(/\n/g,'\r\n'));
    await writeFile(path.join(batchDirectory,'manifest.json'),JSON.stringify({
      schemaVersion:1,batchId:'batch-001',authorUrlToken:'MarryMea',recordCount:1,
      records:[{answerId:'1001',inputFile:'answer-1001.json',sha256:digest(lf)}],
    }));
    const corpus=await loadAuthorCorpus(directory,'MarryMea');
    assert.equal(corpus.recordCount,1);
  });
});
