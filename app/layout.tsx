import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'假如我们的人生 · 知乎互动叙事游戏',description:'你甚至可以在知乎玩galgame！选择一段人生处境，让四个人的关系一起推动答案。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
