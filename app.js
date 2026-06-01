/* ===== SERVICE WORKER ===== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

/* ===== STRIPE ===== */
const STRIPE_PK = 'pk_live_51SiipcR5OonznFInqbNzaUxI3bHwqshMFjSHXmYJx3YsDMymr72zKKqtZcHpidAjqP20K5rSUVdwqa8IFFzpj3Ml00D9Y3PpxX';
// Links de pagamento criados no Stripe Dashboard:
const STRIPE_LINK_MONTHLY = 'https://buy.stripe.com/8x2dRbbjJ7rw66K9dHgIo03';
const STRIPE_LINK_ANNUAL  = 'https://buy.stripe.com/14A3cxfzZcLQcv889DgIo04';
const ADMIN_EMAIL = 'nelsontcmagalhaes@gmail.com';

/* ===== CONFIG SUPABASE ===== */
const SUPABASE_URL = 'https://cklxdvlkagwyzzmxdmpm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrbHhkdmxrYWd3eXp6bXhkbXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMDU5ODQsImV4cCI6MjA5NTU4MTk4NH0.I1vYFqOJQOo1Jsw8Q1LIVcJ8nshqnjUu5x6hrBWjiqA';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ===== STATE ===== */
let currentUser  = null;
let isPremium    = false;
let currentImage = null;
let outputMode   = 'word';
let ocrResult    = '';
let docs         = [];
let sheets       = [];
let searchQuery  = '';
let viewingDoc   = null;
let renamingDoc  = null;
let stripeMode   = 'monthly'; // 'monthly' | 'annual'
let scanCount    = 0; // contador de scans do visitante

/* ===== SETTINGS ===== */
let settings = {
  lang: 'por', quality: 0.85, format: 'word',
  theme: 'dark', psm: '6', preprocess: 'on', handwriting: 'on'
};

function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem('scribble_settings') || '{}') }; } catch {}
  try { scanCount = parseInt(localStorage.getItem('scribble_scan_count') || '0'); } catch {}
  applySettings();
}
function saveSettings() { localStorage.setItem('scribble_settings', JSON.stringify(settings)); }

function applySettings() {
  document.documentElement.setAttribute('data-theme', settings.theme);
  if ($('settingLang'))    $('settingLang').value    = settings.lang;
  if ($('settingQuality')) $('settingQuality').value = String(settings.quality);
  if ($('settingFormat'))  $('settingFormat').value  = settings.format;
  if ($('settingPsm'))     $('settingPsm').value     = settings.psm;
  document.querySelectorAll('[data-theme-btn]').forEach(b =>
    b.classList.toggle('active', b.dataset.themeBtn === settings.theme));
  document.querySelectorAll('[data-preprocess]').forEach(b =>
    b.classList.toggle('active', b.dataset.preprocess === settings.preprocess));
  document.querySelectorAll('[data-handwriting]').forEach(b =>
    b.classList.toggle('active', b.dataset.handwriting === (settings.handwriting || 'on')));
  outputMode = settings.format;
  document.querySelectorAll('.toggle-btn[data-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === outputMode));
}

/* ===== DOM ===== */
const $ = id => document.getElementById(id);

/* ===== PREMIUM CHECK ===== */
function checkPremium(user) {
  if (!user) { isPremium = false; return; }
  if (user.email === ADMIN_EMAIL) { isPremium = true; return; }
  const meta = user.user_metadata || {};
  isPremium = meta.premium === true || meta.plan === 'premium' || meta.plan === 'annual';
}

function updatePremiumUI() {
  const chip = $('planChip');
  if (isPremium) {
    chip.classList.remove('hidden');
    $('planChipLabel').textContent = currentUser?.email === ADMIN_EMAIL ? 'Admin' : 'Premium';
    $('planCurrentLabel').innerHTML = `Você está no plano <strong>${currentUser?.email === ADMIN_EMAIL ? 'Administrador' : 'Premium'}</strong> ✨`;
    $('settingPlanLabel').textContent = 'Premium ativo';
    $('visitorBanner').classList.add('hidden');
    $('premiumLockMsg').classList.add('hidden');
    // Mostra botões premium
    document.querySelectorAll('.premium-only').forEach(b => { b.style.opacity = '1'; b.disabled = false; });
    // Esconde botão assinar no perfil
    if ($('btnUpgradeProfile')) $('btnUpgradeProfile').classList.add('hidden');
  } else {
    chip.classList.add('hidden');
    $('planCurrentLabel').innerHTML = 'Você está no plano <strong>Visitante</strong>';
    $('settingPlanLabel').textContent = 'Visitante (grátis)';
    if (currentUser) $('visitorBanner').classList.remove('hidden');
    document.querySelectorAll('.premium-only').forEach(b => { b.style.opacity = '0.4'; b.disabled = true; });
    if ($('btnUpgradeProfile')) $('btnUpgradeProfile').classList.remove('hidden');
  }

  // Plano no perfil
  if ($('userPlanLabel')) {
    if (!currentUser) return;
    if (currentUser.email === ADMIN_EMAIL) {
      $('userPlanLabel').textContent = '👑 Administrador';
      $('userPlanLabel').className = 'user-plan-label admin';
      $('planBadgeAvatar').textContent = '👑';
    } else if (isPremium) {
      $('userPlanLabel').textContent = '⭐ Premium';
      $('userPlanLabel').className = 'user-plan-label premium';
      $('planBadgeAvatar').textContent = '⭐';
    } else {
      $('userPlanLabel').textContent = 'Visitante';
      $('userPlanLabel').className = 'user-plan-label';
      $('planBadgeAvatar').textContent = '';
    }
  }
}

/* ===== PWA INSTALL ===== */
let deferredInstallPrompt = null;

function showInstallButtons() {
  // Botão de instalação apenas na aba Config (btnInstallSettings)
  // O banner flutuante é controlado pelo evento beforeinstallprompt
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallButtons();
  $('installBanner')?.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.querySelectorAll('.btn-install-footer').forEach(b => b.classList.add('hidden'));
  $('installBanner')?.classList.add('hidden');
  showToast('App instalado com sucesso!');
});

window.addEventListener('load', () => setTimeout(showInstallButtons, 2500));

function openInstallGuide() {
  // Ajusta o botão "Instalar agora" conforme disponibilidade
  const btn = $('btnInstallNow');
  if (btn) {
    if (deferredInstallPrompt) {
      btn.classList.remove('hidden');
      btn.innerHTML = '<span class="material-icons-round">install_mobile</span>Instalar agora';
    } else {
      btn.classList.add('hidden');
    }
  }
  $('modalInstallGuide').classList.remove('hidden');
}

async function triggerInstall() {
  if (deferredInstallPrompt) {
    $('modalInstallGuide')?.classList.add('hidden');
    $('installBanner')?.classList.add('hidden');
    try {
      await deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredInstallPrompt = null;
        showToast('App instalado com sucesso! 🎉');
      }
    } catch {}
    return;
  }
  // Sem prompt nativo → abre guia
  openInstallGuide();
}

/* ===== INIT ===== */
window.addEventListener('load', async () => {
  loadSettings();
  checkPaymentReturn();

  // Timeout de segurança — evita loop infinito no celular
  const MAX_WAIT = 4000;
  const initPromise = initSupabase();
  const timeoutPromise = new Promise(resolve => setTimeout(resolve, MAX_WAIT));

  await Promise.race([initPromise, timeoutPromise]);

  // Esconde splash independente do resultado
  $('splash').style.opacity = '0';
  setTimeout(() => {
    $('splash').classList.add('hidden');
    if (currentUser) {
      showApp();
    } else {
      showAuthScreen();
    }
  }, 400);
});

