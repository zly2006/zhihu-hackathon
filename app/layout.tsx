import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'此间 · 人生阶段互动故事',description:'先选择一段人生处境，再让四个人的关系一起推动答案。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
