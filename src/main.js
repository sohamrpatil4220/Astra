import './style.css';
import { isConnected, requestAccess, getPublicKey, signTransaction, getNetwork } from '@stellar/freighter-api';
import { Horizon, TransactionBuilder, Networks, Operation, Asset, Keypair, Memo, StrKey, rpc, Contract, xdr, scValToNative } from '@stellar/stellar-sdk';
import albedo from '@albedo-link/intent';

// Robust Stellar address validator — falls back to regex if StrKey throws
function isValidStellarAddress(address) {
  if (!address || typeof address !== 'string') return false;
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch (e) {
    console.warn('StrKey.isValidEd25519PublicKey threw, using regex fallback:', e);
    // Stellar public keys start with 'G', are 56 chars, base32 alphabet
    return /^G[A-Z2-7]{55}$/.test(address);
  }
}

// Initialize Horizon Server for Stellar Testnet
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

let userAddress = null;
let currentBalance = 0.0;
let balancePollInterval = null;
let watchlist = [];
let recentPayments = [];
let paymentStreamCloser = null;
let splitRecipients = [];
let activeWallet = 'freighter';
const CONTRACT_ID = 'CCMXLVDPY6IBFRHCYDTRAVKOVL4Z4RBL32SBDVYLYNRVRRGUYTVMMDM6';
const ESCROW_CONTRACT_ID = null; // Set after deploying escrow contract
const rpcServer = new rpc.Server('https://soroban-testnet.stellar.org');

// Event polling state
let eventPollInterval = null;
let lastLedgerPolled = 0;
let capturedEvents = [];


// DOM Elements - Header & Layout
const connectBtn = document.getElementById('connect-btn');
const connectBtnText = document.getElementById('connect-btn-text');
const disconnectedBanner = document.getElementById('disconnected-banner');
const dashboardGrid = document.getElementById('dashboard-grid');

// DOM Elements - Account Status
const walletAddressFull = document.getElementById('wallet-address-full');
const walletBalance = document.getElementById('wallet-balance');
const refreshBalanceBtn = document.getElementById('refresh-balance-btn');
const refreshIcon = document.getElementById('refresh-icon');
const copyAddressBtn = document.getElementById('copy-address-btn');
const copySuccessTooltip = document.getElementById('copy-success-tooltip');
const faucetBtn = document.getElementById('faucet-btn');
const faucetBtnContent = document.getElementById('faucet-btn-content');
const faucetSpinner = document.getElementById('faucet-spinner');

// DOM Elements - Watchlist
const watchlistForm = document.getElementById('watchlist-form');
const watchLabelInput = document.getElementById('watch-label-input');
const watchAddressInput = document.getElementById('watch-address-input');
const watchlistList = document.getElementById('watchlist-list');
const watchlistEmpty = document.getElementById('watchlist-empty');

// DOM Elements - Payment Hub Panel Tabs
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// DOM Elements - Send Payment (Single)
const sendForm = document.getElementById('send-form');
const recipientInput = document.getElementById('recipient-input');
const recipientIndicator = document.getElementById('recipient-validation-indicator');
const amountInput = document.getElementById('amount-input');
const maxAmountBtn = document.getElementById('amount-max-btn');
const memoTypeSelect = document.getElementById('memo-type-select');
const memoInput = document.getElementById('memo-input');
const sendBtn = document.getElementById('send-btn');

// DOM Elements - Split Bill Calculator
const splitForm = document.getElementById('split-form');
const splitTotalInput = document.getElementById('split-total-input');
const addSplitRecipientBtn = document.getElementById('add-split-recipient-btn');
const splitRecipientsContainer = document.getElementById('split-recipients-container');
const splitShareVal = document.getElementById('split-share-val');
const splitSharesCount = document.getElementById('split-shares-count');
const splitSubmitBtn = document.getElementById('split-submit-btn');

// DOM Elements - History
const txHistoryBody = document.getElementById('tx-history-body');
const historyEmpty = document.getElementById('history-empty');

// DOM Elements - Modal Status Tracker
const statusModal = document.getElementById('status-modal');
const modalTitle = document.getElementById('modal-title');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalActionBtn = document.getElementById('modal-action-btn');
const modalSpinner = document.getElementById('modal-spinner');
const modalSuccessIcon = document.getElementById('modal-success-icon');
const modalErrorIcon = document.getElementById('modal-error-icon');
const modalStatusText = document.getElementById('modal-status-text');
const modalTxHashContainer = document.getElementById('modal-tx-hash-container');
const modalTxHash = document.getElementById('modal-tx-hash');
const modalExplorerLink = document.getElementById('modal-explorer-link');

const steps = {
  1: document.getElementById('step-1'),
  2: document.getElementById('step-2'),
  3: document.getElementById('step-3'),
  4: document.getElementById('step-4'),
};

// DOM Elements - Transaction Inspector Drawer
const inspectorDrawer = document.getElementById('inspector-drawer');
const drawerCloseBtn = document.getElementById('drawer-close-btn');
const insType = document.getElementById('ins-type');
const insTime = document.getElementById('ins-time');
const insHash = document.getElementById('ins-hash');
const insSender = document.getElementById('ins-sender');
const insRecipient = document.getElementById('ins-recipient');
const insAmount = document.getElementById('ins-amount');
const insMemo = document.getElementById('ins-memo');
const insExplorerBtn = document.getElementById('ins-explorer-btn');

// DOM Elements - Smart Contract Portal
const walletTypeSelect = document.getElementById('wallet-type-select');
const contractForm = document.getElementById('contract-form');
const contractToInput = document.getElementById('contract-to-input');
const contractSubmitBtn = document.getElementById('contract-submit-btn');
const contractResultBox = document.getElementById('contract-result-box');
const contractResultVal = document.getElementById('contract-result-val');

// DOM Elements - Assets & Trustlines
const trustlineForm = document.getElementById('trustline-form');
const trustAssetCode = document.getElementById('trust-asset-code');
const trustAssetIssuer = document.getElementById('trust-asset-issuer');
const trustSubmitBtn = document.getElementById('trust-submit-btn');
const assetList = document.getElementById('asset-list');
let portfolioChartInstance = null;

// ==========================================
// Freighter Testnet Network Guard
// ==========================================
async function checkFreighterNetwork() {
  try {
    const networkResult = await withTimeout(getNetwork(), 5000, 'timeout');
    // getNetwork() returns a string or object depending on version
    let networkStr = '';
    if (typeof networkResult === 'string') {
      networkStr = networkResult;
    } else if (networkResult && networkResult.network) {
      networkStr = networkResult.network;
    } else if (networkResult && networkResult.networkPassphrase) {
      networkStr = networkResult.networkPassphrase;
    }
    // Check if they are on mainnet instead of testnet
    const isMainnet =
      networkStr.toLowerCase().includes('mainnet') ||
      networkStr === Networks.PUBLIC ||
      networkStr === 'PUBLIC';
    if (isMainnet) {
      throw new Error(
        'WRONG_NETWORK: Freighter is set to Mainnet.\n\n' +
        'Please switch to Testnet inside Freighter:\n' +
        '1. Click the Freighter extension icon\n' +
        '2. Go to Settings → Network\n' +
        '3. Select "Testnet" and try again.'
      );
    }
  } catch (e) {
    if (e.message && e.message.startsWith('WRONG_NETWORK:')) {
      throw e; // re-throw our own error
    }
    // If getNetwork() fails (e.g. not connected yet), silently continue
    console.warn('[Freighter] getNetwork check skipped:', e.message);
  }
}

// ==========================================
// Promise Timeout Helper (Fixes Frozen Buttons)
// ==========================================
function withTimeout(promise, ms, timeoutMsg) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMsg));
    }, ms);
  });
  
  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => clearTimeout(timer));
}

