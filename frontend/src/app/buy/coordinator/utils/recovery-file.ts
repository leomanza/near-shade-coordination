export interface CoordinatorRecoveryData {
  coordinatorDid: string;
  displayName: string;
  contractAddress?: string;
  phalaEndpoint?: string;
  cvmId?: string;
  nearAccount: string;
  storachaPrivateKey: string;
  minWorkers: number;
  maxWorkers: number;
  ensueOrgName?: string;
  ensueClaimUrl?: string;
  ensueVerificationCode?: string;
  registeredAt: string;
}

export function downloadCoordinatorRecoveryFile(data: CoordinatorRecoveryData) {
  const recovery = {
    role: "coordinator",
    ...data,
    note: "Keep this file secure. The storachaPrivateKey is your coordinator's sovereign identity key. Claim the Ensue org to activate coordination memory.",
  };

  const blob = new Blob([JSON.stringify(recovery, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `coordinator-recovery-${data.coordinatorDid.substring(8, 20)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
