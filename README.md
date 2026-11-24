# IikanSwap — Ammora SDK Exchange on GIWA Sepolia

A minimal exchange built with the [Ammora SDK](https://www.npmjs.com/package/@ammora-protocol/sdk)
(`@ammora-protocol/sdk@0.3.9`): swap **ETH ⇄ tAMM** on the live Ammora pool on
**GIWA Sepolia testnet** (chain 91342), plus live launchpad discovery via the SDK's Data API.

Live demo: https://aldozz189.github.io/ammora-sdk-swap-demo/

Built for the Ammora Season 2 **builder mission**: "Ship an exchange or launchpad with the
Ammora SDK." Status: exchange shipped; launches listed live from the indexer.

## What it does

- **Swap tab** — live quote + swap ETH ⇄ tAMM on the tAMM/ETH pool
  `0x1EF92A6a9BB4bBed2b385Dd5E688F88e7965BCf8` via the native router
  `0x4FC91b90087288520A7bB4aA7Ab5441bb4E9C496` (the same pool/router Ammora's own site
  uses for its Season 2 daily swap).
  - Quote: the pool's own quote view (`0xfc521e91`), verified live (0.001 ETH → 253,350 tAMM).
  - Execution calldata: built by the real SDK — `buildV3NativePoolExactInput` (ETH → tAMM)
    and `buildV3PoolExactInputForNative` (tAMM → ETH). The buy builder's selector
    (`0xdb73c039`) matches Ammora's own on-chain daily swap exactly.
  - Slippage 1%, 20-minute deadline, referrer = zero address.
  - Wallet connect via injected provider (MetaMask / Rabby); quoting works without a wallet.
  - Chain/RPC/explorer come from the SDK's built-in GIWA catalog (`giwaSepoliaVNext`).
- **Launches tab** — live launches on GIWA Sepolia via
  `AmmoraDataApiClient.getLaunches({ chainId: 91342n })`, with loading/error/retry states.

## Run it locally

```sh
cd app
npm ci --ignore-scripts
npm run build
npm run preview
```

No keys, no secrets, no backend. Testnet only — no real funds.

## Research notes

See [RESEARCH.md](RESEARCH.md) for the full SDK research: API surface, what was verified
live against GIWA Sepolia, what the SDK cannot do for this pool (DammV2Client refuses the
pool's factory), and the one live test still needed (a real test swap from a wallet with
GIWA Sepolia test ETH).

## Disclaimer

Ammora is beta testnet software and has not announced a mainnet deployment or completed an
independent security audit. Do not use with real funds.
