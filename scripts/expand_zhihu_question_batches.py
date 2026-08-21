"""Expand the local Zhihu dataset from already discovered question IDs.

The script only consumes question IDs present in persisted Zhihu search
responses. It keeps an ephemeral attempted-ID ledger so a question whose feed
has no acceptable answers is not retried forever. Cookies are passed through to
the collector and are never read or written by this orchestration layer.
"""

from __future__ import annotations

import argparse
import sqlite3
import subprocess
import sys
from pathlib import Path

from decision_knowledge.db import Database
from decision_knowledge.ingest.bootstrap import import_jsonl

SEARCH_QUESTION_IDS_SQL = """
SELECT DISTINCT COALESCE(
    json_extract(j.value, '$.object.question.id'),
    CASE
        WHEN json_extract(j.value, '$.object.type') = 'question'
        THEN json_extract(j.value, '$.object.id')
    END
)
FROM raw_envelope AS r,
     json_each(json_extract(r.payload, '$.raw.payload.api_responses.search.data')) AS j
WHERE COALESCE(
    json_extract(j.value, '$.object.question.id'),
    CASE
        WHEN json_extract(j.value, '$.object.type') = 'question'
        THEN json_extract(j.value, '$.object.id')
    END
) IS NOT NULL
"""

CRAWLED_QUESTION_IDS_SQL = """
SELECT DISTINCT json_extract(payload, '$.external_ref.parent.id')
FROM raw_envelope
WHERE json_extract(payload, '$.external_ref.parent.type') = 'question'
"""


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError('必须大于零')
    return number


def _nonnegative_float(value: str) -> float:
    number = float(value)
    if number < 0:
        raise argparse.ArgumentTypeError('不能小于零')
    return number


def _question_frontier(connection: sqlite3.Connection, attempted: set[str]) -> list[str]:
    discovered = {
        str(row[0])
        for row in connection.execute(SEARCH_QUESTION_IDS_SQL)
        if str(row[0]).isdecimal()
    }
    crawled = {
        str(row[0])
        for row in connection.execute(CRAWLED_QUESTION_IDS_SQL)
        if row[0] is not None
    }
    return sorted(discovered - crawled - attempted)


def _stats(connection: sqlite3.Connection) -> tuple[int, int, int]:
    return tuple(
        int(connection.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0])
        for table in ('content_item', 'content_snapshot', 'raw_envelope')
    )  # type: ignore[return-value]


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cookie-file', type=Path, required=True)
    parser.add_argument('--authorization-ref', required=True)
    parser.add_argument('--database-path', type=Path, default=Path('local.db'))
    parser.add_argument('--output-dir', type=Path, default=Path('data/zhihu'))
    parser.add_argument(
        '--attempted-file',
        type=Path,
        default=Path('.tmp/zhihu_question_attempted.txt'),
    )
    parser.add_argument('--start-batch', type=_positive_int, default=4)
    parser.add_argument('--max-batches', type=_positive_int, default=1)
    parser.add_argument('--batch-size', type=_positive_int, default=40)
    parser.add_argument('--max-answers-per-question', type=_positive_int, default=10)
    parser.add_argument('--max-candidates-per-question', type=_positive_int, default=50)
    parser.add_argument('--request-timeout', type=_positive_int, default=15)
    parser.add_argument('--request-retries', type=int, default=1)
    parser.add_argument('--request-delay', type=_nonnegative_float, default=0.5)
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    if args.request_retries < 0:
        raise SystemExit('--request-retries 不能小于零')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.attempted_file.parent.mkdir(parents=True, exist_ok=True)
    attempted = (
        {
            line.strip()
            for line in args.attempted_file.read_text(encoding='utf-8').splitlines()
            if line.strip().isdecimal()
        }
        if args.attempted_file.exists()
        else set()
    )
    database = Database(f'sqlite+pysqlite:///{args.database_path.as_posix()}')
    connection = sqlite3.connect(args.database_path)
    try:
        for offset in range(args.max_batches):
            batch_number = args.start_batch + offset
            frontier = _question_frontier(connection, attempted)
            if not frontier:
                print('STOP no undiscovered question IDs')
                break
            question_ids = frontier[: args.batch_size]
            attempted.update(question_ids)
            args.attempted_file.write_text(
                ''.join(f'{question_id}\n' for question_id in sorted(attempted)),
                encoding='utf-8',
            )
            output = args.output_dir / (
                f'search_question_answers_question_batch{batch_number:02d}.jsonl'
            )
            print(
                f'START batch={batch_number} questions={len(question_ids)} '
                f'first={question_ids[0]} last={question_ids[-1]}',
                flush=True,
            )
            command = [
                sys.executable,
                'scripts/collect_zhihu_search_question.py',
                '--cookie-file',
                str(args.cookie_file),
                '--authorization-ref',
                args.authorization_ref,
                '--max-answers-per-question',
                str(args.max_answers_per_question),
                '--max-candidates-per-question',
                str(args.max_candidates_per_question),
                '--use-feed-content',
                '--request-timeout',
                str(args.request_timeout),
                '--request-retries',
                str(args.request_retries),
                '--request-delay',
                str(args.request_delay),
                '--output',
                str(output),
            ]
            for question_id in question_ids:
                command.extend(('--question-id', question_id))
            completed = subprocess.run(command, check=False)
            if not output.is_file():
                print(f'ERROR missing output={output}')
                return 1
            result = import_jsonl(database, output)
            content_items, snapshots, raw_envelopes = _stats(connection)
            print(
                f'IMPORT batch={batch_number} exit={completed.returncode} '
                f'created={result.created} unchanged={result.unchanged} rejected={result.rejected} '
                f'unique={content_items} snapshots={snapshots} raw={raw_envelopes}',
                flush=True,
            )
    finally:
        connection.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