function showApp() {
  $('authScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  loadDocs();
  updateAdminUI();
  updateHomeGreeting();
  if (!localStorage.getItem('scribble_onboarded')) {
    setTimeout(() => {
      $('modalHelp').classList.remove('hidden');
      localStorage.setItem('scribble_onboarded', '1');
    }, 700);
  }
}

function updateHomeGreeting() {
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const name = currentUser?.user_metadata?.name || currentUser?.email?.split('@')[0] || '';
  const el = $('homeGreeting');
  if (el) {
    el.querySelector('.home-hello').textContent = `${greeting}${name ? ', ' + name : ''}! 👋`;
  }
}

/* ===== HOME CARDS ===== */
document.addEventListener('DOMContentLoaded', () => {
  // Card: Escanear
  $('cardScan')?.addEventListener('click', () => {
    openScanModal();
  });

  // Card: Gravar reunião
  $('cardRecord')?.addEventListener('click', () => {
    switchTab('tabAudio');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tabAudio'));
    setTimeout(() => $('btnStartRecord')?.scrollIntoView({ behavior: 'smooth' }), 300);
  });

  // Card: Importar áudio
  $('cardAudioFile')?.addEventListener('click', () => {
    switchTab('tabAudio');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tabAudio'));
    setTimeout(() => {
      $('audioUploadArea')?.scrollIntoView({ behavior: 'smooth' });
      $('audioFileInput')?.click();
    }, 400);
  });

  // Card: Traduzir
  $('cardTranslate')?.addEventListener('click', () => {
    openScanModal();
    showToast('Escaneie o texto → depois toque em "Traduzir PT-BR"');
  });

  // Card: Meus documentos
  $('cardDocs')?.addEventListener('click', () => {
    switchTab('tabDocs');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tabDocs'));
  });
});

function showAuthScreen() {
  $('app').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
  switchAuthScreenTab('login');
}

document.addEventListener('DOMContentLoaded', () => {
  // Ajuda
  $('btnHelp')?.addEventListener('click',         () => $('modalHelp').classList.remove('hidden'));
  $('btnCloseHelp')?.addEventListener('click',    () => $('modalHelp').classList.add('hidden'));
  $('btnHelpSettings')?.addEventListener('click', () => $('modalHelp').classList.remove('hidden'));
  $('modalHelp')?.addEventListener('click', e => { if (e.target === $('modalHelp')) $('modalHelp').classList.add('hidden'); });

  // Install guia
  $('btnInstallSettings')?.addEventListener('click', openInstallGuide);
  $('btnInstallNow')?.addEventListener('click', triggerInstall);
  $('btnCloseInstallGuide')?.addEventListener('click', () => $('modalInstallGuide').classList.add('hidden'));
  $('modalInstallGuide')?.addEventListener('click', e => { if (e.target === $('modalInstallGuide')) $('modalInstallGuide').classList.add('hidden'); });

  // Install banner
  $('btnInstallConfirm')?.addEventListener('click', triggerInstall);
  $('btnInstallDismiss')?.addEventListener('click', () => $('installBanner').classList.add('hidden'));

  // Settings
  $('settingLang')?.addEventListener('change',    e => { settings.lang    = e.target.value;           saveSettings(); });
  $('settingQuality')?.addEventListener('change', e => { settings.quality  = parseFloat(e.target.value); saveSettings(); });
  $('settingFormat')?.addEventListener('change',  e => { settings.format   = e.target.value; outputMode = e.target.value; saveSettings(); });
  $('settingPsm')?.addEventListener('change',     e => { settings.psm      = e.target.value;           saveSettings(); });

  document.querySelectorAll('[data-preprocess]').forEach(btn => btn.addEventListener('click', () => {
    settings.preprocess = btn.dataset.preprocess;
    document.querySelectorAll('[data-preprocess]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); saveSettings();
  }));
  document.querySelectorAll('[data-handwriting]').forEach(btn => btn.addEventListener('click', () => {
    settings.handwriting = btn.dataset.handwriting;
    document.querySelectorAll('[data-handwriting]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); saveSettings();
    showToast(settings.handwriting === 'on' ? 'Modo manuscrito ativo' : 'Modo texto impresso ativo');
  }));
  document.querySelectorAll('[data-theme-btn]').forEach(btn => btn.addEventListener('click', () => {
    settings.theme = btn.dataset.themeBtn;
    saveSettings(); applySettings();
  }));

  $('btnClearLocal')?.addEventListener('click', () => {
    if (!confirm('Apagar todos os documentos salvos localmente?')) return;
    localStorage.removeItem('scribble_docs'); localStorage.removeItem('scribble_sheets');
    docs = []; sheets = []; renderDocs(); renderSheets();
    showToast('Dados locais removidos');
  });

  // Config → planos link
  document.querySelectorAll('[data-tab-go]').forEach(el => el.addEventListener('click', () => {
    const tab = el.dataset.tabGo;
    switchTab(tab);
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  }));

  // Sync
  $('btnSync')?.addEventListener('click', syncCloud);
  $('btnSyncCloud')?.addEventListener('click', syncCloud);

  // Planos
  $('btnAssinarPremium')?.addEventListener('click',  () => openPayment('monthly'));
  $('btnAssinarAnual')?.addEventListener('click',    () => openPayment('annual'));
  $('btnUpgradeBanner')?.addEventListener('click',   () => {
    switchTab('tabPlans');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tabPlans'));
  });
  $('btnUpgradeProfile')?.addEventListener('click', () => { $('modalProfile').classList.add('hidden'); openPayment('monthly'); });
  $('linkUpgrade')?.addEventListener('click', e => { e.preventDefault(); switchTab('tabPlans'); });

  // Modal pagamento
  $('btnGoToStripe')?.addEventListener('click',    goToStripe);
  $('btnCancelPayment')?.addEventListener('click', () => $('modalPayment').classList.add('hidden'));

  // LGPD
  $('btnLgpd')?.addEventListener('click',     e => { e.preventDefault(); $('modalLgpd').classList.remove('hidden'); });
  $('btnCloseLgpd')?.addEventListener('click', () => $('modalLgpd').classList.add('hidden'));
  $('modalLgpd')?.addEventListener('click',    e => { if (e.target === $('modalLgpd')) $('modalLgpd').classList.add('hidden'); });

  // Auth tabs
  $('tabLogin')?.addEventListener('click',    () => switchAuthTab('login'));
  $('tabRegister')?.addEventListener('click', () => switchAuthTab('register'));

  // Show/hide senha
  $('btnTogglePwd')?.addEventListener('click', () => {
    const inp  = $('authPassword');
    const icon = $('pwdEyeIcon');
    const isHidden = inp.type === 'password';
    inp.type   = isHidden ? 'text' : 'password';
    icon.textContent = isHidden ? 'visibility_off' : 'visibility';
  });
});

function switchAuthTab(tab) {
  $('tabLogin').classList.toggle('active',    tab === 'login');
  $('tabRegister').classList.toggle('active', tab === 'register');
  $('lgpdCheck').classList.toggle('hidden',   tab !== 'register');
  $('btnLogin').innerHTML = tab === 'login'
    ? '<span class="material-icons-round">login</span>Entrar'
    : '<span class="material-icons-round">person_add</span>Criar conta';
  $('authError').classList.add('hidden');
}

/* ===== SUPABASE AUTH ===== */
async function initSupabase() {
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) { currentUser = session.user; checkPremium(currentUser); }
  db.auth.onAuthStateChange((_e, session) => {
    currentUser = session?.user || null;
    checkPremium(currentUser);
    updatePremiumUI();
    updateAdminUI();
    renderProfile();
  });
  updatePremiumUI();
}

/* ===== ADMIN ===== */
function isAdmin() {
  return currentUser?.email === ADMIN_EMAIL;
}

function updateAdminUI() {
  const navAdmin = $('navAdmin');
  if (!navAdmin) return;
  if (isAdmin()) {
    navAdmin.classList.remove('hidden');
    loadAdminData();
  } else {
    navAdmin.classList.add('hidden');
  }
}

async function loadAdminData() {
  try {
    // Documentos
    const { data: allDocs, error: docsErr } = await db.from('documents').select('*').order('created_at', { ascending: false });
    if (!docsErr && allDocs) {
      $('adminStatDocs').textContent = allDocs.length;
      renderAdminDocs(allDocs);
    }

    // Usuários via auth (requer service role — usamos metadados disponíveis)
    $('adminStatUsers').textContent = '—';
    $('adminStatPremium').textContent = '—';
    renderAdminUsers([]);

  } catch (e) { console.error('Admin load error', e); }
}

function renderAdminDocs(docs) {
  const list = $('adminDocList');
  if (!docs.length) { list.innerHTML = '<div class="loading-users"><span>Nenhum documento</span></div>'; return; }
  list.innerHTML = docs.slice(0, 50).map(d => `
    <div class="admin-doc-row">
      <span class="material-icons-round" style="font-size:18px;color:var(--blue-glow);flex-shrink:0">${d.type === 'excel' ? 'table_chart' : 'description'}</span>
      <span class="admin-doc-name">${escHtml(d.name || 'sem nome')}</span>
      <span class="admin-doc-meta">${d.created_at ? formatDate(new Date(d.created_at)) : ''}</span>
      <button class="icon-btn small admin-doc-del" data-id="${d.id}" title="Excluir">
        <span class="material-icons-round" style="font-size:18px;color:var(--red)">delete</span>
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.admin-doc-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir este documento?')) return;
      const id = btn.dataset.id;
      await db.from('documents').delete().eq('id', id);
      btn.closest('.admin-doc-row').remove();
      showToast('Documento excluído');
    });
  });
}

function renderAdminUsers(users) {
  const list = $('adminUserList');
  list.innerHTML = '<div class="loading-users"><span class="material-icons-round" style="font-size:16px">info</span><span>Lista de usuários disponível via Supabase Dashboard → Authentication → Users</span></div>';
}

// Admin: salvar preços
document.addEventListener('DOMContentLoaded', () => {
  $('btnSavePriceMonthly')?.addEventListener('click', () => {
    const v = parseFloat($('adminPriceMonthly').value);
    if (!isNaN(v)) { localStorage.setItem('sc_price_monthly', v); showToast(`Preço mensal: R$ ${v.toFixed(2)}`); }
  });
  $('btnSavePriceAnnual')?.addEventListener('click', () => {
    const v = parseFloat($('adminPriceAnnual').value);
    if (!isNaN(v)) { localStorage.setItem('sc_price_annual', v); showToast(`Preço anual: R$ ${v.toFixed(2)}`); }
  });
  $('btnSaveTrial')?.addEventListener('click', () => {
    const v = parseInt($('adminTrialDays').value);
    if (!isNaN(v)) { localStorage.setItem('sc_trial_days', v); showToast(`Período de teste: ${v} dias`); }
  });
});

/* ===== STRIPE PAGAMENTO ===== */
function openPayment(mode) {
  if (!currentUser) { showToast('Faça login primeiro'); openProfile(); return; }
  stripeMode = mode;
  $('paymentTitle').textContent = mode === 'annual' ? 'Assinar Premium Anual' : 'Assinar Premium';
  $('paymentPrice').textContent = mode === 'annual' ? 'R$ 167,00/ano' : 'R$ 19,90/mês';
  $('paymentSub').textContent   = 'Você será redirecionado para o checkout seguro da Stripe.';
  $('modalPayment').classList.remove('hidden');
}

function goToStripe() {
  if (!currentUser) return;
  const baseUrl = stripeMode === 'annual' ? STRIPE_LINK_ANNUAL : STRIPE_LINK_MONTHLY;
  const successUrl = encodeURIComponent(
    `${location.origin}${location.pathname}?payment=success&plan=${stripeMode}&email=${encodeURIComponent(currentUser.email)}`
  );
  const cancelUrl  = encodeURIComponent(`${location.origin}${location.pathname}?payment=cancel`);
  const url = `${baseUrl}?prefilled_email=${encodeURIComponent(currentUser.email)}&success_url=${successUrl}&cancel_url=${cancelUrl}`;
  $('modalPayment').classList.add('hidden');
  window.open(url, '_blank');
}

function checkPaymentReturn() {
  const params = new URLSearchParams(location.search);
  if (params.get('payment') === 'success') {
    const plan  = params.get('plan') || 'monthly';
    const email = params.get('email') || '';
    // Limpa URL
    history.replaceState({}, '', location.pathname);
    // Aguarda auth inicializar e atualiza premium
    setTimeout(async () => {
      if (currentUser && currentUser.email === email) {
        await activatePremium(plan);
      } else {
        // Salva pendência para ativar após login
        localStorage.setItem('scribble_pending_plan', plan);
        localStorage.setItem('scribble_pending_email', email);
        showToast('Pagamento recebido! Faça login para ativar o Premium.');
      }
    }, 2000);
  } else if (params.get('payment') === 'cancel') {
    history.replaceState({}, '', location.pathname);
    showToast('Pagamento cancelado.');
  }
}

async function activatePremium(plan) {
  try {
    await db.auth.updateUser({ data: { premium: true, plan: plan, premium_since: new Date().toISOString() } });
    isPremium = true;
    updatePremiumUI();
    showToast('Premium ativado com sucesso! Bem-vindo(a)! 🎉');
    localStorage.removeItem('scribble_pending_plan');
    localStorage.removeItem('scribble_pending_email');
  } catch { showToast('Erro ao ativar Premium. Entre em contato.'); }
}

/* ===== BOTTOM NAV ===== */
document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === 'tabProfile') { openProfile(); return; }
    switchTab(tab);
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

function switchTab(tabId) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  $(tabId)?.classList.add('active');
  $('mainContent').scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===== SEARCH ===== */
$('btnSearch').addEventListener('click', () => {
  $('searchBar').classList.toggle('hidden');
  if (!$('searchBar').classList.contains('hidden')) $('searchInput').focus();
});
$('btnCloseSearch').addEventListener('click', () => {
  $('searchBar').classList.add('hidden');
  $('searchInput').value = ''; searchQuery = '';
  renderDocs(); renderSheets();
});
$('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.toLowerCase(); renderDocs(); renderSheets();
});

/* ===== FAB ===== */
$('fabScan').addEventListener('click', () => {
  if (!currentUser) {
    // visitante pode escanear até 5x/mês
    const month = new Date().toISOString().slice(0, 7);
    const key   = `scribble_scan_${month}`;
    const cnt   = parseInt(localStorage.getItem(key) || '0');
    if (cnt >= 5) {
      showToast('Limite de 5 scans/mês no plano Visitante. Assine o Premium!');
      switchTab('tabPlans');
      document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tabPlans'));
      return;
    }
    localStorage.setItem(key, String(cnt + 1));
  }
  openScanModal();
});

function openScanModal() {
  $('modalScan').classList.remove('hidden');
  currentImage = null;
  $('previewImg').classList.add('hidden');
  $('scanPlaceholder').classList.remove('hidden');
  $('btnRecognize').disabled = true;
  resetCameraStream();
}

$('btnCancelScan').addEventListener('click', closeScanModal);
$('modalScan').addEventListener('click', e => { if (e.target === $('modalScan')) closeScanModal(); });
function closeScanModal() { $('modalScan').classList.add('hidden'); resetCameraStream(); }

/* ===== CÂMERA ===== */
$('btnCamera').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video  = $('cameraStream');
    video.srcObject = stream; video.classList.remove('hidden');
    $('scanPlaceholder').classList.add('hidden'); $('previewImg').classList.add('hidden');
    const oldHtml  = $('btnCamera').innerHTML;
    const oldClick = $('btnCamera').onclick;
    $('btnCamera').innerHTML = '<span class="material-icons-round">camera</span> Capturar';
    $('btnCamera').onclick = () => {
      const canvas = $('cameraCanvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      canvas.toBlob(blob => {
        stream.getTracks().forEach(t => t.stop());
        video.classList.add('hidden');
        setPreviewBlob(blob);
        $('btnCamera').innerHTML  = oldHtml;
        $('btnCamera').onclick    = oldClick;
      }, 'image/jpeg', settings.quality);
    };
  } catch { showToast('Câmera não disponível — use Galeria'); $('galleryInput').click(); }
});

$('btnUpload').addEventListener('click', () => $('galleryInput').click());
$('galleryInput').addEventListener('change', e => { if (e.target.files[0]) setPreviewBlob(e.target.files[0]); e.target.value = ''; });

function setPreviewBlob(blob) {
  const img = new Image(), url = URL.createObjectURL(blob);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    canvas.toBlob(compressed => {
      currentImage = compressed;
      $('previewImg').src = URL.createObjectURL(compressed);
      $('previewImg').classList.remove('hidden');
      $('scanPlaceholder').classList.add('hidden');
      $('cameraStream').classList.add('hidden');
      $('btnRecognize').disabled = false;
    }, 'image/jpeg', settings.quality);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function resetCameraStream() {
  const v = $('cameraStream');
  if (v.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; }
  v.classList.add('hidden');
}

/* ===== TOGGLE MODO ===== */
document.querySelectorAll('.toggle-btn[data-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn[data-mode]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); outputMode = btn.dataset.mode;
  });
});

/* ===== PRÉ-PROCESSAMENTO ===== */
function preprocessImage(blob) {
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(blob);
    img.onload = () => {
      const isHandwriting = settings.handwriting === 'on';

      // Escala maior para manuscritos (mais detalhe nas letras)
      const minWidth = isHandwriting ? 2400 : 1800;
      const scale = Math.max(1, minWidth / img.naturalWidth);

      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d');

      // Renderiza com suavização
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d  = id.data;

      if (isHandwriting) {
        // MODO MANUSCRITO: preserva traços, aumenta contraste suavemente
        for (let i = 0; i < d.length; i += 4) {
          // Converte para escala de cinza
          const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          // Aumenta contraste suavemente (não binariza)
          const contrast = 2.2;
          const factor   = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
          let enhanced   = factor * (gray - 128) + 128;
          enhanced       = Math.max(0, Math.min(255, enhanced));
          // Limiar adaptativo mais suave (preserva traços finos)
          const val = enhanced < 180 ? Math.max(0, enhanced - 20) : 255;
          d[i] = d[i+1] = d[i+2] = val;
        }
      } else {
        // MODO IMPRESSO: binarização agressiva (ideal para texto tipográfico)
        for (let i = 0; i < d.length; i += 4) {
          const gray    = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          const contrast = 1.8;
          const factor   = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
          let enhanced   = Math.max(0, Math.min(255, factor * (gray - 128) + 128));
          d[i] = d[i+1] = d[i+2] = enhanced > 140 ? 255 : 0;
        }
      }

      ctx.putImageData(id, 0, 0);
      canvas.toBlob(p => { URL.revokeObjectURL(url); resolve(p); }, 'image/png');
    };
    img.src = url;
  });
}

/* ===== OCR ===== */
$('btnRecognize').addEventListener('click', runOCR);

async function runOCR() {
  if (!currentImage) return;
  closeScanModal();
  $('modalProgress').classList.remove('hidden');
  $('progressFill').style.width = '0%'; $('progressPct').textContent = '0%';
  $('progressStatus').textContent = 'Preparando imagem...';
  try {
    const processed = settings.preprocess === 'on' ? await preprocessImage(currentImage) : currentImage;
    $('progressStatus').textContent = 'Iniciando OCR...';
    const worker = await Tesseract.createWorker(settings.lang, 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          $('progressFill').style.width = pct + '%'; $('progressPct').textContent = pct + '%';
          $('progressStatus').textContent = 'Reconhecendo texto...';
        } else { $('progressStatus').textContent = m.status; }
      }
    });
    const isHandwriting = settings.handwriting === 'on';
    await worker.setParameters({
      tessedit_pageseg_mode:     isHandwriting ? '6' : settings.psm,
      preserve_interword_spaces: '1',
      tessedit_do_invert:        '0',
      language_model_penalty_non_freq_dict_word: isHandwriting ? '0.5' : '0.1',
      language_model_penalty_non_dict_word:      isHandwriting ? '0.5' : '0.15',
    });
    const { data: { text } } = await worker.recognize(processed);
    await worker.terminate();
    ocrResult = cleanOcrText(text);
    $('modalProgress').classList.add('hidden');
    showOcrCard();
  } catch (err) { $('modalProgress').classList.add('hidden'); showToast('Erro no OCR: ' + err.message); }
}

function cleanOcrText(raw) {
  return raw.split('\n').map(l => l.trim()).filter(l => {
    if (!l) return false;
    return (l.match(/[a-zA-Z0-9À-ÿ]/g) || []).length >= 2;
  }).join('\n').trim();
}

function showOcrCard() {
  const url = URL.createObjectURL(currentImage);
  $('ocrPreview').innerHTML = `<img src="${url}" style="width:100%;border-radius:8px;max-height:140px;object-fit:cover" />`;
  $('ocrText').textContent  = ocrResult;
  $('ocrDocName').value     = 'Documento_' + dateSlug();
  $('ocrCard').classList.remove('hidden');

  // Mostra/esconde lock msg
  if (!isPremium) {
    $('premiumLockMsg').classList.remove('hidden');
  } else {
    $('premiumLockMsg').classList.add('hidden');
  }

  switchTab('tabDocs');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tabDocs'));
  $('mainContent').scrollTo({ top: 0, behavior: 'smooth' });
}

$('btnCloseOcr').addEventListener('click', () => { $('ocrCard').classList.add('hidden'); ocrResult = ''; currentImage = null; });

/* ===== COMPARTILHAR ===== */
$('btnShareOcr').addEventListener('click', () => shareText($('ocrText').innerText.trim(), $('ocrDocName').value));
async function shareText(text, title = 'Documento') {
  if (!text) { showToast('Nenhum texto para compartilhar'); return; }
  if (navigator.share) { try { await navigator.share({ title, text }); return; } catch {} }
  try { await navigator.clipboard.writeText(text); showToast('Texto copiado!'); }
  catch { showToast('Compartilhamento não disponível'); }
}

/* ===== EXPORTAR (bloqueado para visitantes) ===== */
function requirePremium(action) {
  if (!isPremium) {
    showToast('Recurso exclusivo do plano Premium');
    switchTab('tabPlans');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tabPlans'));
    return false;
  }
  if (!currentUser) { showToast('Faça login primeiro'); openProfile(); return false; }
  return true;
}

$('btnExportWord').addEventListener('click', () => { if (requirePremium()) exportWord($('ocrText').innerText.trim(), $('ocrDocName').value); });
$('btnExportExcel').addEventListener('click', () => { if (requirePremium()) exportExcel($('ocrText').innerText.trim(), $('ocrDocName').value); });
$('btnSaveDoc').addEventListener('click', async () => {
  if (!requirePremium()) return;
  const text = $('ocrText').innerText.trim();
  if (!text) { showToast('Nenhum texto para salvar'); return; }
  const name = ($('ocrDocName').value.trim() || 'Documento') + (outputMode === 'excel' ? '.xlsx' : '.docx');
  await saveDocRecord(name, text, outputMode);
  $('ocrCard').classList.add('hidden');
  showToast('Documento salvo!');
});

$('btnViewExportWord').addEventListener('click', () => { if (viewingDoc && requirePremium()) exportWord(viewingDoc.text, viewingDoc.name); });
$('btnViewExportExcel').addEventListener('click', () => { if (viewingDoc && requirePremium()) exportExcel(viewingDoc.text, viewingDoc.name); });

async function exportWord(text, docName = 'Documento') {
  if (!text) { showToast('Nenhum texto para exportar'); return; }
  try {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
    const lines = text.split('\n').filter(l => l.trim());
    const paragraphs = lines.map((line, i) =>
      new Paragraph({ children: [new TextRun({ text: line, size: 24, font: 'Calibri' })], spacing: { after: 160 },
        ...(i === 0 ? { heading: HeadingLevel.HEADING_2 } : {}) }));
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: docName, bold: true, size: 28, color: '1565C0', font: 'Calibri' })], spacing: { after: 200 } }),
      new Paragraph({ children: [new TextRun({ text: 'Data: ' + formatDate(new Date()), size: 20, color: '666666', font: 'Calibri' })], spacing: { after: 400 } }),
      ...paragraphs
    ]}] });
    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, sanitizeFilename(docName) + '.docx');
    await saveDocRecord(sanitizeFilename(docName) + '.docx', text, 'word');
    showToast('Word exportado!');
  } catch (err) { showToast('Erro: ' + err.message); }
}

function exportExcel(text, docName = 'Planilha') {
  if (!text) { showToast('Nenhum texto'); return; }
  try {
    const lines = text.split('\n').filter(l => l.trim());
    const data  = lines.map(line => {
      if (line.includes('|')) return line.split('|').map(c => c.trim()).filter(Boolean);
      const nums = line.match(/[\d.,]+/g);
      if (nums && nums.length > 1) return [line.replace(/[\d.,]+/g,'').trim(), ...nums];
      return [line];
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[docName],['Data: ' + formatDate(new Date())],[], ...data]);
    ws['!cols'] = [{ wch: 40 },{ wch: 20 },{ wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Documento');
    XLSX.writeFile(wb, sanitizeFilename(docName) + '.xlsx');
    saveDocRecord(sanitizeFilename(docName) + '.xlsx', text, 'excel');
    showToast('Excel exportado!');
  } catch (err) { showToast('Erro: ' + err.message); }
}

/* ===== PERSISTÊNCIA ===== */
async function saveDocRecord(name, text, type) {
  const record = { id: crypto.randomUUID(), name, text, type, createdAt: new Date().toISOString(), userId: currentUser?.id || null };
  if (type === 'excel') { sheets.unshift(record); saveLocal('scribble_sheets', sheets); renderSheets(); }
  else                   { docs.unshift(record);   saveLocal('scribble_docs',   docs);   renderDocs(); }
  if (currentUser) {
    try { await db.from('documents').insert({ id: record.id, name, text, type, user_id: currentUser.id, created_at: record.createdAt }); }
    catch {}
  }
}

function saveLocal(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch {} }
function loadLocal(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } }

async function loadDocs() {
  docs = loadLocal('scribble_docs'); sheets = loadLocal('scribble_sheets');
  renderDocs(); renderSheets();
  if (currentUser) await syncCloud();

  // Verifica pendência de ativação premium
  const pendingPlan  = localStorage.getItem('scribble_pending_plan');
  const pendingEmail = localStorage.getItem('scribble_pending_email');
  if (pendingPlan && pendingEmail && currentUser?.email === pendingEmail) {
    await activatePremium(pendingPlan);
  }
}

async function syncCloud() {
  if (!currentUser) { showToast('Faça login para sincronizar'); openProfile(); return; }
  try {
    showToast('Sincronizando...');
    const { data, error } = await db.from('documents').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    if (error) throw error;
    if (data?.length) {
      const remote = data.map(r => ({ id: r.id, name: r.name, text: r.text, type: r.type, createdAt: r.created_at }));
      docs   = mergeById(docs,   remote.filter(d => d.type !== 'excel'));
      sheets = mergeById(sheets, remote.filter(d => d.type === 'excel'));
      saveLocal('scribble_docs', docs); saveLocal('scribble_sheets', sheets);
      renderDocs(); renderSheets();
    }
    showToast(`Sincronizado! ${docs.length + sheets.length} documento(s)`);
  } catch (err) { showToast('Erro ao sincronizar: ' + err.message); }
}

function mergeById(local, remote) {
  const map = new Map(local.map(d => [d.id, d]));
  remote.forEach(r => map.set(r.id, r));
  return [...map.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* ===== RENDER ===== */
function renderDocs() {
  const list = $('docList'), q = searchQuery;
  const filtered = docs.filter(d => !q || d.name.toLowerCase().includes(q) || d.text?.toLowerCase().includes(q));
  $('badgeDocs').textContent = docs.length; $('statDocs').textContent = docs.length;
  const homeBadge = $('homeBadgeDocs');
  if (homeBadge) homeBadge.textContent = docs.length + (docs.length === 1 ? ' documento' : ' documentos');
  $('emptyDocs').classList.toggle('hidden', filtered.length > 0);
  [...list.querySelectorAll('.doc-item')].forEach(el => el.remove());
  filtered.forEach(doc => list.appendChild(docItemEl(doc, 'word')));
}

function renderSheets() {
  const list = $('sheetList'), q = searchQuery;
  const filtered = sheets.filter(d => !q || d.name.toLowerCase().includes(q) || d.text?.toLowerCase().includes(q));
  $('badgeSheets').textContent = sheets.length; $('statSheets').textContent = sheets.length;
  $('emptySheets').classList.toggle('hidden', filtered.length > 0);
  [...list.querySelectorAll('.doc-item')].forEach(el => el.remove());
  filtered.forEach(doc => list.appendChild(docItemEl(doc, 'excel')));
}

function docItemEl(doc, type) {
  const el = document.createElement('div');
  el.className = 'doc-item';
  el.innerHTML = `
    <div class="doc-icon ${type}"><span class="material-icons-round">${type === 'excel' ? 'table_chart' : 'description'}</span></div>
    <div class="doc-info">
      <div class="doc-name">${escHtml(doc.name)}</div>
      <div class="doc-meta">${formatDate(new Date(doc.createdAt))} · ${type === 'excel' ? 'Excel' : 'Word'}</div>
    </div>
    <span class="doc-status processed">Processado</span>
    <div class="doc-actions">
      <button class="icon-btn small" title="Compartilhar"><span class="material-icons-round">share</span></button>
      <button class="icon-btn small" title="Excluir"><span class="material-icons-round">delete_outline</span></button>
    </div>`;
  const [btnShare, btnDel] = el.querySelectorAll('.doc-actions .icon-btn');
  btnShare.addEventListener('click', e => { e.stopPropagation(); shareText(doc.text, doc.name); });
  btnDel.addEventListener('click',   e => { e.stopPropagation(); deleteDoc(doc.id, type); });
  el.addEventListener('click', () => openViewModal(doc, type));
  return el;
}

function deleteDoc(id, type) {
  if (type === 'excel') { sheets = sheets.filter(d => d.id !== id); saveLocal('scribble_sheets', sheets); renderSheets(); }
  else                   { docs   = docs.filter(d => d.id !== id);   saveLocal('scribble_docs',   docs);   renderDocs(); }
  if (currentUser) db.from('documents').delete().eq('id', id).then(() => {});
  showToast('Documento excluído');
}

/* ===== VISUALIZAR ===== */
function openViewModal(doc, type) {
  viewingDoc = doc;
  $('viewDocName').textContent = doc.name;
  $('viewDocMeta').textContent = formatDate(new Date(doc.createdAt)) + ' · ' + (type === 'excel' ? 'Excel' : 'Word');
  $('viewDocText').textContent = doc.text || '(sem texto)';
  $('viewDocIcon').className   = 'doc-icon ' + type;
  $('viewDocIcon').innerHTML   = `<span class="material-icons-round">${type === 'excel' ? 'table_chart' : 'description'}</span>`;
  $('modalView').classList.remove('hidden');
}

$('btnCloseView').addEventListener('click', () => { $('modalView').classList.add('hidden'); viewingDoc = null; });
$('modalView').addEventListener('click', e => { if (e.target === $('modalView')) { $('modalView').classList.add('hidden'); viewingDoc = null; } });
$('btnViewRename').addEventListener('click', () => {
  if (!viewingDoc) return; renamingDoc = viewingDoc;
  $('renameInput').value = viewingDoc.name.replace(/\.(docx|xlsx)$/i, '');
  $('modalRename').classList.remove('hidden');
});
$('btnViewShare').addEventListener('click',     () => { if (viewingDoc) shareText(viewingDoc.text, viewingDoc.name); });
$('btnViewShareFull').addEventListener('click', () => { if (viewingDoc) shareText(viewingDoc.text, viewingDoc.name); });
$('btnViewExport').addEventListener('click',    () => { if (!viewingDoc || !requirePremium()) return; viewingDoc.type === 'excel' ? exportExcel(viewingDoc.text, viewingDoc.name) : exportWord(viewingDoc.text, viewingDoc.name); });

/* ===== RENOMEAR ===== */
$('btnCancelRename').addEventListener('click', () => { $('modalRename').classList.add('hidden'); renamingDoc = null; });
$('btnConfirmRename').addEventListener('click', () => {
  if (!renamingDoc) return;
  const newBase = $('renameInput').value.trim();
  if (!newBase) { showToast('Digite um nome válido'); return; }
  const ext = renamingDoc.type === 'excel' ? '.xlsx' : '.docx';
  const newName = newBase + ext;
  const list = renamingDoc.type === 'excel' ? sheets : docs;
  const item = list.find(d => d.id === renamingDoc.id);
  if (item) { item.name = newName; renamingDoc.type === 'excel' ? saveLocal('scribble_sheets', sheets) : saveLocal('scribble_docs', docs); }
  if (currentUser) db.from('documents').update({ name: newName }).eq('id', renamingDoc.id).then(() => {});
  if (viewingDoc?.id === renamingDoc.id) { viewingDoc.name = newName; $('viewDocName').textContent = newName; }
  $('modalRename').classList.add('hidden'); renamingDoc = null;
  renderDocs(); renderSheets();
  showToast('Documento renomeado!');
});
$('renameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnConfirmRename').click(); });

/* ===== AUTH SCREEN ===== */
function switchAuthScreenTab(tab) {
  $('authTabLogin').classList.toggle('active',    tab === 'login');
  $('authTabRegister').classList.toggle('active', tab === 'register');
  $('authFormLogin').classList.toggle('hidden',   tab !== 'login');
  $('authFormRegister').classList.toggle('hidden',tab !== 'register');
  $('authFormConfirm').classList.add('hidden');
  $('loginError').classList.add('hidden');
  $('registerError').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  $('authTabLogin')?.addEventListener('click',    () => switchAuthScreenTab('login'));
  $('authTabRegister')?.addEventListener('click', () => switchAuthScreenTab('register'));

  // Visitante
  $('btnVisitor')?.addEventListener('click',  enterAsVisitor);
  $('btnVisitor2')?.addEventListener('click', enterAsVisitor);

  // Show/hide senha — login
  $('btnToggleLoginPwd')?.addEventListener('click', () => togglePwd('loginPassword', 'loginEyeIcon'));
  // Show/hide senha — cadastro
  $('btnToggleRegPwd')?.addEventListener('click',  () => togglePwd('regPassword',        'regEyeIcon'));
  $('btnToggleRegPwd2')?.addEventListener('click', () => togglePwd('regPasswordConfirm', 'regEyeIcon2'));

  // Recuperar senha
  $('btnForgotPassword')?.addEventListener('click', () => {
    $('authFormLogin').classList.add('hidden');
    $('authFormRegister').classList.add('hidden');
    $('authFormReset').classList.remove('hidden');
    $('resetEmail').value = $('loginEmail').value || '';
  });
  $('btnBackFromReset')?.addEventListener('click', () => {
    $('authFormReset').classList.add('hidden');
    $('authFormLogin').classList.remove('hidden');
  });
  $('btnDoReset')?.addEventListener('click', doResetPassword);
  $('resetEmail')?.addEventListener('keydown', e => { if (e.key === 'Enter') doResetPassword(); });

  // LGPD no cadastro
  $('btnRegLgpd')?.addEventListener('click', e => { e.preventDefault(); $('modalLgpd').classList.remove('hidden'); });

  // Login
  $('btnDoLogin')?.addEventListener('click', doLogin);
  $('loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // Cadastro
  $('btnDoRegister')?.addEventListener('click', doRegister);

  // Após confirmação
  $('btnBackToLogin')?.addEventListener('click', () => switchAuthScreenTab('login'));
  $('btnResendEmail')?.addEventListener('click', async () => {
    const email = $('confirmEmailAddr').textContent;
    if (!email) return;
    await db.auth.resend({ type: 'signup', email });
    showToast('E-mail reenviado!');
  });
});

function togglePwd(inputId, iconId) {
  const inp  = $(inputId);
  const icon = $(iconId);
  const hidden = inp.type === 'password';
  inp.type      = hidden ? 'text' : 'password';
  icon.textContent = hidden ? 'visibility_off' : 'visibility';
}

function enterAsVisitor() {
  currentUser = null; isPremium = false;
  showApp();
}

async function doLogin() {
  const email = $('loginEmail').value.trim();
  const pass  = $('loginPassword').value;
  if (!email || !pass) { showAuthScreenError('loginError', 'Preencha e-mail e senha'); return; }

  const btn = $('btnDoLogin');
  btn.disabled = true; btn.innerHTML = '<span class="material-icons-round spinning">sync</span>Entrando...';

  const { data, error } = await db.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false;
  btn.innerHTML = '<span class="material-icons-round">login</span>Entrar';

  if (error) {
    if (error.message.includes('Email not confirmed')) {
      showAuthScreenError('loginError', 'E-mail não confirmado. Verifique sua caixa de entrada.');
    } else if (error.message.includes('Invalid login')) {
      showAuthScreenError('loginError', 'E-mail ou senha incorretos.');
    } else {
      showAuthScreenError('loginError', error.message);
    }
    return;
  }

  currentUser = data.user;
  checkPremium(currentUser);
  showApp();
  showToast('Bem-vindo(a)! 🎉');
}

async function doRegister() {
  const name  = $('regName').value.trim();
  const email = $('regEmail').value.trim();
  const pass  = $('regPassword').value;
  const pass2 = $('regPasswordConfirm').value;
  const lgpd  = $('regLgpdConsent').checked;

  if (!email)            { showAuthScreenError('registerError', 'Informe seu e-mail'); return; }
  if (!pass)             { showAuthScreenError('registerError', 'Informe uma senha'); return; }
  if (pass.length < 6)   { showAuthScreenError('registerError', 'Senha mínima de 6 caracteres'); return; }
  if (pass !== pass2)    { showAuthScreenError('registerError', 'As senhas não coincidem'); return; }
  if (!lgpd)             { showAuthScreenError('registerError', 'Aceite a Política de Privacidade para continuar'); return; }

  const btn = $('btnDoRegister');
  btn.disabled = true; btn.innerHTML = '<span class="material-icons-round spinning">sync</span>Criando conta...';

  const { error } = await db.auth.signUp({
    email, password: pass,
    options: {
      data: { name: name || email.split('@')[0], lgpd_accepted: true, lgpd_date: new Date().toISOString() },
      emailRedirectTo: 'https://nelsonassembler-svg.github.io/scribble-converter/'
    }
  });

  btn.disabled = false;
  btn.innerHTML = '<span class="material-icons-round">person_add</span>Criar minha conta';

  if (error) { showAuthScreenError('registerError', error.message); return; }

  // Mostra tela de confirmação
  $('confirmEmailAddr').textContent = email;
  $('authFormLogin').classList.add('hidden');
  $('authFormRegister').classList.add('hidden');
  $('authFormConfirm').classList.remove('hidden');
}

async function doResetPassword() {
  const email = $('resetEmail').value.trim();
  if (!email) { showAuthScreenError('resetError', 'Digite seu e-mail'); return; }

  const btn = $('btnDoReset');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons-round spinning">sync</span>Enviando...';

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://nelsonassembler-svg.github.io/scribble-converter/?reset=true'
  });

  btn.disabled = false;
  btn.innerHTML = '<span class="material-icons-round">send</span>Enviar link de recuperação';

  if (error) { showAuthScreenError('resetError', error.message); return; }

  $('resetError').classList.add('hidden');
  const success = $('resetSuccess');
  success.textContent = `✅ Link enviado para ${email}! Verifique sua caixa de entrada e spam.`;
  success.classList.remove('hidden');
  $('btnDoReset').disabled = true;
}

function showAuthScreenError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ===== PERFIL / AUTH ===== */
$('btnProfile').addEventListener('click', openProfile);
$('navProfile').addEventListener('click', openProfile);

function openProfile() { renderProfile(); $('modalProfile').classList.remove('hidden'); }

function renderProfile() {
  if (currentUser) {
    $('authForm').classList.add('hidden'); $('userPanel').classList.remove('hidden');
    $('profileTitle').textContent = 'Meu Perfil';
    $('userEmail').textContent    = currentUser.email;
    $('userSince').textContent    = formatDate(new Date(currentUser.created_at || Date.now()));
    $('statDocs').textContent     = docs.length; $('statSheets').textContent = sheets.length;
    $('statCloud').innerHTML      = '<span class="material-icons-round" style="font-size:20px;color:var(--green)">cloud_done</span>';
    updatePremiumUI();
  } else {
    $('authForm').classList.remove('hidden'); $('userPanel').classList.add('hidden');
    $('profileTitle').textContent = 'Entrar na conta';
    $('authError').classList.add('hidden');
    switchAuthTab('login');
  }
}

$('btnLogin').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  const pass  = $('authPassword').value;
  if (!email || !pass) { showAuthError('Preencha e-mail e senha'); return; }

  const isRegister = $('tabRegister').classList.contains('active');

  if (isRegister) {
    // Verificar LGPD
    if (!$('lgpdConsent').checked) { showAuthError('Aceite a Política de Privacidade (LGPD) para criar conta'); return; }
    $('btnLogin').disabled = true; $('btnLogin').textContent = 'Criando...';
    const { error } = await db.auth.signUp({ email, password: pass });
    $('btnLogin').disabled = false;
    $('btnLogin').innerHTML = '<span class="material-icons-round">person_add</span>Criar conta';
    if (error) { showAuthError(error.message); return; }
    showToast('Conta criada! Verifique seu e-mail.');
    $('modalProfile').classList.add('hidden');
  } else {
    $('btnLogin').disabled = true; $('btnLogin').textContent = 'Entrando...';
    const { error } = await db.auth.signInWithPassword({ email, password: pass });
    $('btnLogin').disabled = false;
    $('btnLogin').innerHTML = '<span class="material-icons-round">login</span>Entrar';
    if (error) { showAuthError(error.message); return; }
    $('modalProfile').classList.add('hidden');
    showToast('Bem-vindo(a)!');
    loadDocs();
  }
});

$('btnLogout').addEventListener('click', async () => {
  await db.auth.signOut();
  currentUser = null; isPremium = false;
  updatePremiumUI(); updateAdminUI();
  $('modalProfile').classList.add('hidden');
  showToast('Até logo!');
  setTimeout(() => showAuthScreen(), 300);
});

$('btnCancelProfile').addEventListener('click', () => $('modalProfile').classList.add('hidden'));
$('btnCloseProfile').addEventListener('click',  () => $('modalProfile').classList.add('hidden'));
$('modalProfile').addEventListener('click', e => { if (e.target === $('modalProfile')) $('modalProfile').classList.add('hidden'); });

function showAuthError(msg) { $('authError').textContent = msg; $('authError').classList.remove('hidden'); }

/* ===== UTILS ===== */
function formatDate(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function dateSlug() {
  const n = new Date();
  return [n.getDate(), n.getMonth()+1, n.getFullYear(), n.getHours(), n.getMinutes()].map(v => String(v).padStart(2,'0')).join('');
}
function sanitizeFilename(n) { return n.replace(/[\\/:*?"<>|]/g,'_').replace(/\.(docx|xlsx)$/i,'').trim() || 'documento'; }
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

/* ===== TRADUÇÃO (MyMemory API - gratuita) ===== */
async function translateText(text, fromLang, toLang) {
  if (!text.trim() || toLang === 'none') return text;
  // Normaliza código de idioma
  const from = fromLang.split('-')[0]; // pt-BR → pt
  const to   = toLang.split('-')[0];   // pt-BR → pt
  if (from === to) return text;

  try {
    showToast('Traduzindo...');
    // Divide texto em chunks de 500 chars (limite da API gratuita)
    const chunks = [];
    for (let i = 0; i < text.length; i += 490) chunks.push(text.slice(i, i + 490));

    const translated = await Promise.all(chunks.map(async chunk => {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${from}|${to}&de=nelsonassembrer@gmail.com`;
      const res  = await fetch(url);
      const data = await res.json();
      return data.responseData?.translatedText || chunk;
    }));

    return translated.join(' ');
  } catch {
    showToast('Erro na tradução. Tente novamente.');
    return text;
  }
}

