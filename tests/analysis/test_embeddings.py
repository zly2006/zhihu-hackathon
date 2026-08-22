import pytest

from decision_knowledge.analysis.embeddings import (
    build_scenario_input,
    decode_vector,
    encode_vector,
    top_k_similar,
)


def test_scenario_input_is_stable_and_excludes_action_and_outcome() -> None:
    result = build_scenario_input(
        context="家庭储蓄只够一年，需要控制试错成本。",
        decision="在稳定工作和转行之间选择。",
        action="先用下班时间做项目。",
        outcome="三个月后拿到反馈。",
    )

    assert result.ready is True
    assert result.text == (
        "背景：家庭储蓄只够一年，需要控制试错成本。\n"
        "决策点：在稳定工作和转行之间选择。"
    )
    assert "先用下班时间做项目" not in result.text
    assert "三个月后拿到反馈" not in result.text
    assert len(result.input_sha256) == 64
    assert result.reason is None


def test_scenario_input_rejects_missing_or_duplicated_decision_fields() -> None:
    missing = build_scenario_input(context="家庭储蓄有限。", decision="")
    duplicated = build_scenario_input(context="要不要转行？", decision="要不要转行？")

    assert missing.ready is False
    assert missing.reason == "missing_context_or_decision"
    assert duplicated.ready is False
    assert duplicated.reason == "duplicated_context_and_decision"


def test_vector_round_trip_normalizes_and_top_k_is_deterministic() -> None:
    payload = encode_vector((3.0, 4.0))
    assert decode_vector(payload, dimension=2) == pytest.approx((0.6, 0.8), abs=1e-6)

    hits = top_k_similar(
        (1.0, 0.0),
        (
            ("b", (0.8, 0.6)),
            ("a", (0.8, 0.6)),
            ("c", (-1.0, 0.0)),
        ),
        limit=2,
    )

    assert [hit.candidate_id for hit in hits] == ["a", "b"]
    assert hits[0].score == pytest.approx(0.8, abs=1e-6)


def test_vector_rejects_invalid_payloads() -> None:
    with pytest.raises(ValueError, match="all zeros"):
        encode_vector((0.0, 0.0))
    with pytest.raises(ValueError, match="dimension mismatch"):
        decode_vector(encode_vector((1.0, 0.0)), dimension=3)
