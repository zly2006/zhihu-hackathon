export function canonicalLoginUrlFor(redirectUri:string,currentOrigin:string){
  if(!redirectUri)return null;
  let callback:URL,current:URL;
  try{callback=new URL(redirectUri);current=new URL(currentOrigin);}catch{return null;}
  return current.origin===callback.origin?null:new URL('/api/auth/login',callback.origin);
}
