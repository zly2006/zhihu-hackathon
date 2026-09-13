import {createHash} from 'node:crypto';
import {open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {validateAnswerSource} from './author-citations';

const answerSchema=z.object({
  answerId:z.string().regex(/^\d+$/),authorName:z.string().min(1).max(80),
  authorUrlToken:z.string().min(1).max(100),authorProfileUrl:z.string().optional(),
  questionTitle:z.string().min(1).max(500),sourceUrl:z.string(),body:z.string().trim().min(1).max(100_000),
  completeness:z.enum(['stored_body_unverified_against_live_page','verified_full_text']),
});
export type AuthorAnswer=z.infer<typeof answerSchema>;
const manifestSchema=z.object({
  schemaVersion:z.literal(1),batchId:z.string().min(1),authorUrlToken:z.string().min(1),
  recordCount:z.number().int().min(1).max(30),
  records:z.array(z.object({answerId:z.string().regex(/^\d+$/),inputFile:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(30),
});
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

/** Reads only the explicitly selected manifest, one record at a time. */
export async function* loadAuthorBatch(manifestPath:string,authorToken:string):AsyncGenerator<AuthorAnswer>{
  const manifest=manifestSchema.parse(JSON.parse((await readLimited(manifestPath,128_000)).toString('utf8')));
  if(manifest.authorUrlToken!==authorToken)throw new Error('Manifest author mismatch');
  if(manifest.recordCount!==manifest.records.length)throw new Error('Manifest record count mismatch');
  const ids=new Set<string>();const filenames=new Set<string>();
  for(const record of manifest.records){
    if(!/^answer-\d+\.json$/.test(record.inputFile))throw new Error('Invalid corpus input file path');
    if(ids.has(record.answerId)||filenames.has(record.inputFile))throw new Error('Duplicate corpus answer or file');
    ids.add(record.answerId);filenames.add(record.inputFile);
  }
  const directory=await realpath(path.dirname(manifestPath));let totalBytes=0;
  for(const record of manifest.records){
    const file=await realpath(path.join(directory,record.inputFile));
    if(path.dirname(file)!==directory)throw new Error('Corpus file path leaves batch directory');
    const raw=await readLimited(file,128_000);totalBytes+=raw.length;
    if(totalBytes>512_000)throw new Error('Corpus batch size limit exceeded');
    if(createHash('sha256').update(raw).digest('hex')!==record.sha256)throw new Error('Corpus hash mismatch');
    const answer=answerSchema.parse(JSON.parse(raw.toString('utf8')));
    if(answer.authorUrlToken!==authorToken)throw new Error('Corpus answer author mismatch');
    if(answer.answerId!==record.answerId)throw new Error('Corpus answer ID mismatch');
    answer.sourceUrl=validateAnswerSource(answer.sourceUrl,answer.answerId);
    yield answer;
  }
}

