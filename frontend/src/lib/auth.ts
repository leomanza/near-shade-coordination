"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { createElement } from "react";
import { NearConnector } from "@hot-labs/near-connect";
import { getOnChainState, type RegisteredWorker } from "./api";

export type Role = "coordinator" | "worker" | "none";

export interface AuthState {
  /** Connected NEAR account ID, or null if not connected */
  accountId: string | null;
  /** Detected role based on contract state */
  role: Role;
  /** If role is "worker", the matched workerId */
  workerId: string | null;
  /** Whether wallet is currently connecting */
  connecting: boolean;
  /** Connect wallet — opens near-connect selector */
  connect: () => Promise<void>;
  /** Disconnect wallet */
  disconnect: () => Promise<void>;
}

const NEAR_NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK || "testnet") as "mainnet" | "testnet";

const AuthContext = createContext<AuthState>({
  accountId: null,
  role: "none",
  workerId: null,
  connecting: false,
  connect: async () => {},
  disconnect: async () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/**
 * Detect role by comparing accountId against contract owner and registered workers.
 */
async function detectRole(
  accountId: string
): Promise<{ role: Role; workerId: string | null }> {
  const state = await getOnChainState();
  if (!state) return { role: "none", workerId: null };

  // Check if coordinator (owner)
  if (accountId === state.owner) {
    return { role: "coordinator", workerId: null };
  }

  // Check if registered worker
  const match = state.registeredWorkers.find(
    (w: RegisteredWorker) => w.account_id === accountId && w.active
  );
  if (match) {
    return { role: "worker", workerId: match.worker_id };
  }

  return { role: "none", workerId: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("none");
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const connectorRef = useRef<NearConnector | null>(null);

  // Initialize connector (client-side only)
  useEffect(() => {
    const connector = new NearConnector({
      network: NEAR_NETWORK,
      autoConnect: true,
    });
    connectorRef.current = connector;

    // Listen for sign-in events
    connector.on("wallet:signIn", async ({ accounts, success }) => {
      if (success && accounts.length > 0) {
        const id = accounts[0].accountId;
        setAccountId(id);
        const detected = await detectRole(id);
        setRole(detected.role);
        setWorkerId(detected.workerId);
      }
    });

    connector.on("wallet:signOut", () => {
      setAccountId(null);
      setRole("none");
      setWorkerId(null);
    });

    // Check for existing connection
    connector
      .getConnectedWallet()
      .then(async ({ accounts }) => {
        if (accounts.length > 0) {
          const id = accounts[0].accountId;
          setAccountId(id);
          const detected = await detectRole(id);
          setRole(detected.role);
          setWorkerId(detected.workerId);
        }
      })
      .catch(() => {
        // No connected wallet — that's fine
      });
  }, []);

  const connect = useCallback(async () => {
    const connector = connectorRef.current;
    if (!connector) return;
    setConnecting(true);
    try {
      const wallet = await connector.connect();
      const accounts = await wallet.getAccounts();
      if (accounts.length > 0) {
        const id = accounts[0].accountId;
        setAccountId(id);
        const detected = await detectRole(id);
        setRole(detected.role);
        setWorkerId(detected.workerId);
      }
    } catch (err) {
      console.error("Wallet connection failed:", err);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const connector = connectorRef.current;
    if (!connector) return;
    try {
      await connector.disconnect();
    } catch (err) {
      console.error("Wallet disconnect failed:", err);
    }
    setAccountId(null);
    setRole("none");
    setWorkerId(null);
  }, []);

  return createElement(
    AuthContext.Provider,
    {
      value: { accountId, role, workerId, connecting, connect, disconnect },
    },
    children
  );
}
