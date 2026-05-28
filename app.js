/* ===== SERVICE WORKER ===== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

/* ===== PWA INSTALL ===== */
let deferredInstallPrompt = null;

// Mostra botões de instalação sempre (com comportamento inteligente)
function showInstallButtons() {
  document.querySelectorAll('.btn-install-footer').forEach(b => b.classList.remove('hidden'));
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

// Exibe botão sempre — se não tiver prompt nativo, dá instrução manual
window.addEventListener('load', () => {
  setTimeout(showInstallButtons, 2500);
});

async function triggerInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      deferredInstallPrompt = null;
      document.querySelectorAll('.btn-install-footer').forEach(b => b.classList.add('hidden'));
      $('installBanner')?.classList.add('hidden');
    }
    return;
  }
  // iOS / browsers sem suporte ao prompt
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS) {
    showToast('No Safari: toque em Compartilhar → "Adicionar à Tela Inicial"');
  } else {
    showToast('No Chrome: menu (⋮) → "Adicionar à tela inicial"');
  }
}

/* ===== CONFIG SUPABASE ===== */
const SUPABASE_URL = 'https://cklxdvlkagwyzzmxdmpm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrbHhkdmxrYWd3eXp6bXhkbXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMDU5ODQsImV4cCI6MjA5NTU4MTk4NH0.I1vYFqOJQOo1Jsw8Q1LIVcJ8nshqnjUu5x6hrBWjiqA';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ===== STATE ===== */
let currentUser  = null;
let currentImage = null;
let outputMode   = 'word';
let ocrResult    = '';
let docs         = [];
let sheets       = [];
let searchQuery  = '';
let viewingDoc   = null;    // doc aberto no modal de visualização
let renamingDoc  = null;    // doc sendo renomeado

/* ===== SETTINGS ===== */
let settings = {
  lang:       'por',
  quality:    0.85,
  format:     'word',
  theme:      'dark',
  psm:        '6',
  preprocess: 'on'
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('scribble_settings') || '{}');
    settings = { ...settings, ...s };
  } catch {}
  applySettings();
}

function saveSettings() {
  localStorage.setItem('scribble_settings', JSON.stringify(settings));
}

function applySettings() {
  document.documentElement.setAttribute('data-theme', settings.theme);

  const langEl = $('settingLang');
  if (langEl) langEl.value = settings.lang;

  const qualEl = $('settingQuality');
  if (qualEl) qualEl.value = String(settings.quality);
  const psmEl = $('settingPsm');
  if (psmEl) psmEl.value = settings.psm;
  document.querySelectorAll('[data-preprocess]').forEach(b => {
    b.classList.toggle('active', b.dataset.preprocess === settings.preprocess);
  });

  const fmtEl = $('settingFormat');
  if (fmtEl) fmtEl.value = settings.format;

  document.querySelectorAll('[data-theme-btn]').forEach(b => {
    b.classList.toggle('active', b.dataset.themeBtn === settings.theme);
  });

  outputMode = settings.format;
  document.querySelectorAll('.toggle-btn[data-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === outputMode);
  });
}

/* ===== DOM ===== */
const $ = id => document.getElementById(id);

/* ===== INIT ===== */
window.addEventListener('load', async () => {
  loadSettings();
  await initSupabase();
  setTimeout(() => {
    $('splash').style.opacity = '0';
    setTimeout(() => {
      $('splash').classList.add('hidden');
      $('app').classList.remove('hidden');
      loadDocs();
    }, 500);
  }, 1800);
});

