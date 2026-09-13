import {createHash} from 'node:crypto';
import {open,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {validateAnswerSource} from './author-citations';

export const MAX_CORPUS_RECORDS = 500;
export const MAX_CORPUS_BYTES = 5_000_000;

export type CorpusErrorCode = 'CORPUS_MISSING' | 'CORPUS_MANIFEST_INVALID' | 'CORPUS_HASH_MISMATCH' | 'CORPUS_LIMIT_EXCEEDED';

export class CorpusError extends Error {
  constructor(message: string, readonly code: CorpusErrorCode) {
    super(message);
    this.name = 'CorpusError';
  }
}

const answerSchema=z.object({
  answerId:z.string().regex(/^\d+$/),authorName:z.string().min(1).max(80),
  authorUrlToken:z.string().min(1).max(100),authorProfileUrl:z.string().optional(),
  questionTitle:z.string().min(1).max(500),sourceUrl:z.string(),body:z.string().trim().min(1).max(100_000),
  completeness:z.enum(['stored_body_unverified_against_live_page','fetched_api_content_unverified','verified_full_text']),
});
export type AuthorAnswer=z.infer<typeof answerSchema>;
const manifestSchema=z.object({
  schemaVersion:z.literal(1),batchId:z.string().min(1),authorUrlToken:z.string().min(1),
  recordCount:z.number().int().min(1).max(30),
  records:z.array(z.object({answerId:z.string().regex(/^\d+$/),inputFile:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(30),
}).passthrough();

async function readLimited(file:string,limit:number){
  const handle=await open(file,'r');
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw new Error('Corpus file size limit exceeded');
    const buffer=Buffer.alloc(limit+1);let total=0;
    while(total<buffer.length){const {bytesRead}=await handle.read(buffer,total,buffer.length-total,null);if(!bytesRead)break;total+=bytesRead;}
    if(total>limit)throw new Error('Corpus file size limit exceeded');
    return buffer.subarray(0,total);
  }finally{await handle.close();}
}

function recordDigest(raw:Buffer):string {
  const text=raw.toString('utf8');
  const normalized=text.includes('\r\n')?Buffer.from(text.replace(/\r\n/g,'\n'),'utf8'):raw;
  return createHash('sha256').update(normalized).digest('hex');
}

/** Reads only the explicitly selected manifest, one record at a time. */
export async function* loadAuthorBatch(manifestPath:string,authorToken:string):AsyncGenerator<AuthorAnswer>{
  let rawManifest:string;
  try{rawManifest=(await readLimited(manifestPath,128_000)).toString('utf8');}
  catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')throw new CorpusError('Corpus batch missing','CORPUS_MISSING');
    throw error;
  }
  let manifest:z.infer<typeof manifestSchema>;
  try{manifest=manifestSchema.parse(JSON.parse(rawManifest));}
  catch{throw new CorpusError('Corpus manifest invalid','CORPUS_MANIFEST_INVALID');}
  if(manifest.authorUrlToken!==authorToken)throw new CorpusError('Manifest author mismatch','CORPUS_MANIFEST_INVALID');
  if(manifest.recordCount!==manifest.records.length)throw new CorpusError('Manifest record count mismatch','CORPUS_MANIFEST_INVALID');
  const ids=new Set<string>();const filenames=new Set<string>();
  for(const record of manifest.records){
    if(!/^answer-\d+\.json$/.test(record.inputFile))throw new CorpusError('Invalid corpus input file path','CORPUS_MANIFEST_INVALID');
    if(ids.has(record.answerId)||filenames.has(record.inputFile))throw new CorpusError('Duplicate corpus answer or file','CORPUS_MANIFEST_INVALID');
    ids.add(record.answerId);filenames.add(record.inputFile);
  }
  const directory=await realpath(path.dirname(manifestPath));let totalBytes=0;
  for(const record of manifest.records){
    const file=await realpath(path.join(directory,record.inputFile));
    if(path.dirname(file)!==directory)throw new CorpusError('Corpus file path leaves batch directory','CORPUS_MANIFEST_INVALID');
    const raw=await readLimited(file,128_000);totalBytes+=raw.length;
    if(totalBytes>512_000)throw new CorpusError('Corpus batch size limit exceeded','CORPUS_LIMIT_EXCEEDED');
    if(recordDigest(raw)!==record.sha256)throw new CorpusError('Corpus hash mismatch','CORPUS_HASH_MISMATCH');
    let answer:AuthorAnswer;
    try{answer=answerSchema.parse(JSON.parse(raw.toString('utf8')));}
    catch{throw new CorpusError('Corpus answer invalid','CORPUS_MANIFEST_INVALID');}
    if(answer.authorUrlToken!==authorToken)throw new CorpusError('Corpus answer author mismatch','CORPUS_MANIFEST_INVALID');
    if(answer.answerId!==record.answerId)throw new CorpusError('Corpus answer ID mismatch','CORPUS_MANIFEST_INVALID');
    try{answer.sourceUrl=validateAnswerSource(answer.sourceUrl,answer.answerId);}
    catch{throw new CorpusError('Invalid source URL or answer ID','CORPUS_MANIFEST_INVALID');}
    yield answer;
  }
}

export type AuthorBatchInfo={batchId:string;manifestPath:string};

export async function listAuthorBatches(authorDirectory:string):Promise<AuthorBatchInfo[]>{
  let entries;
  try{entries=await readdir(authorDirectory,{withFileTypes:true});}
  catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT'||(error as NodeJS.ErrnoException).code==='ENOTDIR')return [];
    throw error;
  }
  const batches:{index:number;name:string}[]=[];
  for(const entry of entries){
    if(!entry.isDirectory()||!/^batch-\d+$/.test(entry.name))continue;
    batches.push({index:Number(entry.name.slice('batch-'.length)),name:entry.name});
  }
  batches.sort((a,b)=>a.index-b.index||a.name.localeCompare(b.name));
  for(let index=1;index<batches.length;index+=1){
    if(batches[index].index===batches[index-1].index)throw new CorpusError('Duplicate corpus batch index','CORPUS_MANIFEST_INVALID');
  }
  return batches.map((batch)=>({batchId:batch.name,manifestPath:path.join(authorDirectory,batch.name,'manifest.json')}));
}

export async function countAuthorCorpus(authorDirectory:string,authorToken:string):Promise<number>{
  const batches=await listAuthorBatches(authorDirectory);
  const seen=new Set<string>();
  for(const batch of batches){
    for await(const answer of loadAuthorBatch(batch.manifestPath,authorToken))seen.add(answer.answerId);
  }
  return seen.size;
}

export type AuthorCorpusLoad={answers:AuthorAnswer[];batchCount:number;recordCount:number;bytes:number};

export async function loadAuthorCorpus(
  authorDirectory:string,
  authorToken:string,
  options:{maxRecords?:number;maxBytes?:number}={},
):Promise<AuthorCorpusLoad>{
  const maxRecords=options.maxRecords??MAX_CORPUS_RECORDS;
  const maxBytes=options.maxBytes??MAX_CORPUS_BYTES;
  if(!Number.isSafeInteger(maxRecords)||maxRecords<1)throw new CorpusError('Invalid corpus record limit','CORPUS_LIMIT_EXCEEDED');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new CorpusError('Invalid corpus byte limit','CORPUS_LIMIT_EXCEEDED');
  const batches=await listAuthorBatches(authorDirectory);
  if(!batches.length)throw new CorpusError('Corpus unavailable','CORPUS_MISSING');
  const answers:AuthorAnswer[]=[];const seen=new Set<string>();let bytes=0;
  for(const batch of batches){
    for await(const answer of loadAuthorBatch(batch.manifestPath,authorToken)){
      if(seen.has(answer.answerId))continue;
      seen.add(answer.answerId);
      bytes+=Buffer.byteLength(JSON.stringify(answer),'utf8');
      if(answers.length+1>maxRecords||bytes>maxBytes)throw new CorpusError('Corpus limit exceeded','CORPUS_LIMIT_EXCEEDED');
      answers.push(answer);
    }
  }
  return {answers,batchCount:batches.length,recordCount:answers.length,bytes};
}