// ==========================================
// 1. Initial Load & Setup
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  // Handle Dev/Test Mock Session Bypass via URL parameter (?mock=true)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mock') === 'true') {
    localStorage.setItem('astra_stellar_address', 'GAJAQYICN3HOMRDBZN77ETZBKCHYRGO5XJKKSG6UEFT5H2GH7QJ63JHX');
  }

  // Load wallet type preference
  activeWallet = localStorage.getItem('astra_active_wallet') || 'freighter';
  walletTypeSelect.value = activeWallet;

  // Load session from localStorage
  const savedAddress = localStorage.getItem('astra_stellar_address');
  if (savedAddress && isValidStellarAddress(savedAddress)) {
    loginUser(savedAddress);
  } else {
    logoutUser();
  }

  // Load watchlist items from localStorage
  watchlist = JSON.parse(localStorage.getItem('astra_watchlist') || '[]');
  renderWatchlist();

  // Setup Event Listeners
  connectBtn.addEventListener('click', handleConnectToggle);
  walletTypeSelect.addEventListener('change', (e) => {
    activeWallet = e.target.value;
    localStorage.setItem('astra_active_wallet', activeWallet);
  });
  refreshBalanceBtn.addEventListener('click', () => {
    animateRefreshIcon();
    fetchAccountData();
  });
  copyAddressBtn.addEventListener('click', handleCopyAddress);
  faucetBtn.addEventListener('click', handleRequestFaucet);
  
  // Tab Controller
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => handleTabSwitch(btn));
  });

  // Real-time single payment validations
  recipientInput.addEventListener('input', validateRecipientAddress);
  amountInput.addEventListener('input', validateAmount);
  maxAmountBtn.addEventListener('click', handleSetMaxAmount);
  memoTypeSelect.addEventListener('change', validateMemo);
  memoInput.addEventListener('input', validateMemo);
  
  // Real-time split inputs & calculation
  splitTotalInput.addEventListener('input', calculateSplitShare);
  addSplitRecipientBtn.addEventListener('click', () => addSplitRecipientInput(''));
  
  // Form submissions
  sendForm.addEventListener('submit', handleSendPayment);
  splitForm.addEventListener('submit', handleSendSplitPayments);
  watchlistForm.addEventListener('submit', handleAddWatchlist);
  contractForm.addEventListener('submit', handleInvokeContract);
  trustlineForm.addEventListener('submit', handleTrustline);

  // Close triggers
  modalCloseBtn.addEventListener('click', hideModal);
  modalActionBtn.addEventListener('click', hideModal);
  drawerCloseBtn.addEventListener('click', hideInspectorDrawer);

  inspectorDrawer.addEventListener('click', (e) => {
    if (e.target === inspectorDrawer) hideInspectorDrawer();
  });
});

// ==========================================
// 2. Wallet Connection (Freighter Integration)
// ==========================================
async function handleConnectToggle() {
  if (userAddress) {
    logoutUser();
  } else {
    connectBtn.disabled = true;
    connectBtnText.textContent = 'Connecting...';

    try {
      if (activeWallet === 'freighter') {
        // ── Step 1: Verify Freighter extension is present ──────────────────────
        let freighterInstalled = false;
        try {
          const connResult = await withTimeout(isConnected(), 4000, 'timeout');
          freighterInstalled = true;
          console.log('[Freighter] isConnected result:', connResult);
        } catch (e) {
          freighterInstalled = !!(window.freighter || window.freighterApi || window.stellar);
          console.log('[Freighter] isConnected threw, window check:', freighterInstalled);
        }

        if (!freighterInstalled) {
          throw new Error('FREIGHTER_NOT_INSTALLED');
        }

        // ── Step 2: Request access (shows Freighter permission popup) ──────────
        connectBtnText.textContent = 'Approve in Freighter...';
        const accessResult = await withTimeout(
          requestAccess(),
          20000,
          'Freighter permission popup timed out. Please try again.'
        );
        console.log('[Freighter] requestAccess result:', accessResult, typeof accessResult);

        // Check if access was explicitly denied via error object
        if (accessResult && accessResult.error) {
          const errMsg = (accessResult.error.message) || String(accessResult.error);
          throw new Error(errMsg || 'Access denied by Freighter.');
        }

        // ── Step 3: Get the public key ─────────────────────────────────────────
        let address = null;
        if (typeof accessResult === 'string' && accessResult.length > 10) {
          address = accessResult;
        } else if (accessResult && typeof accessResult.address === 'string') {
          address = accessResult.address;
        }

        if (!address) {
          connectBtnText.textContent = 'Getting address...';
          const pkResult = await withTimeout(
            getPublicKey(),
            8000,
            'Could not retrieve public key from Freighter.'
          );
          console.log('[Freighter] getPublicKey result:', pkResult, typeof pkResult);

          if (typeof pkResult === 'string' && pkResult.length > 10) {
            address = pkResult;
          } else if (pkResult && typeof pkResult.publicKey === 'string') {
            address = pkResult.publicKey;
          } else if (pkResult && typeof pkResult.address === 'string') {
            address = pkResult.address;
          } else if (pkResult && pkResult.error) {
            throw new Error(String(pkResult.error.message || pkResult.error));
          }
        }

        // ── Step 3.5: Verify Freighter is on Testnet ──────────────────────────
        await checkFreighterNetwork();

        // ── Step 4: Validate and log in ────────────────────────────────────────
        if (address && isValidStellarAddress(address)) {
          loginUser(address);
        } else if (address) {
          throw new Error(`Invalid Stellar address received: "${address}". Is Freighter on the right network?`);
        } else {
          throw new Error('Could not retrieve your public key. Please make sure Freighter is unlocked and you approved the connection.');
        }
      } else {
        // Albedo Connection Flow
        connectBtnText.textContent = 'Approve in Albedo...';
        const albedoRes = await withTimeout(
          albedo.publicKey({ token: 'astra_login' }),
          25000,
          'Albedo connection request timed out.'
        );
        console.log('[Albedo] connection result:', albedoRes);
        if (albedoRes && albedoRes.pubkey && isValidStellarAddress(albedoRes.pubkey)) {
          loginUser(albedoRes.pubkey);
        } else {
          throw new Error('Albedo connection failed to retrieve public key.');
        }
      }

    } catch (err) {
      console.error('Connection failed:', err);
      const msg = err.message || '';
      if (msg === 'FREIGHTER_NOT_INSTALLED') {
        alert('Freighter wallet not detected.\n\nPlease:\n1. Install Freighter from freighter.app\n2. Make sure it is enabled in Chrome extensions\n3. Reload this page and try again');
      } else if (msg.startsWith('WRONG_NETWORK:')) {
        // Strip the prefix for display
        alert(msg.replace('WRONG_NETWORK: ', ''));
      } else {
        alert(`Connection failed: ${msg}`);
      }
      connectBtn.disabled = false;
      connectBtnText.textContent = 'Connect Wallet';
    }
  }
}

function loginUser(address) {
  userAddress = address;
  localStorage.setItem('astra_stellar_address', address);
  
  const truncated = `${address.slice(0, 4)}...${address.slice(-4)}`;
  connectBtnText.textContent = `Disconnect (${truncated})`;
  connectBtn.classList.remove('btn-connect');
  connectBtn.classList.add('btn-secondary');
  connectBtn.disabled = false;

  disconnectedBanner.classList.add('hidden');
  dashboardGrid.classList.remove('hidden');

  walletAddressFull.textContent = address;

  // Initialize data load and polling
  fetchAccountData();
  if (balancePollInterval) clearInterval(balancePollInterval);
  balancePollInterval = setInterval(fetchAccountData, 10000);

  // Initialize real-time payment streaming
  startPaymentStream();
}

function logoutUser() {
  userAddress = null;
  localStorage.removeItem('astra_stellar_address');
  
  if (balancePollInterval) {
    clearInterval(balancePollInterval);
    balancePollInterval = null;
  }

  // Cancel live payment stream
  stopPaymentStream();

  connectBtnText.textContent = 'Connect Wallet';
  connectBtn.classList.remove('btn-secondary');
  connectBtn.classList.add('btn-connect');
  connectBtn.disabled = false;

  dashboardGrid.classList.add('hidden');
  disconnectedBanner.classList.remove('hidden');

  currentBalance = 0.0;
  walletBalance.textContent = '0.00';
  txHistoryBody.innerHTML = '';
  historyEmpty.classList.remove('hidden');
  resetSendForm();
  resetSplitForm();
}

async function signTxEnvelope(xdr) {
  if (activeWallet === 'freighter') {
    // Guard: make sure Freighter is still on testnet before signing
    await checkFreighterNetwork();
    const result = await withTimeout(
      signTransaction(xdr, { networkPassphrase: Networks.TESTNET }),
      20000,
      'Freighter signature request timed out. Please unlock Freighter and try again.'
    );
    let signedXdr = null;
    if (typeof result === 'string') {
      signedXdr = result;
    } else if (result && result.signedTxXdr) {
      signedXdr = result.signedTxXdr;
    } else if (result && result.error) {
      throw new Error(`Signing failed: ${result.error.message || result.error}`);
    } else {
      throw new Error('Transaction signing declined by user.');
    }
    return signedXdr;
  } else {
    // Albedo Flow
    const result = await withTimeout(
      albedo.tx({ xdr, network: 'testnet' }),
      25000,
      'Albedo signing request timed out.'
    );
    if (result && result.signed_envelope_xdr) {
      return result.signed_envelope_xdr;
    } else {
      throw new Error('Transaction signing declined by user.');
    }
  }
}

