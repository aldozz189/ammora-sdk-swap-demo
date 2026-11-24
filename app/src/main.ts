import {
  AmmoraDataApiClient,
  buildV3NativePoolExactInput,
  buildV3PoolExactInputForNative,
  giwaSepoliaVNext,
} from '@ammora-protocol/sdk';
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeAbiParameters,
  formatEther,
  formatUnits,
  http,
  parseAbiParameters,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import './style.css';

// ---------------------------------------------------------------------------
// Addresses: the same ones Ammora's own site uses for the S2 daily swap,
// proven on-chain. Chain/RPC/explorer come from the SDK's built-in GIWA catalog.
// ---------------------------------------------------------------------------
const POOL = '0x1EF92A6a9BB4bBed2b385Dd5E688F88e7965BCf8' as Address; // tAMM/ETH ARL V5 pool
const ROUTER = '0x4FC91b90087288520A7bB4aA7Ab5441bb4E9C496' as Address; // nativeRouter (S2)
const WETH = '0x4200000000000000000000000000000000000006' as Address;
const TAMM = '0x10B3Cc2fc981277Ada576891CF649D0ABA768B06' as Address;
const VAULT = '0x016e6B1c6e73152eA8C33CDA7D960D08608f7c4b' as Address;
const STAKING = '0x091d0B15121DD466e67DBE080E62C30D05b93C27' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const TAMM_DECIMALS = 6;
const SLIPPAGE_BPS = 100; // 1%
const DATA_API = 'https://ammora-giwa-sepolia-data.fly.dev';

const giwaChain = defineChain({
  id: giwaSepoliaVNext.chain.id,
  name: giwaSepoliaVNext.chain.name,
  nativeCurrency: giwaSepoliaVNext.chain.nativeCurrency,
  rpcUrls: { default: { http: [...giwaSepoliaVNext.chain.rpcUrls] } },
  blockExplorers: {
    default: { name: 'GIWA Explorer', url: giwaSepoliaVNext.chain.blockExplorerUrl },
  },
});
const EXPLORER = giwaSepoliaVNext.chain.blockExplorerUrl;

const publicClient = createPublicClient({
  chain: giwaChain,
  transport: http(giwaSepoliaVNext.chain.rpcUrls[0]),
});

