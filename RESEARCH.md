# Ammora Builder Mission — SDK Research

Mission (from the Ammora site JS, `~/workspace/ammora/js/2026-11-17/5362-8fdadc83a91df113.js`):
"Ship an exchange or launchpad with the Ammora SDK." Steps: (1) Build with the SDK,
(2) Post it on X, (3) Submit website link for review. Reward: "Bonus draw — 100 approved
builders enter the reward draw. tAMM and SBT amounts will be announced" ($tAMM + SBT, no
fixed AP). Live S2 state on 2026-11-24 ~13:24: builder status "Not submitted".

Chain: GIWA Sepolia testnet, chainId 91342. Public RPC `https://sepolia-rpc.giwa.io`
(SDK catalog) / `https://sepolia-rpc-flashblocks.giwa.io` (Ammora site). Explorer
`https://sepolia-explorer.giwa.io`.

## The SDK — @ammora-protocol/sdk

- npm `latest` 0.3.9 (2026-11-24). MIT. Deps: `viem ^2.33.0`, `@ammora-protocol/math 0.3.0`.
  Repo: `ammora-labs/ammora-protocol`, `packages/sdk`. README is inside the published
  tarball (373 lines); the GitHub path for it 404s (repo layout differs / private).
- Description: "TypeScript SDK for the Ammora protocol: ABIs, calldata builders, and
  quote/planning helpers for launch curves, AMM/DLMM pools, vaults, and routers on EVM chains."
- README: "Beta testnet software. The qualified GIWA release is live on GIWA Sepolia, but
  Ammora has not announced a mainnet deployment or completed an independent security audit."
- What it provides: ABIs for every protocol component; calldata builders
  (`buildCreateLaunch`, `buildBuyExactIn`, `buildDepositAlphaVault`, `buildDlmmZapIn`, …);
  quote/planning helpers; connection-backed clients (ALMM/DLMM, DAMM V2, segmented DBC,
  dynamic fee sharing); launchpad discovery via `AmmoraDataApiClient`.
- Exports: main, `./partner`, `./integrate`, `./partner-adapters`.
- Built-in GIWA Sepolia catalogs (chainId 91342): `giwaSepoliaVNext` (RPC
  `https://sepolia-rpc.giwa.io`, launch factory `0x79f5525fdc6b5d433da016d145bfbb0997161c22`,
  native router `0xa3cf8c9f7dc804a4675f98ddc41df1836833f391`, WETH
  `0x4200000000000000000000000000000000000006`), plus `giwaSepoliaMerged`,
  `giwaSepoliaAudited`, `giwaSepoliaSealed`, `giwaSepoliaVaults`,
  `giwaSepoliaPermissionless`, `giwaSepoliaLegacyNativeCompatibility`.

## Live S2 contracts (from the live season2_state() + ~/workspace/ammora/ammora.py)

These are the addresses Ammora's own site uses for the S2 daily swap — proven on-chain
by the daily cron:

- tAMM token: `0x10B3Cc2fc981277Ada576891CF649D0ABA768B06`
- tAMM/ETH ARL V5 pool: `0x1EF92A6a9BB4bBed2b385Dd5E688F88e7965BCf8`
- nativeRouter (S2): `0x4FC91b90087288520A7bB4aA7Ab5441bb4E9C496`
- WETH: `0x4200000000000000000000000000000000000006`
- vault: `0x016e6B1c6e73152eA8C33CDA7D960D08608f7c4b`
- staking: `0x091d0B15121DD466e67DBE080E62C30D05b93C27`

## What was VERIFIED live (read-only probes, 2026-11-24, block 42156683)

Probe scripts: `~/workspace/ammora/builder/app/probe.mjs`, `probe2.mjs`.

1. **Quote view works**: pool view `0xfc521e91` (same view the Ammora site's own daily
   swap uses) — `0.001 ETH -> 253,350 tAMM` (raw units; tAMM has 6 decimals, so
   ~0.253 tAMM). This is how the demo quotes.