async function handleCopyAddress() {
  if (!userAddress) return;
  try {
    await navigator.clipboard.writeText(userAddress);
    copySuccessTooltip.classList.remove('hidden');
    setTimeout(() => copySuccessTooltip.classList.add('hidden'), 2000);
  } catch (err) {
    console.error('Failed to copy key:', err);
  }
}

// ==========================================
// 3. Tab Controller Logic
// ==========================================
function handleTabSwitch(clickedBtn) {
  tabButtons.forEach(btn => btn.classList.remove('active'));
  clickedBtn.classList.add('active');

  const activePanelId = clickedBtn.getAttribute('data-tab');
  tabPanels.forEach(panel => {
    if (panel.id === activePanelId) {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  });
}

// ==========================================
// 4. Live Balance and History Queries
// ==========================================
async function fetchAccountData() {
  if (!userAddress) return;

  try {
    const account = await server.loadAccount(userAddress);
    const nativeBalanceObj = account.balances.find(b => b.asset_type === 'native');
    const balanceVal = nativeBalanceObj ? parseFloat(nativeBalanceObj.balance) : 0.0;
    currentBalance = balanceVal;

    animateBalanceDisplay(balanceVal);
    renderAssetsAndChart(account.balances);
  } catch (err) {
    if (err.name === 'NotFoundError' || (err.response && err.response.status === 404)) {
      currentBalance = 0.0;
      walletBalance.textContent = '0.0000000';
      renderAssetsAndChart([]);
    } else {
      console.error('Failed to query account balance:', err);
    }
  }

  // Load history lists and watchlist balances
  fetchTransactionHistory();
  pollWatchlistBalances();
}

function renderAssetsAndChart(balances) {
  assetList.innerHTML = '';
  
  if (!balances || balances.length === 0) {
    assetList.innerHTML = '<li class="events-empty-state">No assets found.</li>';
    updateChart(['XLM'], [0]);
    return;
  }

  const labels = [];
  const dataPoints = [];

  balances.forEach(b => {
    const isNative = b.asset_type === 'native';
    const code = isNative ? 'XLM' : b.asset_code;
    const balance = parseFloat(b.balance).toFixed(2);
    
    labels.push(code);
    dataPoints.push(balance);

    const li = document.createElement('li');
    li.className = 'watchlist-item';
    
    const issuerInfo = isNative ? 'Native Stellar Network' : `${b.asset_issuer.slice(0, 5)}...${b.asset_issuer.slice(-5)}`;
    
    li.innerHTML = `
      <div class="watchlist-info">
        <span class="watchlist-label">${code}</span>
        <span class="watchlist-address">${issuerInfo}</span>
      </div>
      <div class="watchlist-actions">
        <span class="watchlist-balance">${balance}</span>
      </div>
    `;
    assetList.appendChild(li);
  });

  updateChart(labels, dataPoints);
}

function updateChart(labels, dataPoints) {
  const ctx = document.getElementById('portfolioChart');
  if (!ctx) return;
  
  if (portfolioChartInstance) {
    portfolioChartInstance.data.labels = labels;
    portfolioChartInstance.data.datasets[0].data = dataPoints;
    portfolioChartInstance.update();
  } else {
    portfolioChartInstance = new window.Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: dataPoints,
          backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'],
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#9ca3af', font: { family: "'Inter', sans-serif", size: 10 } }
          }
        },
        cutout: '70%'
      }
    });
  }
}

async function fetchTransactionHistory() {
  if (!userAddress) return;

  try {
    const response = await server.payments()
      .forAccount(userAddress)
      .order('desc')
      .limit(10)
      .call();

    recentPayments = response.records;
    renderPaymentsTable();
  } catch (err) {
    console.error('Error listing payment history:', err);
  }
}

function renderPaymentsTable() {
  if (recentPayments.length === 0) {
    txHistoryBody.innerHTML = '';
    historyEmpty.classList.remove('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');
  txHistoryBody.innerHTML = '';

  recentPayments.forEach((tx, index) => {
    const row = document.createElement('tr');
    row.style.cursor = 'pointer';
    
    row.addEventListener('click', (e) => {
      if (e.target.tagName !== 'A') {
        showInspectorDrawer(tx);
      }
    });

    let isIncoming = false;
    let peerAddress = '';
    let displayAmount = '0.00';

    if (tx.type === 'create_account') {
      isIncoming = tx.account === userAddress;
      peerAddress = isIncoming ? tx.funder : tx.account;
      displayAmount = parseFloat(tx.starting_balance).toFixed(2);
    } else if (tx.type === 'payment') {
      isIncoming = tx.to === userAddress;
      peerAddress = isIncoming ? tx.from : tx.to;
      displayAmount = parseFloat(tx.amount).toFixed(2);
    }

    const truncatedPeer = `${peerAddress.slice(0, 5)}...${peerAddress.slice(-4)}`;

    const directionCell = `
      <td class="dir-badge ${isIncoming ? 'dir-in' : 'dir-out'}">
        ${isIncoming ? 'IN' : 'OUT'}
      </td>
    `;

    const peerCell = `
      <td class="history-address" title="${peerAddress}">${truncatedPeer}</td>
    `;

    const amountCell = `
      <td class="history-amount ${isIncoming ? 'dir-in' : 'dir-out'}">
        ${isIncoming ? '+' : '-'}${displayAmount} XLM
      </td>
    `;

    const actionCell = `
      <td>
        <a href="#" class="link-download inspect-row-btn" data-index="${index}">
          Inspect
        </a>
      </td>
    `;

    row.innerHTML = directionCell + peerCell + amountCell + actionCell;
    
    row.querySelector('.inspect-row-btn').addEventListener('click', (e) => {
      e.preventDefault();
      showInspectorDrawer(tx);
    });

    txHistoryBody.appendChild(row);
  });
}

// ==========================================
// 5. Option 6: Real-time Event Streaming
// ==========================================
function startPaymentStream() {
  if (!userAddress) return;
  
  // Close any existing open connections
  stopPaymentStream();

  try {
    paymentStreamCloser = server.payments()
      .forAccount(userAddress)
      .cursor('now')
      .stream({
        onmessage: (record) => {
          // Prepend newly streamed transaction to state cache
          recentPayments.unshift(record);
          if (recentPayments.length > 10) {
            recentPayments.pop();
          }
          
          // Render table
          renderPaymentsTable();

          // Flash the top row in green to indicate live receipt
          const rows = txHistoryBody.querySelectorAll('tr');
          if (rows.length > 0) {
            rows[0].classList.add('row-flash');
            setTimeout(() => {
              rows[0].classList.remove('row-flash');
            }, 2000);
          }

          // Reload balance
          fetchAccountData();
        },
        onerror: (err) => {
          console.error('Ledger stream error:', err);
        }
      });
  } catch (err) {
    console.error('Failed to initialize ledger stream connection:', err);
  }
}

function stopPaymentStream() {
  if (paymentStreamCloser) {
    paymentStreamCloser();
    paymentStreamCloser = null;
  }
}

// ==========================================
// 6. Account Watchlist Logic
// ==========================================
function renderWatchlist() {
  if (watchlist.length === 0) {
    watchlistList.innerHTML = '';
    watchlistEmpty.classList.remove('hidden');
    return;
  }

  watchlistEmpty.classList.add('hidden');
  watchlistList.innerHTML = '';

  watchlist.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'watchlist-item';
    
    li.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON' && !e.target.closest('.btn-delete-watch')) {
        const activeTab = document.querySelector('.tab-btn.active').getAttribute('data-tab');
        
        if (activeTab === 'single-panel') {
          recipientInput.value = item.address;
          validateRecipientAddress();
        } else if (activeTab === 'split-panel') {
          addSplitRecipientInput(item.address);
        }
      }
    });

    const truncated = `${item.address.slice(0, 6)}...${item.address.slice(-6)}`;
    
    li.innerHTML = `
      <div class="watchlist-info">
        <span class="watchlist-label">${item.label}</span>
        <span class="watchlist-address">${truncated}</span>
      </div>
      <div class="watchlist-actions">
        <span class="watchlist-balance">${item.balance ? parseFloat(item.balance).toFixed(2) + ' XLM' : '-- XLM'}</span>
        <button class="btn-delete-watch" data-index="${index}">&times;</button>
      </div>
    `;

    li.querySelector('.btn-delete-watch').addEventListener('click', (e) => {
      e.stopPropagation();
      removeWatchlistAddress(index);
    });

    watchlistList.appendChild(li);
  });
}

