import './style.css';
import { isConnected, requestAccess, getPublicKey, signTransaction } from '@stellar/freighter-api';
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

// State Variables
let userAddress = null;
let currentBalance = 0.0;
let balancePollInterval = null;
let watchlist = [];
let recentPayments = [];
let paymentStreamCloser = null;
let splitRecipients = [];
let activeWallet = 'freighter';
const CONTRACT_ID = 'CCMXLVDPY6IBFRHCYDTRAVKOVL4Z4RBL32SBDVYLYNRVRRGUYTVMMDM6';
const rpcServer = new rpc.Server('https://soroban-testnet.stellar.org');

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
      if (err.message === 'FREIGHTER_NOT_INSTALLED') {
        alert('Freighter wallet not detected.\n\nPlease:\n1. Install Freighter from freighter.app\n2. Make sure it is enabled in Chrome extensions\n3. Reload this page and try again');
      } else {
        alert(`Connection failed: ${err.message}`);
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
  } catch (err) {
    if (err.name === 'NotFoundError' || (err.response && err.response.status === 404)) {
      currentBalance = 0.0;
      walletBalance.textContent = '0.0000000';
    } else {
      console.error('Failed to query account balance:', err);
    }
  }

  // Load history lists and watchlist balances
  fetchTransactionHistory();
  pollWatchlistBalances();
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

  if (isValidStellarAddress(value)) {
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

  const recipient = recipientInput.value.trim();
  const amount = amountInput.value.trim();
  const memoType = memoTypeSelect.value;
  const memoVal = memoInput.value.trim();

  if (!validateRecipientAddress() || !validateAmount() || !validateMemo()) {
    alert('Please correct validation errors before sending.');
    return;
  }

  showModal();
  updateStepperState(1, 'active');
  modalStatusText.textContent = 'Building Stellar payment operations...';

  try {
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