document.addEventListener('DOMContentLoaded', () => {
  // Install buttons
  document.querySelectorAll('.btn-install-footer').forEach(b => b.addEventListener('click', triggerInstall));
  $('btnInstallConfirm')?.addEventListener('click', triggerInstall);
  $('btnInstallDismiss')?.addEventListener('click', () => $('installBanner').classList.add('hidden'));

  // Settings
  $('settingLang')?.addEventListener('change', e => { settings.lang = e.target.value; saveSettings(); });
  $('settingQuality')?.addEventListener('change', e => { settings.quality = parseFloat(e.target.value); saveSettings(); });
  $('settingFormat')?.addEventListener('change', e => { settings.format = e.target.value; outputMode = e.target.value; saveSettings(); });
  $('settingPsm')?.addEventListener('change', e => { settings.psm = e.target.value; saveSettings(); });
  document.querySelectorAll('[data-preprocess]').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.preprocess = btn.dataset.preprocess;
      document.querySelectorAll('[data-preprocess]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveSettings();
    });
  });
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.theme = btn.dataset.themeBtn;
      saveSettings(); applySettings();
    });
  });

  // Instalar via Config
  $('btnInstallSettings')?.addEventListener('click', triggerInstall);

  // Clear local
  $('btnClearLocal')?.addEventListener('click', () => {
    if (!confirm('Apagar todos os documentos salvos localmente?')) return;
    localStorage.removeItem('scribble_docs');
    localStorage.removeItem('scribble_sheets');
    docs = []; sheets = [];
    renderDocs(); renderSheets();
    showToast('Dados locais removidos');
  });

  // Sync
  $('btnSync')?.addEventListener('click', syncCloud);
  $('btnSyncCloud')?.addEventListener('click', syncCloud);
});

/* ===== SUPABASE AUTH ===== */
async function initSupabase() {
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) currentUser = session.user;
  db.auth.onAuthStateChange((_e, session) => {
    currentUser = session?.user || null;
    renderProfile();
    if (currentUser) {
      $('statCloud').innerHTML = '<span class="material-icons-round" style="font-size:20px;color:var(--green)">cloud_done</span>';
    } else {
      $('statCloud').innerHTML = '<span class="material-icons-round" style="font-size:20px">cloud_off</span>';
    }
  });
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
  $('searchInput').value = '';
  searchQuery = '';
  renderDocs(); renderSheets();
});
$('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.toLowerCase();
  renderDocs(); renderSheets();
});

/* ===== FAB ===== */
$('fabScan').addEventListener('click', openScanModal);

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

function closeScanModal() {
  $('modalScan').classList.add('hidden');
  resetCameraStream();
}

/* ===== CÂMERA ===== */
$('btnCamera').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    const video = $('cameraStream');
    video.srcObject = stream;
    video.classList.remove('hidden');
    $('scanPlaceholder').classList.add('hidden');
    $('previewImg').classList.add('hidden');

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
        $('btnCamera').innerHTML = '<span class="material-icons-round">photo_camera</span> Câmera';
        $('btnCamera').onclick = oldClick;
      }, 'image/jpeg', settings.quality);
    };
  } catch {
    showToast('Câmera não disponível — use Galeria');
    $('galleryInput').click();
  }
});

$('btnUpload').addEventListener('click', () => $('galleryInput').click());
$('galleryInput').addEventListener('change', e => {
  if (e.target.files[0]) setPreviewBlob(e.target.files[0]);
  e.target.value = '';
});
$('fileInput').addEventListener('change', e => {
  if (e.target.files[0]) setPreviewBlob(e.target.files[0]);
  e.target.value = '';
});

function setPreviewBlob(blob) {
  // aplica compressão conforme qualidade
  const img = new Image();
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    canvas.toBlob(compressed => {
      currentImage = compressed;
      const purl = URL.createObjectURL(compressed);
      $('previewImg').src = purl;
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
  const video = $('cameraStream');
  if (video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
  video.classList.add('hidden');
}

/* ===== TOGGLE MODO ===== */
document.querySelectorAll('.toggle-btn[data-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn[data-mode]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    outputMode = btn.dataset.mode;
  });
});