/* ===== ÁUDIO — GRAVAÇÃO EM TEMPO REAL ===== */
let recognition     = null;
let recordTimer     = null;
let recordSeconds   = 0;
let fullTranscript  = '';  // texto acumulado desta sessão inteira
let savedTranscript = '';  // salvo antes de cada reinício do recognition
let isRecording     = false;

function initSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('Seu navegador não suporta gravação de voz. Use o Chrome.');
    return null;
  }
  const rec = new SpeechRec();
  rec.continuous      = true;
  rec.interimResults  = true;
  rec.maxAlternatives = 1;
  return rec;
}

document.addEventListener('DOMContentLoaded', () => {
  // Botão iniciar gravação
  $('btnStartRecord')?.addEventListener('click', startRecording);
  $('btnStopRecord')?.addEventListener('click',  stopRecording);
  $('btnClearRecord')?.addEventListener('click', clearRecording);

  // Upload de arquivo de áudio
  $('audioUploadArea')?.addEventListener('click', () => $('audioFileInput').click());
  $('audioFileInput')?.addEventListener('change', onAudioFileSelected);

  // Transcrever arquivo
  $('btnTranscribeFile')?.addEventListener('click', transcribeAudioFile);

  // Traduzir resultado
  $('btnTranslateResult')?.addEventListener('click', async () => {
    const text = $('audioResultText').innerText.trim();
    if (!text) return;
    const lang = $('audioLangInput').value;
    const translated = await translateText(text, lang, 'pt-BR');
    $('audioResultText').textContent = translated;
    $('audioResultLang').textContent = '🇧🇷 PT-BR';
    showToast('Tradução concluída!');
  });

  // Exportar áudio → Word
  $('btnAudioExportWord')?.addEventListener('click', () => {
    const text = $('audioResultText').innerText.trim();
    if (requirePremium()) exportWord(text, 'Transcrição_' + dateSlug());
  });

  // Exportar áudio → Excel
  $('btnAudioExportExcel')?.addEventListener('click', () => {
    const text = $('audioResultText').innerText.trim();
    if (requirePremium()) exportExcel(text, 'Transcrição_' + dateSlug());
  });

  // Salvar transcrição
  $('btnAudioSave')?.addEventListener('click', async () => {
    const text = $('audioResultText').innerText.trim();
    if (!requirePremium()) return;
    if (!text) return;
    await saveDocRecord('Transcrição_' + dateSlug() + '.docx', text, 'word');
    showToast('Transcrição salva!');
  });

  // Traduzir OCR
  $('btnTranslateOcr')?.addEventListener('click', async () => {
    const text = $('ocrText').innerText.trim();
    if (!text) { showToast('Nenhum texto para traduzir'); return; }
    const langIn  = $('settingLang').value; // idioma do OCR
    const translated = await translateText(text, langIn, 'pt-BR');
    $('ocrText').textContent = translated;
    showToast('Texto traduzido para PT-BR!');
  });
});