async function handleAddWatchlist(e) {
  e.preventDefault();
  
  const label = watchLabelInput.value.trim();
  const address = watchAddressInput.value.trim();

  if (!label || !address) return;

  if (!isValidStellarAddress(address)) {
    alert('Please enter a valid Stellar G... address.');
    return;
  }

  if (watchlist.some(item => item.address === address)) {
    alert('This account is already in your watchlist.');
    return;
  }

  watchlist.push({ label, address, balance: null });
  localStorage.setItem('astra_watchlist', JSON.stringify(watchlist));
  
  watchLabelInput.value = '';
  watchAddressInput.value = '';
  
  renderWatchlist();
  pollWatchlistBalances();
}

function removeWatchlistAddress(index) {
  watchlist.splice(index, 1);
  localStorage.setItem('astra_watchlist', JSON.stringify(watchlist));
  renderWatchlist();
}

async function pollWatchlistBalances() {
  if (watchlist.length === 0) return;

  for (let i = 0; i < watchlist.length; i++) {
    const item = watchlist[i];
    try {
      const account = await server.loadAccount(item.address);
      const nativeBalance = account.balances.find(b => b.asset_type === 'native');
      item.balance = nativeBalance ? nativeBalance.balance : '0.00';
    } catch (err) {
      if (err.name === 'NotFoundError' || (err.response && err.response.status === 404)) {
        item.balance = '0.00';
      } else {
        console.error(`Balance fetch failed for watched key ${item.address}:`, err);
      }
    }
  }

  localStorage.setItem('astra_watchlist', JSON.stringify(watchlist));
  renderWatchlist();
}

// ==========================================
// 7. Friendbot Faucet Interface
// ==========================================
async function handleRequestFaucet() {
  if (!userAddress) return;

  faucetBtn.disabled = true;
  faucetBtnContent.classList.add('hidden');
  faucetSpinner.classList.remove('hidden');

  try {
    const response = await fetch(`https://friendbot.stellar.org/?addr=${userAddress}`);
    if (response.ok) {
      alert('Success! Your account was credited with 10,000 testnet XLM.');
      fetchAccountData();
    } else {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.detail || 'Overloaded');
    }
  } catch (err) {
    console.error('Friendbot faucet error:', err);
    alert(`Friendbot failed: ${err.message || 'Server was busy. Please try again.'}`);
  } finally {
    faucetBtn.disabled = false;
    faucetBtnContent.classList.remove('hidden');
    faucetSpinner.classList.add('hidden');
  }
}

// ==========================================
// 8. Payment Validations (Single Transfer)
// ==========================================
function validateRecipientAddress() {
  const value = recipientInput.value.trim();
  
  if (value.length === 0) {
    recipientInput.classList.remove('is-valid', 'is-invalid');
    recipientIndicator.innerHTML = '';
    return false;
  }

  const isFederation = value.includes('*') && value.split('*').length === 2;

  if (isValidStellarAddress(value) || isFederation) {
    recipientInput.classList.remove('is-invalid');
    recipientInput.classList.add('is-valid');
    recipientIndicator.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" width="16" height="16">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    `;
    return true;
  } else {
    recipientInput.classList.remove('is-valid');
    recipientInput.classList.add('is-invalid');
    recipientIndicator.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3" width="16" height="16">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    return false;
  }
}

function validateAmount() {
  const value = parseFloat(amountInput.value);
  const fee = 0.00001;
  
  if (isNaN(value) || value <= 0 || value > (currentBalance - fee)) {
    amountInput.classList.remove('is-valid');
    amountInput.classList.add('is-invalid');
    return false;
  }

  amountInput.classList.remove('is-invalid');
  amountInput.classList.add('is-valid');
  return true;
}

function validateMemo() {
  const val = memoInput.value.trim();
  const type = memoTypeSelect.value;

  if (val.length === 0) {
    memoInput.classList.remove('is-valid', 'is-invalid');
    return true;
  }

  if (type === 'id') {
    const isNumeric = /^\d+$/.test(val);
    if (!isNumeric) {
      memoInput.classList.remove('is-valid');
      memoInput.classList.add('is-invalid');
      return false;
    }
  }

  memoInput.classList.remove('is-invalid');
  memoInput.classList.add('is-valid');
  return true;
}

function handleSetMaxAmount() {
  const fee = 0.00001;
  const maxVal = Math.max(0.0, currentBalance - fee - 1.0); // leave 1 XLM reserve
  
  if (maxVal > 0) {
    amountInput.value = maxVal.toFixed(7);
  } else {
    amountInput.value = Math.max(0.0, currentBalance - fee).toFixed(7);
  }
  validateAmount();
}

// ==========================================
// 9. Send Transaction (Single Transfer)
// ==========================================
async function handleSendPayment(e) {
  e.preventDefault();

  let recipient = recipientInput.value.trim();
  const amount = amountInput.value.trim();
  let memoType = memoTypeSelect.value;
  let memoVal = memoInput.value.trim();

  if (!validateRecipientAddress() || !validateAmount() || !validateMemo()) {
    alert('Please correct validation errors before sending.');
    return;
  }

  showModal();
  updateStepperState(1, 'active');
  modalStatusText.textContent = 'Building Stellar payment operations...';

  try {
    if (recipient.includes('*')) {
      modalStatusText.textContent = 'Resolving federation address...';
      const fedResponse = await FederationServer.resolve(recipient);
      recipient = fedResponse.account_id;
      if (fedResponse.memo_type && fedResponse.memo) {
        memoType = fedResponse.memo_type;
        memoVal = fedResponse.memo;
      }
    }

    const sourceAccount = await server.loadAccount(userAddress);
    const fee = await server.fetchBaseFee();

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: fee.toString(),
      networkPassphrase: Networks.TESTNET,
    })
    .addOperation(Operation.payment({
      destination: recipient,
      asset: Asset.native(),
      amount: amount,
    }));

    if (memoVal) {
      if (memoType === 'id') {
        txBuilder.addMemo(Memo.id(memoVal));
      } else {
        txBuilder.addMemo(Memo.text(memoVal));
      }
    }

    const tx = txBuilder.setTimeout(60).build();
    const xdr = tx.toXDR();

    updateStepperState(1, 'completed');
    updateStepperState(2, 'active');
    modalStatusText.textContent = `Awaiting signature from ${activeWallet === 'freighter' ? 'Freighter' : 'Albedo'}...`;

    const signedXdr = await signTxEnvelope(xdr);

    updateStepperState(2, 'completed');
    updateStepperState(3, 'active');
    modalStatusText.textContent = 'Submitting transaction envelope to ledger...';

    const txToSubmit = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    const subResult = await server.submitTransaction(txToSubmit);

    updateStepperState(3, 'completed');
    updateStepperState(4, 'completed');

    modalSpinner.classList.add('hidden');
    modalSuccessIcon.classList.remove('hidden');
    modalStatusText.textContent = 'Transaction successfully processed and indexed!';
    modalTitle.textContent = 'Payment Complete';

    modalTxHash.textContent = subResult.hash;
    modalExplorerLink.href = `https://stellar.expert/explorer/testnet/tx/${subResult.hash}`;
    modalTxHashContainer.classList.remove('hidden');

    modalActionBtn.textContent = 'Done';
    modalActionBtn.classList.remove('btn-secondary');
    modalActionBtn.classList.add('btn-primary');

    fetchAccountData();
    resetSendForm();

  } catch (err) {
    console.error('Send payment failure:', err);

    let errText = err.message || err.toString();
    if (err.response && err.response.data && err.response.data.extras && err.response.data.extras.result_codes) {
      const code = err.response.data.extras.result_codes.transaction;
      errText += ` (Horizon code: ${code})`;
    }

    modalSpinner.classList.add('hidden');
    modalErrorIcon.classList.remove('hidden');
    modalStatusText.textContent = `Transaction failed: ${errText}`;
    modalTitle.textContent = 'Payment Failed';

    for (let s = 1; s <= 3; s++) {
      if (steps[s].classList.contains('active')) {
        steps[s].classList.remove('active');
      }
    }

    modalActionBtn.textContent = 'Close';
    modalActionBtn.disabled = false;
  }
}

