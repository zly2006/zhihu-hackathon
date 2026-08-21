import json
from datetime import UTC, datetime

import pytest

from scripts.collect_zhihu_public import (
    _as_content_data,
    _validate_capture_url,
    build_source_record,
    clean_html_fragment,
)


def test_clean_html_fragment_keeps_readable_text() -> None:
    fragment = '<p>Hello <strong>world</strong>.</p><p>Second line&nbsp;here.</p>'

    assert clean_html_fragment(fragment) == "Hello world.\nSecond line here."


def test_public_answer_page_is_converted_to_source_record() -> None:
    page_html = (
        '<script id="js-initialData" type="text/json">'
        + json.dumps(
            {
                "initialState": {
                    "globalStation": {
                        "contentData": {
                            "type": "answer",
                            "id": "123",
                            "parentId": "456",
                            "title": "A real title",
                            "content": "<p>A real answer.</p>",
                            "url": "https://www.zhihu.com/en/answer/123",
                            "originalPageUrl": "https://www.zhihu.com/answer/123",
                            "editedTime": 1_700_000_000,
                            "keywords": ["career"],
                            "upvotedNum": 12,
                            "author": {"id": "author-key"},
                        }
                    }
                }
            }
        )
        + "</script>"
    )
    content_data = _as_content_data(page_html)
    record = build_source_record(
        fetch_url="https://www.zhihu.com/en/answer/123",
        final_url="https://www.zhihu.com/en/answer/123",
        fetched_at=datetime(2026, 8, 21, tzinfo=UTC),
        page_bytes=page_html.encode("utf-8"),
        content_data=content_data,
    )

    assert record.source.adapter_code == "manual_url_capture"
    assert str(record.canonical_url) == "https://www.zhihu.com/answer/123"
    assert record.content.body == "A real answer."
    assert record.content.raw_html == "<p>A real answer.</p>"
    assert record.raw.payload["capture_method"] == "public_en_answer_page"


@pytest.mark.parametrize(
    "url",
    [
        "https://www.zhihu.com/question/123/answer/456",
        "https://www.zhihu.com/api/v4/answers/456",
        "http://www.zhihu.com/en/answer/456",
        "https://example.test/en/answer/456",
    ],
)
def test_capture_scope_rejects_non_public_answer_urls(url: str) -> None:
    with pytest.raises(ValueError):
        _validate_capture_url(url)
