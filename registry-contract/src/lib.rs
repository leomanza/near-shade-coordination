use near_sdk::{
    env, near, require,
    store::{IterableMap, IterableSet},
    AccountId, BorshStorageKey, NearToken, PanicOnDefault,
};

const DEFAULT_MIN_DEPOSIT: NearToken = NearToken::from_millinear(100); // 0.1 NEAR

/// Domain-separated prefix for the deactivate-worker-by-controller signature.
/// Any change here is a breaking signature-format change — bump the version.
const DEACTIVATE_DOMAIN: &[u8] = b"delibera.deactivate-worker.v1\x00";

#[derive(BorshStorageKey)]
#[near]
pub enum StorageKey {
    _DeprecatedCoordinators, // ordinal 0 — V1 format (dead)
    _DeprecatedWorkers,      // ordinal 1 — V1 format (dead)
    _DeprecatedCoordinatorsV2, // ordinal 2 — V2 format (dead)
    _DeprecatedWorkersV2,    // ordinal 3 — V2 format (dead)
    _DeprecatedWorkersByDidV3, // ordinal 4 — V3 (stale storage from pre-V3.1 deploys)
    _DeprecatedCoordinatorsByDidV3, // ordinal 5 — V3 (stale storage from pre-V3.1 deploys)
    _DeprecatedUsedControllerNoncesV31, // ordinal 6 — V3.1 first cut (stale)
    WorkersByDid,                  // ordinal 7 — V3.1.1 primary index (fresh storage)
    CoordinatorsByDid,             // ordinal 8 — V3.1.1 primary index (fresh storage)
    UsedControllerNonces,          // ordinal 9 — V3.1.1 replay protection (fresh storage)
}

/// A registered worker agent, keyed by `worker_did`.
///
/// Workers are first-class entities in the registry — they do NOT pair to a
/// specific coordinator at registration time. Coordinator discovery happens
/// client-side via `list_active_workers()` + capability/tag filtering, with
/// dispatch auth via off-chain HMAC secrets shared out-of-band.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct WorkerRecord {
    pub account_id: AccountId,
    pub worker_did: String,
    pub endpoint_url: String,
    pub cvm_id: String,
    pub registered_at: u64,
    pub is_active: bool,
    /// Raw 32-byte ed25519 public key that controls deactivation independent
    /// of `account_id`. When `Some`, anyone can deactivate the worker by
    /// supplying a valid ed25519 signature over the canonical challenge.
    /// `None` for backward compat with pre-migration registrations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller_pubkey: Option<[u8; 32]>,
}

