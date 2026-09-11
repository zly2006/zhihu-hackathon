import 'server-only';

export const deepseekModel=process.env.DEEPSEEK_MODEL||'deepseek-chat';
export function deepseekCredentials(){
 const key=process.env.DEEPSEEK_API_KEY;
 if(!key)throw new Error('服务端尚未配置 DEEPSEEK_API_KEY');
 return {key,endpoint:process.env.DEEPSEEK_ENDPOINT||'https://api.deepseek.com/v1/chat/completions'};
}
