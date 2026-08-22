import argparse
import os

from decision_knowledge.operations.database_sync import replace_database


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Atomically replace a migrated target database from a source database."
    )
    parser.add_argument("--source-url", required=True)
    parser.add_argument(
        "--target-url",
        default=os.getenv("DK_DATABASE_URL"),
        help="Defaults to DK_DATABASE_URL; prefer the environment to keep credentials out of logs.",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument(
        "--replace",
        action="store_true",
        required=True,
        help="Required acknowledgement that application tables in the target will be replaced.",
    )
    args = parser.parse_args()
    if not args.target_url:
        parser.error("--target-url or DK_DATABASE_URL is required")

    report = replace_database(args.source_url, args.target_url, batch_size=args.batch_size)
    for table_name, count in report.table_counts.items():
        print(f"{table_name}: {count}")
    print(f"total: {report.total_rows}")


if __name__ == "__main__":
    main()
