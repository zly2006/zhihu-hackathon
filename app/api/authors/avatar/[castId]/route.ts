import {NextRequest,NextResponse} from 'next/server';
import {resolveAuthorAvatar} from '../../../../../lib/author-avatars';
import {resolveAuthorCastRegistration} from '../../../../../lib/author-cast';
import {AUTHOR_CAST_ID_PATTERN} from '../../../../../lib/author-identity';
import {defaultAuthorRegistryRoot,readInvitedAuthor} from '../../../../../lib/author-registry';
import {cachedOrFetchAvatar} from '../../../../../lib/author-avatar-cache';
import {defaultAuthorDataRoot} from '../../../../../lib/author-chat';

export const runtime='nodejs';

/** 只用服务端已知的作者来源取头像；客户端永远不能指定 URL 或路径。 */
async function sourceFor(castId:string):Promise<{urlToken:string;sourceUrl?:string}|null> {
  const registration=resolveAuthorCastRegistration(castId);
  if(registration){
    const avatar=resolveAuthorAvatar(registration.authorAvatarId);
    return avatar?{urlToken:avatar.sourceAuthorUrlToken,sourceUrl:avatar.sourceAuthorAvatarUrl}:null;
  }
  if(!AUTHOR_CAST_ID_PATTERN.test(castId))return null;
  const entry=await readInvitedAuthor(defaultAuthorRegistryRoot(),castId);
  return entry?{urlToken:entry.urlToken,sourceUrl:entry.source.avatarUrl}:null;
}

export async function GET(_req:NextRequest,ctx:{params:Promise<{castId:string}>}){
  const {castId}=await ctx.params;
  const source=await sourceFor(String(castId)).catch(()=>null);
  if(!source)return new NextResponse(null,{status:404});
  const avatar=await cachedOrFetchAvatar({root:defaultAuthorDataRoot(),urlToken:source.urlToken,sourceUrl:source.sourceUrl});
  if(!avatar)return new NextResponse(null,{status:404});
  return new NextResponse(new Uint8Array(avatar.bytes),{
    headers:{
      'Content-Type':avatar.contentType,
      'Content-Length':String(avatar.bytes.byteLength),
      'Cache-Control':'public, max-age=86400, immutable',
    },
  });
}
