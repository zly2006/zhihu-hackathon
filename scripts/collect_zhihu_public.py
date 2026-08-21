"""Capture a small, user-directed set of publicly accessible Zhihu answer pages.

This collector intentionally supports only Zhihu's public English answer pages.
It does not use cookies, login state, private APIs, signature generation, proxy
rotation, or retries. The bounded/manual capture path is separate from the
authorized bulk adapter used for any future licensed collection.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from decision_knowledge.contracts.source_record import SourceRecordV1

USER_AGENT = (
    "DecisionKnowledge/0.1 (user-directed public capture; "
    "+https://github.com/hanhan761/zhihu-competation)"
)
ANSWER_PATH = re.compile(r"^/en/answer/(?P<answer_id>[0-9]+)/?$")
INITIAL_DATA_SCRIPT = re.compile(
    r'<script id=["\']js-initialData["\'][^>]*>(?P<data>.*?)</script>',
    re.DOTALL,
)


class _FragmentTextParser(HTMLParser):
    """Turn an HTML fragment into readable text without losing the fragment."""

    _line_break_tags = frozenset({"br", "div", "li", "p", "section", "tr"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._line_break_tags:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._line_break_tags:
            self._parts.append("\n")

    def text(self) -> str:
        lines = (" ".join(line.split()) for line in "".join(self._parts).splitlines())
        return "\n".join(line for line in lines if line)


def clean_html_fragment(fragment: str) -> str:
    parser = _FragmentTextParser()
    parser.feed(fragment)
    parser.close()
    return parser.text()


def _as_content_data(page_html: str) -> dict[str, Any]:
    match = INITIAL_DATA_SCRIPT.search(page_html)
    if match is None:
        raise ValueError("知乎页面缺少 js-initialData")
    initial_data = json.loads(match.group("data"))
    content_data = initial_data["initialState"]["globalStation"]["contentData"]
    if not isinstance(content_data, dict) or content_data.get("type") != "answer":
        raise ValueError("页面不是可导入的知乎回答")
    return content_data


def _edited_at(value: Any) -> datetime | None:
    if isinstance(value, int | float) and value > 0:
        return datetime.fromtimestamp(value, UTC)
    return None


def _validate_capture_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "www.zhihu.com":
        raise ValueError("只允许 https://www.zhihu.com/en/answer/<id> 页面")
    if ANSWER_PATH.fullmatch(parsed.path) is None:
        raise ValueError("只允许知乎公开 English answer 页面")
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
    source_payload = {
        "capture_method": "public_en_answer_page",
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
                "language": "en-US",
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


def capture_url(url: str, *, timeout: float = 30.0) -> SourceRecordV1:
    validated_url = _validate_capture_url(url)
    request = Request(
        validated_url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
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


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", action="append", required=True, help="公开知乎回答 URL")
    parser.add_argument("--output", type=Path, required=True, help="JSONL 输出路径")
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    records: list[SourceRecordV1] = []
    for url in args.url:
        try:
            record = capture_url(url)
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