const erc20Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'o', type: 'address' },
      { name: 's', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 's', type: 'address' },
      { name: 'a', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// The pool's own quote view (selector 0xfc521e91) — the same view Ammora's site
// uses for its S2 daily swap quote. Verified live: 0.001 ETH -> 253,350 tAMM.
async function quotePool(tokenIn: Address, amountIn: bigint): Promise<bigint> {
  const data = ('0xfc521e91' +
    encodeAbiParameters(parseAbiParameters('address,uint256'), [tokenIn, amountIn]).slice(2)) as Hex;
  const r = await publicClient.call({ to: POOL, data });
  if (!r.data) throw new Error('empty quote response');
  return BigInt(r.data);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const exLink = (a: string) => `${EXPLORER}/address/${a}`;
const exTx = (h: string) => `${EXPLORER}/tx/${h}`;

let direction: 'eth->tamm' | 'tamm->eth' = 'eth->tamm';
let account: Address | null = null;
let walletClient: ReturnType<typeof createWalletClient> | null = null;
let lastQuote: { out: bigint; minOut: bigint } | null = null;
let quoteTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(msg: string) {
  ($('quoteStatus') as HTMLParagraphElement).textContent = msg;
}

async function refreshBalances() {
  if (!account) return;
  try {
    const [eth, tamm] = await Promise.all([
      publicClient.getBalance({ address: account }),
      publicClient.readContract({ address: TAMM, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    ]);
    const el = $('balances');
    el.hidden = false;
    el.textContent = `ETH ${formatEther(eth)} · tAMM ${formatUnits(tamm, TAMM_DECIMALS)}`;
    $('balanceLine').textContent =
      direction === 'eth->tamm'
        ? `Balance: ${formatEther(eth)} ETH`
        : `Balance: ${formatUnits(tamm, TAMM_DECIMALS)} tAMM`;
  } catch {
    /* balances are best-effort */
  }
}

async function refreshQuote() {
  const raw = ($('amountIn') as HTMLInputElement).value;
  const inIsEth = direction === 'eth->tamm';
  const decimals = inIsEth ? 18 : TAMM_DECIMALS;
  let amountIn: bigint;
  try {
    amountIn = parseUnits(raw || '0', decimals);
  } catch {
    setStatus('Enter a valid amount.');
    return;
  }
  if (amountIn <= 0n) {
    $('quoteOut').textContent = '—';
    $('quotePrice').textContent = '—';
    $('quoteMin').textContent = '—';
    setStatus('Enter an amount to quote.');
    lastQuote = null;
    updateSwapBtn();
    return;
  }
  setStatus('Fetching live quote…');
  try {
    const out = await quotePool(inIsEth ? WETH : TAMM, amountIn);
    const minOut = (out * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;
    lastQuote = { out, minOut };
    if (inIsEth) {
      $('quoteOut').textContent = `${formatUnits(out, TAMM_DECIMALS)} tAMM`;
      $('quotePrice').textContent = `1 ETH ≈ ${formatUnits((out * 10n ** 18n) / amountIn, TAMM_DECIMALS)} tAMM`;
      $('quoteMin').textContent = `${formatUnits(minOut, TAMM_DECIMALS)} tAMM`;
    } else {
      $('quoteOut').textContent = `${formatEther(out)} ETH`;
      $('quotePrice').textContent = `1 tAMM ≈ ${formatEther((out * 10n ** BigInt(TAMM_DECIMALS)) / amountIn)} ETH`;
      $('quoteMin').textContent = `${formatEther(minOut)} ETH`;
    }
    setStatus('Live quote from the pool. Refreshes as you type.');
  } catch (e) {
    lastQuote = null;
    setStatus(`Quote failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
  }
  updateSwapBtn();
}

function updateSwapBtn() {
  const btn = $('swapBtn') as HTMLButtonElement;
  const approveBtn = $('approveBtn') as HTMLButtonElement;
  approveBtn.hidden = true;
  if (!account) {
    btn.disabled = true;
    btn.textContent = 'Connect wallet to swap';
    return;
  }
  if (!lastQuote) {
    btn.disabled = true;
    btn.textContent = 'Swap';
    return;
  }
  btn.disabled = false;
  btn.textContent = direction === 'eth->tamm' ? 'Swap ETH → tAMM' : 'Swap tAMM → ETH';
}

async function connectWallet() {
  const eth = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!eth) {
    $('walletStatus').textContent =
      'No injected wallet found. Install MetaMask or Rabby, then reload this page.';
    return;
  }
  try {
    walletClient = createWalletClient({ chain: giwaChain, transport: custom(eth as never) });
    const [addr] = await walletClient.requestAddresses();
    account = addr;
    const chainId = await walletClient.getChainId();
    if (chainId !== giwaChain.id) {
      try {
        await walletClient.switchChain({ id: giwaChain.id });
      } catch {
        $('walletStatus').textContent =
          `Connected as ${short(account)}, but your wallet is on chain ${chainId}. ` +
          `Please switch to GIWA Sepolia (chain 91342, RPC ${giwaSepoliaVNext.chain.rpcUrls[0]}) in your wallet.`;
        await refreshBalances();
        updateSwapBtn();
        return;
      }
    }
    $('walletStatus').textContent = `Connected: ${short(account)} on GIWA Sepolia.`;
    ($('connectBtn') as HTMLButtonElement).textContent = 'Connected';
    await refreshBalances();
    updateSwapBtn();
  } catch (e) {
    $('walletStatus').textContent = `Connect failed: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`;
  }
}

async function doSwap() {
  if (!account || !walletClient || !lastQuote) return;
  const raw = ($('amountIn') as HTMLInputElement).value;
  const inIsEth = direction === 'eth->tamm';
  const amountIn = parseUnits(raw, inIsEth ? 18 : TAMM_DECIMALS);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const txEl = $('txStatus');
  try {
    if (!inIsEth) {
      // tAMM -> ETH: the router pulls tAMM from the caller, so approve it first.
      const allowance = await publicClient.readContract({
        address: TAMM,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account, ROUTER],
      });
      if (allowance < amountIn) {
        txEl.textContent = 'Approving tAMM spend for the router…';
        const approveHash = await walletClient.writeContract({
          address: TAMM,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ROUTER, amountIn],
          account,
          chain: giwaChain,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        txEl.textContent = 'Approval confirmed. Building the swap…';
      }
    }
    // Calldata is built by the real Ammora SDK.
    const tx = inIsEth
      ? { ...buildV3NativePoolExactInput(POOL, amountIn, lastQuote.minOut, account, deadline, ZERO), to: ROUTER }
      : { ...buildV3PoolExactInputForNative(POOL, TAMM, amountIn, lastQuote.minOut, account, deadline, ZERO), to: ROUTER, value: 0n };
    txEl.textContent = 'Sending swap — confirm it in your wallet…';
    const hash = await walletClient.sendTransaction({ ...tx, account, chain: giwaChain });
    txEl.innerHTML = `Sent: <a href="${exTx(hash)}" target="_blank" rel="noreferrer">${short(hash)}</a> — waiting for confirmation…`;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    txEl.innerHTML =
      receipt.status === 'success'
        ? `✅ Swap confirmed in block ${receipt.blockNumber}. <a href="${exTx(hash)}" target="_blank" rel="noreferrer">View on explorer</a>`
        : `❌ Swap reverted. <a href="${exTx(hash)}" target="_blank" rel="noreferrer">View on explorer</a>`;
    await refreshBalances();
    await refreshQuote();
  } catch (e) {
    txEl.textContent = `Swap failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
  }
}

// ---------------------------------------------------------------------------
// Launches (SDK Data API)
// ---------------------------------------------------------------------------
async function loadLaunches() {
  const statusEl = $('launchesStatus');
  const listEl = $('launchesList');
  statusEl.textContent = 'Loading launches from the Ammora indexer…';
  listEl.innerHTML = '';
  try {
    const api = new AmmoraDataApiClient(DATA_API);
    const page = (await api.getLaunches({ chainId: 91342n })) as unknown as {
      items?: unknown[];
      launches?: unknown[];
    };
    const items = page.items ?? page.launches ?? [];
    if (!items.length) {
      statusEl.textContent = 'The indexer returned no launches for GIWA Sepolia (chain 91342).';
      return;
    }
    statusEl.textContent = `${items.length} launch(es) on GIWA Sepolia.`;
    for (const raw of items) {
      const l = raw as Record<string, unknown>;
      const token = String(l.token ?? l.tokenAddress ?? l.baseToken ?? '');
      const name = String(l.name ?? l.symbol ?? l.tokenName ?? token);
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = name || token;
      li.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'mono muted';
      meta.textContent = [
        token ? `token ${token}` : '',
        l.curve ? `curve ${String(l.curve)}` : '',
        l.pool ? `pool ${String(l.pool)}` : '',
        l.status ? `status ${String(l.status)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      li.appendChild(meta);
      if (token) {
        const a = document.createElement('a');
        a.href = exLink(token);
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.textContent = 'View token on explorer';
        li.appendChild(a);
      }
      listEl.appendChild(li);
    }
  } catch (e) {
    statusEl.textContent =
      `Could not reach the Ammora indexer (${DATA_API}) from this network: ` +
      `${e instanceof Error ? e.message.slice(0, 140) : String(e)}. ` +
      `The swap above still works — this is only the launches list. Try Refresh.`;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function setAddr(id: string, addr: string) {
  const a = $(id) as HTMLAnchorElement;
  a.textContent = short(addr);
  a.href = exLink(addr);
}
$('poolAddr').textContent = short(POOL);
$('routerAddr').textContent = short(ROUTER);
setAddr('linkToken', TAMM);
setAddr('linkPool', POOL);
setAddr('linkRouter', ROUTER);
setAddr('linkVault', VAULT);
setAddr('linkStaking', STAKING);

$('connectBtn').addEventListener('click', connectWallet);
$('swapBtn').addEventListener('click', doSwap);
$('amountIn').addEventListener('input', () => {
  if (quoteTimer) clearTimeout(quoteTimer);
  quoteTimer = setTimeout(refreshQuote, 400);
});
$('flipBtn').addEventListener('click', () => {
  direction = direction === 'eth->tamm' ? 'tamm->eth' : 'eth->tamm';
  $('inLabel').textContent = direction === 'eth->tamm' ? 'You pay (ETH)' : 'You pay (tAMM)';
  ($('amountIn') as HTMLInputElement).value = direction === 'eth->tamm' ? '0.001' : '0.25';
  $('txStatus').textContent = '';
  refreshBalances();
  refreshQuote();
});
$('tabSwap').addEventListener('click', () => {
  $('tabSwap').classList.add('active');
  $('tabLaunches').classList.remove('active');
  $('swapPanel').hidden = false;
  $('launchesPanel').hidden = true;
});
$('tabLaunches').addEventListener('click', () => {
  $('tabLaunches').classList.add('active');
  $('tabSwap').classList.remove('active');
  $('swapPanel').hidden = true;
  $('launchesPanel').hidden = false;
  loadLaunches();
});
$('refreshLaunches').addEventListener('click', loadLaunches);

// Live "1 ETH ≈ ? tAMM" on load.
quotePool(WETH, 10n ** 18n)
  .then((q) => {
    $('oneEthQuote').textContent = formatUnits(q, TAMM_DECIMALS);
  })
  .catch(() => {
    $('oneEthQuote').textContent = 'unavailable (pool unreachable)';
  });

refreshQuote();
