import {NextRequest,NextResponse} from 'next/server';
import {applicationUrl,attachSessionCookie,authorizationUrl,canonicalLoginUrl,recordError} from '../../../../lib/zhihu-auth';
import {recordInteraction} from '../../../../lib/database';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function GET(request:NextRequest){try{const canonical=canonicalLoginUrl(request);if(canonical)return NextResponse.redirect(canonical);const {session,url}=authorizationUrl(request);void recordInteraction(request,{type:'oauth_login_started',payload:{}});const response=NextResponse.redirect(url);attachSessionCookie(response,session);return response;}catch(error){const session=recordError(request,error);void recordInteraction(request,{type:'oauth_login_failed',payload:{error:session.error?.code}});const response=NextResponse.redirect(applicationUrl('/?oauth=error',request));attachSessionCookie(response,session);return response;}}
