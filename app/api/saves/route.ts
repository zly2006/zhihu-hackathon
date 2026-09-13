import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {readState} from '../../../lib/storage';
import {publicState} from '../../../lib/story';
import {requireSession} from '../../../lib/zhihu-auth';
import {recordInteraction} from '../../../lib/database';

const schema=z.object({storyId:z.string().uuid()}).strict();
export async function POST(req:NextRequest){
 if(req.headers.get('origin')&&new URL(req.headers.get('origin')!).host!==req.headers.get('host'))return NextResponse.json({error:'请求来源不匹配。'},{status:403});
 if(!requireSession(req))return NextResponse.json({error:'请先登录知乎。'},{status:401});
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'存档标识无效。'},{status:400});
 const state=await readState(parsed.data.storyId);if(!state)return NextResponse.json({error:'剧情存档不可用。'},{status:404});
 void recordInteraction(req,{type:'save_snapshot',storyId:parsed.data.storyId,payload:{nodes:state.nodes.length,selections:state.selections.length}});
 return NextResponse.json({storyId:parsed.data.storyId,state:publicState(state)},{headers:{'Cache-Control':'no-store'}});
}
