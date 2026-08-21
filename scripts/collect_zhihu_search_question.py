"""Collect bounded Zhihu answers through search, question feeds, and answer APIs.

The command delegates requests to ``zhurl`` by default. A user-provided local
Netscape Cookie file can be selected explicitly for the same three API calls;
the unsigned mode passes it to curl, while the signed mode creates a temporary
zhurl account. In both modes it never enters a SourceRecord, log, or database.
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
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from uuid import uuid4

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.ingest.html_text import html_fragment_to_text
from decision_knowledge.ingest.quality import (
    QualityAssessment,
    assess_answer_quality,
    extract_keyword_candidate_sources,
    extract_keyword_candidates,
    suggest_queries,
)

ADAPTER_CODE = "zhihu_search_question_api"
ADAPTER_VERSION = "1.0.0"
SEARCH_ENDPOINT = "https://www.zhihu.com/api/v4/search_v3"
QUESTION_FEEDS_ENDPOINT = "https://www.zhihu.com/api/v4/questions/{question_id}/feeds"
ANSWER_ENDPOINT = "https://www.zhihu.com/api/v4/answers/{answer_id}"
ANSWER_INCLUDE = ",".join(
    (
        "content",
        "excerpt",
        "thanks_count",
        "voteup_count",
        "comment_count",
        "question.topics",
        "author.badge_v2",
    )
)

FetchJson = Callable[[str], dict[str, Any]]


def _search_url(query: str, *, limit: int) -> str:
    params = {
        "q": query,
        "t": "general",
        "correction": 1,
        "offset": 0,
        "limit": limit,
        "search_source": "Normal",
        "vertical": "answer",
        "include": "data[*].highlight,object,type",
    }
    return f"{SEARCH_ENDPOINT}?{urlencode(params)}"


def _question_feeds_url(question_id: str, *, limit: int) -> str:
    params = {
        "limit": limit,
        "order": "default",
        "offset": 0,
        "include": "data[*].content,excerpt,headline,target.author.badge_v2",
    }
    return f"{QUESTION_FEEDS_ENDPOINT.format(question_id=question_id)}?{urlencode(params)}"


def _answer_url(answer_id: str) -> str:
    return f"{ANSWER_ENDPOINT.format(answer_id=answer_id)}?{urlencode({'include': ANSWER_INCLUDE})}"


def _object(value: object) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _items(payload: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    data = payload.get("data")
    if not isinstance(data, list):
        return ()
    return tuple(item for item in data if isinstance(item, dict))


def _question_id(search_result: dict[str, Any]) -> str | None:
    result_object = _object(search_result.get("object"))
    if result_object is None:
        return None
    if result_object.get("type") == "question" and result_object.get("id") is not None:
        return str(result_object["id"])
    question = _object(result_object.get("question"))
    if question and question.get("id") is not None:
        return str(question["id"])
    match = re.search(r"/question/(?P<question_id>[0-9]+)", str(result_object.get("url", "")))
    if match:
        return match.group("question_id")
    return None


def _answer_id(feed_item: dict[str, Any]) -> str | None:
    target = _object(feed_item.get("target"))
    if target and target.get("type") == "answer" and target.get("id") is not None:
        return str(target["id"])
    return None


def _timestamp(value: object) -> datetime | None:
    if isinstance(value, int | float) and value > 0:
        return datetime.fromtimestamp(value, UTC)
    return None


def _count(value: object) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None


def _canonical_json(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _build_record(
    *,
    query: str,
    authorization_ref: str,
    fetched_at: datetime,
    search_url: str,
    question_feed_url: str,
    answer_url: str,
    search_payload: dict[str, Any],
    question_feed_payload: dict[str, Any],
    search_result: dict[str, Any],
    question_feed_item: dict[str, Any],
    answer_detail: dict[str, Any],
    answer_capture: str,
    quality: QualityAssessment,
    discovery_round: int,
    discovery_run_id: str | None,
) -> SourceRecordV1:
    answer_id = str(answer_detail.get("id", "")).strip()
    question = _object(answer_detail.get("question"))
    question_id = str(question.get("id", "")).strip() if question else ""
    title = str(question.get("title", "")).strip() if question else ""
    raw_html = str(answer_detail.get("content", "")).strip()
    body = html_fragment_to_text(raw_html)
    if not answer_id or not question_id or not title or not raw_html or not body:
        raise ValueError("回答详情缺少回答 ID、问题、标题或正文")

    topics: list[dict[str, str]] = []
    raw_topics = question.get("topics") if question else None
    if isinstance(raw_topics, list):
        for raw_topic in raw_topics:
            topic = _object(raw_topic)
            if topic and topic.get("id") and topic.get("name"):
                topics.append(
                    {"external_id": str(topic["id"]), "name": str(topic["name"])}
                )

    author = _object(answer_detail.get("author"))
    author_id = str(author.get("id", "")).strip() if author else ""
    raw_payload = {
        "capture_method": ADAPTER_CODE,
        "query": query,
        "discovery_round": discovery_round,
        "quality": quality.as_dict(),
        "keyword_candidates": list(extract_keyword_candidates(answer_detail)),
        "keyword_candidate_sources": [
            {"term": term, "origin": origin}
            for term, origin in extract_keyword_candidate_sources(answer_detail)
        ],
        "endpoints": {
            "search": search_url,
            "question_feed": question_feed_url,
            "answer": answer_url,
        },
        "answer_capture": answer_capture,
        "api_responses": {
            "search": search_payload,
            "question_feed": question_feed_payload,
            "answer_detail": answer_detail,
        },
        "matched_items": {
            "search_result": search_result,
            "question_feed_item": question_feed_item,
        },
    }
    if discovery_run_id:
        raw_payload["discovery_run_id"] = discovery_run_id
    response_sha256 = hashlib.sha256(_canonical_json(raw_payload)).hexdigest()
    return SourceRecordV1.model_validate(
        {
            "schema_version": "source_record.v1",
            "source": {
                "code": "zhihu",
                "adapter_code": ADAPTER_CODE,
                "adapter_version": ADAPTER_VERSION,
                "authorization_ref": authorization_ref,
            },
            "external_ref": {
                "type": "answer",
                "id": answer_id,
                "parent": {"type": "question", "id": question_id},
            },
            "canonical_url": f"https://www.zhihu.com/answer/{answer_id}",
            "fetched_at": fetched_at,
            "source_created_at": _timestamp(answer_detail.get("created_time")),
            "source_updated_at": _timestamp(answer_detail.get("updated_time")),
            "availability": "AVAILABLE",
            "content": {
                "title": title,
                "body_format": "HTML",
                "body": body,
                "raw_html": raw_html,
                "language": "zh-CN",
            },
            "topics": topics,
            "engagement": {
                "observed_at": fetched_at,
                "voteup_count": _count(answer_detail.get("voteup_count")),
                "comment_count": _count(answer_detail.get("comment_count")),
                "thanks_count": _count(answer_detail.get("thanks_count")),
            },
            "restricted_author": {"external_id": author_id} if author_id else None,
            "raw": {"sha256": response_sha256, "payload": raw_payload},
        }
    )


def _collect_question_answers(
    question_id: str,
    *,
    query: str,
    authorization_ref: str,
    fetched_at: datetime,
    max_answers_per_question: int,
    max_candidates_per_question: int,
    fetch_json: FetchJson,
    use_feed_content: bool,
    search_url: str,
    search_payload: dict[str, Any],
    search_result: dict[str, Any],
    discovery_round: int,
    discovery_run_id: str | None,
) -> tuple[SourceRecordV1, ...]:
    feed_url = _question_feeds_url(
        question_id,
        limit=max_candidates_per_question,
    )
    try:
        feed_payload = fetch_json(feed_url)
    except RuntimeError:
        return ()
    records: list[SourceRecordV1] = []
    seen_answers: set[str] = set()
    accepted = 0
    inspected = 0
    for feed_item in _items(feed_payload):
        target = _object(feed_item.get("target"))
        answer_id = _answer_id(feed_item)
        if not answer_id or answer_id in seen_answers:
            continue
        seen_answers.add(answer_id)
        inspected += 1
        answer_url = _answer_url(answer_id)
        if use_feed_content:
            if target is None:
                continue
            answer_detail = target
            answer_capture = "question_feed_target"
        else:
            try:
                answer_detail = fetch_json(answer_url)
            except RuntimeError:
                continue
            answer_capture = "answer_detail_api"
        quality = assess_answer_quality(answer_detail)
        if not quality.accepted:
            if inspected >= max_candidates_per_question:
                break
            continue
        records.append(
            _build_record(
                query=query,
                authorization_ref=authorization_ref,
                fetched_at=fetched_at,
                search_url=search_url,
                question_feed_url=feed_url,
                answer_url=answer_url,
                search_payload=search_payload,
                question_feed_payload=feed_payload,
                search_result=search_result,
                question_feed_item=feed_item,
                answer_detail=answer_detail,
                answer_capture=answer_capture,
                quality=quality,
                discovery_round=discovery_round,
                discovery_run_id=discovery_run_id,
            )
        )
        accepted += 1
        if accepted >= max_answers_per_question:
            break
        if inspected >= max_candidates_per_question:
            break
    return tuple(records)


def collect_question(
    question_id: str,
    *,
    authorization_ref: str,
    fetched_at: datetime,
    max_answers_per_question: int,
    max_candidates_per_question: int | None = None,
    fetch_json: FetchJson,
    use_feed_content: bool = False,
    discovery_round: int = 0,
    discovery_run_id: str | None = None,
) -> tuple[SourceRecordV1, ...]:
    """Start from one question ID and collect its highest-ranked answers."""

    normalized_id = question_id.strip()
    if not normalized_id:
        raise ValueError("问题 ID 不能为空")
    if not normalized_id.isdecimal():
        raise ValueError("问题 ID 必须是数字")
    if max_answers_per_question < 1:
        raise ValueError("每题回答数必须大于零")
    candidate_limit = max_candidates_per_question or max_answers_per_question * 3
    if candidate_limit < 1:
        raise ValueError("候选回答数必须大于零")
    return _collect_question_answers(
        normalized_id,
        query=f"question:{normalized_id}",
        authorization_ref=authorization_ref,
        fetched_at=fetched_at,
        max_answers_per_question=max_answers_per_question,
        max_candidates_per_question=candidate_limit,
        fetch_json=fetch_json,
        use_feed_content=use_feed_content,
        search_url=f"https://www.zhihu.com/question/{normalized_id}",
        search_payload={"seed_question_id": normalized_id},
        search_result={
            "type": "seed_question",
            "object": {"type": "question", "id": normalized_id},
        },
        discovery_round=discovery_round,
        discovery_run_id=discovery_run_id,
    )


def collect_query(
    query: str,
    *,
    authorization_ref: str,
    fetched_at: datetime,
    max_questions: int,
    max_answers_per_question: int,
    max_candidates_per_question: int | None = None,
    fetch_json: FetchJson,
    use_feed_content: bool = False,
    discovery_round: int = 0,
    discovery_run_id: str | None = None,
) -> tuple[SourceRecordV1, ...]:
    """Run a bounded search → question feed → answer detail collection."""

    normalized_query = query.strip()
    if not normalized_query:
        raise ValueError("搜索词不能为空")
    if max_questions < 1 or max_answers_per_question < 1:
        raise ValueError("问题数和每题回答数必须大于零")
    candidate_limit = max_candidates_per_question or max_answers_per_question * 3
    if candidate_limit < 1:
        raise ValueError("候选回答数必须大于零")

    search_url = _search_url(normalized_query, limit=max(20, max_questions))
    search_payload = fetch_json(search_url)
    questions: dict[str, dict[str, Any]] = {}
    for search_result in _items(search_payload):
        question_id = _question_id(search_result)
        if question_id and question_id not in questions:
            questions[question_id] = search_result

    records: list[SourceRecordV1] = []
    for question_id, search_result in tuple(questions.items())[:max_questions]:
        records.extend(
            _collect_question_answers(
                question_id,
                query=normalized_query,
                authorization_ref=authorization_ref,
                fetched_at=fetched_at,
                max_answers_per_question=max_answers_per_question,
                max_candidates_per_question=candidate_limit,
                fetch_json=fetch_json,
                use_feed_content=use_feed_content,
                search_url=search_url,
                search_payload=search_payload,
                search_result=search_result,
                discovery_round=discovery_round,
                discovery_run_id=discovery_run_id,
            )
        )
    return tuple(records)


def _run_zhurl(executable: str, url: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [executable, "--web", url],
            capture_output=True,
            check=False,
            text=True,
            encoding="utf-8",
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"找不到 zhurl：{executable}") from exc
    if result.returncode != 0:
        raise RuntimeError(f"zhurl 请求失败（exit {result.returncode}）")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("zhurl 没有返回有效 JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("zhurl 返回的顶层数据不是 JSON object")
    return payload


def _netscape_cookies(cookie_file: Path) -> dict[str, str]:
    """Read a Netscape cookie jar into the account shape expected by zhurl."""

    if not cookie_file.is_file():
        raise RuntimeError(f"Cookie 文件不存在：{cookie_file}")
    cookies: dict[str, str] = {}
    try:
        lines = cookie_file.read_text(encoding="utf-8", errors="strict").splitlines()
    except (OSError, UnicodeError) as exc:
        raise RuntimeError("Cookie 文件无法读取") from exc
    for line in lines:
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 7:
            continue
        domain, _include_subdomains, path, _secure, _expires, name, value = fields
        if "zhihu.com" not in domain.lower() or not name:
            continue
        cookies[name] = value
    if not cookies.get("z_c0") or not cookies.get("d_c0"):
        raise RuntimeError("Cookie 文件缺少 zhurl 所需的 z_c0 或 d_c0")
    return cookies


def _run_signed_cookie_request(
    executable: str,
    cookie_file: Path,
    url: str,
    *,
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Run zhurl with a temporary account generated from a local cookie jar."""

    if timeout <= 0:
        raise ValueError("请求超时必须大于零")
    cookies = _netscape_cookies(cookie_file)
    account = {
        "login": True,
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "cookies": cookies,
    }
    try:
        with tempfile.TemporaryDirectory(prefix="decision-knowledge-zhurl-") as home:
            account_dir = Path(home) / ".zhihu-plus-plus"
            account_dir.mkdir(parents=True, exist_ok=True)
            (account_dir / "account.json").write_text(
                json.dumps(account, ensure_ascii=False),
                encoding="utf-8",
            )
            environment = os.environ.copy()
            environment["HOME"] = home
            environment["USERPROFILE"] = home
            result = subprocess.run(
                [executable, "--web", url],
                capture_output=True,
                check=False,
                text=True,
                encoding="utf-8",
                timeout=max(5.0, timeout + 5.0),
                env=environment,
            )
    except FileNotFoundError as exc:
        raise RuntimeError(f"找不到 zhurl：{executable}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"zhurl 请求超时（>{timeout:g}s，endpoint={url.split('?', 1)[0]}）"
        ) from exc
    if result.returncode != 0:
        raise RuntimeError(
            f"zhurl 请求失败（exit {result.returncode}，endpoint={url.split('?', 1)[0]}）"
        )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"zhurl 没有返回有效 JSON（endpoint={url.split('?', 1)[0]}）"
        ) from exc
    if not isinstance(payload, dict):
        raise RuntimeError("zhurl 返回的顶层数据不是 JSON object")
    error = payload.get("error")
    if isinstance(error, dict):
        error_code = error.get("code") or error.get("status") or "unknown"
        raise RuntimeError(
            f"zhurl API 返回 error code={error_code}（endpoint={url.split('?', 1)[0]}）"
        )
    return payload


