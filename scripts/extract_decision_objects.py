"""Extract one COEL-backed decision object from each Zhihu question title.

This script is intentionally a worker artifact: the database importer validates
its JSON output before any row is persisted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

EXTRACTOR_VERSION = "decision-object-v1"
_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)
_GENERIC_DECISION_OBJECTS = frozenset(
    {"是否做出正确决定", "选择应对方式", "选择重大人生方向", "选择重要性因素"}
)
_CORE_DECISION_CODES = (
    "28.1.1.0",  # Get married
    "28.1.2.0",  # Getting divorced
    "28.1.3.0",  # Start a family
    "28.2.1.0",  # Bankruptcy
    "28.3.1.0",  # Buying a house
    "28.3.2.0",  # Selling a house
    "28.3.4.0",  # Moving home
    "28.4.1.0",  # Get a job
    "28.4.2.0",  # Promoted
    "28.4.3.0",  # Fired
    "28.4.4.0",  # Resign
    "28.4.6.0",  # Retire
    "26.5.1.0",  # Enrol at university
    "26.5.6.0",  # Take university exams
    "26.5.7.0",  # Study at university
    "26.6.1.0",  # Enrol in development education
    "26.6.7.0",  # Study in development education
)
_CORE_COEL_ALIASES = (
    ("28.1.1.0", ("结婚", "婚姻伴侣", "结婚对象", "伴侣类型")),
    ("28.1.2.0", ("离婚",)),
    ("28.1.3.0", ("生育", "生孩子", "要孩子")),
    ("28.2.1.0", ("破产",)),
    ("28.3.1.0", ("买房", "购房", "购买住房")),
    ("28.3.2.0", ("卖房", "售房", "出售住房")),
    ("28.3.4.0", ("搬家", "迁居")),
    (
        "28.4.1.0",
        ("找工作", "参加工作", "开始工作", "接受offer", "工作单位", "工作城市"),
    ),
    ("28.4.2.0", ("晋升", "升职")),
    ("28.4.3.0", ("被裁", "裁员", "被辞退")),
    ("28.4.4.0", ("辞职", "辞去", "离职", "跳槽")),
    ("28.4.6.0", ("退休",)),
    ("26.5.1.0", ("上大学", "进入大学")),
    ("26.5.6.0", ("考研",)),
    ("26.5.7.0", ("读研", "读博", "留学", "继续深造")),
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _coel_alias_codes(name: str) -> tuple[str, ...]:
    normalized = name.casefold().replace(" ", "")
    return tuple(
        code
        for code, aliases in _CORE_COEL_ALIASES
        if any(alias.casefold() in normalized for alias in aliases)
    )[:2]


def _coel_subclasses(model_path: Path) -> tuple[dict[str, str], ...]:
    model = json.loads(model_path.read_text(encoding="utf-8"))
    clusters = {int(item["Cluster"]): str(item["Name"]) for item in model["Clusters"]}
    classes = {
        (int(item["Cluster"]), int(item["Class"])): str(item["Name"])
        for item in model["Classes"]
    }
    rows = []
    for item in model["SubClasses"]:
        cluster = int(item["Cluster"])
        class_number = int(item["Class"])
        subclass = int(item["SubClass"])
        name = str(item["Name"])
        parent = classes[(cluster, class_number)]
        rows.append(
            {
                "code": f"{cluster}.{class_number}.{subclass}.0",
                "name": name,
                "path": f"{clusters[cluster]} > {parent} > {name}",
            }
        )
    return tuple(rows)


def parse_model_output(
    raw: str,
    row: Mapping[str, object],
    candidates: Sequence[Mapping[str, str]],
    *,
    model_id: str,
) -> dict[str, object]:
    match = _JSON_OBJECT.search(raw)
    if match is None:
        raise ValueError("model output contains no JSON object")
    value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise ValueError("model output must be a JSON object")
    is_decision = value.get("is_decision") is True
    name = str(value.get("decision_object", "")).strip()
    confidence = float(value.get("confidence", 0.0))
    if not 0.0 <= confidence <= 1.0:
        raise ValueError("confidence must be between 0 and 1")
    if is_decision and not name:
        raise ValueError("decision output is missing decision_object")
    if is_decision and not name.startswith(("是否", "选择")):
        raise ValueError("decision_object must start with 是否 or 选择")
    if is_decision and len(name) > 18:
        raise ValueError("decision_object must be at most 18 Chinese characters")
    if is_decision and name in _GENERIC_DECISION_OBJECTS:
        raise ValueError("decision_object is too generic to index")
    raw_codes = value.get("coel_codes", [])
    if not isinstance(raw_codes, list) or not all(isinstance(code, str) for code in raw_codes):
        raise ValueError("coel_codes must be an array of strings")
    if len(raw_codes) > 2:
        raise ValueError("at most two COEL codes may define one decision object")
    by_code = {item["code"]: dict(item) for item in candidates}
    unknown = [code for code in raw_codes if code not in by_code]
    if unknown:
        raise ValueError(f"COEL code was not retrieved: {unknown[0]}")
    alias_codes = _coel_alias_codes(name) if is_decision else ()
    return {
        "question_id": str(row["question_id"]),
        "title": str(row["title"]),
        "snapshot_ids": [str(item) for item in row["snapshot_ids"]],
        "is_decision": is_decision,
        "decision_object": name if is_decision else "",
        "coel": [by_code[code] for code in alias_codes if code in by_code],
        "confidence": confidence,
        "model_id": model_id,
        "extractor_version": EXTRACTOR_VERSION,
    }


def _prompt(title: str) -> str:
    return f"""你负责把知乎问题归一成一个最小的“决策对象”。

