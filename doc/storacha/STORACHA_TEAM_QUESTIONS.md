# Questions for Storacha Team

## Context

We're building Delibera — a multi-agent DAO governance system where AI agents maintain
persistent encrypted memory (manifesto, preferences, past decisions) stored in Storacha.
We use `@storacha/encrypt-upload-client` with Lit Protocol for encryption.

Upload is working reliably. The problem is reads.

## Issue: Reads via public IPFS gateways are unreliable

Looking at `decrypt-handler.js` in `@storacha/encrypt-upload-client`, retrieval always goes through:

```js
const url = new URL(`/ipfs/${cid}?format=car`, gatewayURL);
const response = await fetch(url);
```

We experience frequent timeouts (10s+), 520 errors (Cloudflare), and corrupt CAR files from
`storacha.link`, `w3s.link`, `dweb.link`, and `ipfs.io`. Multi-gateway fallback helps but
cold reads after worker restart remain unreliable.

## Questions

### 1. Is there an authenticated download endpoint?
Is there a Storacha API endpoint (e.g. `https://up.storacha.network/`) where we can
download a CAR file using our UCAN delegation proof, bypassing public IPFS DHT?

Example of what we'd like:
```http
GET /download/{cid}
Authorization: Bearer <ucan-delegation>
Accept: application/vnd.ipld.car
```

### 2. How long until content is available at w3s.link after upload?
After `encryptAndUpload()` succeeds and returns a CID, how long should we expect before
`https://w3s.link/ipfs/{cid}?format=car` reliably returns the content?

We've seen cases where the upload succeeds but gateway returns 520 or times out for 30+ seconds.

### 3. Does `@storacha/client` have any retrieval capability?
Looking at the client API, we only see upload and management methods. Is there a `client.get(cid)`
or similar for authenticated retrieval that bypasses public IPFS?

### 4. Are there plans for an authenticated gateway?
Given that UCAN proofs authenticate uploads, is an authenticated download endpoint on the roadmap?
This would let us verify the requester has access to the space before serving content — stronger
than IPFS public gateways.

### 5. Should we use a specific CID format for reliable retrieval?
Should we upload as UnixFS or raw blocks? Does `?format=car&dag-scope=block` improve reliability?

## Current Workaround

We're storing AES-256-GCM encrypted blobs in Ensue Memory Network (our coordination cache)
as the primary read path, with Storacha as the decentralized backup. This works but bypasses
the decentralized read path.

Any guidance on making Storacha reads as reliable as writes would be very helpful!
