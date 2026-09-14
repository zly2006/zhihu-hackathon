import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:3000';
await mkdir('.tmp/human-browser', { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, authorized: true, profile: { name: '体验玩家' }, error: null }) }));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '体验预览' }).click();
  await page.locator('.dialogue-click').waitFor();
  for (let i = 0; i < 20; i++) {
    const choice = page.locator('.choice-option button');
    if (await choice.count()) break;
    await page.locator('.dialogue-click').click();
  }
  const choices = await page.locator('.choice-option button').allTextContents();
  if (!choices.length) throw new Error('体验预览未显示选择');
  await page.locator('.choice-option button').first().click();
  for (let i = 0; i < 20; i++) {
    if (await page.locator('.choice-option button').count()) break;
    await page.locator('.dialogue-click').click();
  }
  await page.getByRole('button', { name: /和.*聊聊/ }).click();
  const chat = page.getByRole('dialog', { name: '自由对话' });
  await chat.waitFor();
  const box = chat.getByRole('textbox');
  const label = await box.getAttribute('aria-label');
  await box.fill('我想听听你的真实想法。');
  await box.press('Enter');
  await chat.getByRole('button', { name: '关闭自由对话' }).click();
  await page.screenshot({ path: '.tmp/human-browser/preview.png', fullPage: true });
  console.log(JSON.stringify({ choices, chatInputLabel: label, consoleErrors: errors }));
} finally {
  await browser.close();
}
