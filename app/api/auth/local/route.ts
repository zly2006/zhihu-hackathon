import {NextRequest,NextResponse} from 'next/server';
import {localModeAvailable} from '../../../../lib/local-mode';
import {attachSessionCookie,createLocalSession,sessionStatus} from '../../../../lib/zhihu-auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function POST(request:NextRequest){
  const headers={'Cache-Control':'no-store'};
  if(!localModeAvailable(request))return NextResponse.json({error:'本地模式仅在本机开发服务器上可用。'},{status:404,headers});
  const origin=request.headers.get('origin');
  // NextURL 会把 127.0.0.1 规范化为 localhost；同源比较应保留浏览器实际访问的 Host。
  const expectedOrigin=`${request.nextUrl.protocol}//${request.headers.get('host')||request.nextUrl.host}`;
  if(origin&&origin!==expectedOrigin)return NextResponse.json({error:'请求来源不匹配。'},{status:403,headers});
  const session=createLocalSession(request);
  const response=NextResponse.json(sessionStatus(request,session),{headers});
  attachSessionCookie(response,session);
  return response;
}
