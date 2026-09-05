"use client";

export type BranchPanelBranch = {
  id: string;
  name: string;
  active: boolean;
  snapshotCount: number;
};

export type BranchPanelCheckpoint = {
  id: string;
  label: string;
  sceneId: string;
  blockId: string;
};

export function BranchPanel({
  branches,
  checkpoints,
  onSwitchBranch,
  onCreateBranch,
  disabled = false,
}: {
  branches: BranchPanelBranch[];
  checkpoints: BranchPanelCheckpoint[];
  onSwitchBranch: (branchId: string) => void;
  onCreateBranch: (snapshotId: string) => void;
  disabled?: boolean;
}) {
  return (
    <section aria-label="分支与场景回溯" style={{ display: "grid", gap: 12 }}>
      <div>
        <b>分支</b>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              className={branch.active ? "life-vn-btn" : "life-vn-btn ghost"}
              onClick={() => onSwitchBranch(branch.id)}
              disabled={disabled || branch.active}
              aria-pressed={branch.active}
              style={{ textAlign: "left" }}
            >
              {branch.name}{branch.active ? "（当前）" : ""}
              <small style={{ display: "block", opacity: 0.72 }}>
                {branch.snapshotCount} 个检查点
              </small>
            </button>
          ))}
        </div>
      </div>

      <div>
        <b>可回溯的场景检查点</b>
        {checkpoints.length === 0 ? (
          <p style={{ margin: "8px 0 0", color: "var(--lv-muted)", fontSize: 12 }}>
            完成一次 live 选择后，这里会出现可重新选择的场景检查点。
          </p>
        ) : (
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {checkpoints.map((checkpoint) => (
              <button
                key={checkpoint.id}
                type="button"
                className="life-vn-btn ghost"
                onClick={() => onCreateBranch(checkpoint.id)}
                disabled={disabled}
                style={{ textAlign: "left" }}
              >
                从{checkpoint.label}新建分支
                <small style={{ display: "block", opacity: 0.72 }}>
                  {checkpoint.sceneId} / {checkpoint.blockId}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