/// A registered coordinator, keyed by `coordinator_did`
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct CoordinatorRecord {
    pub account_id: AccountId,
    pub coordinator_did: String,
    pub endpoint_url: String,
    pub cvm_id: String,
    pub min_workers: u8,
    pub max_workers: u8,
    pub registered_at: u64,
    pub is_active: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RegistryContract {
    pub admin: AccountId,
    pub workers_by_did: IterableMap<String, WorkerRecord>,
    pub coordinators_by_did: IterableMap<String, CoordinatorRecord>,
    pub min_deposit: NearToken,
    pub next_worker_seq: u64,
    /// sha256(worker_did || \0 || nonce) base58-encoded. Spent nonces are
    /// recorded here to prevent replay of captured deactivate-by-controller
    /// signatures. Initialized empty on migration — pre-V3.1 records that
    /// never used this path are unaffected.
    pub used_controller_nonces: IterableSet<String>,
}

#[near]
impl RegistryContract {
    #[init]
    #[private]
    pub fn new(admin: AccountId) -> Self {
        Self {
            admin,
            workers_by_did: IterableMap::new(StorageKey::WorkersByDid),
            coordinators_by_did: IterableMap::new(StorageKey::CoordinatorsByDid),
            min_deposit: DEFAULT_MIN_DEPOSIT,
            next_worker_seq: 0,
            used_controller_nonces: IterableSet::new(StorageKey::UsedControllerNonces),
        }
    }

    /// Re-initialize from scratch, discarding any stale state.
    /// Use when deploying a new schema after previous state is incompatible.
    /// All previous coordinator/worker records will be cleared (use only when no live data).
    #[init(ignore_state)]
    #[private]
    pub fn force_reinitialize(admin: AccountId) -> Self {
        Self {
            admin,
            workers_by_did: IterableMap::new(StorageKey::WorkersByDid),
            coordinators_by_did: IterableMap::new(StorageKey::CoordinatorsByDid),
            min_deposit: DEFAULT_MIN_DEPOSIT,
            next_worker_seq: 0,
            used_controller_nonces: IterableSet::new(StorageKey::UsedControllerNonces),
        }
    }

    // V3 → V3.1 migration note: this release adds the optional
    // `controller_pubkey: Option<[u8; 32]>` field to WorkerRecord (borsh
    // schema change at the end of the struct) plus the new
    // `used_controller_nonces: IterableSet<String>` storage map. Existing
    // V3 records cannot be parsed as V3.1 records, so deploys must call
    // `force_reinitialize` and re-register existing workers/coordinators
    // (we maintain the registration list off-chain). A non-destructive
    // migration is tracked separately if/when the active-record count
    // grows past what's reasonable to re-register manually.

    // ========== COORDINATOR REGISTRATION ==========

    /// Register or update a coordinator. Requires minimum deposit.
    #[payable]
    pub fn register_coordinator(
        &mut self,
        coordinator_did: String,
        endpoint_url: String,
        cvm_id: String,
        min_workers: u8,
        max_workers: u8,
    ) -> CoordinatorRecord {
        let deposit = env::attached_deposit();
        require!(
            deposit >= self.min_deposit,
            format!("Minimum deposit is {}, got {}", self.min_deposit, deposit)
        );
        require!(
            coordinator_did.starts_with("did:"),
            "coordinator_did must start with 'did:'"
        );
        require!(
            min_workers <= max_workers,
            "min_workers must be <= max_workers"
        );
        require!(max_workers > 0, "max_workers must be > 0");

        let caller = env::predecessor_account_id();

        // Upsert: update existing or insert new
        if let Some(existing) = self.coordinators_by_did.get(&coordinator_did) {
            require!(
                caller == existing.account_id || caller == self.admin,
                "Only the original registrant or admin can update"
            );
        }

        let record = CoordinatorRecord {
            account_id: caller,
            coordinator_did: coordinator_did.clone(),
            endpoint_url,
            cvm_id,
            min_workers,
            max_workers,
            registered_at: env::block_timestamp(),
            is_active: true,
        };

        self.coordinators_by_did
            .insert(coordinator_did.clone(), record.clone());
        env::log_str(&format!("Registered coordinator: {}", coordinator_did));
        record
    }

    // ========== WORKER REGISTRATION ==========

    /// Register or update a worker. Requires minimum deposit.
    ///
    /// Workers are first-class entities — no `coordinator_did` argument.
    /// Coordinators discover workers via `list_active_workers()` and dispatch
    /// off-chain (HMAC-signed webhook with a pre-shared per-worker secret).
    ///
    #[payable]
    pub fn register_worker(
        &mut self,
        worker_did: String,
        endpoint_url: String,
        cvm_id: String,
    ) -> WorkerRecord {
        self.register_worker_inner(worker_did, endpoint_url, cvm_id, None)
    }

    /// V3.1 variant: also binds a controller pubkey so the worker — not the
    /// `account_id` of the payer — can later deactivate via
    /// `deactivate_worker_by_controller`. `controller_pubkey` is the
    /// base58-encoded 32-byte ed25519 public key.
    #[payable]
    pub fn register_worker_with_controller(
        &mut self,
        worker_did: String,
        endpoint_url: String,
        cvm_id: String,
        controller_pubkey: String,
    ) -> WorkerRecord {
        let bytes = Self::decode_pubkey_or_panic(&controller_pubkey);
        self.register_worker_inner(worker_did, endpoint_url, cvm_id, Some(bytes))
    }

    fn register_worker_inner(
        &mut self,
        worker_did: String,
        endpoint_url: String,
        cvm_id: String,
        controller_pubkey: Option<[u8; 32]>,
    ) -> WorkerRecord {
        let deposit = env::attached_deposit();
        require!(
            deposit >= self.min_deposit,
            format!("Minimum deposit is {}, got {}", self.min_deposit, deposit)
        );
        require!(
            worker_did.starts_with("did:"),
            "worker_did must start with 'did:'"
        );

        let caller = env::predecessor_account_id();

        // Upsert: update existing or insert new
        if let Some(existing) = self.workers_by_did.get(&worker_did) {
            require!(
                caller == existing.account_id || caller == self.admin,
                "Only the original registrant or admin can update"
            );
        }

        let record = WorkerRecord {
            account_id: caller,
            worker_did: worker_did.clone(),
            endpoint_url,
            cvm_id,
            registered_at: env::block_timestamp(),
            is_active: true,
            controller_pubkey,
        };

        self.workers_by_did
            .insert(worker_did.clone(), record.clone());
        env::log_str(&format!("Registered worker: {}", worker_did));
        record
    }

    // ========== MUTATORS ==========

    /// Update a worker's endpoint URL (only the worker's account_id or admin)
    pub fn update_worker_endpoint(&mut self, worker_did: String, endpoint_url: String) {
        let entry = self
            .workers_by_did
            .get_mut(&worker_did)
            .expect("Worker not found");
        let caller = env::predecessor_account_id();
        require!(
            caller == entry.account_id || caller == self.admin,
            "Only worker owner or admin can update endpoint"
        );
        entry.endpoint_url = endpoint_url;
        env::log_str(&format!("Updated endpoint for worker: {}", worker_did));
    }

    /// Deactivate a worker (only the worker's account_id or admin).
    ///
    /// For workers registered with a `controller_pubkey`, the off-chain
    /// controller path via [`deactivate_worker_by_controller`] is also
    /// available — it doesn't require the predecessor to match the
    /// registrant.
    pub fn deactivate_worker(&mut self, worker_did: String) {
        let entry = self
            .workers_by_did
            .get_mut(&worker_did)
            .expect("Worker not found");
        let caller = env::predecessor_account_id();
        require!(
            caller == entry.account_id || caller == self.admin,
            "Only worker owner or admin can deactivate"
        );
        entry.is_active = false;
        env::log_str(&format!("Deactivated worker: {}", worker_did));
    }

    /// Deactivate a worker by presenting an ed25519 signature from its
    /// registered `controller_pubkey` (V3.1+). The predecessor does NOT need
    /// to match `account_id` — any caller paying gas can submit.
    ///
    /// Signature scheme:
    ///   message = b"delibera.deactivate-worker.v1\x00"
    ///              || worker_did_bytes || b"\x00" || nonce_bytes
    ///   ed25519_verify(signature, message, controller_pubkey) == true
    ///
    /// `nonce` is any caller-chosen string (recommended: 16+ random bytes
    /// hex/base58-encoded). The contract records `(worker_did, nonce)` pairs
    /// to reject replays.
    pub fn deactivate_worker_by_controller(
        &mut self,
        worker_did: String,
        nonce: String,
        signature: String,
    ) {
        require!(!nonce.is_empty(), "nonce must not be empty");

        // Fetch + capture controller pubkey before mutating
        let controller_pubkey = self
            .workers_by_did
            .get(&worker_did)
            .expect("Worker not found")
            .controller_pubkey
            .unwrap_or_else(|| {
                env::panic_str(
                    "Worker has no controller_pubkey — use deactivate_worker (predecessor auth) instead",
                )
            });

        // Replay protection — derive a collision-free key from (worker_did, nonce)
        let nonce_key = Self::nonce_storage_key(&worker_did, &nonce);
        require!(
            !self.used_controller_nonces.contains(&nonce_key),
            "Nonce already used for this worker"
        );

        // Decode signature
        let sig_bytes = near_sdk::bs58::decode(&signature)
            .into_vec()
            .unwrap_or_else(|_| env::panic_str("signature is not valid base58"));
        require!(sig_bytes.len() == 64, "signature must decode to 64 bytes");
        let mut sig_arr = [0u8; 64];
        sig_arr.copy_from_slice(&sig_bytes);

        // Build canonical message
        let mut msg =
            Vec::with_capacity(DEACTIVATE_DOMAIN.len() + worker_did.len() + 1 + nonce.len());
        msg.extend_from_slice(DEACTIVATE_DOMAIN);
        msg.extend_from_slice(worker_did.as_bytes());
        msg.push(0);
        msg.extend_from_slice(nonce.as_bytes());

        require!(
            env::ed25519_verify(&sig_arr, &msg, &controller_pubkey),
            "ed25519 signature verification failed"
        );

        // Spend nonce + flip is_active
        self.used_controller_nonces.insert(nonce_key);
        let entry = self.workers_by_did.get_mut(&worker_did).unwrap();
        entry.is_active = false;
        env::log_str(&format!(
            "Deactivated worker via controller signature: {}",
            worker_did
        ));
    }

    // --- internal helpers ---

    fn decode_pubkey_or_panic(s: &str) -> [u8; 32] {
        let bytes = near_sdk::bs58::decode(s)
            .into_vec()
            .unwrap_or_else(|_| env::panic_str("controller_pubkey is not valid base58"));
        require!(
            bytes.len() == 32,
            "controller_pubkey must decode to 32 bytes"
        );
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        arr
    }

    fn nonce_storage_key(worker_did: &str, nonce: &str) -> String {
        let mut buf = Vec::with_capacity(worker_did.len() + 1 + nonce.len());
        buf.extend_from_slice(worker_did.as_bytes());
        buf.push(0);
        buf.extend_from_slice(nonce.as_bytes());
        let digest = env::sha256_array(&buf);
        near_sdk::bs58::encode(digest).into_string()
    }

    /// Deactivate a coordinator (only the coordinator's account_id or admin)
    pub fn deactivate_coordinator(&mut self, coordinator_did: String) {
        let entry = self
            .coordinators_by_did
            .get_mut(&coordinator_did)
            .expect("Coordinator not found");
        let caller = env::predecessor_account_id();
        require!(
            caller == entry.account_id || caller == self.admin,
            "Only coordinator owner or admin can deactivate"
        );
        entry.is_active = false;
        env::log_str(&format!("Deactivated coordinator: {}", coordinator_did));
    }

    // ========== ADMIN ==========

    /// Set the minimum deposit required to register (admin only)
    pub fn set_min_deposit(&mut self, amount_yocto: String) {
        require!(
            env::predecessor_account_id() == self.admin,
            "Only admin can set min deposit"
        );
        let yocto: u128 = amount_yocto.parse().expect("Invalid yocto amount");
        self.min_deposit = NearToken::from_yoctonear(yocto);
        env::log_str(&format!("Min deposit set to {}", self.min_deposit));
    }

    // ========== VIEW FUNCTIONS ==========

    // NOTE: `get_workers_for_coordinator(coordinator_did)` was removed when
    // workers became first-class (no coordinator pairing in WorkerRecord).
    // Coordinators discover workers via `list_active_workers()` + client-side
    // filter (by capability/tag/out-of-band agreement).

    /// Look up a single worker by DID
    pub fn get_worker_by_did(&self, worker_did: String) -> Option<WorkerRecord> {
        self.workers_by_did.get(&worker_did).cloned()
    }

    /// Look up a single coordinator by DID
    pub fn get_coordinator_by_did(&self, coordinator_did: String) -> Option<CoordinatorRecord> {
        self.coordinators_by_did.get(&coordinator_did).cloned()
    }

    /// List all active workers
    pub fn list_active_workers(&self) -> Vec<WorkerRecord> {
        self.workers_by_did
            .values()
            .filter(|w| w.is_active)
            .cloned()
            .collect()
    }

    /// List all active coordinators
    pub fn list_active_coordinators(&self) -> Vec<CoordinatorRecord> {
        self.coordinators_by_did
            .values()
            .filter(|c| c.is_active)
            .cloned()
            .collect()
    }

    /// Get registry statistics
    pub fn get_stats(&self) -> serde_json::Value {
        let active_coords = self
            .coordinators_by_did
            .values()
            .filter(|c| c.is_active)
            .count();
        let active_workers = self
            .workers_by_did
            .values()
            .filter(|w| w.is_active)
            .count();
        serde_json::json!({
            "total_coordinators": self.coordinators_by_did.len(),
            "active_coordinators": active_coords,
            "total_workers": self.workers_by_did.len(),
            "active_workers": active_workers,
        })
    }

    /// Get the admin account
    pub fn get_admin(&self) -> AccountId {
        self.admin.clone()
    }

    /// Get the current minimum deposit (as yoctoNEAR string)
    pub fn get_min_deposit(&self) -> String {
        self.min_deposit.as_yoctonear().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const COORD_DID: &str = "did:key:z6MkCoordinator1";
    const WORKER_DID: &str = "did:key:z6MkWorker1";
    const WORKER_DID_2: &str = "did:key:z6MkWorker2";

    // Test fixtures — regenerate with `node scripts/gen-test-keypair.mjs`
    // if you change the controller signing-message constants.
    const CONTROLLER_WORKER_DID: &str = "did:key:z6MkController1";
    const TEST_CONTROLLER_PUBKEY_B58: &str = "9ShWVwMmNp4EJPz8beiKuxKYGzPN2aGdxcXiUKqjpp7H";
    const TEST_NONCE_1: &str = "nonce-1";
    const TEST_NONCE_2: &str = "nonce-2";
    const TEST_SIG_NONCE_1_B58: &str =
        "WcdMZrmRp4nhBDzWSHTux54DcpVyPSQBhnsMrnyatDVHSrfBQqHP9oNk9e3WWZdpMPeNAz6HD8qYcZ5h8sV7yRF";
    const TEST_SIG_NONCE_2_B58: &str =
        "37M2DJMUgWSEituMCXZx7QTVCoVWFkCqeY7L3PyAGU88zzy5SQp8cyMj5pJZak5xgNghM6jHQiDECTv8y6Eagjaa";
    const TEST_SIG_FROM_OTHER_KEY_B58: &str =
        "v46qcfdv1ZivnTm26YRcXzgVGJccwZzrhEckgDGq5BgBGX9y5QeqwpnNQMZ54uTjgvFiS9JfU9SF2iccCaeseX8";

    fn get_context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor)
            .attached_deposit(NearToken::from_near(1));
        builder
    }

    fn setup_contract() -> RegistryContract {
        let context = get_context(accounts(0));
        testing_env!(context.build());
        RegistryContract::new(accounts(0))
    }

    fn register_test_coordinator(contract: &mut RegistryContract) -> CoordinatorRecord {
        contract.register_coordinator(
            COORD_DID.to_string(),
            "https://coord.example.com".to_string(),
            "cvm-coord-1".to_string(),
            1,
            5,
        )
    }

    fn register_test_worker(contract: &mut RegistryContract) -> WorkerRecord {
        contract.register_worker(
            WORKER_DID.to_string(),
            "https://worker1.example.com".to_string(),
            "cvm-worker-1".to_string(),
        )
    }

    fn register_test_worker_with_controller(contract: &mut RegistryContract) -> WorkerRecord {
        contract.register_worker_with_controller(
            CONTROLLER_WORKER_DID.to_string(),
            "https://controller-worker.example.com".to_string(),
            "cvm-ctrl-1".to_string(),
            TEST_CONTROLLER_PUBKEY_B58.to_string(),
        )
    }

    // ========== INIT ==========

    #[test]
    fn test_init() {
        let contract = setup_contract();
        assert_eq!(contract.get_admin(), accounts(0));
        assert_eq!(contract.list_active_coordinators().len(), 0);
        assert_eq!(contract.list_active_workers().len(), 0);
        assert_eq!(
            contract.get_min_deposit(),
            NearToken::from_millinear(100).as_yoctonear().to_string()
        );
    }

    // ========== COORDINATOR REGISTRATION ==========

    #[test]
    fn test_register_coordinator_success() {
        let mut contract = setup_contract();
        let record = register_test_coordinator(&mut contract);

        assert_eq!(record.coordinator_did, COORD_DID);
        assert_eq!(record.account_id, accounts(0));
        assert_eq!(record.endpoint_url, "https://coord.example.com");
        assert_eq!(record.cvm_id, "cvm-coord-1");
        assert_eq!(record.min_workers, 1);
        assert_eq!(record.max_workers, 5);
        assert!(record.is_active);
        assert_eq!(contract.list_active_coordinators().len(), 1);
    }

    #[test]
    #[should_panic(expected = "Minimum deposit")]
    fn test_register_coordinator_low_deposit() {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(0))
            .signer_account_id(accounts(0))
            .attached_deposit(NearToken::from_millinear(1)); // 0.001 NEAR < 0.1 min
        testing_env!(builder.build());
        let mut contract = RegistryContract::new(accounts(0));
        contract.register_coordinator(
            COORD_DID.to_string(),
            "https://coord.example.com".to_string(),
            "cvm-1".to_string(),
            1,
            3,
        );
    }

    #[test]
    #[should_panic(expected = "coordinator_did must start with 'did:'")]
    fn test_register_coordinator_invalid_did() {
        let mut contract = setup_contract();
        contract.register_coordinator(
            "not-a-did".to_string(),
            "https://coord.example.com".to_string(),
            "cvm-1".to_string(),
            1,
            3,
        );
    }

    #[test]
    fn test_register_coordinator_upsert() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);

        // Re-register same DID with updated endpoint
        let updated = contract.register_coordinator(
            COORD_DID.to_string(),
            "https://new-coord.example.com".to_string(),
            "cvm-coord-2".to_string(),
            2,
            10,
        );
        assert_eq!(updated.endpoint_url, "https://new-coord.example.com");
        assert_eq!(updated.max_workers, 10);
        // Should still be 1 coordinator, not 2
        assert_eq!(contract.list_active_coordinators().len(), 1);
    }

    // ========== WORKER REGISTRATION ==========

    #[test]
    fn test_register_worker_success() {
        let mut contract = setup_contract();
        // Workers are first-class — no coordinator needs to exist beforehand.
        let record = register_test_worker(&mut contract);

        assert_eq!(record.worker_did, WORKER_DID);
        assert_eq!(record.account_id, accounts(0));
        assert_eq!(record.endpoint_url, "https://worker1.example.com");
        assert_eq!(record.cvm_id, "cvm-worker-1");
        assert!(record.is_active);
        assert_eq!(contract.list_active_workers().len(), 1);
    }

    #[test]
    fn test_register_worker_without_coordinator() {
        // Explicit regression for the first-class workers change: a worker
        // must register successfully without any coordinator existing in the
        // registry.
        let mut contract = setup_contract();
        assert_eq!(contract.list_active_coordinators().len(), 0);

        let record = register_test_worker(&mut contract);
        assert_eq!(record.worker_did, WORKER_DID);
        assert_eq!(contract.list_active_workers().len(), 1);
        // Coordinators list still empty — workers don't auto-create coordinators
        assert_eq!(contract.list_active_coordinators().len(), 0);
    }

    #[test]
    #[should_panic(expected = "Minimum deposit")]
    fn test_register_worker_low_deposit() {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(0))
            .signer_account_id(accounts(0))
            .attached_deposit(NearToken::from_millinear(1)); // 0.001 NEAR < 0.1 min
        testing_env!(builder.build());
        let mut contract = RegistryContract::new(accounts(0));

        contract.register_worker(
            WORKER_DID.to_string(),
            "https://worker.example.com".to_string(),
            "cvm-w-1".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "worker_did must start with 'did:'")]
    fn test_register_worker_invalid_did() {
        let mut contract = setup_contract();
        contract.register_worker(
            "not-a-did".to_string(),
            "https://worker.example.com".to_string(),
            "cvm-w-1".to_string(),
        );
    }

    #[test]
    fn test_register_worker_upsert() {
        let mut contract = setup_contract();
        register_test_worker(&mut contract);

        // Re-register same worker DID with updated endpoint
        let updated = contract.register_worker(
            WORKER_DID.to_string(),
            "https://new-worker.example.com".to_string(),
            "cvm-worker-updated".to_string(),
        );
        assert_eq!(updated.endpoint_url, "https://new-worker.example.com");
        assert_eq!(contract.list_active_workers().len(), 1);
    }

    // ========== VIEW: list_active_workers ==========

    #[test]
    fn test_list_active_workers_returns_all() {
        let mut contract = setup_contract();
        register_test_worker(&mut contract);

        // Register a second worker — no coordinator pairing required
        contract.register_worker(
            WORKER_DID_2.to_string(),
            "https://worker2.example.com".to_string(),
            "cvm-worker-2".to_string(),
        );

        let workers = contract.list_active_workers();
        assert_eq!(workers.len(), 2);

        // Deactivating one excludes it from the active list
        contract.deactivate_worker(WORKER_DID.to_string());
        let workers = contract.list_active_workers();
        assert_eq!(workers.len(), 1);
        assert_eq!(workers[0].worker_did, WORKER_DID_2);
    }

    // ========== VIEW: get_worker_by_did ==========

    #[test]
    fn test_get_worker_by_did_found() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        let worker = contract.get_worker_by_did(WORKER_DID.to_string());
        assert!(worker.is_some());
        assert_eq!(worker.unwrap().worker_did, WORKER_DID);
    }

    #[test]
    fn test_get_worker_by_did_not_found() {
        let contract = setup_contract();
        let worker = contract.get_worker_by_did("did:key:z6MkNonexistent".to_string());
        assert!(worker.is_none());
    }

    // ========== DEACTIVATE WORKER ==========

    #[test]
    fn test_deactivate_worker() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        assert_eq!(contract.list_active_workers().len(), 1);
        contract.deactivate_worker(WORKER_DID.to_string());
        assert_eq!(contract.list_active_workers().len(), 0);

        // Worker still exists, just inactive
        let worker = contract.get_worker_by_did(WORKER_DID.to_string());
        assert!(worker.is_some());
        assert!(!worker.unwrap().is_active);
    }

    #[test]
    #[should_panic(expected = "Only worker owner or admin can deactivate")]
    fn test_deactivate_worker_unauthorized() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        // Switch to a different caller
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(1))
            .signer_account_id(accounts(1));
        testing_env!(builder.build());

        contract.deactivate_worker(WORKER_DID.to_string());
    }

    // ========== UPDATE WORKER ENDPOINT ==========

    #[test]
    fn test_update_worker_endpoint() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        contract.update_worker_endpoint(
            WORKER_DID.to_string(),
            "https://updated-endpoint.example.com".to_string(),
        );

        let worker = contract.get_worker_by_did(WORKER_DID.to_string()).unwrap();
        assert_eq!(worker.endpoint_url, "https://updated-endpoint.example.com");
    }

    #[test]
    #[should_panic(expected = "Only worker owner or admin can update endpoint")]
    fn test_update_worker_endpoint_unauthorized() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(1))
            .signer_account_id(accounts(1));
        testing_env!(builder.build());

        contract.update_worker_endpoint(
            WORKER_DID.to_string(),
            "https://hacker.example.com".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "Worker not found")]
    fn test_update_worker_endpoint_not_found() {
        let mut contract = setup_contract();
        contract.update_worker_endpoint(
            "did:key:z6MkNonexistent".to_string(),
            "https://example.com".to_string(),
        );
    }

    // ========== DEACTIVATE COORDINATOR ==========

    #[test]
    fn test_deactivate_coordinator() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);

        assert_eq!(contract.list_active_coordinators().len(), 1);
        contract.deactivate_coordinator(COORD_DID.to_string());
        assert_eq!(contract.list_active_coordinators().len(), 0);

        let coord = contract.get_coordinator_by_did(COORD_DID.to_string());
        assert!(coord.is_some());
        assert!(!coord.unwrap().is_active);
    }

    // ========== ADMIN ==========

    #[test]
    fn test_set_min_deposit() {
        let mut contract = setup_contract();
        let new_deposit = NearToken::from_millinear(500).as_yoctonear().to_string();
        contract.set_min_deposit(new_deposit.clone());
        assert_eq!(contract.get_min_deposit(), new_deposit);
    }

    #[test]
    #[should_panic(expected = "Only admin can set min deposit")]
    fn test_set_min_deposit_unauthorized() {
        let mut contract = setup_contract();

        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(1))
            .signer_account_id(accounts(1));
        testing_env!(builder.build());

        contract.set_min_deposit("1000000000000000000000000".to_string());
    }

    // ========== STATS ==========

    #[test]
    fn test_get_stats() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        let stats = contract.get_stats();
        assert_eq!(stats["total_coordinators"], 1);
        assert_eq!(stats["active_coordinators"], 1);
        assert_eq!(stats["total_workers"], 1);
        assert_eq!(stats["active_workers"], 1);

        contract.deactivate_worker(WORKER_DID.to_string());
        let stats = contract.get_stats();
        assert_eq!(stats["total_workers"], 1);
        assert_eq!(stats["active_workers"], 0);
    }

    // ========== V3.1: CONTROLLER-PUBKEY DEACTIVATION ==========

    /// Switch the predecessor for the next contract call. Useful for asserting
    /// that the controller-deactivation path works from ANY predecessor.
    fn become_caller(caller: AccountId) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(caller.clone())
            .signer_account_id(caller)
            .attached_deposit(NearToken::from_yoctonear(0));
        testing_env!(b.build());
    }

    #[test]
    fn test_register_worker_without_controller_pubkey_backward_compat() {
        // The default helper passes None; the resulting record has
        // controller_pubkey: None, matching pre-V3.1 behavior.
        let mut contract = setup_contract();
        let record = register_test_worker(&mut contract);
        assert!(record.controller_pubkey.is_none());
    }

    #[test]
    fn test_register_worker_with_valid_controller_pubkey_stores_bytes() {
        let mut contract = setup_contract();
        let record = register_test_worker_with_controller(&mut contract);
        assert!(record.controller_pubkey.is_some());
        let bytes = record.controller_pubkey.unwrap();
        // The bytes should round-trip back to the input base58
        let encoded = near_sdk::bs58::encode(bytes).into_string();
        assert_eq!(encoded, TEST_CONTROLLER_PUBKEY_B58);
    }

    #[test]
    #[should_panic(expected = "controller_pubkey is not valid base58")]
    fn test_register_worker_invalid_controller_pubkey_not_base58() {
        let mut contract = setup_contract();
        contract.register_worker_with_controller(
            CONTROLLER_WORKER_DID.to_string(),
            "https://w.example.com".to_string(),
            "cvm-c-1".to_string(),
            // '0' and 'I' are invalid base58 characters
            "0OIl_NOT_BASE58_AT_ALL_!@#".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "controller_pubkey must decode to 32 bytes")]
    fn test_register_worker_invalid_controller_pubkey_wrong_length() {
        let mut contract = setup_contract();
        // Valid base58 but only ~5 bytes when decoded ("hello")
        contract.register_worker_with_controller(
            CONTROLLER_WORKER_DID.to_string(),
            "https://w.example.com".to_string(),
            "cvm-c-1".to_string(),
            near_sdk::bs58::encode(b"hello").into_string(),
        );
    }

    #[test]
    fn test_existing_deactivate_worker_path_unchanged_for_controller_worker() {
        // A worker with controller_pubkey set can still be deactivated via the
        // legacy predecessor-auth path — the new field is additive.
        let mut contract = setup_contract();
        register_test_worker_with_controller(&mut contract);

        contract.deactivate_worker(CONTROLLER_WORKER_DID.to_string());
        let w = contract
            .get_worker_by_did(CONTROLLER_WORKER_DID.to_string())
            .unwrap();
        assert!(!w.is_active);
    }

    #[test]
    fn test_deactivate_worker_by_controller_success_from_arbitrary_predecessor() {
        let mut contract = setup_contract();
        register_test_worker_with_controller(&mut contract);

        // Caller is a completely unrelated account — this is the whole point.
        become_caller(accounts(2));

        contract.deactivate_worker_by_controller(
            CONTROLLER_WORKER_DID.to_string(),
            TEST_NONCE_1.to_string(),
            TEST_SIG_NONCE_1_B58.to_string(),
        );

        let w = contract
            .get_worker_by_did(CONTROLLER_WORKER_DID.to_string())
            .unwrap();
        assert!(!w.is_active);
        // controller_pubkey should be preserved
        assert!(w.controller_pubkey.is_some());
    }

    #[test]
    #[should_panic(expected = "ed25519 signature verification failed")]
    fn test_deactivate_worker_by_controller_wrong_signature() {
        let mut contract = setup_contract();
        register_test_worker_with_controller(&mut contract);
        // Signature signed by a different key, over the same canonical msg
        contract.deactivate_worker_by_controller(
            CONTROLLER_WORKER_DID.to_string(),
            TEST_NONCE_1.to_string(),
            TEST_SIG_FROM_OTHER_KEY_B58.to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "Nonce already used for this worker")]
    fn test_deactivate_worker_by_controller_replay_rejected() {
        let mut contract = setup_contract();
        register_test_worker_with_controller(&mut contract);
        // First use spends the nonce
        contract.deactivate_worker_by_controller(
            CONTROLLER_WORKER_DID.to_string(),
            TEST_NONCE_1.to_string(),
            TEST_SIG_NONCE_1_B58.to_string(),
        );
        // Re-using same (did, nonce) — replay
        contract.deactivate_worker_by_controller(
            CONTROLLER_WORKER_DID.to_string(),
            TEST_NONCE_1.to_string(),
            TEST_SIG_NONCE_1_B58.to_string(),
        );
    }

    #[test]
    fn test_deactivate_worker_by_controller_fresh_nonce_works_after_first() {
        // Sanity: it's the (did, nonce) PAIR that's spent, not just the nonce.
        // After spending nonce-1, nonce-2 with a valid sig should still work.
        let mut contract = setup_contract();
        register_test_worker_with_controller(&mut contract);
        contract.deactivate_worker_by_controller(
            CONTROLLER_WORKER_DID.to_string(),
            TEST_NONCE_1.to_string(),
            TEST_SIG_NONCE_1_B58.to_string(),
        );
        // Worker is now inactive. Re-activate via legacy upsert is out of scope
        // for this test; we just confirm a fresh-nonce call doesn't get
        // replay-blocked. (Calling deactivate on already-inactive worker is
        // intentionally allowed — idempotent.)
        contract.deactivate_worker_by_controller(
            CONTROLLER_WORKER_DID.to_string(),
            TEST_NONCE_2.to_string(),
            TEST_SIG_NONCE_2_B58.to_string(),
        );
        let w = contract
            .get_worker_by_did(CONTROLLER_WORKER_DID.to_string())
            .unwrap();
        assert!(!w.is_active);
    }

    #[test]
    #[should_panic(expected = "Worker has no controller_pubkey")]
    fn test_deactivate_worker_by_controller_no_pubkey_set() {
        // A pre-V3.1-style worker (no controller_pubkey) cannot be deactivated
        // via the controller path — only the legacy predecessor path.
        let mut contract = setup_contract();
        register_test_worker(&mut contract);
        contract.deactivate_worker_by_controller(
            WORKER_DID.to_string(),
            TEST_NONCE_1.to_string(),
            TEST_SIG_NONCE_1_B58.to_string(),
        );
    }

    #[test]
    fn test_serialization_omits_controller_pubkey_when_none() {
        // The #[serde(skip_serializing_if = "Option::is_none")] attribute
        // means JSON output for a no-controller-pubkey worker doesn't include
        // the field at all. JS callers that don't know about V3.1 see the
        // same shape they did before.
        let mut contract = setup_contract();
        register_test_worker(&mut contract);
        let w = contract.get_worker_by_did(WORKER_DID.to_string()).unwrap();
        let json = serde_json::to_value(&w).unwrap();
        assert!(json.get("controller_pubkey").is_none(), "controller_pubkey should be skipped, got: {}", json);

        // For a V3.1 worker WITH controller_pubkey, the field IS in the JSON
        register_test_worker_with_controller(&mut contract);
        let w = contract
            .get_worker_by_did(CONTROLLER_WORKER_DID.to_string())
            .unwrap();
        let json = serde_json::to_value(&w).unwrap();
        assert!(json.get("controller_pubkey").is_some());
    }
}

