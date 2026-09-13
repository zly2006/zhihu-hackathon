import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {requireSession} from '../../../lib/zhihu-auth';
import {recordInteraction} from '../../../lib/database';

export const runtime='nodejs';
const schema=z.object({type:z.string().trim().min(1).max(100),storyId:z.string().uuid().optional(),payload:z.record(z.string(),z.unknown()).optional()}).strict();
export async function POST(request:NextRequest){
  if(!requireSession(request))return NextResponse.json({error:'请先登录知乎。'},{status:401});
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'交互记录格式不正确。'},{status:400});
  void recordInteraction(request,parsed.data);
  return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}
