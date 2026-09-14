import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {NextRequest} from 'next/server';
import {Pool} from 'pg';
import {localModeAvailable} from './local-mode';
import {sessionViewer} from './author-runtime-config';
import {canonicalProfiles,initial} from './story';

const require=createRequire(import.meta.url);
require('../scripts/mock-server-only.cjs');
const auth:typeof import('./zhihu-auth')=require('./zhihu-auth');
const database:typeof import('./database')=require('./database');
const localRoute:typeof import('../app/api/auth/local/route')=require('../app/api/auth/local/route');
const logoutRoute:typeof import('../app/api/auth/logout/route')=require('../app/api/auth/logout/route');

function request(cookie?:string,host='127.0.0.1:3000',extra:Record<string,string>={}){
  return new NextRequest(`http://${host}/api/auth/local`,{method:'POST',headers:{host,...(cookie?{cookie}:{}),...extra}});
}

test('local login requires an explicit click, retains its identity, and logs out without OAuth or database access',async(t)=>{
  const originalEnv={...process.env};
  Object.assign(process.env,{NODE_ENV:'development',LAMPLIGHT_DEV_MODE:'1',LAMPLIGHT_PLAYTEST:'1',ZHIHU_OAUTH_APP_ID:'',ZHIHU_OAUTH_APP_KEY:'',ZHIHU_OAUTH_REDIRECT_URI:'',LAMPLIGHT_DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unavailable'});
  t.after(()=>{process.env=originalEnv;});
  const connect=t.mock.method(Pool.prototype,'connect',()=>{throw new Error('local mode attempted a database connection');});
  const query=t.mock.method(Pool.prototype,'query',()=>{throw new Error('local mode attempted a database query');});
  const upstream=t.mock.method(globalThis,'fetch',()=>{throw new Error('local login attempted OAuth');});

  const before=auth.status(request());
  assert.equal(before.payload.authorized,false,'legacy flags must not silently log in');
  assert.equal(before.payload.configured,false);
  assert.equal(before.payload.localModeAvailable,true);
  const response=localRoute.POST(request(undefined,undefined,{origin:'http://127.0.0.1:3000'}));
  assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie')||'',/HttpOnly/i);
  const cookie=response.headers.get('set-cookie')!.split(';')[0];
  const payload=await response.json();
  assert.equal(payload.authorized,true);
  assert.equal(payload.localMode,true);
  assert.equal(payload.profile.name,'本地开发');
  assert.ok(!('accessToken' in payload));
  assert.equal(auth.status(request(cookie)).payload.profile?.id,payload.profile.id);
  assert.equal(auth.requireSession(request(cookie))?.accessToken,null);
  assert.equal(sessionViewer({...auth.requireSession(request(cookie)),accessToken:'mock-token'}),null);

  const state=initial(canonicalProfiles([{id:'m1',name:'顾言川',gender:'男'},{id:'m3',name:'沈屿',gender:'男'},{id:'f2',name:'陶晚晴',gender:'女'},{id:'f4',name:'苏棠',gender:'女'}]),{backgroundId:'university',playerName:'本地玩家',playerGender:'女',seed:'local-mode'});
  const storyId='ba5d828e-b7e6-40ef-98a2-6728102cdbe4';
  await database.recordInteraction(request(cookie),{type:'local_test',storyId});
  await database.recordChat(request(cookie),{storyId,character:'m1',messages:[{role:'user',text:'你好'}]});
  await database.recordStorySnapshot(request(cookie),storyId,state);
  assert.equal(connect.mock.callCount(),0);
  assert.equal(query.mock.callCount(),0);
  assert.equal(upstream.mock.callCount(),0);

  assert.equal(logoutRoute.POST(request(cookie)).status,200);
  assert.equal(auth.requireSession(request(cookie)),null);
  assert.equal(auth.status(request()).payload.authorized,false);
  const second=localRoute.POST(request());
  assert.notEqual(second.headers.get('set-cookie')!.split(';')[0],cookie,'each login must receive a new session');
  const secondCookie=second.headers.get('set-cookie')!.split(';')[0];
  auth.requireSession(request(secondCookie))!.expiresAt=Date.now()-1;
  assert.equal(auth.requireSession(request(secondCookie)),null);
});

test('local mode rejects nonlocal hosts, cross-origin requests, production and replayed local sessions',async(t)=>{
  const originalEnv={...process.env};
  Object.assign(process.env,{NODE_ENV:'development'});
  t.after(()=>{process.env=originalEnv;});
  for(const host of ['127.0.0.1:3000','localhost:3000','[::1]:3000'])assert.equal(localModeAvailable(request(undefined,host)),true);
  for(const host of ['example.com','192.168.1.10:3000','localhost.example.com']){
    assert.equal(localModeAvailable(request(undefined,host)),false);
    assert.equal(localRoute.POST(request(undefined,host)).status,404);
  }
  assert.equal(localModeAvailable(request(undefined,undefined,{'x-forwarded-host':'public.example.com'})),false);
  assert.equal(localModeAvailable(request(undefined,undefined,{host:'public.example.com'})),false);
  for(const origin of ['https://example.com','null','http://127.0.0.1:4000'])assert.equal(localRoute.POST(request(undefined,undefined,{origin})).status,403);
  const response=localRoute.POST(request());
  const cookie=response.headers.get('set-cookie')!.split(';')[0];
  assert.equal(auth.requireSession(request(cookie,'example.com')),null);
  assert.equal(auth.requireSession(request('lamplight_zhihu_session=playtest-local')),null);
  for(const environment of ['production','test']){
    Object.assign(process.env,{NODE_ENV:environment,LAMPLIGHT_DEV_MODE:'1',LAMPLIGHT_PLAYTEST:'1'});
    assert.equal(localRoute.POST(request()).status,404);
    assert.equal(auth.requireSession(request(cookie)),null);
    assert.equal(auth.status(request(cookie)).payload.localModeAvailable,false);
  }
  // 正式 OAuth 会话仍走原有 token 校验，不受本地模式的开关影响。
  const {session}=auth.status(request());
  session.accessToken='test-oauth-token';
  session.profile={id:'oauth-user',name:'知乎用户',avatarUrl:null,headline:null,url:null};
  const oauthCookie=`lamplight_zhihu_session=${session.id}`;
  assert.equal(auth.requireSession(request(oauthCookie,'example.com'))?.profile?.id,'oauth-user');
  assert.equal(auth.status(request(oauthCookie)).payload.localMode,false);
});

test('completing a real OAuth login replaces the local identity and its storage mode',async(t)=>{
  const originalEnv={...process.env};
  Object.assign(process.env,{NODE_ENV:'development',ZHIHU_OAUTH_APP_ID:'123',ZHIHU_OAUTH_APP_KEY:'test-key',ZHIHU_OAUTH_REDIRECT_URI:'http://127.0.0.1:3000/auth/callback'});
  t.after(()=>{process.env=originalEnv;});
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>String(input).includes('/access_token')
    ?Response.json({access_token:'real-oauth-token',expires_in:3600})
    :Response.json({id:'oauth-user',name:'知乎用户'}));
  const local=localRoute.POST(request());
  const cookie=local.headers.get('set-cookie')!.split(';')[0];
  const {url}=auth.authorizationUrl(request(cookie));
  const state=new URL(url).searchParams.get('state');
  await auth.completeAuthorization(new NextRequest(`http://127.0.0.1:3000/auth/callback?code=test-code&state=${state}`,{headers:{host:'127.0.0.1:3000',cookie}}));
  const session=auth.requireSession(request(cookie));
  assert.equal(session?.localMode,false);
  assert.equal(session?.profile?.id,'oauth-user');
  assert.equal(session?.accessToken,'real-oauth-token');
  assert.ok(!('accessToken' in auth.status(request(cookie)).payload));
});
