import {chromium} from 'playwright';
import path from 'node:path';

const base='http://127.0.0.1:3000';
const root=process.cwd();
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1536,height:864},deviceScaleFactor:1});
  const errors=[];page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'开始体验'}).click();
  await page.locator('.dialogue-panel').waitFor();
  await page.locator('.dialogue-click').click();
  await page.screenshot({path:path.join(root,'galgame-ui-preview.png'),type:'png'});
  for(let i=0;i<16;i++)await page.locator('.dialogue-click').click();
  await page.locator('.choice-card').waitFor();
  await page.getByRole('button',{name:'陪见夏整理窗边的画纸'}).click();
  await page.locator('.dialogue-panel').waitFor();
  await page.getByRole('button',{name:'和她聊聊'}).click();
  await page.getByRole('dialog',{name:'自由对话'}).waitFor();
  const text=page.getByRole('textbox',{name:'想对她说的话'});await text.fill('窗外的雨好像小了一点。');await text.press('Enter');
  await page.getByText('雨看起来小了一点。').waitFor();
  await page.getByRole('button',{name:'关闭自由对话'}).click();
  await page.getByRole('button',{name:'存档'}).click();
  await page.getByRole('button',{name:'保存到位置 1'}).click();
  await page.getByText('已保存到位置 01').waitFor();
  await page.setViewportSize({width:844,height:390});
  await page.locator('.dialogue-panel').waitFor();
  if(errors.length)throw new Error(`浏览器控制台错误：${errors.join(' | ')}`);
  console.log('UI smoke passed; preview:',path.join(root,'galgame-ui-preview.png'));
}finally{await browser.close();}
