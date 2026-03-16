export interface WorkerRecoveryData {
  role: "worker";
  workerDid: string;
  displayName: string;
  coordinatorDid: string;
  phalaEndpoint?: string;
  cvmId?: string;
  nearAccount: string;
  registeredAt: string;
}

export interface CoordinatorRecoveryData {
  role: "coordinator";
  coordinatorDid: string;
  displayName: string;
  contractAddress?: string;
  minWorkers: number;
  maxWorkers: number;
  phalaEndpoint?: string;
  cvmId?: string;
  ensueOrgName?: string;
  ensueClaimUrl?: string;
  ensueVerificationCode?: string;
  nearAccount: string;
  registeredAt: string;
  note?: string;
}

export type RecoveryData = WorkerRecoveryData | CoordinatorRecoveryData;

export function downloadRecoveryFile(data: RecoveryData): void {
  const filename =
    data.role === "worker" ? "worker-recovery.json" : "coordinator-recovery.json";
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