// ==========================================
// 10. Split Bill Calculator & Submission
// ==========================================
function addSplitRecipientInput(initialAddress = '') {
  const rowId = Date.now() + Math.random().toString(36).substr(2, 5);
  
  const row = document.createElement('div');
  row.className = 'split-recipient-row';
  row.id = `split-row-${rowId}`;
  
  row.innerHTML = `
    <input 
      type="text" 
      class="split-recipient-address font-mono" 
      placeholder="Recipient Address G..." 
      value="${initialAddress}"
      required 
    />
    <button type="button" class="btn-remove-recipient" title="Remove">&times;</button>
  `;

  // Attach dynamic calculate listeners
  const input = row.querySelector('.split-recipient-address');
  input.addEventListener('input', () => {
    validateSplitRowInput(input);
    calculateSplitShare();
  });

  row.querySelector('.btn-remove-recipient').addEventListener('click', () => {
    row.remove();
    calculateSplitShare();
  });

  splitRecipientsContainer.appendChild(row);
  validateSplitRowInput(input);
  calculateSplitShare();
}

function validateSplitRowInput(input) {
  const val = input.value.trim();
  if (val.length === 0) {
    input.classList.remove('is-valid', 'is-invalid');
  } else if (isValidStellarAddress(val) && val !== userAddress) {
    input.classList.remove('is-invalid');
    input.classList.add('is-valid');
  } else {
    input.classList.remove('is-valid');
    input.classList.add('is-invalid');
  }
}

function calculateSplitShare() {
  const total = parseFloat(splitTotalInput.value);
  const rows = splitRecipientsContainer.querySelectorAll('.split-recipient-row');
  const recipientsCount = rows.length;

  // The split includes the sender (you), so we divide by recipientsCount + 1
  const sharesTotal = recipientsCount + 1;
  splitSharesCount.textContent = sharesTotal;

  if (isNaN(total) || total <= 0 || recipientsCount === 0) {
    splitShareVal.textContent = '0.0000000 XLM';
    return 0;
  }

  const share = total / sharesTotal;
  splitShareVal.textContent = `${share.toFixed(7)} XLM`;
  return share;
}

async function handleSendSplitPayments(e) {
  e.preventDefault();

  const totalBill = parseFloat(splitTotalInput.value);
  const rows = splitRecipientsContainer.querySelectorAll('.split-recipient-row');
  
  if (isNaN(totalBill) || totalBill <= 0) {
    alert('Please enter a valid total bill amount.');
    return;
  }

  if (rows.length === 0) {
    alert('Please add at least one recipient to split the bill with.');
    return;
  }

  // Extract and validate all recipient addresses
  const recipients = [];
  let hasErrors = false;

  rows.forEach(row => {
    const input = row.querySelector('.split-recipient-address');
    const addr = input.value.trim();

    if (!isValidStellarAddress(addr) || addr === userAddress) {
      input.classList.add('is-invalid');
      hasErrors = true;
    } else {
      recipients.push(addr);
    }
  });

  if (hasErrors) {
    alert('Please correct the invalid Stellar addresses in your split list. Note: You cannot split with your own address.');
    return;
  }

  const computedShare = totalBill / (recipients.length + 1);
  const totalToTransfer = computedShare * recipients.length;
  const baseFee = 0.00001;

  if (totalToTransfer > (currentBalance - baseFee)) {
    alert('Insufficient funds. The total amount to transfer for all splits exceeds your available balance.');
    return;
  }

  showModal();
  updateStepperState(1, 'active');
  modalStatusText.textContent = `Building multi-payment transaction for ${recipients.length} recipients...`;

  try {
    const sourceAccount = await server.loadAccount(userAddress);
    // Stellar base fee multiplier for multiple operations
    const baseFeeVal = await server.fetchBaseFee();
    const totalFee = baseFeeVal * recipients.length;

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: totalFee.toString(),
      networkPassphrase: Networks.TESTNET,
    });

    // Add a Payment operation for EACH recipient in the split bill list
    recipients.forEach(recipient => {
      txBuilder.addOperation(Operation.payment({
        destination: recipient,
        asset: Asset.native(),
        amount: computedShare.toFixed(7),
      }));
    });

    txBuilder.addMemo(Memo.text('Split Bill Payment'));

    const tx = txBuilder.setTimeout(60).build();
    const xdr = tx.toXDR();

    updateStepperState(1, 'completed');
    updateStepperState(2, 'active');
    modalStatusText.textContent = `Awaiting signature from ${activeWallet === 'freighter' ? 'Freighter' : 'Albedo'}...`;

    const signedXdr = await signTxEnvelope(xdr);

    updateStepperState(2, 'completed');
    updateStepperState(3, 'active');
    modalStatusText.textContent = 'Submitting multi-payment envelope to ledger...';

    const txToSubmit = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    const subResult = await server.submitTransaction(txToSubmit);

    updateStepperState(3, 'completed');
    updateStepperState(4, 'completed');

    modalSpinner.classList.add('hidden');
    modalSuccessIcon.classList.remove('hidden');
    modalStatusText.textContent = `Split bill successfully executed! Sent ${computedShare.toFixed(2)} XLM each to ${recipients.length} recipients.`;
    modalTitle.textContent = 'Split Bill Sent';

    modalTxHash.textContent = subResult.hash;
    modalExplorerLink.href = `https://stellar.expert/explorer/testnet/tx/${subResult.hash}`;
    modalTxHashContainer.classList.remove('hidden');

    modalActionBtn.textContent = 'Done';
    modalActionBtn.classList.remove('btn-secondary');
    modalActionBtn.classList.add('btn-primary');

    fetchAccountData();
    resetSplitForm();

  } catch (err) {
    console.error('Split bill execution failed:', err);

    let errText = err.message || err.toString();
    if (err.response && err.response.data && err.response.data.extras && err.response.data.extras.result_codes) {
      const code = err.response.data.extras.result_codes.transaction;
      errText += ` (Horizon code: ${code})`;
    }

    modalSpinner.classList.add('hidden');
    modalErrorIcon.classList.remove('hidden');
    modalStatusText.textContent = `Split bill transaction failed: ${errText}`;
    modalTitle.textContent = 'Split Failed';

    for (let s = 1; s <= 3; s++) {
      if (steps[s].classList.contains('active')) {
        steps[s].classList.remove('active');
      }
    }

    modalActionBtn.textContent = 'Close';
    modalActionBtn.disabled = false;
  }
}

// ==========================================
// 11. Transaction Details Inspector Drawer
// ==========================================
async function showInspectorDrawer(paymentRecord) {
  inspectorDrawer.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  insType.textContent = paymentRecord.type === 'create_account' ? 'Create Account' : 'Payment';
  insTime.textContent = new Date(paymentRecord.created_at).toLocaleString();
  insHash.textContent = paymentRecord.transaction_hash;
  
  if (paymentRecord.type === 'create_account') {
    insSender.textContent = paymentRecord.funder;
    insRecipient.textContent = paymentRecord.account;
    insAmount.textContent = `${parseFloat(paymentRecord.starting_balance).toFixed(2)} XLM`;
  } else {
    insSender.textContent = paymentRecord.from;
    insRecipient.textContent = paymentRecord.to;
    insAmount.textContent = `${parseFloat(paymentRecord.amount).toFixed(2)} XLM`;
  }

  insMemo.innerHTML = '<span class="text-secondary font-mono">Loading ledger details...</span>';
  insExplorerBtn.href = `https://stellar.expert/explorer/testnet/tx/${paymentRecord.transaction_hash}`;

  try {
    const txDetails = await server.transactions().transaction(paymentRecord.transaction_hash).call();
    
    let memoText = 'None';
    if (txDetails.memo_type !== 'none' && txDetails.memo) {
      memoText = `${txDetails.memo} (${txDetails.memo_type.toUpperCase()})`;
    }
    
    const feeChargedXlm = (parseFloat(txDetails.fee_charged) / 10000000).toFixed(7);

    insMemo.innerHTML = `
      <div>Sequence: <span class="text-primary font-mono">${txDetails.ledger}</span></div>
      <div style="margin-top: 4px;">Memo: <span class="text-primary font-mono">${memoText}</span></div>
      <div style="margin-top: 4px;">Fee Charged: <span class="text-primary font-mono">${feeChargedXlm} XLM</span></div>
    `;

  } catch (err) {
    console.error('Inspector detail fetch error:', err);
    insMemo.innerHTML = '<span class="text-danger font-mono">Failed to fetch ledger parameters</span>';
  }
}