#[cfg(test)]
mod borsh_compat_tests {
    use borsh::{BorshDeserialize, BorshSerialize};

    #[derive(BorshSerialize, BorshDeserialize)]
    struct OldShape { s: String, n: u64, b: bool }

    #[derive(BorshSerialize, BorshDeserialize, Debug)]
    struct NewShape { s: String, n: u64, b: bool, new_field: Option<[u8; 32]> }

    /// Empirical confirmation that deploying V3.1 over V3 IS destructive:
    /// borsh does not default `Option<T>` to None on EOF — adding a new
    /// optional field to the end of a struct breaks deserialization of
    /// existing rows. Recorded here so future contributors don't re-derive
    /// the same conclusion. Asserts the FAILURE shape we measured on
    /// borsh 1.5: `Custom { kind: InvalidData, error: "Unexpected length of input" }`.
    #[test]
    fn v3_v31_borsh_compat_is_destructive() {
        let old = OldShape { s: "did:key:test".to_string(), n: 42, b: true };
        let bytes = borsh::to_vec(&old).unwrap();
        let parsed = NewShape::try_from_slice(&bytes);
        assert!(
            parsed.is_err(),
            "borsh changed behavior — V3 → V3.1 might now be non-destructive, revisit the migration plan"
        );
        let err = parsed.unwrap_err().to_string();
        assert!(
            err.contains("Unexpected length of input"),
            "unexpected borsh error shape: {err}"
        );
    }
}
