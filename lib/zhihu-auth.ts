import 'server-only';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {NextRequest,NextResponse} from 'next/server';
import {canonicalLoginUrlFor} from './oauth-origin';

const COOKIE_NAME='lamplight_zhihu_session';
const SESSION_MAX_AGE_SECONDS=8*60*60;
const USERINFO_DEFAULT_URL='https://openapi.zhihu.com/user';

export type ZhihuProfile={id:string|null;name:string|null;avatarUrl:string|null;headline:string|null;url:string|null};
type AuthError={code:string;message:string};
type Session={id:string;expiresAt:number;oauthState:string|null;accessToken:string|null;tokenExpiresAt:number|null;profile:ZhihuProfile|null;error:AuthError|null};
type SessionStore=Map<string,Session>;
const globalStore=globalThis as typeof globalThis&{lamplightZhihuSessions?:SessionStore};
const sessions=globalStore.lamplightZhihuSessions??=new Map();

function env(name:string){return process.env[name]?.trim()||'';}
function configuration(){
  // The guide calls this credential “Access Secret”. Older project templates
  // used ZHIHU_ACCESS_SECRET, so accept it as a backwards-compatible alias.
  return {
    appId:env('ZHIHU_OAUTH_APP_ID'),
    appKey:env('ZHIHU_OAUTH_APP_KEY'),
    redirectUri:env('ZHIHU_OAUTH_REDIRECT_URI'),
    accessSecret:env('ZHIHU_OAUTH_ACCESS_SECRET')||env('ZHIHU_ACCESS_SECRET'),
    userInfoUrl:env('ZHIHU_OAUTH_USERINFO_URL')||USERINFO_DEFAULT_URL
  };
}
function fail(code:string,message:string){return Object.assign(new Error(message),{code});}
function errorPayload(error:unknown):AuthError{const source=error as {code?:unknown;message?:unknown};return {code:String(source?.code||'OAUTH_FAILED').slice(0,80),message:String(source?.message||'知乎登录失败').slice(0,200)};}
function safe(value:string,label:string){if(!value||/[\r\n]/.test(value))throw fail('CONFIG_INVALID',`${label} 未配置或格式无效`);return value;}
function equal(left:string,right:string){const a=Buffer.from(left);const b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}
function newSession():Session{const id=randomBytes(32).toString('base64url');const session:Session={id,expiresAt:Date.now()+SESSION_MAX_AGE_SECONDS*1000,oauthState:null,accessToken:null,tokenExpiresAt:null,profile:null,error:null};sessions.set(id,session);return session;}
function activeSession(request:NextRequest){const id=request.cookies.get(COOKIE_NAME)?.value;if(!id||!/^[A-Za-z0-9_-]{40,50}$/.test(id))return null;const session=sessions.get(id)||null;if(session&&session.expiresAt<=Date.now()){sessions.delete(id);return null;}if(session?.tokenExpiresAt&&session.tokenExpiresAt<=Date.now()){session.accessToken=null;session.profile=null;session.tokenExpiresAt=null;session.error={code:'TOKEN_EXPIRED',message:'知乎登录已过期，请重新登录'};}return session;}
function getOrCreate(request:NextRequest){const existing=activeSession(request);return existing?{session:existing,created:false}:{session:newSession(),created:true};}
export function attachSessionCookie(response:NextResponse,session:Session){response.cookies.set(COOKIE_NAME,session.id,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:SESSION_MAX_AGE_SECONDS});}
export function clearSession(request:NextRequest){const session=activeSession(request);if(session)sessions.delete(session.id);}
export function applicationUrl(pathname:string,request:NextRequest){const config=configuration();if(config.redirectUri){try{return new URL(pathname,new URL(config.redirectUri).origin);}catch{}}
  const host=request.headers.get('x-forwarded-host')||request.headers.get('host')||request.nextUrl.host;
  const protocol=request.headers.get('x-forwarded-proto')==='https'?'https':request.nextUrl.protocol.replace(':','');
  return new URL(pathname,`${protocol}://${host}`);
}
export function canonicalLoginUrl(request:NextRequest){const config=configuration();const host=request.headers.get('x-forwarded-host')||request.headers.get('host')||request.nextUrl.host;const protocol=request.headers.get('x-forwarded-proto')==='https'?'https':request.nextUrl.protocol.replace(':','');return canonicalLoginUrlFor(config.redirectUri,`${protocol}://${host}`);}
export function currentSession(request:NextRequest){return activeSession(request);}
export function requireSession(request:NextRequest){const session=activeSession(request);return session?.accessToken?session:null;}
export function status(request:NextRequest){const {session,created}=getOrCreate(request);const config=configuration();const missingConfiguration=[!config.appId&&'ZHIHU_OAUTH_APP_ID',!config.appKey&&'ZHIHU_OAUTH_APP_KEY',!config.redirectUri&&'ZHIHU_OAUTH_REDIRECT_URI'].filter((value):value is string=>Boolean(value));return {session,created,payload:{configured:missingConfiguration.length===0,missingConfiguration,authorized:Boolean(session.accessToken),profile:session.profile,expiresAt:session.tokenExpiresAt?new Date(session.tokenExpiresAt).toISOString():null,error:session.error}};}
export function authorizationUrl(request:NextRequest){const {session}=getOrCreate(request);const config=configuration();if(!config.appId||!config.appKey||!config.redirectUri)throw fail('OAUTH_NOT_CONFIGURED','知乎登录尚未完成服务端配置');if(!/^\d+$/.test(config.appId))throw fail('APP_ID_INVALID','知乎 OAuth App ID 格式无效');let redirect:URL;try{redirect=new URL(config.redirectUri);}catch{throw fail('REDIRECT_URI_INVALID','知乎 OAuth 回调地址格式无效');}if(!['http:','https:'].includes(redirect.protocol)||!redirect.pathname.endsWith('/auth/callback'))throw fail('REDIRECT_URI_INVALID','知乎 OAuth 回调地址必须指向 /auth/callback');session.oauthState=randomBytes(24).toString('base64url');session.error=null;const url=new URL('https://openapi.zhihu.com/authorize');url.searchParams.set('redirect_uri',config.redirectUri);url.searchParams.set('app_id',config.appId);url.searchParams.set('response_type','code');url.searchParams.set('state',session.oauthState);return {session,url:url.toString()};}
async function jsonBody(response:Response){const text=await response.text();try{return text?JSON.parse(text) as Record<string,unknown>:{};}catch{return {message:text.slice(0,200)};}}
function messageFrom(body:Record<string,unknown>,fallback:string){const data=body.data as Record<string,unknown>|undefined;return String(body.message||body.error_description||data?.message||fallback);}
function profileFrom(body:Record<string,unknown>):ZhihuProfile|null{const source=(body.data||body.user||body) as Record<string,unknown>;if(!source||typeof source!=='object')return null;const value=(...keys:string[])=>{for(const key of keys){const item=source[key];if(typeof item==='string'&&item.trim())return item.trim();}return null;};const profile={id:value('id','url_token','user_url_token','uid'),name:value('name','fullname','full_name'),avatarUrl:value('avatar_url','avatarUrl','avatar'),headline:value('headline','bio','description'),url:value('url','profile_url')};return profile.id||profile.name?profile:null;}
async function fetchProfile(config:ReturnType<typeof configuration>,token:string){const url=new URL(config.userInfoUrl);if(url.protocol!=='https:')throw fail('USERINFO_URL_INVALID','知乎用户信息地址必须使用 HTTPS');const attempts:[Record<string,string>,string][]=[[{'Authorization':`Bearer ${token}`,'Accept':'application/json'},'token']];if(config.accessSecret)attempts.push([{'Authorization':`Bearer ${config.accessSecret}`,'X-OAuth-Token':token,'X-Request-Timestamp':String(Math.floor(Date.now()/1000)),'Accept':'application/json'},'access-secret']);let last='知乎用户信息接口调用失败';for(const [headers,label] of attempts){const response=await fetch(url,{headers,signal:AbortSignal.timeout(20_000),cache:'no-store'});const body=await jsonBody(response);if(response.ok){const profile=profileFrom(body);if(profile)return profile;last=`${label} 鉴权成功但返回中没有用户资料`;continue;}last=messageFrom(body,`知乎用户信息接口 HTTP ${response.status}`);}throw fail('USERINFO_FAILED',last);}
export async function completeAuthorization(request:NextRequest){const session=activeSession(request);if(!session?.oauthState)throw fail('SESSION_MISSING','登录会话已失效，请重新发起知乎授权');const config=configuration();const providerError=request.nextUrl.searchParams.get('error');if(providerError)throw fail('AUTH_DENIED',`知乎授权未完成：${providerError}`);const code=request.nextUrl.searchParams.get('authorization_code')||request.nextUrl.searchParams.get('code')||'';const returnedState=request.nextUrl.searchParams.get('state')||'';if(!code)throw fail('CODE_MISSING','知乎回调缺少 authorization_code');if(returnedState&&!equal(returnedState,session.oauthState))throw fail('STATE_MISMATCH','知乎登录 state 校验失败');const form=new URLSearchParams({app_id:safe(config.appId,'OAuth App ID'),app_key:safe(config.appKey,'OAuth App Key'),grant_type:'authorization_code',redirect_uri:safe(config.redirectUri,'OAuth Redirect URI'),code:safe(code,'authorization code')});const response=await fetch('https://openapi.zhihu.com/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(20_000),cache:'no-store'});const body=await jsonBody(response);const token=typeof body.access_token==='string'?body.access_token:typeof (body.data as Record<string,unknown>|undefined)?.access_token==='string'?(body.data as Record<string,string>).access_token:'';if(!response.ok||!token)throw fail('TOKEN_FAILED',messageFrom(body,`知乎 token 接口 HTTP ${response.status}`));const expiresIn=Number(body.expires_in??(body.data as Record<string,unknown>|undefined)?.expires_in);session.accessToken=token;session.tokenExpiresAt=Number.isFinite(expiresIn)&&expiresIn>0?Date.now()+expiresIn*1000:null;session.oauthState=null;session.error=null;session.profile=await fetchProfile(config,token);return session;}
export function recordError(request:NextRequest,error:unknown){const {session}=getOrCreate(request);session.error=errorPayload(error);session.oauthState=null;return session;}