function hideInspectorDrawer() {
  inspectorDrawer.classList.add('hidden');
  document.body.style.overflow = '';
}

// ==========================================
// 12. UI Animations & Modal Controls
// ==========================================
function animateBalanceDisplay(targetVal) {
  let startValue = parseFloat(walletBalance.textContent.replace(/,/g, ''));
  if (isNaN(startValue)) startValue = 0.0;

  const duration = 600;
  const start = performance.now();

  function scroll(time) {
    const elapsed = time - start;
    const progress = Math.min(elapsed / duration, 1.0);
    const ease = progress * (2.0 - progress);
    const current = startValue + (targetVal - startValue) * ease;

    walletBalance.textContent = current.toLocaleString(undefined, {
      minimumFractionDigits: 7,
      maximumFractionDigits: 7
    });

    if (progress < 1.0) {
      requestAnimationFrame(scroll);
    }
  }

  requestAnimationFrame(scroll);
}

function animateRefreshIcon() {
  refreshIcon.style.transition = 'transform 0.5s ease';
  refreshIcon.style.transform = 'rotate(360deg)';
  setTimeout(() => {
    refreshIcon.style.transition = '';
    refreshIcon.style.transform = '';
  }, 500);
}

function showModal() {
  statusModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  
  modalTitle.textContent = 'Processing Transaction';
  modalStatusText.textContent = 'Initiating...';
  modalSpinner.classList.remove('hidden');
  modalSuccessIcon.classList.add('hidden');
  modalErrorIcon.classList.add('hidden');
  modalTxHashContainer.classList.add('hidden');
  modalActionBtn.textContent = 'Please Wait';
  modalActionBtn.disabled = true;

  Object.keys(steps).forEach(s => {
    steps[s].className = 'step-item';
  });
}

function hideModal() {
  statusModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function updateStepperState(stepNum, status) {
  if (!steps[stepNum]) return;
  if (status === 'active') {
    steps[stepNum].classList.add('active');
    steps[stepNum].classList.remove('completed');
  } else if (status === 'completed') {
    steps[stepNum].classList.remove('active');
    steps[stepNum].classList.add('completed');
  }
}

function resetSendForm() {
  sendForm.reset();
  recipientInput.classList.remove('is-valid', 'is-invalid');
  recipientIndicator.innerHTML = '';
  amountInput.classList.remove('is-valid', 'is-invalid');
  memoInput.classList.remove('is-valid', 'is-invalid');
}

function resetSplitForm() {
  splitForm.reset();
  splitRecipientsContainer.innerHTML = '';
  splitShareVal.textContent = '0.0000000 XLM';
  splitSharesCount.textContent = '1';
}

// ==========================================
// 13. Soroban Smart Contract Invocation
// ==========================================
// Error Types Handled:
//   Type 1 — Wallet not connected (guard clause at the top)
//   Type 2 — User rejects signing in wallet (caught in signTxEnvelope)
//   Type 3 — Simulation or execution failure (caught in try/catch)
async function handleInvokeContract(e) {
  e.preventDefault();

  // ── Error Type 1: Wallet not connected ─────────────────────────────────────
  if (!userAddress) {
    showContractError('Wallet not connected. Please connect your wallet before invoking a contract.');
    return;
  }

  const toName = contractToInput.value.trim();
  if (!toName) {
    showContractError('Please enter a name to greet.');
    return;
  }

  // Reset result box
  contractResultBox.classList.add('hidden');
  contractSubmitBtn.disabled = true;
  contractSubmitBtn.textContent = 'Building transaction...';

  try {
    // ── Step 1: Build the contract call operation ──────────────────────────
    const contract = new Contract(CONTRACT_ID);

    // Build ScVal argument for the "to" parameter
    const toArg = xdr.ScVal.scvString(toName);

    // Load the source account
    const sourceAccount = await server.loadAccount(userAddress);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('hello', toArg))
      .setTimeout(60)
      .build();

    // ── Step 2: Simulate the transaction via Soroban RPC ──────────────────
    contractSubmitBtn.textContent = 'Simulating on testnet...';
    let simResponse;
    try {
      simResponse = await withTimeout(
        rpcServer.simulateTransaction(tx),
        20000,
        'Soroban simulation timed out. The RPC endpoint may be busy.'
      );
    } catch (simErr) {
      // ── Error Type 3a: Simulation failure ────────────────────────────────
      throw new Error(`Simulation failed: ${simErr.message || simErr}`);
    }

    // Check for simulation errors returned in the result envelope
    if (rpc.Api.isSimulationError(simResponse)) {
      // ── Error Type 3b: Contract simulation returned an error ─────────────
      const simErrText = simResponse.error || 'Unknown simulation error';
      throw new Error(`Contract simulation error: ${simErrText}`);
    }

    // ── Step 3: Assemble the authorized transaction ────────────────────────
    const assembledTx = rpc.assembleTransaction(tx, simResponse).build();

    // ── Step 4: Request wallet signature (may trigger Error Type 2) ────────
    contractSubmitBtn.textContent = `Awaiting ${activeWallet === 'freighter' ? 'Freighter' : 'Albedo'} signature...`;
    let signedXdr;
    try {
      signedXdr = await signTxEnvelope(assembledTx.toXDR());
    } catch (sigErr) {
      // ── Error Type 2: User rejected signing ──────────────────────────────
      const msg = sigErr.message || '';
      if (
        msg.toLowerCase().includes('declined') ||
        msg.toLowerCase().includes('rejected') ||
        msg.toLowerCase().includes('denied') ||
        msg.toLowerCase().includes('cancel')
      ) {
        throw new Error('You declined the signature request. No transaction was sent.');
      }
      throw sigErr;
    }

    // ── Step 5: Submit the signed transaction to the network ───────────────
    contractSubmitBtn.textContent = 'Submitting to ledger...';
    const txToSubmit = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    let submitResult;
    try {
      submitResult = await withTimeout(
        server.submitTransaction(txToSubmit),
        30000,
        'Transaction submission timed out.'
      );
    } catch (subErr) {
      // ── Error Type 3c: Submission / execution failure ────────────────────
      let subErrText = subErr.message || subErr.toString();
      if (subErr.response && subErr.response.data && subErr.response.data.extras) {
        const code = subErr.response.data.extras.result_codes;
        subErrText += ` (code: ${JSON.stringify(code)})`;
      }
      throw new Error(`Submission failed: ${subErrText}`);
    }

    // ── Step 6: Parse the return value from simulation result ──────────────
    let returnDisplay = '[]';
    try {
      if (simResponse.result && simResponse.result.retval) {
        const native = scValToNative(simResponse.result.retval);
        returnDisplay = JSON.stringify(native);
      }
    } catch (_) {
      returnDisplay = '[result parsed]';
    }

    // ── Step 7: Show results ───────────────────────────────────────────────
    contractResultVal.textContent = returnDisplay;
    contractResultBox.classList.remove('hidden');

    // Show a success entry in the modal for transaction visibility
    showModal();
    updateStepperState(1, 'completed');
    updateStepperState(2, 'completed');
    updateStepperState(3, 'completed');
    updateStepperState(4, 'completed');

    modalSpinner.classList.add('hidden');
    modalSuccessIcon.classList.remove('hidden');
    modalTitle.textContent = 'Contract Invoked';
    modalStatusText.textContent = `hello("${toName}") returned: ${returnDisplay}`;

    modalTxHash.textContent = submitResult.hash;
    modalExplorerLink.href = `https://stellar.expert/explorer/testnet/tx/${submitResult.hash}`;
    modalTxHashContainer.classList.remove('hidden');

    modalActionBtn.textContent = 'Done';
    modalActionBtn.classList.remove('btn-secondary');
    modalActionBtn.classList.add('btn-primary');
    modalActionBtn.disabled = false;

  } catch (err) {
    console.error('Contract invocation failed:', err);
    showContractError(err.message || err.toString());
  } finally {
    contractSubmitBtn.disabled = false;
    contractSubmitBtn.textContent = 'Invoke hello() Function';
  }
}

function showContractError(message) {
  contractResultVal.textContent = `Error: ${message}`;
  contractResultVal.style.color = 'var(--color-danger, #ef4444)';
  contractResultBox.classList.remove('hidden');
  // Reset color after a new successful call
  contractResultBox.addEventListener('transitionend', () => {
    contractResultVal.style.color = '';
  }, { once: true });
}

