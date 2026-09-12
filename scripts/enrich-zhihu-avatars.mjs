import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const file = 'content/campus-life-events.v1.json';
const zhurl = process.env.ZHURL_BIN || 'zhurl';
const data = JSON.parse(await readFile(file, 'utf8'));
const answerIds = [...new Set(data.events.flatMap((event) => event.zhihuEvidence).map((item) => item.url.match(/answer\/(\d+)/)?.[1]).filter(Boolean))];
const authors = new Map();

for (const answerId of answerIds) {
  const url = `https://www.zhihu.com/api/v4/answers/${answerId}?include=author`;
  let payload;
  try {
    payload = JSON.parse(execFileSync(zhurl, [url], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  } catch (error) {
    throw new Error(`读取回答 ${answerId} 失败。请先让 zhurl 使用已登录账号运行：${error instanceof Error ? error.message : String(error)}`);
  }
  if (payload.error?.need_login) throw new Error('知乎回答接口要求登录，未写入任何头像字段。请先完成 zhurl 登录后重试。');
  const author = payload.author;
  if (!author?.avatar_url) throw new Error(`回答 ${answerId} 没有返回 author.avatar_url，未写入任何头像字段。`);
  authors.set(answerId, { authorAvatarUrl: author.avatar_url, authorProfileUrl: author.url_token ? `https://www.zhihu.com/people/${author.url_token}` : undefined });
}

for (const event of data.events) {
  for (const evidence of event.zhihuEvidence) {
    const answerId = evidence.url.match(/answer\/(\d+)/)?.[1];
    const author = answerId ? authors.get(answerId) : undefined;
    if (author) Object.assign(evidence, author);
  }
  for (const option of event.options) {
    for (const evidence of option.zhihuEvidence) {
      const answerId = evidence.url.match(/answer\/(\d+)/)?.[1];
      const author = answerId ? authors.get(answerId) : undefined;
      if (author) Object.assign(evidence, author);
    }
  }
}

await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(`updated ${authors.size} Zhihu answer avatars in ${file}`);
