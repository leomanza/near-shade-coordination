// Shared NEAR transaction types and utilities used by both worker and coordinator flows.

export interface FunctionCallAction {
  type: "FunctionCall";
  params: {
    methodName: string;
    args: object;
    gas: string;
    deposit: string;
  };
}

export interface NearTransaction {
  receiverId: string;
  actions: FunctionCallAction[];
}