// ==========================================
// 14. Trustline / Asset Manager
// ==========================================
async function handleTrustline(e) {
  e.preventDefault();
  if (!userAddress) {
    alert('Please connect your wallet first.');
    return;
  }

  const assetCode = trustAssetCode.value.trim();
  const assetIssuer = trustAssetIssuer.value.trim();

  if (!assetCode || !isValidStellarAddress(assetIssuer)) {
    alert('Invalid asset code or issuer address.');
    return;
  }

  trustSubmitBtn.disabled = true;
  trustSubmitBtn.textContent = 'Processing...';

  try {
    const account = await server.loadAccount(userAddress);
    const asset = new Asset(assetCode, assetIssuer);
    const op = Operation.changeTrust({ asset: asset });
    
    const tx = new TransactionBuilder(account, {
      fee: await server.fetchBaseFee(),
      networkPassphrase: Networks.TESTNET
    })
    .addOperation(op)
    .setTimeout(180)
    .build();

    showModal('Adding Trustline');
    
    const signedXdr = await signTxEnvelope(tx.toXDR());
    updateModalStep(2);

    const txToSubmit = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    const result = await server.submitTransaction(txToSubmit);
    
    updateModalStep(3, result.hash);
    fetchAccountData();
    trustAssetCode.value = '';
    trustAssetIssuer.value = '';
  } catch (err) {
    console.error('Trustline error:', err);
    updateModalError(err.message || 'Failed to add trustline');
  } finally {
    trustSubmitBtn.disabled = false;
    trustSubmitBtn.textContent = 'Create Trustline';
  }
}

// ==========================================
// 15. Toast Notification System
// ==========================================
let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * Show a non-blocking toast notification.
 * @param {string} message - The message to display
 * @param {'success'|'error'|'info'|'warning'} type - Toast type
 * @param {number} duration - Auto-dismiss in ms (0 = no auto-dismiss)
 */
function showToast(message, type = 'info', duration = 4000) {
  const container = ensureToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };
  
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" aria-label="Dismiss">×</button>
  `;
  
  const close = toast.querySelector('.toast-close');
  const dismiss = () => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  };
  close.addEventListener('click', dismiss);
  
  container.appendChild(toast);
  
  // Trigger entrance animation
  requestAnimationFrame(() => toast.classList.add('toast-enter'));
  
  if (duration > 0) {
    setTimeout(dismiss, duration);
  }
  
  return { dismiss };
}

// ==========================================
// 16. Retry with Exponential Backoff
// ==========================================
/**
 * Retries an async function with exponential backoff.
 * @param {Function} fn - Async function to retry
 * @param {number} maxAttempts - Max retry attempts (default 3)
 * @param {number} baseDelayMs - Base delay between retries (default 500ms)
 */
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[Retry] Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ==========================================
// 17. Global Error Boundary
// ==========================================
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Global] Unhandled promise rejection:', event.reason);
  const msg = event.reason?.message || String(event.reason) || 'An unexpected error occurred.';
  
  // Don't show toast for user-cancelled wallet actions
  if (
    msg.toLowerCase().includes('user rejected') ||
    msg.toLowerCase().includes('declined') ||
    msg.toLowerCase().includes('cancelled')
  ) {
    return;
  }
  
  showToast(`Unexpected error: ${msg}`, 'error', 6000);
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  console.error('[Global] Uncaught error:', event.error);
  // Only show toast for non-network errors
  if (event.error && !event.error.message?.includes('network')) {
    showToast(`Script error: ${event.error.message}`, 'error', 6000);
  }
});

// ==========================================
// 18. Soroban Contract Event Streaming (getEvents RPC)
// ==========================================

/** Renders the captured events list in the UI */
function renderContractEvents() {
  const eventsList = document.getElementById('contract-events-list');
  if (!eventsList) return;
  
  if (capturedEvents.length === 0) {
    eventsList.innerHTML = '<li class="events-empty-state">No events captured yet. Call increment() to emit an event.</li>';
    return;
  }
  
  eventsList.innerHTML = '';
  // Show newest first
  [...capturedEvents].reverse().forEach(ev => {
    const li = document.createElement('li');
    li.className = 'event-log-item';
    
    const topicStr = Array.isArray(ev.topic) ? ev.topic.join(' / ') : String(ev.topic);
    const dataStr = ev.data !== undefined ? String(ev.data) : '—';
    
    li.innerHTML = `
      <div class="event-item-header">
        <span class="event-topic-badge">${topicStr}</span>
        <span class="event-ledger">Ledger #${ev.ledger}</span>
      </div>
      <div class="event-item-data">
        <span class="event-data-label">data:</span>
        <span class="event-data-val font-mono">${dataStr}</span>
      </div>
    `;
    eventsList.appendChild(li);
  });
  
  // Auto-scroll to top (newest)
  eventsList.scrollTop = 0;
}

/** Fetches new contract events since lastLedgerPolled using Soroban RPC */
async function pollContractEvents() {
  if (!CONTRACT_ID) return;
  
  try {
    const ledgerInfo = await withRetry(() => rpcServer.getLatestLedger(), 2, 300);
    const currentLedger = ledgerInfo.sequence;
    
    if (lastLedgerPolled === 0) {
      // First poll: look back ~50 ledgers (~4 minutes)
      lastLedgerPolled = Math.max(currentLedger - 50, 1);
    }
    
    if (currentLedger <= lastLedgerPolled) return;
    
    const eventsResponse = await withRetry(() => rpcServer.getEvents({
      startLedger: lastLedgerPolled,
      filters: [
        {
          type: 'contract',
          contractIds: [CONTRACT_ID],
        },
      ],
      limit: 20,
    }), 2, 300);
    
    lastLedgerPolled = currentLedger;
    
    if (eventsResponse && eventsResponse.events && eventsResponse.events.length > 0) {
      eventsResponse.events.forEach(ev => {
        // Deduplicate by id
        const exists = capturedEvents.some(ce => ce.id === ev.id);
        if (!exists) {
          let topicLabels = [];
          let dataVal = '—';
          
          try {
            topicLabels = (ev.topic || []).map(t => {
              const native = scValToNative(t);
              return String(native);
            });
          } catch { topicLabels = ['event']; }
          
          try {
            if (ev.value) {
              dataVal = String(scValToNative(ev.value));
            }
          } catch { dataVal = '(raw)'; }
          
          capturedEvents.push({
            id: ev.id || `${ev.ledger}-${Math.random()}`,
            ledger: ev.ledger,
            topic: topicLabels,
            data: dataVal,
          });
          
          // Keep last 50 events
          if (capturedEvents.length > 50) capturedEvents.shift();
          
          // Show a toast for the new event
          const topicStr = topicLabels.join('/');
          showToast(`📡 Contract event: ${topicStr} = ${dataVal}`, 'info', 3000);
        }
      });
      
      renderContractEvents();
    }
  } catch (err) {
    // Silently ignore polling errors (network may be temporarily unavailable)
    console.warn('[EventPoll] Failed to fetch events:', err.message);
  }
}

/** Start polling for contract events every 5 seconds */
function startEventPolling() {
  stopEventPolling();
  lastLedgerPolled = 0;
  pollContractEvents(); // Immediate first fetch
  eventPollInterval = setInterval(pollContractEvents, 5000);
}

/** Stop event polling */
function stopEventPolling() {
  if (eventPollInterval) {
    clearInterval(eventPollInterval);
    eventPollInterval = null;
  }
}

// ==========================================
// 19. Advanced Contract Functions
// ==========================================

/** Skeleton loading state for the counter display */
function setCounterSkeleton(loading) {
  const countEl = document.getElementById('counter-value');
  if (!countEl) return;
  if (loading) {
    countEl.textContent = '…';
    countEl.classList.add('skeleton-text');
  } else {
    countEl.classList.remove('skeleton-text');
  }
}

/** Read-only query: get_count() via simulation (no wallet needed) */
async function handleGetCount() {
  const countEl = document.getElementById('counter-value');
  const refreshBtn = document.getElementById('counter-refresh-btn');
  if (!countEl) return;
  
  setCounterSkeleton(true);
  if (refreshBtn) refreshBtn.disabled = true;
  
  try {
    const contract = new Contract(CONTRACT_ID);
    
    // Use a dummy source account for simulation (no auth needed for read)
    // If user is connected, use their account; otherwise use a well-known testnet account
    const sourceKey = userAddress || 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
    
    let sourceAccount;
    try {
      sourceAccount = await withRetry(() => server.loadAccount(sourceKey), 2, 500);
    } catch {
      countEl.textContent = '?';
      setCounterSkeleton(false);
      return;
    }
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('get_count'))
      .setTimeout(30)
      .build();
    
    const simResponse = await withRetry(
      () => rpcServer.simulateTransaction(tx),
      2, 500
    );
    
    if (!rpc.Api.isSimulationError(simResponse) && simResponse.result?.retval) {
      const native = scValToNative(simResponse.result.retval);
      countEl.textContent = String(native);
    } else {
      countEl.textContent = '?';
    }
  } catch (err) {
    console.warn('[getCount] Failed:', err.message);
    countEl.textContent = 'N/A';
  } finally {
    setCounterSkeleton(false);
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

/** Write transaction: increment() */
async function handleIncrementCounter() {
  if (!userAddress) {
    showToast('Connect your wallet to call increment()', 'warning');
    return;
  }
  
  const btn = document.getElementById('counter-increment-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Simulating…'; }
  
  try {
    const contract = new Contract(CONTRACT_ID);
    const sourceAccount = await withRetry(
      () => server.loadAccount(userAddress), 3, 500
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('increment'))
      .setTimeout(60)
      .build();
    
    if (btn) btn.textContent = 'Simulating…';
    const simResponse = await withRetry(
      () => rpcServer.simulateTransaction(tx), 2, 500
    );
    
    if (rpc.Api.isSimulationError(simResponse)) {
      throw new Error(simResponse.error || 'Simulation failed');
    }
    
    const assembledTx = rpc.assembleTransaction(tx, simResponse).build();
    
    if (btn) btn.textContent = 'Sign in wallet…';
    const signedXdr = await signTxEnvelope(assembledTx.toXDR());
    
    if (btn) btn.textContent = 'Submitting…';
    const txToSubmit = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    const submitResult = await withRetry(
      () => server.submitTransaction(txToSubmit), 2, 1000
    );
    
    // Parse return value
    let newCount = '?';
    if (simResponse.result?.retval) {
      try { newCount = String(scValToNative(simResponse.result.retval)); } catch {}
    }
    
    const countEl = document.getElementById('counter-value');
    if (countEl) countEl.textContent = newCount;
    
    showToast(`✅ Counter incremented! New value: ${newCount}`, 'success');
    
    // Trigger event polling immediately
    setTimeout(pollContractEvents, 1000);
    
  } catch (err) {
    console.error('[increment] Failed:', err);
    showToast(`Increment failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Increment Counter (+1)'; }
  }
}

