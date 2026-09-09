import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'留一盏灯 · 雨夜短篇',description:'读一小段故事，做一个自己的选择。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
