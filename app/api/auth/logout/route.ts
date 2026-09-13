import {NextRequest,NextResponse} from 'next/server';
import {clearSession} from '../../../../lib/zhihu-auth';
import {recordInteraction} from '../../../../lib/database';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function POST(request:NextRequest){void recordInteraction(request,{type:'oauth_logout',payload:{}});clearSession(request);const response=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});response.cookies.delete('lamplight_zhihu_session');return response;}
