"""Capture a small, user-directed set of publicly accessible Zhihu answer pages.

This collector intentionally supports only bounded Zhihu answer captures. The
default path uses public English answer pages; a user-supplied local Cookie file
may be used for the corresponding original answer page. It never writes or
prints Cookie contents, calls private APIs, generates signatures, rotates
proxies, or retries. The bounded/manual capture path is separate from the
authorized bulk adapter used for any future licensed collection.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.ingest.html_text import html_fragment_to_text

USER_AGENT = (
    "DecisionKnowledge/0.1 (user-directed public capture; "
    "+https://github.com/hanhan761/zhihu-competation)"
)
ANSWER_PATH = re.compile(r"^/en/answer/(?P<answer_id>[0-9]+)/?$")
INITIAL_DATA_SCRIPT = re.compile(
    r'<script id=["\']js-initialData["\'][^>]*>(?P<data>.*?)</script>',
    re.DOTALL,
)


def clean_html_fragment(fragment: str) -> str:
    return html_fragment_to_text(fragment)


def _as_content_data(page_html: str) -> dict[str, Any]:
    match = INITIAL_DATA_SCRIPT.search(page_html)
    if match is None:
        raise ValueError("知乎页面缺少 js-initialData")
    initial_data = json.loads(match.group("data"))
    initial_state = initial_data["initialState"]
    content_data = initial_state.get("globalStation", {}).get("contentData")
    if not isinstance(content_data, dict):
        content_data = _original_answer_content_data(initial_state)
    if not isinstance(content_data, dict) or content_data.get("type") != "answer":
        raise ValueError("页面不是可导入的知乎回答")
    return content_data


def _original_answer_content_data(initial_state: dict[str, Any]) -> dict[str, Any]:
    entities = initial_state.get("entities")
    answers = entities.get("answers") if isinstance(entities, dict) else None
    if not isinstance(answers, dict) or len(answers) != 1:
        raise ValueError("知乎原始页面缺少唯一回答实体")
    answer = next(iter(answers.values()))
    if not isinstance(answer, dict):
        raise ValueError("知乎原始页面回答实体格式错误")
    question = answer.get("question")
    if not isinstance(question, dict):
        raise ValueError("知乎原始页面缺少问题实体")
    answer_id = str(answer.get("id", ""))
    question_id = str(question.get("id", ""))
    if not answer_id or not question_id:
        raise ValueError("知乎原始页面缺少回答或问题 ID")
    return {
        "author": answer.get("author"),
        "id": answer_id,
        "type": "answer",
        "url": f"https://www.zhihu.com/answer/{answer_id}",
        "originalPageUrl": f"https://www.zhihu.com/answer/{answer_id}",
        "title": str(question.get("title", "")),
        "summary": answer.get("excerpt", ""),
        "content": answer.get("content", ""),
        "editedTime": answer.get("updatedTime"),
        "keywords": [],
        "topics": [],
        "upvotedNum": answer.get("voteupCount"),
        "parentId": question_id,
    }


def _edited_at(value: Any) -> datetime | None:
    if isinstance(value, int | float) and value > 0:
        return datetime.fromtimestamp(value, UTC)
    return None


def _validate_capture_url(url: str, *, allow_authenticated_original: bool = False) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "www.zhihu.com":
        raise ValueError("只允许 https://www.zhihu.com/answer/<id> 页面")
    if ANSWER_PATH.fullmatch(parsed.path) is None:
        original_path = re.fullmatch(r"/answer/[0-9]+/?", parsed.path)
        if not (allow_authenticated_original and original_path is not None):
            raise ValueError("只允许知乎公开 English answer 页面，或 Cookie 授权的原始回答页面")
    return url


def build_source_record(
    *,
    fetch_url: str,
    final_url: str,
    fetched_at: datetime,
    page_bytes: bytes,
    content_data: dict[str, Any],
) -> SourceRecordV1:
    answer_id = str(content_data["id"])
    question_id = str(content_data["parentId"])
    fragment = str(content_data["content"])
    if not fragment.strip():
        raise ValueError(f"回答 {answer_id} 没有正文 HTML 片段")
    title = str(content_data["title"]).strip()
    body = clean_html_fragment(fragment)
    if not title or not body:
        raise ValueError(f"回答 {answer_id} 没有可用标题或正文")

    original_url = str(
        content_data.get("originalPageUrl")
        or content_data.get("url")
        or final_url
    )
    edited_at = _edited_at(content_data.get("editedTime"))
    response_sha256 = hashlib.sha256(page_bytes).hexdigest()
    capture_method = (
        "cookie_authenticated_answer_page"
        if urlparse(fetch_url).path.startswith("/answer/")
        else "public_en_answer_page"
    )
    source_payload = {
        "capture_method": capture_method,
        "fetch_url": fetch_url,
        "final_url": final_url,
        "original_page_url": original_url,
        "answer_id": answer_id,
        "question_id": question_id,
        "response_sha256": response_sha256,
        "fragment_sha256": hashlib.sha256(fragment.encode("utf-8")).hexdigest(),
        "edited_time": content_data.get("editedTime"),
        "keywords": content_data.get("keywords", []),
        "upvoted_num": content_data.get("upvotedNum"),
    }
    return SourceRecordV1.model_validate(
        {
            "schema_version": "source_record.v1",
            "source": {
                "code": "zhihu",
                "adapter_code": "manual_url_capture",
                "adapter_version": "1.0.0",
                "authorization_ref": None,
            },
            "external_ref": {
                "type": "answer",
                "id": answer_id,
                "parent": {"type": "question", "id": question_id},
            },
            "canonical_url": original_url,
            "fetched_at": fetched_at,
            "source_created_at": None,
            "source_updated_at": edited_at,
            "availability": "AVAILABLE",
            "content": {
                "title": title,
                "body_format": "HTML",
                "body": body,
                "raw_html": fragment,
                "language": "zh-CN"
                if capture_method == "cookie_authenticated_answer_page"
                else "en-US",
            },
            "topics": [],
            "engagement": {
                "observed_at": fetched_at,
                "voteup_count": content_data.get("upvotedNum"),
                "comment_count": None,
                "thanks_count": None,
            },
            "restricted_author": (
                {"external_id": str(content_data["author"]["id"])}
                if isinstance(content_data.get("author"), dict)
                and content_data["author"].get("id")
                else None
            ),
            "raw": {"sha256": response_sha256, "payload": source_payload},
        }
    )


def capture_url(
    url: str,
    *,
    cookie_file: Path | None = None,
    timeout: float = 30.0,
) -> SourceRecordV1:
    validated_url = _validate_capture_url(
        url, allow_authenticated_original=cookie_file is not None
    )
    request = Request(
        validated_url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": USER_AGENT,
        },
    )

    if cookie_file is not None:
        page_bytes, final_url = _fetch_with_curl(
            validated_url, cookie_file=cookie_file, timeout=timeout
        )
        page_html = page_bytes.decode("utf-8", errors="replace")
        return build_source_record(
            fetch_url=validated_url,
            final_url=final_url,
            fetched_at=datetime.now(UTC),
            page_bytes=page_bytes,
            content_data=_as_content_data(page_html),
        )

    return _capture_without_cookie(
        validated_url, request=request, timeout=timeout
    )


def _capture_without_cookie(
    validated_url: str, *, request: Request, timeout: float
) -> SourceRecordV1:
    try:
        with build_opener().open(request, timeout=timeout) as response:
            page_bytes = response.read()
            final_url = response.geturl()
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError(f"抓取 {validated_url} 失败: {exc}") from exc

    page_html = page_bytes.decode("utf-8", errors="replace")
    return build_source_record(
        fetch_url=validated_url,
        final_url=final_url,
        fetched_at=datetime.now(UTC),
        page_bytes=page_bytes,
        content_data=_as_content_data(page_html),
    )


def _fetch_with_curl(
    url: str, *, cookie_file: Path, timeout: float
) -> tuple[bytes, str]:
    if not cookie_file.is_file():
        raise ValueError(f"Cookie 文件不存在: {cookie_file}")
    curl = "curl.exe" if os.name == "nt" else "curl"
    with tempfile.NamedTemporaryFile(prefix="decision-knowledge-zhihu-", delete=False) as temp:
        response_path = Path(temp.name)
    try:
        result = subprocess.run(
            [
                curl,
                "--fail",
                "--location",
                "--compressed",
                "--silent",
                "--show-error",
                "--max-time",
                str(int(timeout)),
                "--cookie",
                str(cookie_file),
                "--user-agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "--header",
                "Accept-Language: zh-CN,zh;q=0.9,en;q=0.5",
                "--output",
                str(response_path),
                "--write-out",
                "%{url_effective}",
                url,
            ],
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"抓取 {url} 失败: curl exit {result.returncode}")
        final_url = result.stdout.decode("utf-8", errors="replace").strip()
        return response_path.read_bytes(), final_url or url
    finally:
        response_path.unlink(missing_ok=True)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", action="append", required=True, help="公开知乎回答 URL")
    parser.add_argument("--output", type=Path, required=True, help="JSONL 输出路径")
    parser.add_argument(
        "--cookie-file",
        type=Path,
        help="可选的本机 Netscape Cookie 文件；只用于原始回答页，不会写入输出",
    )
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    records: list[SourceRecordV1] = []
    for url in args.url:
        try:
            record = capture_url(url, cookie_file=args.cookie_file)
        except (ValueError, RuntimeError, KeyError, json.JSONDecodeError) as exc:
            print(f"ERROR {url}: {exc}", file=sys.stderr)
            return 1
        records.append(record)
        print(
            f"CAPTURED answer={record.external_ref.id} "
            f"url={record.canonical_url} raw_html_chars={len(record.content.raw_html or '')}"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(record.model_dump_json() + "\n" for record in records),
        encoding="utf-8",
    )
    print(f"WROTE records={len(records)} path={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
