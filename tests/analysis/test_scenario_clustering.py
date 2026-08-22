from decision_knowledge.analysis.scenarios import (
    decision_point_ready,
    propose_scenario_clusters,
)


def _candidate(
    candidate_id: str,
    *,
    context: str,
    decision: str,
    action: str,
    outcome: str = "",
    blocking_key: str = "career",
    vector: tuple[float, ...],
) -> dict[str, object]:
    return {
        "candidate_id": candidate_id,
        "context": context,
        "decision": decision,
        "action": action,
        "outcome": outcome,
        "confidence": 80,
        "blocking_key": blocking_key,
        "vector": vector,
    }


def test_clusters_same_decision_point_and_splits_observed_actions() -> None:
    proposals = propose_scenario_clusters(
        (
            _candidate(
                "a",
                context="收入有限，需要控制风险",
                decision="要不要转行做产品经理？",
                action="先利用晚上时间做项目",
                outcome="拿到面试反馈",
                vector=(1.0, 0.0, 0.0),
            ),
            _candidate(
                "b",
                context="收入有限，需要控制风险",
                decision="是否转行做产品经理？",
                action="直接辞职参加训练营",
                outcome="三个月后进入新行业",
                vector=(0.98, 0.1, 0.0),
            ),
            _candidate(
                "c",
                context="收入有限，需要控制风险",
                decision="要不要继续做开发？",
                action="留在原公司",
                outcome="",
                vector=(0.99, 0.08, 0.0),
            ),
        ),
        similarity_threshold=0.9,
        min_cluster_size=2,
    )

    assert len(proposals) == 1
    proposal = proposals[0]
    assert proposal.candidate_ids == ("a", "b")
    assert len(proposal.branches) == 2
    assert {branch.candidate_ids for branch in proposal.branches} == {("a",), ("b",)}


def test_blocking_key_prevents_cross_domain_merge_even_for_identical_vectors() -> None:
    proposals = propose_scenario_clusters(
        (
            _candidate(
                "career",
                context="工作不稳定",
                decision="要不要转行？",
                action="先学习",
                blocking_key="career",
                vector=(1.0, 0.0),
            ),
            _candidate(
                "education",
                context="工作不稳定",
                decision="要不要转行？",
                action="先学习",
                blocking_key="education",
                vector=(1.0, 0.0),
            ),
        ),
        similarity_threshold=0.9,
        min_cluster_size=2,
    )

    assert proposals == ()


def test_singletons_and_empty_actions_stay_out_of_branch_proposals() -> None:
    proposals = propose_scenario_clusters(
        (
            _candidate(
                "a",
                context="想提升收入",
                decision="要不要学编程？",
                action="",
                vector=(1.0, 0.0),
            ),
            _candidate(
                "b",
                context="想提升收入",
                decision="要不要学编程？",
                action="",
                vector=(0.99, 0.1),
            ),
        ),
        similarity_threshold=0.9,
        min_cluster_size=2,
    )

    assert len(proposals) == 1
    assert proposals[0].branches == ()


def test_generic_advice_is_not_treated_as_a_decision_point() -> None:
    assert decision_point_ready("如果有的选，优先选择大公司吧。") is False
    assert decision_point_ready("这，就决定了两条路径的上限高低。") is False
    assert decision_point_ready("态度决定你能不能留下来。") is False
    assert decision_point_ready("要不要转行做产品经理？") is True