async function startRecording() {
  recognition = initSpeechRecognition();
  if (!recognition) return;

  const lang = $('audioLangInput').value;
  recognition.lang = lang;

  fullTranscript = '';
  isRecording    = true;
  recordSeconds  = 0;

  // UI
  $('btnStartRecord').classList.add('hidden');
  $('btnStopRecord').classList.remove('hidden');
  $('btnClearRecord').classList.remove('hidden');
  $('recordVisualizer').classList.add('recording');
  $('recordLiveText').innerHTML = '';

  // Timer
  recordTimer = setInterval(() => {
    recordSeconds++;
    const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
    const s = String(recordSeconds % 60).padStart(2, '0');
    $('recordTimer').textContent = `${m}:${s}`;
  }, 1000);

  // Eventos do reconhecimento
  recognition.onresult = (e) => {
    let interim = '';
    let final   = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) { final += t + ' '; }
      else { interim += t; }
    }
    if (final) fullTranscript += final;
    $('recordLiveText').innerHTML =
      `<span style="color:var(--white)">${fullTranscript}</span>` +
      `<span style="color:var(--white-40);font-style:italic">${interim}</span>`;
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech') {
      showToast('Erro no reconhecimento: ' + e.error);
      stopRecording();
    }
  };

  recognition.onend = () => {
    if (isRecording) recognition.start(); // reinicia continuamente
  };

  recognition.start();
}

