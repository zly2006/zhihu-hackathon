from pathlib import Path

from sqlalchemy import func, select

from decision_knowledge.analysis.decision_object_persistence import (
    persist_decision_objects,
)
from decision_knowledge.analysis.decision_objects import (
    DecisionObjectProposal,
    validate_decision_object_batch,
)
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import DecisionObject, DecisionObjectAssignment
from scripts.extract_decision_objects import parse_model_output


def test_decision_object_identity_comes_from_canonical_name() -> None:
    resign = DecisionObjectProposal.from_mapping(
        {
            "question_id": "q1",
            "title": "没有下家要不要裸辞？",
            "snapshot_ids": ["s1"],
            "is_decision": True,
            "decision_object": "是否辞去当前工作",
            "coel": [
                {
                    "code": "28.4.4.0",
                    "name": "Resign",
                    "path": "Lifestage > Employment > Resign",
                }
            ],
            "confidence": 0.94,
        }
    )
    same_action = DecisionObjectProposal.from_mapping(
        {
            "question_id": "q2",
            "title": "工作不开心，该不该离职？",
            "snapshot_ids": ["s2"],
            "is_decision": True,
            "decision_object": "是否辞去当前工作",
            "coel": [
                {
                    "code": "28.4.4.0",
                    "name": "Resign",
                    "path": "Lifestage > Employment > Resign",
                }
            ],
            "confidence": 0.91,
        }
    )

    assert resign.object_key.startswith("object:decision-object-v1:")
    assert same_action.object_key == resign.object_key
    assert resign.snapshot_ids == ("s1",)


def test_coel_is_an_anchor_not_the_whole_decision_object() -> None:
    choose_city = DecisionObjectProposal.from_mapping(
        {
            "question_id": "q1",
            "title": "去哪个城市工作？",
            "snapshot_ids": ["s1"],
            "is_decision": True,
            "decision_object": "选择工作城市",
            "coel": [{"code": "28.4.1.0", "name": "Get a job", "path": "Lifestage"}],
            "confidence": 0.9,
        }
    )
    choose_employer = DecisionObjectProposal.from_mapping(
        {
            "question_id": "q2",
            "title": "大厂还是小公司？",
            "snapshot_ids": ["s2"],
            "is_decision": True,
            "decision_object": "选择工作单位类型",
            "coel": [{"code": "28.4.1.0", "name": "Get a job", "path": "Lifestage"}],
            "confidence": 0.9,
        }
    )

    assert choose_city.object_key != choose_employer.object_key


def test_same_canonical_object_persists_as_one_decision_object(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'decision-objects.db'}")
    database.create_schema()
    proposals = tuple(
        DecisionObjectProposal.from_mapping(value)
        for value in (
            {
                "question_id": "q1",
                "title": "没有下家要不要裸辞？",
                "snapshot_ids": ["s1"],
                "is_decision": True,
                "decision_object": "是否辞去当前工作",
                "coel": [{"code": "28.4.4.0", "name": "Resign", "path": "Lifestage"}],
                "confidence": 0.94,
            },
            {
                "question_id": "q2",
                "title": "工作不开心，该不该离职？",
                "snapshot_ids": ["s2"],
                "is_decision": True,
                "decision_object": "是否辞去当前工作",
                "coel": [{"code": "28.4.4.0", "name": "Resign", "path": "Lifestage"}],
                "confidence": 0.91,
            },
        )
    )

    with database.session() as session:
        first = persist_decision_objects(session, proposals)
        second = persist_decision_objects(session, proposals)

        assert first.objects_created == 1
        assert first.assignments_created == 2
        assert second.objects_created == 0
        assert second.assignments_created == 0
        assert session.scalar(select(func.count()).select_from(DecisionObject)) == 1
        assert session.scalar(select(func.count()).select_from(DecisionObjectAssignment)) == 2
        decision_object = session.scalar(select(DecisionObject))
        assert decision_object is not None
        assert decision_object.object_key.startswith("object:decision-object-v1:")
        assert decision_object.name == "是否辞去当前工作"
    database.dispose()


def test_model_output_must_use_a_retrieved_coel_code() -> None:
    row = {
        "question_id": "q1",
        "title": "没有下家要不要裸辞？",
        "snapshot_ids": ["s1"],
    }
    candidates = (
        {
            "code": "28.4.4.0",
            "name": "Resign",
            "path": "Lifestage > Employment > Resign",
        },
    )

    proposal = parse_model_output(
        '{"is_decision":true,"decision_object":"是否辞去当前工作",'
        '"coel_codes":["28.4.4.0"],"confidence":0.93}',
        row,
        candidates,
        model_id="test-model",
    )

    assert proposal["decision_object"] == "是否辞去当前工作"
    assert proposal["coel"] == list(candidates)
    assert proposal["model_id"] == "test-model"

    try:
        parse_model_output(
            '{"is_decision":true,"decision_object":"是否辞职",'
            '"coel_codes":["99.9.9.0"],"confidence":0.9}',
            row,
            candidates,
            model_id="test-model",
        )
    except ValueError as error:
        assert "not retrieved" in str(error)
    else:
        raise AssertionError("hallucinated COEL code was accepted")


