import {NextRequest,NextResponse} from 'next/server';
import {applicationUrl,attachSessionCookie,completeAuthorization,recordError} from '../../../lib/zhihu-auth';
import {recordInteraction} from '../../../lib/database';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:NextRequest){try{const session=await completeAuthorization(request);void recordInteraction(request,{type:'oauth_login_completed',payload:{authorized:true}});const response=NextResponse.redirect(applicationUrl('/?oauth=success',request));attachSessionCookie(response,session);return response;}catch(error){const session=recordError(request,error);void recordInteraction(request,{type:'oauth_login_failed',payload:{error:session.error?.code}});const response=NextResponse.redirect(applicationUrl('/?oauth=error',request));attachSessionCookie(response,session);return response;}}