决策对象只回答：用户正在决定是否做什么，或在什么行动之间选择。
- 背景、原因、目标、结果不要写入决策对象。
- 只要这个问题的回答能帮助某人决定一个行动，is_decision=true；不要求提问者正在亲自做决定。
- 已经完成的行动、纯事实问答、纯经验分享，且不能支持未来行动选择时，is_decision=false。
- decision_object 只能采用两种规范格式：“是否+行动”或“选择+对象/行动”。
- decision_object 不超过18个汉字，根据标题本身分别凝练。
  例如“是否辞去当前工作”“选择工作城市”“选择工作单位类型”
  “选择继续深造或开始工作”“是否购买住房”；不要机械复用示例。
- “如何……”“……时间”“……原因”“……影响”“……策略”都不是合格的决策对象。
- coel_codes 始终输出空数组 []；系统会用高精度别名表自动挂接 COEL，模型不得猜编码。
- confidence 表示标题中是否存在清晰决策对象：直接出现“要不要/是否/还是/选择”通常为0.90以上；
  需要少量推断为0.70到0.89；没有决策对象为0.30以下。
- 只输出单行 JSON，不要解释。

例子：
- “汽车人要不要转行？” ->
  {{"is_decision":true,"decision_object":"是否转行","coel_codes":[],"confidence":0.98}}
- “本科生考研还是找工作？” ->
  {{"is_decision":true,"decision_object":"选择考研或参加工作","coel_codes":[],"confidence":0.98}}
- “离职了，每天都会干些什么？” ->
  {{"is_decision":false,"decision_object":"","coel_codes":[],"confidence":0.10}}
- “能力来自读书还是实践？” ->
  {{"is_decision":false,"decision_object":"","coel_codes":[],"confidence":0.20}}
- “人生重大选择中最应考虑什么？” ->
  {{"is_decision":false,"decision_object":"","coel_codes":[],"confidence":0.20}}
- “有人给你50万去创业，你会做什么？” ->
  {{"is_decision":true,"decision_object":"选择创业方向","coel_codes":[],"confidence":0.95}}
- “负债120万该怎么办？” ->
  {{"is_decision":false,"decision_object":"","coel_codes":[],"confidence":0.20}}

标题：{title}

输出格式：
{{"is_decision":true,"decision_object":"...","coel_codes":[],"confidence":0.0}}"""


def run(
    *,
    input_path: Path,
    coel_path: Path,
    output_dir: Path,
    language_model: str,
    language_model_id: str | None,
    batch_size: int,
) -> dict[str, object]:
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as exc:  # pragma: no cover - worker runtime only
        raise RuntimeError("worker requires torch and transformers") from exc

    rows = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError("input must be a JSON array of objects")
    coel = _coel_subclasses(coel_path)
    coel_by_code = {item["code"]: item for item in coel}
    output_dir.mkdir(parents=True, exist_ok=True)
    core_candidates = tuple(coel_by_code[code] for code in _CORE_DECISION_CODES)
    candidate_sets = [core_candidates] * len(rows)

    recorded_language_model = language_model_id or language_model
    tokenizer = AutoTokenizer.from_pretrained(language_model)
    tokenizer.padding_side = "left"
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token_id = tokenizer.eos_token_id
    model = AutoModelForCausalLM.from_pretrained(
        language_model,
        dtype=torch.bfloat16,
        device_map="auto",
    )
    proposals: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    for start in range(0, len(rows), batch_size):
        batch_rows = rows[start : start + batch_size]
        batch_candidates = candidate_sets[start : start + batch_size]
        conversations = [
            [{"role": "user", "content": _prompt(str(row["title"]))}]
            for row in batch_rows
        ]
        prompts = tokenizer.apply_chat_template(
            conversations,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        inputs = tokenizer(
            prompts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=2_048,
        ).to(model.device)
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=128,
                do_sample=False,
                pad_token_id=tokenizer.pad_token_id,
            )
        suffixes = generated[:, inputs["input_ids"].shape[1] :]
        decoded = tokenizer.batch_decode(suffixes, skip_special_tokens=True)
        for row, candidates, raw in zip(batch_rows, batch_candidates, decoded, strict=True):
            try:
                proposal = parse_model_output(
                    raw,
                    row,
                    candidates,
                    model_id=recorded_language_model,
                )
                proposals.append(proposal)
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                errors.append(
                    {
                        "question_id": str(row.get("question_id", "")),
                        "error": str(error),
                        "raw": raw[:1_000],
                    }
                )

    (output_dir / "decision_objects.json").write_text(
        json.dumps(proposals, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "errors.json").write_text(
        json.dumps(errors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    manifest: dict[str, Any] = {
        "extractor_version": EXTRACTOR_VERSION,
        "coel_mapping": "local-alias-v1",
        "language_model": recorded_language_model,
        "coel_version": "1.0",
        "input_sha256": _sha256(input_path),
        "coel_sha256": _sha256(coel_path),
        "input_count": len(rows),
        "proposal_count": len(proposals),
        "error_count": len(errors),
        "decision_count": sum(item["is_decision"] is True for item in proposals),
        "created_at": datetime.now(UTC).isoformat(),
        "gpu": torch.cuda.get_device_name(0),
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--coel", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--language-model", default="Qwen/Qwen3-4B-Instruct-2507")
    parser.add_argument("--language-model-id")
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("batch-size must be positive")
    run(
        input_path=args.input,
        coel_path=args.coel,
        output_dir=args.output_dir,
        language_model=args.language_model,
        language_model_id=args.language_model_id,
        batch_size=args.batch_size,
    )


if __name__ == "__main__":
    main()