def _run_cookie_request(
    cookie_file: Path,
    url: str,
    *,
    timeout: float = 15.0,
    retries: int = 1,
    delay: float = 0.0,
) -> dict[str, Any]:
    """Fetch one JSON API response using a local Cookie file without persisting it."""

    if not cookie_file.is_file():
        raise RuntimeError(f"Cookie 文件不存在：{cookie_file}")
    if timeout <= 0:
        raise ValueError("请求超时必须大于零")
    if retries < 0:
        raise ValueError("重试次数不能小于零")
    if delay < 0:
        raise ValueError("请求间隔不能小于零")
    curl = "curl.exe" if os.name == "nt" else "curl"
    with tempfile.NamedTemporaryFile(
        prefix="decision-knowledge-zhihu-api-",
        suffix=".json",
        delete=False,
    ) as temporary:
        response_path = Path(temporary.name)
    try:
        max_attempts = retries + 1
        for attempt in range(max_attempts):
            response_path.unlink(missing_ok=True)
            if delay:
                time.sleep(delay)
            try:
                result = subprocess.run(
                    [
                        curl,
                        "--location",
                        "--compressed",
                        "--silent",
                        "--show-error",
                        "--max-time",
                        str(max(1, int(timeout))),
                        "--cookie",
                        str(cookie_file),
                        "--user-agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                        "--header",
                        "Accept: application/json",
                        "--header",
                        "Accept-Language: zh-CN,zh;q=0.9,en;q=0.5",
                        "--output",
                        str(response_path),
                        "--write-out",
                        "%{http_code}",
                        url,
                    ],
                    capture_output=True,
                    check=False,
                    timeout=max(5.0, timeout + 5.0),
                )
            except subprocess.TimeoutExpired as exc:
                if attempt + 1 < max_attempts:
                    time.sleep(min(5.0, 1.0 + attempt))
                    continue
                raise RuntimeError(
                    f"Cookie 请求超时（>{timeout:g}s，endpoint={url.split('?', 1)[0]}）"
                ) from exc
            raw_status = result.stdout.decode("ascii", errors="ignore").strip()
            # Some Windows curl builds can append the response body to stdout
            # when a redirect or transient transport error occurs.  The
            # write-out status is the final three digits; never put the raw
            # stdout (which may contain the full API response) in an error.
            status_match = re.search(r"(\d{3})$", raw_status)
            status = status_match.group(1) if status_match else "unknown"
            retryable = result.returncode == 28 or status in {
                "429",
                "500",
                "502",
                "503",
                "504",
            }
            if retryable and attempt + 1 < max_attempts:
                time.sleep(min(5.0, 1.0 + attempt))
                continue
            if result.returncode != 0:
                raise RuntimeError(
                    f"Cookie 请求失败（curl exit {result.returncode}，HTTP {status or 'unknown'}，"
                    f"endpoint={url.split('?', 1)[0]}）"
                )
            if not status.startswith("2"):
                raise RuntimeError(
                    f"Cookie 请求返回 HTTP {status or 'unknown'}，endpoint={url.split('?', 1)[0]}"
                )
            try:
                payload = json.loads(response_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise RuntimeError("Cookie 请求没有返回有效 JSON") from exc
            if not isinstance(payload, dict):
                raise RuntimeError("Cookie 请求返回的顶层数据不是 JSON object")
            return payload
        raise RuntimeError(f"Cookie 请求失败，endpoint={url.split('?', 1)[0]}")
    finally:
        response_path.unlink(missing_ok=True)


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("必须大于零")
    return number


def _nonnegative_int(value: str) -> int:
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError("不能小于零")
    return number


def _positive_float(value: str) -> float:
    number = float(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("必须大于零")
    return number


def _nonnegative_float(value: str) -> float:
    number = float(value)
    if number < 0:
        raise argparse.ArgumentTypeError("不能小于零")
    return number


def _round_count(value: str) -> int:
    number = _positive_int(value)
    if number > 3:
        raise argparse.ArgumentTypeError("滚雪球轮次最多为 3")
    return number


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", action="append", default=[], help="搜索词，可重复")
    parser.add_argument("--question-id", action="append", default=[], help="问题 ID，可重复")
    parser.add_argument("--authorization-ref", required=True, help="数据库中的有效授权引用")
    parser.add_argument("--output", type=Path, required=True, help="SourceRecord JSONL 输出路径")
    parser.add_argument("--max-questions", type=_positive_int, default=5)
    parser.add_argument("--max-answers-per-question", type=_positive_int, default=10)
    parser.add_argument("--max-candidates-per-question", type=_positive_int)
    parser.add_argument("--snowball-rounds", type=_round_count, default=1)
    parser.add_argument("--max-snowball-queries", type=_positive_int, default=5)
    parser.add_argument("--zhurl", default="zhurl", help="zhurl 可执行文件路径")
    parser.add_argument(
        "--request-timeout",
        type=_positive_float,
        default=15.0,
        help="单次 Cookie API 请求超时秒数（默认 15）",
    )
    parser.add_argument(
        "--request-retries",
        type=_nonnegative_int,
        default=1,
        help="对超时、429 和 5xx 的额外重试次数（默认 1）",
    )
    parser.add_argument(
        "--request-delay",
        type=_nonnegative_float,
        default=0.2,
        help="Cookie API 请求之间的间隔秒数（默认 0.2）",
    )
    parser.add_argument(
        "--cookie-file",
        type=Path,
        help="本机 Netscape Cookie 文件；仅用于三段式 API 请求，不会写入输出",
    )
    parser.add_argument(
        "--signed-cookie-file",
        type=Path,
        help="本机 Netscape Cookie 文件；通过 zhurl 临时账号生成 web API 签名",
    )
    parser.add_argument(
        "--use-feed-content",
        action="store_true",
        help="直接使用问题回答流中的完整 HTML，减少逐回答详情请求",
    )
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    if not any(query.strip() for query in args.query) and not any(
        question_id.strip() for question_id in args.question_id
    ):
        print("ERROR: 至少提供一个 --query 或 --question-id", file=sys.stderr)
        return 2
    if args.cookie_file is not None and args.signed_cookie_file is not None:
        print("ERROR: --cookie-file 和 --signed-cookie-file 只能选一个", file=sys.stderr)
        return 2
    fetched_at = datetime.now(UTC)
    discovery_run_id = str(uuid4())
    records_by_key: dict[tuple[str, str], SourceRecordV1] = {}
    if args.signed_cookie_file is not None:
        fetch_json = lambda url: _run_signed_cookie_request(  # noqa: E731
            args.zhurl,
            args.signed_cookie_file,
            url,
            timeout=args.request_timeout,
        )
    elif args.cookie_file is not None:
        fetch_json = lambda url: _run_cookie_request(  # noqa: E731
            args.cookie_file,
            url,
            timeout=args.request_timeout,
            retries=args.request_retries,
            delay=args.request_delay,
        )
    else:
        fetch_json = lambda url: _run_zhurl(args.zhurl, url)  # noqa: E731
    frontier = tuple(dict.fromkeys(query.strip() for query in args.query if query.strip()))
    seen_queries = set(frontier)
    question_seed_records: list[SourceRecordV1] = []
    failed_seeds = 0
    try:
        for question_id in tuple(dict.fromkeys(args.question_id)):
            try:
                records = collect_question(
                    question_id,
                    authorization_ref=args.authorization_ref,
                    fetched_at=fetched_at,
                    max_answers_per_question=args.max_answers_per_question,
                    max_candidates_per_question=args.max_candidates_per_question,
                    fetch_json=fetch_json,
                    use_feed_content=args.use_feed_content,
                    discovery_run_id=discovery_run_id,
                )
            except RuntimeError as exc:
                failed_seeds += 1
                print(f"WARNING: question seed skipped: {exc}", file=sys.stderr)
                continue
            question_seed_records.extend(records)
            for record in records:
                records_by_key.setdefault((record.external_ref.id, record.raw.sha256), record)
        for discovery_round in range(args.snowball_rounds):
            round_records: list[SourceRecordV1] = (
                list(question_seed_records) if discovery_round == 0 else []
            )
            for query in frontier:
                try:
                    records = collect_query(
                        query,
                        authorization_ref=args.authorization_ref,
                        fetched_at=fetched_at,
                        max_questions=args.max_questions,
                        max_answers_per_question=args.max_answers_per_question,
                        max_candidates_per_question=args.max_candidates_per_question,
                        fetch_json=fetch_json,
                        use_feed_content=args.use_feed_content,
                        discovery_round=discovery_round,
                        discovery_run_id=discovery_run_id,
                    )
                except RuntimeError as exc:
                    failed_seeds += 1
                    print(f"WARNING: query skipped ({query}): {exc}", file=sys.stderr)
                    continue
                round_records.extend(records)
                for record in records:
                    records_by_key.setdefault(
                        (record.external_ref.id, record.raw.sha256), record
                    )
            if discovery_round + 1 >= args.snowball_rounds:
                break
            frontier = suggest_queries(
                round_records,
                seed_queries=tuple(seen_queries),
                max_queries=args.max_snowball_queries,
            )
            seen_queries.update(frontier)
            if not frontier:
                break
    except (ValueError, KeyError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    # JSON Lines consumers commonly use ``str.splitlines()``; escape Unicode
    # line/paragraph separators that may occur in Zhihu HTML so one answer
    # always remains one physical JSONL line.
    serialized_records = (
        record.model_dump_json().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        for record in records_by_key.values()
    )
    args.output.write_text(
        "".join(serialized + "\n" for serialized in serialized_records),
        encoding="utf-8",
    )
    if failed_seeds:
        print(f"WARNING: skipped seeds={failed_seeds}", file=sys.stderr)
    print(f"WROTE records={len(records_by_key)} path={args.output}")
    return 1 if failed_seeds and not records_by_key else 0


if __name__ == "__main__":
    raise SystemExit(main())
