from decision_knowledge.analysis.candidates import build_decision_candidate


def test_candidate_extracts_evidence_without_claiming_a_confirmed_episode() -> None:
    body = (
        "我当时需要在稳定工作和转行之间选择。"
        "因为家庭储蓄只够一年，所以先用下班时间做项目，比较机会成本和风险。"
        "三个月后拿到反馈，最终决定转行。"
    )

    candidate = build_decision_candidate(body, quality_accepted=True)

    assert candidate is not None
    assert "家庭储蓄" in candidate.context
    assert "选择" in candidate.decision
    assert "先用下班时间做项目" in candidate.action
    assert "最终决定转行" in candidate.outcome
    assert candidate.review_status == "UNREVIEWED"
    assert candidate.evidence["method"] == "heuristic-v1"
    assert candidate.confidence >= 50


def test_candidate_is_not_created_for_rejected_quality_or_missing_decision() -> None:
    assert build_decision_candidate("后来过得还行。", quality_accepted=True) is None
    assert build_decision_candidate(
        "我当时需要在稳定工作和转行之间选择。后来最终决定转行。",
        quality_accepted=False,
    ) is None