/* ===== PRÉ-PROCESSAMENTO DE IMAGEM ===== */
function preprocessImage(blob) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Escala para no mínimo 1800px de largura (melhora OCR)
      const scale = Math.max(1, 1800 / img.naturalWidth);
      canvas.width  = img.naturalWidth  * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d');

      // Desenha a imagem escalada
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Filtros de melhoria
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;

      for (let i = 0; i < d.length; i += 4) {
        // Escala de cinza
        const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];

        // Aumento de contraste (fórmula sigmoid)
        const contrast = 1.8;
        const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
        let enhanced = factor * (gray - 128) + 128;
        enhanced = Math.max(0, Math.min(255, enhanced));

        // Binarização adaptativa (threshold)
        const threshold = 140;
        const binary = enhanced > threshold ? 255 : 0;

        d[i] = d[i+1] = d[i+2] = binary;
        // d[i+3] = alfa (mantém)
      }

      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob(processed => {
        URL.revokeObjectURL(url);
        resolve(processed);
      }, 'image/png'); // PNG sem compressão para OCR mais preciso
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
  $('progressFill').style.width = '0%';
  $('progressPct').textContent = '0%';
  $('progressStatus').textContent = 'Preparando imagem...';

  try {
    // Pré-processa a imagem (se ativado)
    const processed = settings.preprocess === 'on'
      ? await preprocessImage(currentImage)
      : currentImage;
    $('progressStatus').textContent = 'Iniciando OCR...';

    const worker = await Tesseract.createWorker(settings.lang, 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          $('progressFill').style.width = pct + '%';
          $('progressPct').textContent = pct + '%';
          $('progressStatus').textContent = 'Reconhecendo texto...';
        } else {
          $('progressStatus').textContent = m.status;
        }
      }
    });

    // Configurações para melhor precisão
    await worker.setParameters({
      tessedit_pageseg_mode: settings.psm,
      preserve_interword_spaces: '1',
    });

    const { data: { text } } = await worker.recognize(processed);
    await worker.terminate();

    // Limpa o texto: remove linhas com só símbolos/ruído
    ocrResult = cleanOcrText(text);
    $('modalProgress').classList.add('hidden');
    showOcrCard();
  } catch (err) {
    $('modalProgress').classList.add('hidden');
    showToast('Erro no OCR: ' + err.message);
  }
}

function cleanOcrText(raw) {
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => {
      if (!l) return false;
      // Remove linhas com menos de 2 caracteres alfanuméricos
      const alphaNum = (l.match(/[a-zA-Z0-9À-ÿ]/g) || []).length;
      return alphaNum >= 2;
    })
    .join('\n')
    .trim();
}

function showOcrCard() {
  const url = URL.createObjectURL(currentImage);
  $('ocrPreview').innerHTML = `<img src="${url}" alt="doc" style="width:100%;border-radius:8px;max-height:140px;object-fit:cover" />`;
  $('ocrText').textContent = ocrResult;
  $('ocrDocName').value = 'Documento_' + dateSlug();
  $('ocrCard').classList.remove('hidden');
  switchTab('tabDocs');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tabDocs'));
  $('mainContent').scrollTo({ top: 0, behavior: 'smooth' });
}

$('btnCloseOcr').addEventListener('click', () => {
  $('ocrCard').classList.add('hidden');
  ocrResult = ''; currentImage = null;
});

/* ===== COMPARTILHAR (OCR card) ===== */
$('btnShareOcr').addEventListener('click', () => shareText($('ocrText').innerText.trim(), $('ocrDocName').value));

async function shareText(text, title = 'Documento') {
  if (!text) { showToast('Nenhum texto para compartilhar'); return; }
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch {}
  }
  // Fallback: copiar para clipboard
  try {
    await navigator.clipboard.writeText(text);
    showToast('Texto copiado para a área de transferência!');
  } catch {
    showToast('Compartilhamento não disponível neste navegador');
  }
}

/* ===== EXPORTAR WORD ===== */
$('btnExportWord').addEventListener('click', () => exportWord($('ocrText').innerText.trim(), $('ocrDocName').value));
$('btnViewExportWord').addEventListener('click', () => {
  if (viewingDoc) exportWord(viewingDoc.text, viewingDoc.name);
});

async function exportWord(text, docName = 'Documento') {
  if (!text) { showToast('Nenhum texto para exportar'); return; }
  try {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
    const lines = text.split('\n').filter(l => l.trim());
    const paragraphs = lines.map((line, i) =>
      new Paragraph({
        children: [new TextRun({ text: line, size: 24, font: 'Calibri' })],
        spacing: { after: 160 },
        ...(i === 0 ? { heading: HeadingLevel.HEADING_2 } : {})
      })
    );
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun({ text: docName, bold: true, size: 28, color: '1565C0', font: 'Calibri' })], spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: 'Data: ' + formatDate(new Date()), size: 20, color: '666666', font: 'Calibri' })], spacing: { after: 400 } }),
          ...paragraphs
        ]
      }]
    });
    const blob = await Packer.toBlob(doc);
    const name = sanitizeFilename(docName) + '.docx';
    downloadBlob(blob, name);
    await saveDocRecord(name, text, 'word');
    showToast('Word exportado!');
  } catch (err) { showToast('Erro ao gerar Word: ' + err.message); }
}

