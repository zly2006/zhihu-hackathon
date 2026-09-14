import type {AuthorEvidence} from './author-retrieval';

export type AuthorSource={answerId:string;title:string;author:string;authorUrlToken:string;url:string;completeness:string};
export function validateAnswerSource(source:unknown,answerId:string):string {
  if(typeof source!=='string')throw new Error('Invalid source URL');
  let url:URL;try{url=new URL(source);}catch{throw new Error('Invalid source URL');}
  const match=/^(?:\/question\/\d+)?\/answer\/(\d+)\/?$/.exec(url.pathname);
  if(url.protocol!=='https:'||!['www.zhihu.com','zhihu.com'].includes(url.hostname)||url.username||url.password||url.port||!match||match[1]!==answerId)throw new Error('Invalid source URL or answer ID');
  return `https://www.zhihu.com${url.pathname.replace(/\/$/,'')}`;
}
export function normalizeAuthorCitations(ids:unknown,evidence:AuthorEvidence[],authorToken:string):AuthorSource[] {
  if(!Array.isArray(ids)||ids.length>10||ids.some(id=>typeof id!=='string'))throw new Error('Invalid citation IDs');
  const allowed=new Map(evidence.map(item=>[item.id,item]));
  const seen=new Set<string>();const sources:AuthorSource[]=[];
  for(const id of ids){
    const item=allowed.get(id);if(!item)throw new Error('Unknown citation ID');
    if(item.authorUrlToken!==authorToken)throw new Error('Citation author mismatch');
    const url=validateAnswerSource(item.sourceUrl,item.answerId);
    if(seen.has(item.answerId))continue;seen.add(item.answerId);
    sources.push({answerId:item.answerId,title:item.title,author:item.authorName,authorUrlToken:item.authorUrlToken,url,completeness:item.completeness});
  }
  return sources;
}
export function toChatHistory(messages:readonly unknown[]):{role:'user'|'assistant';text:string}[] {
  return messages.map(value=>{
    if(!value||typeof value!=='object')throw new Error('Invalid history');
    const {role,text}=value as {role?:unknown;text?:unknown};
    if((role!=='user'&&role!=='assistant')||typeof text!=='string')throw new Error('History text must be a string');
    return {role,text};
  });
}
export function toModelHistory(messages:readonly unknown[]) {
  return toChatHistory(messages).map(({role,text})=>({role,content:text}));
}