async function stopRecording() {
  isRecording = false;
  recognition?.stop();
  clearInterval(recordTimer);
  $('recordVisualizer').classList.remove('recording');
  $('btnStartRecord').classList.remove('hidden');
  $('btnStopRecord').classList.add('hidden');

  if (!fullTranscript.trim()) { showToast('Nenhum texto detectado'); return; }

  // Verifica se precisa traduzir
  const langOut = $('audioLangOutput').value;
  let finalText = fullTranscript.trim();

  if (langOut !== 'none' && !$('audioLangInput').value.startsWith(langOut.split('-')[0])) {
    finalText = await translateText(finalText, $('audioLangInput').value, langOut);
  }

  showAudioResult(finalText, langOut);
}

function clearRecording() {
  fullTranscript = '';
  recordSeconds  = 0;
  $('recordTimer').textContent  = '00:00';
  $('recordLiveText').innerHTML = '<p class="record-placeholder">O texto aparecerá aqui enquanto você fala...</p>';
  $('audioResultCard').classList.add('hidden');
}

/* ===== ÁUDIO — ARQUIVO ===== */
let audioBlob = null;

function onAudioFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  audioBlob = file;
  $('audioFileName').textContent = file.name;
  $('audioFileName').classList.remove('hidden');
  $('audioUploadArea').querySelector('p').textContent = file.name;

  // Player de áudio
  const url = URL.createObjectURL(file);
  $('audioElement').src = url;
  $('audioPlayer').classList.remove('hidden');
  $('btnTranscribeFile').disabled = false;

  e.target.value = '';
}

