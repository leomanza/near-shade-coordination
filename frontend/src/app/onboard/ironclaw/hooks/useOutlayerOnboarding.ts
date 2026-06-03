import { useCallback, useEffect, useReducer } from 'react';

export type OnboardingStep =
  | 'connect'      // need NEAR wallet
  | 'config'       // pick seed + path
  | 'register'     // POST /register
  | 'fund'         // need to fund implicit account
  | 'policy'       // commit policy on-chain
  | 'autonomous'   // POST /wallet/v1/call register_worker
  | 'install'      // skill install instructions
  | 'success';

export type Path = 'A_anonymous' | 'B_bound';

export interface OnboardingState {
  step: OnboardingStep;
  path: Path;
  seed: string;
  endpoint_url: string;
  cvm_id: string;
  wallet?: {
    wallet_id: string;
    api_key: string;
    near_account_id: string;
  };
  worker_did?: string;
  policy_tx_hash?: string;
  register_tx_hash?: string;
  error?: string;
}

export type OnboardingAction =
  | { type: 'set_step'; step: OnboardingStep }
  | { type: 'set_path'; path: Path }
  | { type: 'set_seed'; seed: string }
  | { type: 'set_endpoint'; endpoint_url: string; cvm_id: string }
  | { type: 'set_wallet'; wallet: NonNullable<OnboardingState['wallet']>; worker_did: string }
  | { type: 'set_policy_tx'; tx_hash: string }
  | { type: 'set_register_tx'; tx_hash: string }
  | { type: 'set_error'; error?: string }
  | { type: 'reset' };

const STORAGE_KEY = 'delibera.onboard.ironclaw.v1';

const initial: OnboardingState = {
  step: 'connect',
  path: 'A_anonymous',
  seed: '',
  endpoint_url: '',
  cvm_id: 'outlayer-tdx',
};

function reducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'set_step': return { ...state, step: action.step, error: undefined };
    case 'set_path': return { ...state, path: action.path };
    case 'set_seed': return { ...state, seed: action.seed };
    case 'set_endpoint': return { ...state, endpoint_url: action.endpoint_url, cvm_id: action.cvm_id };
    case 'set_wallet': return { ...state, wallet: action.wallet, worker_did: action.worker_did };
    case 'set_policy_tx': return { ...state, policy_tx_hash: action.tx_hash };
    case 'set_register_tx': return { ...state, register_tx_hash: action.tx_hash };
    case 'set_error': return { ...state, error: action.error };
    case 'reset':
      if (typeof window !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
      return initial;
  }
}

function loadInitial(): OnboardingState {
  if (typeof window === 'undefined') return initial;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return initial;
    return { ...initial, ...(JSON.parse(raw) as Partial<OnboardingState>) };
  } catch {
    return initial;
  }
}

/**
 * Onboarding wizard state machine. The api_key (sensitive) is kept in
 * sessionStorage so a page refresh resumes the flow within the same tab.
 * Closing the tab wipes it — the success screen warns the user.
 */
export function useOutlayerOnboarding() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const advance = useCallback((step: OnboardingStep) => dispatch({ type: 'set_step', step }), []);
  const setError = useCallback((error?: string) => dispatch({ type: 'set_error', error }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return { state, dispatch, advance, setError, reset };
}

export type OnboardingApi = ReturnType<typeof useOutlayerOnboarding>;