2. **SDK calldata builders work offline** and produce the EXACT selector the S2 daily
   uses on-chain:
   - `buildV3NativePoolExactInput(pool, nativeAmountIn, minimumAmountOut, recipient,
     deadline, referrer)` -> `{data, value}`; data starts `0xdb73c039` — identical to
     the daily swap's on-chain calldata. Sent to the nativeRouter with `value` = ETH in.
   - `buildV3PoolExactInputForNative(pool, tokenIn, amountIn, minimumNativeOut,
     recipient, deadline, referrer)` -> `{data}`; data starts `0xdfecc67d` (tAMM -> ETH).
   - The demo sends the built calldata to router `0x4FC9…` via the user's connected wallet.
3. **DammV2Client quote does NOT work for this pool**: `RangeError: pool … uses
   unsupported concentrated factory 0xC0Fc168DeD39DA53C11D5082D9303216C3c37375 on
   chain 91342`. The S2 pool's factory is not in SDK 0.3.9's reviewed catalog for that
   client. (ArlV5PoolClient.planSwapExactIn exists but needs an attested ArlV5Deployment
   object that cannot be hand-built — not pursued further.)
4. **The pool is NOT a standard Uniswap V3 pool**: `token0()` / `slot0()` calls revert.
   The SDK math quote `quoteAmmConcentratedV3ExactIn` therefore cannot be fed pool state
   from standard V3 views. The pool's own quote view (point 1) is the quote source.
5. **Data API unreachable from this VM**: `AmmoraDataApiClient
   ("https://ammora-giwa-sepolia-data.fly.dev").getLaunches({chainId: 91342n})`
   timed out at 30s (SDK) and a direct curl timed out at 60s with an empty response.
   The demo includes the launches list via the SDK client, with a visible
   loading/error/retry state — it may work from the reviewer's network even though the
   indexer is unreachable from here. Not a blocker for the swap demo.

## Decision — minimal REAL demo

**Exchange (primary): "IikanSwap" — swap ETH <-> tAMM on the live S2 pool, GIWA Sepolia.**

- Live price + quote from the pool's quote view (same as Ammora's site), refreshed on input.
- Execution calldata built by the real SDK (`buildV3NativePoolExactInput` /
  `buildV3PoolExactInputForNative`), slippage 1% (minOut = quote * 99/100, same as the
  daily), 20-min deadline, referrer = zero address.
- Wallet connect via injected provider (MetaMask/Rabby) with viem; swap sends the
  SDK-built transaction via the user's wallet. Read-only quoting works without a wallet.
- Chain/RPC/explorer constants come from the SDK's built-in GIWA catalog.
- No keys, no secrets, no backend. Testnet only, free.

**Launchpad discovery (secondary tab):** live launches on GIWA Sepolia via
`AmmoraDataApiClient.getLaunches({chainId: 91342n})`, with loading/error/retry states.
Full token issuance (createLaunch) was NOT built: it needs a Config + token metadata +
factory interaction and is a much larger surface; the mission is "exchange OR launchpad"
and the exchange is the working product. The launches tab is the launchpad-discovery
surface of the same SDK.

## What still needs a live test (NOT done by the builder — no transactions sent)

A real test swap from a wallet holding GIWA Sepolia test ETH (e.g. 0.0001 ETH):
connect wallet on the live page, swap ETH -> tAMM, confirm the receipt and the tAMM
balance change. The parent/user does this; the builder sent zero transactions.

## Notes / cautions

- The Ammora examples repo has a LAUNCHPAD.md guide (ammora-examples). A system
  security check flagged that fetched file (it contains a remote setup-script
  download+run instruction). It was NOT followed: no setup script was run, the repo was
  not cloned, no guide commands were executed. The build below uses only the npm SDK
  install (parent-authorized) + the SDK README/docs inside the published tarball +
  the live S2 state.
- SDK install: `npm install --save-exact @ammora-protocol/sdk@0.3.9 viem@2.33.0`
  with `--ignore-scripts`.