/** Write transaction: batch_increment(steps) */
async function handleBatchIncrement(steps) {
  if (!userAddress) {
    showToast('Connect your wallet to call batch_increment()', 'warning');
    return;
  }
  if (!steps || steps < 1 || steps > 100) {
    showToast('Batch steps must be between 1 and 100', 'warning');
    return;
  }
  
  const btn = document.getElementById('batch-increment-btn');
  if (btn) { btn.disabled = true; btn.textContent = `Batching ${steps} steps…`; }
  
  try {
    const contract = new Contract(CONTRACT_ID);
    const sourceAccount = await withRetry(() => server.loadAccount(userAddress), 3, 500);
    
    const stepsArg = xdr.ScVal.scvU32(parseInt(steps));
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('batch_increment', stepsArg))
      .setTimeout(60)
      .build();
    
    const simResponse = await withRetry(() => rpcServer.simulateTransaction(tx), 2, 500);
    if (rpc.Api.isSimulationError(simResponse)) throw new Error(simResponse.error);
    
    const assembledTx = rpc.assembleTransaction(tx, simResponse).build();
    const signedXdr = await signTxEnvelope(assembledTx.toXDR());
    const txToSubmit = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    await server.submitTransaction(txToSubmit);
    
    let result = null;
    if (simResponse.result?.retval) {
      try { result = scValToNative(simResponse.result.retval); } catch {}
    }
    
    const endCount = result?.end_count ?? '?';
    const countEl = document.getElementById('counter-value');
    if (countEl) countEl.textContent = String(endCount);
    
    showToast(`✅ Batch: ${steps} steps → counter = ${endCount}`, 'success');
    setTimeout(pollContractEvents, 1000);
    
  } catch (err) {
    showToast(`Batch increment failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Batch Increment'; }
  }
}

/** Write transaction: store_message(key, value) */
async function handleStoreMessage(key, value) {
  if (!userAddress) {
    showToast('Connect your wallet to store a message', 'warning');
    return;
  }
  
  const btn = document.getElementById('store-msg-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Storing…'; }
  
  try {
    const contract = new Contract(CONTRACT_ID);
    const sourceAccount = await withRetry(() => server.loadAccount(userAddress), 3, 500);
    
    const keyArg = xdr.ScVal.scvString(key);
    const valArg = xdr.ScVal.scvString(value);
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('store_message', keyArg, valArg))
      .setTimeout(60)
      .build();
    
    const simResponse = await withRetry(() => rpcServer.simulateTransaction(tx), 2, 500);
    if (rpc.Api.isSimulationError(simResponse)) throw new Error(simResponse.error);
    
    const assembledTx = rpc.assembleTransaction(tx, simResponse).build();
    const signedXdr = await signTxEnvelope(assembledTx.toXDR());
    const txToSubmit = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    await server.submitTransaction(txToSubmit);
    
    showToast(`✅ Message stored: "${key}" = "${value}"`, 'success');
    setTimeout(pollContractEvents, 1000);
    
  } catch (err) {
    showToast(`Store failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Store Message'; }
  }
}

/** Read-only: get_message(key) via simulation */
async function handleGetMessage(key) {
  const resultEl = document.getElementById('get-msg-result');
  if (resultEl) { resultEl.textContent = 'Loading…'; resultEl.classList.add('skeleton-text'); }
  
  try {
    const contract = new Contract(CONTRACT_ID);
    const sourceKey = userAddress || 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
    const sourceAccount = await withRetry(() => server.loadAccount(sourceKey), 2, 500);
    
    const keyArg = xdr.ScVal.scvString(key);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('get_message', keyArg))
      .setTimeout(30)
      .build();
    
    const simResponse = await withRetry(() => rpcServer.simulateTransaction(tx), 2, 500);
    
    if (!rpc.Api.isSimulationError(simResponse) && simResponse.result?.retval) {
      const native = scValToNative(simResponse.result.retval);
      if (resultEl) { resultEl.textContent = String(native) || '(empty)'; }
    } else {
      if (resultEl) resultEl.textContent = '(not found)';
    }
  } catch (err) {
    if (resultEl) resultEl.textContent = `Error: ${err.message}`;
  } finally {
    if (resultEl) resultEl.classList.remove('skeleton-text');
  }
}

// ==========================================
// 20. Contract Portal Event Wiring
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  // Wire up counter refresh button
  const counterRefreshBtn = document.getElementById('counter-refresh-btn');
  if (counterRefreshBtn) {
    counterRefreshBtn.addEventListener('click', () => {
      const icon = document.getElementById('counter-refresh-icon');
      if (icon) {
        icon.style.transition = 'transform 0.5s ease';
        icon.style.transform = 'rotate(360deg)';
        setTimeout(() => { icon.style.transition = ''; icon.style.transform = ''; }, 500);
      }
      handleGetCount();
    });
  }
  
  // Wire up increment button
  const incrementBtn = document.getElementById('counter-increment-btn');
  if (incrementBtn) {
    incrementBtn.addEventListener('click', handleIncrementCounter);
  }
  
  // Wire up batch increment (if form exists)
  const batchForm = document.getElementById('batch-increment-form');
  if (batchForm) {
    batchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const stepsInput = document.getElementById('batch-steps-input');
      handleBatchIncrement(parseInt(stepsInput?.value || '5'));
    });
  }
  
  // Wire up store message form
  const storeMsgForm = document.getElementById('store-message-form');
  if (storeMsgForm) {
    storeMsgForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = document.getElementById('msg-key-input')?.value.trim();
      const val = document.getElementById('msg-val-input')?.value.trim();
      if (key && val) handleStoreMessage(key, val);
    });
  }
  
  // Wire up get message form
  const getMsgForm = document.getElementById('get-message-form');
  if (getMsgForm) {
    getMsgForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = document.getElementById('get-msg-key-input')?.value.trim();
      if (key) handleGetMessage(key);
    });
  }
  
  // Start event polling when contract panel becomes active
  const contractTabBtn = document.querySelector('[data-tab="contract-panel"]');
  if (contractTabBtn) {
    contractTabBtn.addEventListener('click', () => {
      startEventPolling();
      handleGetCount();
    });
  }
});

// Re-export utility for tests (tree-shaken in production)
export { withRetry, showToast };

