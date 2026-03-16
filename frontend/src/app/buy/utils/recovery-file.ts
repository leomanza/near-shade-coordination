/**
 * Generate and trigger download of a worker recovery file.
 */

export interface RecoveryData {
  workerDid: string;
  displayName: string;
  coordinatorDid: string;
  phalaEndpoint?: string;
  cvmId?: string;
  nearAccount: string;
  storachaPrivateKey: string;
  registeredAt: string;
}

export function downloadRecoveryFile(data: RecoveryData) {
  const recovery = {
    workerDid: data.workerDid,
    displayName: data.displayName,
    coordinatorDid: data.coordinatorDid,
    phalaEndpoint: data.phalaEndpoint,
    cvmId: data.cvmId,
    nearAccount: data.nearAccount,
    storachaPrivateKey: data.storachaPrivateKey,
    registeredAt: data.registeredAt,
    note: "Keep this file secure. The storachaPrivateKey is your worker's sovereign identity key.",
  };

  const blob = new Blob([JSON.stringify(recovery, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `worker-recovery-${data.workerDid.substring(8, 20)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