def test_model_output_must_use_a_canonical_decision_form() -> None:
    row = {
        "question_id": "q1",
        "title": "工作两年后该跳槽吗？",
        "snapshot_ids": ["s1"],
    }

    try:
        parse_model_output(
            '{"is_decision":true,"decision_object":"跳槽时间",'
            '"coel_codes":[],"confidence":0.98}',
            row,
            (),
            model_id="test-model",
        )
    except ValueError as error:
        assert "是否 or 选择" in str(error)
    else:
        raise AssertionError("non-canonical decision object was accepted")


def test_coel_anchor_uses_local_alias_instead_of_model_guess() -> None:
    row = {
        "question_id": "q1",
        "title": "长期居住选租房还是买房？",
        "snapshot_ids": ["s1"],
    }
    candidates = (
        {"code": "28.3.1.0", "name": "Buying a house", "path": "Lifestage"},
        {"code": "28.4.4.0", "name": "Resign", "path": "Lifestage"},
    )

    proposal = parse_model_output(
        '{"is_decision":true,"decision_object":"选择租房或买房",'
        '"coel_codes":["28.4.4.0"],"confidence":0.98}',
        row,
        candidates,
        model_id="test-model",
    )

    assert proposal["coel"] == [candidates[0]]


def test_coel_anchor_is_empty_without_a_high_precision_alias() -> None:
    row = {
        "question_id": "q1",
        "title": "如何面对重大但不确定的选择？",
        "snapshot_ids": ["s1"],
    }
    candidates = (
        {"code": "28.4.4.0", "name": "Resign", "path": "Lifestage"},
    )

    proposal = parse_model_output(
        '{"is_decision":true,"decision_object":"选择重大事项",'
        '"coel_codes":["28.4.4.0"],"confidence":0.80}',
        row,
        candidates,
        model_id="test-model",
    )

    assert proposal["coel"] == []


def test_import_boundary_rejects_noncanonical_decision_object() -> None:
    try:
        DecisionObjectProposal.from_mapping(
            {
                "question_id": "q1",
                "title": "应届生第一份工作多久跳槽？",
                "snapshot_ids": ["s1"],
                "is_decision": True,
                "decision_object": "跳槽时间",
                "coel": [],
                "confidence": 0.98,
            }
        )
    except ValueError as error:
        assert "是否 or 选择" in str(error)
    else:
        raise AssertionError("import boundary accepted a non-canonical object")


def test_import_boundary_rejects_generic_decision_object() -> None:
    try:
        DecisionObjectProposal.from_mapping(
            {
                "question_id": "q1",
                "title": "什么才算正确的决定？",
                "snapshot_ids": ["s1"],
                "is_decision": True,
                "decision_object": "是否做出正确决定",
                "coel": [],
                "confidence": 0.92,
            }
        )
    except ValueError as error:
        assert "too generic" in str(error)
    else:
        raise AssertionError("import boundary accepted a generic object")


def test_import_boundary_rejects_semantically_wrong_coel_anchor() -> None:
    try:
        DecisionObjectProposal.from_mapping(
            {
                "question_id": "q1",
                "title": "长期居住选租房还是买房？",
                "snapshot_ids": ["s1"],
                "is_decision": True,
                "decision_object": "选择租房或买房",
                "coel": [
                    {"code": "28.4.4.0", "name": "Resign", "path": "Lifestage"}
                ],
                "confidence": 0.98,
            }
        )
    except ValueError as error:
        assert "do not match" in str(error)
    else:
        raise AssertionError("import boundary accepted a wrong COEL anchor")


def test_batch_gate_rejects_mode_collapse() -> None:
    proposals = tuple(
        DecisionObjectProposal.from_mapping(
            {
                "question_id": f"q{index}",
                "title": f"不同的问题 {index}",
                "snapshot_ids": [f"s{index}"],
                "is_decision": True,
                "decision_object": "是否继续读博",
                "coel": [],
                "confidence": 0.98,
            }
        )
        for index in range(20)
    )

    try:
        validate_decision_object_batch(proposals)
    except ValueError as error:
        assert "mode collapse" in str(error)
    else:
        raise AssertionError("collapsed model batch passed the automatic gate")


def test_low_confidence_model_output_never_becomes_database_knowledge(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'low-confidence.db'}")
    database.create_schema()
    proposal = DecisionObjectProposal.from_mapping(
        {
            "question_id": "q1",
            "title": "周末夫妻真的行不通吗？",
            "snapshot_ids": ["s1"],
            "is_decision": True,
            "decision_object": "是否继续读博",
            "coel": [],
            "confidence": 0.0,
        }
    )

    with database.session() as session:
        result = persist_decision_objects(session, (proposal,))
        assert result.low_confidence_skipped == 1
        assert session.scalar(select(func.count()).select_from(DecisionObject)) == 0
    database.dispose()