async function transcribeAudioFile() {
  if (!audioBlob) return;

  // Usa Web Speech API com o áudio tocando (método alternativo gratuito)
  // Para arquivos, usamos a API de reconhecimento via playback + microfone
  showToast('Reproduza o áudio em voz alta próximo ao microfone para transcrever, ou use a gravação direta.');

  // Alternativa: inicia gravação enquanto áudio toca
  $('audioElement').play();
  await startRecording();

  $('audioElement').onended = () => {
    setTimeout(stopRecording, 1000);
  };
}

function showAudioResult(text, lang) {
  $('audioResultCard').classList.remove('hidden');
  $('audioResultText').textContent = text;

  const langLabels = {
    'pt-BR': '🇧🇷 PT-BR', 'en': '🇺🇸 EN', 'es': '🇪🇸 ES',
    'fr': '🇫🇷 FR', 'none': '🌐 Original'
  };
  $('audioResultLang').textContent = langLabels[lang] || '🌐';
  $('audioResultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let toastTimer;
function showToast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

/* ===== FIM ===== */
// BLOCO REMOVIDO ABAIXO — era duplicata que causava erro de sintaxe
/*
async function startRecording() {
  recognition = initSpeechRecognition();
  if (!recognition) return;
  const lang = $('audioLangInput')?.value || 'pt-BR';
  recognition.lang           = lang;
  recognition.continuous     = true;
  recognition.interimResults = false; // apenas resultados finais — evita repetição

  fullTranscript = ''; savedTranscript = ''; isRecording = true; recordSeconds = 0;
  $('btnStartRecord')?.classList.add('hidden');
  $('btnStopRecord')?.classList.remove('hidden');
  $('btnClearRecord')?.classList.add('hidden');
  $('recordTip')?.classList.remove('hidden');
  $('recordVisualizer')?.classList.add('recording');
  if ($('recordLiveText')) $('recordLiveText').innerHTML = '<p class="record-placeholder">Aguardando sua voz...</p>';

  recordTimer = setInterval(() => {
    recordSeconds++;
    const m = String(Math.floor(recordSeconds / 60)).padStart(2,'0');
    const s = String(recordSeconds % 60).padStart(2,'0');
    if ($('recordTimer')) $('recordTimer').textContent = `${m}:${s}`;
  }, 1000);

  recognition.onresult = e => {
    // Com interimResults = false, todos os resultados são finais
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        fullTranscript += e.results[i][0].transcript + ' ';
      }
    }
    if ($('recordLiveText')) $('recordLiveText').innerHTML =
      `<span style="color:var(--white)">${fullTranscript}</span>`;
  };

  recognition.onerror = e => {
    if (e.error === 'not-allowed') {
      showToast('Permissão de microfone negada.');
      stopRecording();
    }
  };

  recognition.onend = () => {
    if (isRecording) {
      // Não precisa mais de savedTranscript — fullTranscript acumula diretamente
      try { recognition.start(); } catch(err) {}
    }
  };

  recognition.start();
}

async function stopRecording() {
  isRecording = false;
  recognition?.stop();
  clearInterval(recordTimer);
  $('recordVisualizer')?.classList.remove('recording');
  $('btnStartRecord')?.classList.remove('hidden');
  $('btnStopRecord')?.classList.add('hidden');
  $('btnClearRecord')?.classList.remove('hidden');
  $('recordTip')?.classList.add('hidden');

  if (!fullTranscript.trim()) {
    showToast('Nenhum texto detectado. Verifique o microfone e tente novamente.');
    if ($('recordLiveText')) $('recordLiveText').innerHTML = '<p class="record-placeholder">Nenhum texto detectado. Tente falar mais perto do microfone.</p>';
    return;
  }

  let finalText = fullTranscript.trim();
  const langOut = $('audioLangOutput')?.value || 'none';
  const langIn  = $('audioLangInput')?.value  || 'pt-BR';
  if (langOut !== 'none' && !langIn.startsWith(langOut.split('-')[0])) {
    finalText = await translateText(finalText, langIn, langOut);
  }
  showAudioResult(finalText, langOut);
}

function clearRecording() {
  fullTranscript = ''; recordSeconds = 0;
  if ($('recordTimer'))   $('recordTimer').textContent = '00:00';
  if ($('recordLiveText')) $('recordLiveText').innerHTML = '<p class="record-placeholder">O texto aparecerá aqui enquanto você fala...</p>';
  $('audioResultCard')?.classList.add('hidden');
}
*/