/* ===== EXPORTAR EXCEL ===== */
$('btnExportExcel').addEventListener('click', () => exportExcel($('ocrText').innerText.trim(), $('ocrDocName').value));
$('btnViewExportExcel').addEventListener('click', () => {
  if (viewingDoc) exportExcel(viewingDoc.text, viewingDoc.name);
});

function exportExcel(text, docName = 'Planilha') {
  if (!text) { showToast('Nenhum texto para exportar'); return; }
  try {
    const lines = text.split('\n').filter(l => l.trim());
    const data = lines.map(line => {
      if (line.includes('|')) return line.split('|').map(c => c.trim()).filter(Boolean);
      const nums = line.match(/[\d.,]+/g);
      if (nums && nums.length > 1) return [line.replace(/[\d.,]+/g, '').trim(), ...nums];
      return [line];
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      [docName], ['Data: ' + formatDate(new Date())], [], ...data
    ]);
    ws['!cols'] = [{ wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Documento');
    const name = sanitizeFilename(docName) + '.xlsx';
    XLSX.writeFile(wb, name);
    saveDocRecord(name, text, 'excel');
    showToast('Excel exportado!');
  } catch (err) { showToast('Erro ao gerar Excel: ' + err.message); }
}

/* ===== SALVAR ===== */
$('btnSaveDoc').addEventListener('click', async () => {
  const text = $('ocrText').innerText.trim();
  if (!text) { showToast('Nenhum texto para salvar'); return; }
  const name = ($('ocrDocName').value.trim() || 'Documento') + (outputMode === 'excel' ? '.xlsx' : '.docx');
  await saveDocRecord(name, text, outputMode);
  $('ocrCard').classList.add('hidden');
  showToast('Documento salvo!');
});

/* ===== PERSISTÊNCIA ===== */
async function saveDocRecord(name, text, type) {
  const record = { id: crypto.randomUUID(), name, text, type, createdAt: new Date().toISOString(), userId: currentUser?.id || null };
  if (type === 'excel') { sheets.unshift(record); saveLocal('scribble_sheets', sheets); renderSheets(); }
  else                   { docs.unshift(record);   saveLocal('scribble_docs',   docs);   renderDocs(); }
  if (currentUser) {
    try {
      await db.from('documents').insert({ id: record.id, name, text, type, user_id: currentUser.id, created_at: record.createdAt });
    } catch {}
  }
}

function saveLocal(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch {} }
function loadLocal(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } }

async function loadDocs() {
  docs   = loadLocal('scribble_docs');
  sheets = loadLocal('scribble_sheets');
  renderDocs(); renderSheets();
  if (currentUser) await syncCloud();
}

/* ===== SINCRONIZAR COM NUVEM ===== */
async function syncCloud() {
  if (!currentUser) { showToast('Faça login para sincronizar'); openProfile(); return; }
  try {
    showToast('Sincronizando...');
    const { data, error } = await db.from('documents')
      .select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    if (error) throw error;
    if (data?.length) {
      const remote = data.map(r => ({ id: r.id, name: r.name, text: r.text, type: r.type, createdAt: r.created_at }));
      const wordDocs = remote.filter(d => d.type !== 'excel');
      const xlsDocs  = remote.filter(d => d.type === 'excel');
      docs   = mergeById(docs,   wordDocs);
      sheets = mergeById(sheets, xlsDocs);
      saveLocal('scribble_docs',   docs);
      saveLocal('scribble_sheets', sheets);
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

/* ===== RENDER DOCS ===== */
function renderDocs() {
  const list = $('docList');
  const q = searchQuery;
  const filtered = docs.filter(d => !q || d.name.toLowerCase().includes(q) || d.text?.toLowerCase().includes(q));
  $('badgeDocs').textContent = docs.length;
  $('statDocs').textContent  = docs.length;
  $('emptyDocs').classList.toggle('hidden', filtered.length > 0);
  [...list.querySelectorAll('.doc-item')].forEach(el => el.remove());
  filtered.forEach(doc => list.appendChild(docItemEl(doc, 'word')));
}

function renderSheets() {
  const list = $('sheetList');
  const q = searchQuery;
  const filtered = sheets.filter(d => !q || d.name.toLowerCase().includes(q) || d.text?.toLowerCase().includes(q));
  $('badgeSheets').textContent = sheets.length;
  $('statSheets').textContent  = sheets.length;
  $('emptySheets').classList.toggle('hidden', filtered.length > 0);
  [...list.querySelectorAll('.doc-item')].forEach(el => el.remove());
  filtered.forEach(doc => list.appendChild(docItemEl(doc, 'excel')));
}

function docItemEl(doc, type) {
  const el = document.createElement('div');
  el.className = 'doc-item';
  el.innerHTML = `
    <div class="doc-icon ${type}">
      <span class="material-icons-round">${type === 'excel' ? 'table_chart' : 'description'}</span>
    </div>
    <div class="doc-info">
      <div class="doc-name">${escHtml(doc.name)}</div>
      <div class="doc-meta">${formatDate(new Date(doc.createdAt))} · ${type === 'excel' ? 'Excel' : 'Word'}</div>
    </div>
    <span class="doc-status processed">Processado</span>
    <div class="doc-actions">
      <button class="icon-btn small" title="Compartilhar"><span class="material-icons-round">share</span></button>
      <button class="icon-btn small" title="Excluir"><span class="material-icons-round">delete_outline</span></button>
    </div>
  `;
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

/* ===== VISUALIZAR DOCUMENTO ===== */
function openViewModal(doc, type) {
  viewingDoc = doc;
  $('viewDocName').textContent = doc.name;
  $('viewDocMeta').textContent = formatDate(new Date(doc.createdAt)) + ' · ' + (type === 'excel' ? 'Excel' : 'Word');
  $('viewDocText').textContent = doc.text || '(sem texto)';
  const icon = $('viewDocIcon');
  icon.className = 'doc-icon ' + type;
  icon.innerHTML = `<span class="material-icons-round">${type === 'excel' ? 'table_chart' : 'description'}</span>`;
  $('modalView').classList.remove('hidden');
}

$('btnCloseView').addEventListener('click',  () => { $('modalView').classList.add('hidden'); viewingDoc = null; });
$('modalView').addEventListener('click', e => { if (e.target === $('modalView')) { $('modalView').classList.add('hidden'); viewingDoc = null; } });

$('btnViewRename').addEventListener('click', () => {
  if (!viewingDoc) return;
  renamingDoc = viewingDoc;
  $('renameInput').value = viewingDoc.name.replace(/\.(docx|xlsx)$/i, '');
  $('modalRename').classList.remove('hidden');
});

$('btnViewShare').addEventListener('click',    () => { if (viewingDoc) shareText(viewingDoc.text, viewingDoc.name); });
$('btnViewShareFull').addEventListener('click', () => { if (viewingDoc) shareText(viewingDoc.text, viewingDoc.name); });
$('btnViewExport').addEventListener('click',   () => {
  if (!viewingDoc) return;
  if (viewingDoc.type === 'excel') exportExcel(viewingDoc.text, viewingDoc.name);
  else exportWord(viewingDoc.text, viewingDoc.name);
});

/* ===== RENOMEAR ===== */
$('btnCancelRename').addEventListener('click', () => { $('modalRename').classList.add('hidden'); renamingDoc = null; });

$('btnConfirmRename').addEventListener('click', () => {
  if (!renamingDoc) return;
  const newBase = $('renameInput').value.trim();
  if (!newBase) { showToast('Digite um nome válido'); return; }
  const ext = renamingDoc.type === 'excel' ? '.xlsx' : '.docx';
  const newName = newBase + ext;

  // Atualiza lista local
  const list = renamingDoc.type === 'excel' ? sheets : docs;
  const item = list.find(d => d.id === renamingDoc.id);
  if (item) {
    item.name = newName;
    if (renamingDoc.type === 'excel') saveLocal('scribble_sheets', sheets);
    else                               saveLocal('scribble_docs',   docs);
  }

  // Atualiza Supabase
  if (currentUser) db.from('documents').update({ name: newName }).eq('id', renamingDoc.id).then(() => {});

  // Atualiza modal de visualização
  if (viewingDoc?.id === renamingDoc.id) {
    viewingDoc.name = newName;
    $('viewDocName').textContent = newName;
  }

  $('modalRename').classList.add('hidden');
  renamingDoc = null;
  renderDocs(); renderSheets();
  showToast('Documento renomeado!');
});

$('renameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnConfirmRename').click(); });

/* ===== PERFIL / AUTH ===== */
$('btnProfile').addEventListener('click', openProfile);
$('navProfile').addEventListener('click', openProfile);

function openProfile() {
  renderProfile();
  $('modalProfile').classList.remove('hidden');
}

function renderProfile() {
  if (currentUser) {
    $('authForm').classList.add('hidden');
    $('userPanel').classList.remove('hidden');
    $('profileTitle').textContent = 'Meu Perfil';
    $('userEmail').textContent    = currentUser.email;
    const since = new Date(currentUser.created_at || Date.now());
    $('userSince').textContent    = formatDate(since);
    $('statDocs').textContent     = docs.length;
    $('statSheets').textContent   = sheets.length;
    $('statCloud').innerHTML      = '<span class="material-icons-round" style="font-size:20px;color:var(--green)">cloud_done</span>';
  } else {
    $('authForm').classList.remove('hidden');
    $('userPanel').classList.add('hidden');
    $('profileTitle').textContent = 'Entrar na conta';
    $('authError').classList.add('hidden');
  }
}

$('btnLogin').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  const pass  = $('authPassword').value;
  if (!email || !pass) { showAuthError('Preencha e-mail e senha'); return; }
  $('btnLogin').disabled = true;
  $('btnLogin').textContent = 'Entrando...';
  const { error } = await db.auth.signInWithPassword({ email, password: pass });
  $('btnLogin').disabled = false;
  $('btnLogin').innerHTML = '<span class="material-icons-round">login</span> Entrar';
  if (error) { showAuthError(error.message); return; }
  $('modalProfile').classList.add('hidden');
  showToast('Bem-vindo(a)!');
  loadDocs();
});

$('btnRegister').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  const pass  = $('authPassword').value;
  if (!email || !pass) { showAuthError('Preencha e-mail e senha'); return; }
  if (pass.length < 6)  { showAuthError('Senha mínima de 6 caracteres'); return; }
  $('btnRegister').disabled = true;
  const { error } = await db.auth.signUp({ email, password: pass });
  $('btnRegister').disabled = false;
  if (error) { showAuthError(error.message); return; }
  showToast('Conta criada! Verifique seu e-mail.');
  $('modalProfile').classList.add('hidden');
});

$('btnLogout').addEventListener('click', async () => {
  await db.auth.signOut();
  currentUser = null;
  showToast('Até logo!');
  $('modalProfile').classList.add('hidden');
});

$('btnCancelProfile').addEventListener('click', () => $('modalProfile').classList.add('hidden'));
$('btnCloseProfile').addEventListener('click',  () => $('modalProfile').classList.add('hidden'));
$('modalProfile').addEventListener('click', e => { if (e.target === $('modalProfile')) $('modalProfile').classList.add('hidden'); });

function showAuthError(msg) {
  $('authError').textContent = msg;
  $('authError').classList.remove('hidden');
}

/* ===== UTILS ===== */
function formatDate(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function dateSlug() {
  const n = new Date();
  return [String(n.getDate()).padStart(2,'0'), String(n.getMonth()+1).padStart(2,'0'), n.getFullYear(),
          String(n.getHours()).padStart(2,'0'), String(n.getMinutes()).padStart(2,'0')].join('');
}
function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\.(docx|xlsx)$/i, '').trim() || 'documento';
}
function escHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}
