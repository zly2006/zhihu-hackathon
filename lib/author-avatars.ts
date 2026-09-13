export type AuthorAvatar = {
  id:string; displayName:string; sourceAuthorName:string; sourceAuthorUrlToken:string;
  sourceAuthorProfileUrl:string; status:'evidence-only'; styleStatus:'unreviewed';
};
const avatar:Readonly<AuthorAvatar> = Object.freeze({
  id:'zhao-ling',displayName:'泠泠',sourceAuthorName:'赵泠',sourceAuthorUrlToken:'MarryMea',
  sourceAuthorProfileUrl:'https://www.zhihu.com/people/MarryMea',
  status:'evidence-only',styleStatus:'unreviewed',
});
const aliases=new Set(['zhao-ling','赵泠','泠泠','MarryMea']);
export function resolveAuthorAvatar(value:unknown):Readonly<AuthorAvatar>|undefined {
  return typeof value==='string'&&aliases.has(value.trim())?avatar:undefined;
}

