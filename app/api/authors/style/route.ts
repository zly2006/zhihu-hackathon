import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {resolveAuthorAvatar,authorRefForAvatar} from '../../../../lib/author-avatars';
import {AUTHOR_CAST_ID_PATTERN} from '../../../../lib/author-identity';
import {resolveAuthorCastRegistration} from '../../../../lib/author-cast';
import {defaultAuthorRegistryRoot,readInvitedAuthor} from '../../../../lib/author-registry';
import {authorRefBinding} from '../../../../lib/story';
import {modelCredentials} from '../../../../lib/model-config';
import {defaultAuthorDataRoot} from '../../../../lib/author-chat';
import {prepareAuthorStyle} from '../../../../lib/author-style-runtime';
import {requireSession} from '../../../../lib/zhihu-auth';
import type {AuthorRef} from '../../../../lib/author-provider';

export const runtime='nodejs';
export const maxDuration=120;

const schema=z.object({castIds:z.array(z.string().trim().min(1).max(80)).min(1).max(8),force:z.boolean().optional()}).strict();

/** 解析角色 → 作者绑定：注册答主取化身登记，邀请答主取冻结的注册表记录。 */
async function authorTarget(castId:string):Promise<{authorRef:AuthorRef;displayName?:string}|null> {
  const registration=resolveAuthorCastRegistration(castId);
  if(registration){
    const avatar=resolveAuthorAvatar(registration.authorAvatarId);
    if(!avatar)return null;
    return {authorRef:authorRefForAvatar(avatar),displayName:registration.displayName};
  }
  if(!AUTHOR_CAST_ID_PATTERN.test(castId))return null;
  const entry=await readInvitedAuthor(defaultAuthorRegistryRoot(),castId);
  if(!entry)return null;
  return {authorRef:authorRefBinding(entry.urlToken),displayName:entry.source.displayName};
}

/**
 * 选人页确认角色后触发：为每位知乎答主后台归纳语言风格。
 * 请求立即返回，风格卡稍后写入 .data/author-avatars/<token>/style/style-card.json。
 */
export async function POST(req:NextRequest){
  if(req.headers.get('origin')&&new URL(req.headers.get('origin')!).host!==req.headers.get('host'))return NextResponse.json({error:'请求来源不匹配。'},{status:403});
  if(!requireSession(req))return NextResponse.json({error:'知乎登录已失效，请重新登录后继续。'},{status:401});
  const parsed=schema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'请求格式不正确。'},{status:400});
  const credentials=modelCredentials();
  const root=defaultAuthorDataRoot();
  const queued:string[]=[];
  const skipped:string[]=[];
  for(const castId of parsed.data.castIds){
    const target=await authorTarget(castId).catch(()=>null);
    if(!target){skipped.push(castId);continue;}
    queued.push(castId);
    void prepareAuthorStyle(target,{root,credentials,force:parsed.data.force}).catch(()=>undefined);
  }
  return NextResponse.json({queued,skipped},{headers:{'Cache-Control':'no-store'}});
}
