import type {AuthorAnswer} from './author-corpus';

export type AuthorEvidence={id:string;answerId:string;authorName:string;authorUrlToken:string;title:string;sourceUrl:string;text:string;completeness:string};
type Options={authorUrlToken:string;query:string;sizeBudget:number;budgetUnit:'utf8-bytes'|'tokens';measureInput?: (serialized:string)=>number;maxItems?:number};
type Result={status:'matched'|'no-match'|'budget-exceeded';items:AuthorEvidence[];inputSize:number;budgetUnit:Options['budgetUnit']};
function terms(text:string):Set<string>{
  const result=new Set<string>();
  for(const run of text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu)||[]){
    if(/^[a-z0-9]+$/.test(run)){result.add(run);continue;}
    const chars=Array.from(run);for(let i=0;i<chars.length-1;i++)result.add(chars[i]+chars[i+1]);
  }
  return result;
}
function requiredTermMatches(termCount:number){
  if(termCount<=1)return 1;
  return termCount<=8?2:3;
}
export function retrieveAuthorEvidence(answers:readonly AuthorAnswer[],options:Options):Result{
  if(typeof options.measureInput!=='function')throw new Error('Evidence input size counter is required');
  if(!Number.isSafeInteger(options.sizeBudget)||options.sizeBudget<2||options.sizeBudget>100_000)throw new Error('Invalid evidence budget');
  const count=(value:unknown)=>{const size=options.measureInput!(JSON.stringify(value));if(!Number.isSafeInteger(size)||size<0)throw new Error('Invalid input size count');return size;};
  const emptySize=count([]);const queryTerms=terms(options.query);
  const empty=(status:Result['status']):Result=>({status,items:[],inputSize:emptySize,budgetUnit:options.budgetUnit});
  if(!queryTerms.size)return empty('no-match');
  const requiredMatches=requiredTermMatches(queryTerms.size);
  const seen=new Set<string>();const ranked:{item:AuthorEvidence;score:number}[]=[];
  for(const answer of answers){
    if(answer.authorUrlToken!==options.authorUrlToken||seen.has(answer.answerId))continue;seen.add(answer.answerId);
    const paragraphs=answer.body.split(/\r?\n+/).map(p=>p.trim()).filter(Boolean);
    for(let i=0;i<paragraphs.length;i++){
      const text=paragraphs[i];const bodyTerms=terms(text);const titleTerms=terms(answer.questionTitle);
      let score=0;let matches=0;for(const term of queryTerms){const inBody=bodyTerms.has(term);const inTitle=titleTerms.has(term);if(inBody||inTitle)matches+=1;score+=(inBody?2:0)+(inTitle?1:0);}
      if(matches<requiredMatches)continue;
      ranked.push({score,item:{id:`${answer.answerId}:p${i+1}`,answerId:answer.answerId,authorName:answer.authorName,authorUrlToken:answer.authorUrlToken,title:answer.questionTitle,sourceUrl:answer.sourceUrl,text,completeness:answer.completeness}});
    }
  }
  ranked.sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
  if(!ranked.length)return empty('no-match');
  const limit=options.maxItems??5;if(!Number.isSafeInteger(limit)||limit<1||limit>5)throw new Error('Invalid evidence item limit');
  const items:AuthorEvidence[]=[];const perAnswer=new Map<string,number>();
  for(const {item} of ranked.slice(0,20)){
    if(items.length>=limit)break;
    if((perAnswer.get(item.answerId)||0)>=2||(!perAnswer.has(item.answerId)&&perAnswer.size>=3))continue;
    if(count([...items,item])>options.sizeBudget)continue;
    items.push(item);perAnswer.set(item.answerId,(perAnswer.get(item.answerId)||0)+1);
  }
  return items.length?{status:'matched',items,inputSize:count(items),budgetUnit:options.budgetUnit}:empty('budget-exceeded');
}
