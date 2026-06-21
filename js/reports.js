/* ======================================================================
   CENTILEIQ — PDF REPORTS
   Builds two distinct, designed report layouts using jsPDF + autoTable:
     1) Exam Rankings  -> institutional / letterhead style
     2) Growth Screen   -> clinical report style
   Both pull live data from the existing app.js state (students / growthEntries)
   so they always reflect exactly what's on screen.
====================================================================== */

(function(){

  /* ---------------- Pro licensing ----------------
     LICENSE_PROXY_URL points at the Cloudflare Worker that verifies a license key
     against Lemon Squeezy server-to-server (the License API can't be called reliably
     directly from browser JS due to CORS — see the Worker's own comments for why).
     PASTE YOUR DEPLOYED WORKER URL HERE before this feature will work.
  */
  const LICENSE_PROXY_URL = 'https://centileiq-license.gyamfi250.workers.dev';

  const LICENSE_KEY_STORAGE = 'centileiq_license_key';
  const LICENSE_EMAIL_STORAGE = 'centileiq_license_email';

  function loadLicenseState(){
    return {
      active: localStorage.getItem('centileiq_pro') === 'true',
      key: localStorage.getItem(LICENSE_KEY_STORAGE) || null,
      email: localStorage.getItem(LICENSE_EMAIL_STORAGE) || null
    };
  }

  function setLicenseActive(key, email){
    localStorage.setItem('centileiq_pro', 'true');
    localStorage.setItem(LICENSE_KEY_STORAGE, key);
    if(email) localStorage.setItem(LICENSE_EMAIL_STORAGE, email);
  }

  function clearLicense(){
    localStorage.removeItem('centileiq_pro');
    localStorage.removeItem(LICENSE_KEY_STORAGE);
    localStorage.removeItem(LICENSE_EMAIL_STORAGE);
  }

  async function verifyLicenseKey(key){
    if(LICENSE_PROXY_URL.startsWith('REPLACE_WITH')){
      return { valid:false, error:'Licensing isn\'t fully set up yet — the verification server URL is missing. Contact support.' };
    }
    try{
      const res = await fetch(LICENSE_PROXY_URL, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ license_key: key })
      });
      return await res.json();
    }catch(e){
      return { valid:false, error:'Could not reach the licensing server. Check your connection and try again.' };
    }
  }

  /* ---------------- Branding (persisted locally) ---------------- */
  const BRAND_KEY = 'centileiq_branding';

  function loadBranding(){
    try{
      return JSON.parse(localStorage.getItem(BRAND_KEY)) || {
        examOrgName: '', examTeacherName: '', examClassName: '',
        examAddress: '', examPhone: '', examEmail: '',
        examSignerName: '', examSignerTitle: '',
        growthOrgName: '', growthProviderName: '',
        growthAddress: '', growthPhone: '', growthEmail: '',
        growthSignerName: '', growthSignerTitle: '',
        logoDataUrl: null, signatureDataUrl: null, stampDataUrl: null
      };
    }catch(e){
      return { examOrgName:'', examTeacherName:'', examClassName:'', examAddress:'', examPhone:'', examEmail:'',
        examSignerName:'', examSignerTitle:'',
        growthOrgName:'', growthProviderName:'', growthAddress:'', growthPhone:'', growthEmail:'',
        growthSignerName:'', growthSignerTitle:'',
        logoDataUrl:null, signatureDataUrl:null, stampDataUrl:null };
    }
  }
  function saveBranding(b){
    localStorage.setItem(BRAND_KEY, JSON.stringify(b));
  }
  let branding = loadBranding();

  /* ---------------- Grading (persisted locally) ----------------
     Bands are defined as { label, min } pairs against % of max score, sorted descending.
     A score's grade is the first band whose min it meets or exceeds (>=) — same boundary
     convention as the Pass/Fail cutoff elsewhere in this file, for consistency.
  */
  const GRADING_KEY = 'centileiq_grading';
  const GRADE_PRESETS = {
    // WASSCE scale per WAEC's published grading table (A1 Excellent 75-100 down to F9 Fail 0-39)
    wassce: [
      { label:'A1', min:75 }, { label:'B2', min:70 }, { label:'B3', min:65 },
      { label:'C4', min:60 }, { label:'C5', min:55 }, { label:'C6', min:50 },
      { label:'D7', min:45 }, { label:'E8', min:40 }, { label:'F9', min:0 }
    ],
    usaf: [
      { label:'A', min:80 }, { label:'B', min:70 }, { label:'C', min:60 },
      { label:'D', min:50 }, { label:'F', min:0 }
    ],
    dcpf: [
      { label:'Distinction', min:80 }, { label:'Credit', min:65 },
      { label:'Pass', min:50 }, { label:'Fail', min:0 }
    ],
    custom: [
      { label:'A', min:80 }, { label:'B', min:70 }, { label:'C', min:60 },
      { label:'D', min:50 }, { label:'F', min:0 }
    ]
  };

  function loadGrading(){
    try{
      const saved = JSON.parse(localStorage.getItem(GRADING_KEY));
      if(saved && saved.preset && Array.isArray(saved.bands)) return saved;
    }catch(e){ /* fall through to default */ }
    return { enabled:false, preset:'wassce', bands: GRADE_PRESETS.wassce.map(b=>({...b})) };
  }
  function saveGrading(g){ localStorage.setItem(GRADING_KEY, JSON.stringify(g)); }
  let grading = loadGrading();

  // Returns the matching band's label for a given % of max, or '—' if no band matches
  // (shouldn't happen with a well-formed band set that bottoms out at min:0).
  function gradeFor(pctOfMax, bands){
    const sorted = [...bands].sort((a,b)=>b.min-a.min);
    for(const band of sorted){ if(pctOfMax >= band.min) return band.label; }
    return '—';
  }

  /* ---------------- Shared PDF helpers ---------------- */
  const PAGE_W = 595.28; // A4 pt, portrait
  const MARGIN = 40;

  function newDoc(){
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit:'pt', format:'a4' });
  }

  function drawHeader(doc, opts){
    // opts: { orgName, detailLines: string[], title, logoDataUrl }
    // Logo sits fixed at the left margin inside a circular frame; the org name and contact
    // details remain centered on the full page width, independent of the logo's presence.
    const lines = (opts.detailLines || []).filter(Boolean);
    const pageCenterX = PAGE_W / 2;
    let y = MARGIN;
    const blockStartY = y;

    doc.setFont('helvetica','bold');
    doc.setFontSize(14);
    doc.setTextColor(28,42,63);
    doc.text(opts.orgName || 'CentileIQ', pageCenterX, y + 8, { align:'center' });
    y += 24;

    doc.setFont('helvetica','normal');
    doc.setFontSize(9);
    doc.setTextColor(82,96,122);
    lines.forEach(line => {
      doc.text(line, pageCenterX, y, { align:'center' });
      y += 12;
    });

    const blockEndY = lines.length ? y - 12 + 8 : y;

    // Circular logo placeholder, fixed at the left margin, vertically centered against the
    // name+details block so it doesn't look stranded at the top when there are several lines.
    if(opts.logoDataUrl){
      const r = 22;
      const cx = MARGIN + r;
      const cy = (blockStartY + 8 + blockEndY) / 2;
      try{
        doc.saveGraphicsState();
        doc.circle(cx, cy, r, null);
        doc.clip();
        doc.discardPath();
        doc.addImage(opts.logoDataUrl, 'PNG', cx - r, cy - r, r*2, r*2);
        doc.restoreGraphicsState();
        // Thin ring around the circle so the crop edge reads as deliberate, not accidental
        doc.setDrawColor(226,221,208);
        doc.setLineWidth(1);
        doc.circle(cx, cy, r, 'S');
      }catch(e){ /* malformed image — skip the logo rather than break the PDF */ }
    }

    y = Math.max(blockEndY, blockStartY + 44);
    y += 10;
    doc.setDrawColor(28,125,118);
    doc.setLineWidth(1.5);
    doc.line(pageCenterX - 28, y, pageCenterX + 28, y);
    y += 22;

    doc.setFont('times','bold');
    doc.setFontSize(17);
    doc.setTextColor(28,42,63);
    doc.text(opts.title, pageCenterX, y, { align:'center' });
    y += 6;

    y += 8;
    doc.setDrawColor(226,221,208);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);

    return y + 22;
  }

  function drawDiagonalWatermark(doc){
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    doc.saveGraphicsState();
    // Real alpha transparency (not just a pale color) so the watermark visually blends with
    // whatever's underneath — table cell backgrounds are fully opaque fills, so a light
    // *color* alone would still sit fully opaque on top of them; true opacity is what
    // actually lets the table content show through.
    doc.setGState(new doc.GState({ opacity: 0.06 }));
    doc.setFont('times','bold');
    doc.setFontSize(80);
    doc.setTextColor(28,42,63);
    doc.text('CentileIQ', pageW / 2, pageH / 2, { align:'center', angle:38 });
    doc.restoreGraphicsState();
  }

  function drawFooter(doc, pageNum, totalPages, watermark, generatedStr){
    const h = doc.internal.pageSize.getHeight();
    doc.setDrawColor(226,221,208);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, h - 40, PAGE_W - MARGIN, h - 40);
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.setTextColor(154,163,181);
    const leftText = watermark ? 'Generated with CentileIQ — centileiq app' : null;
    if(leftText) doc.text(leftText, MARGIN, h - 26);
    // Generated date+time sits centered in the footer, independent of the watermark/page-count text
    doc.text(generatedStr, PAGE_W / 2, h - 26, { align:'center' });
    doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, h - 26, { align:'right' });
  }

  function finalizeFooters(doc, watermark){
    const total = doc.internal.getNumberOfPages();
    const now = new Date();
    const generatedStr = 'Generated ' + now.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}) +
      ' at ' + now.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
    for(let i=1;i<=total;i++){
      doc.setPage(i);
      // Diagonal watermark drawn FIRST so it sits visually behind the footer text/rule
      // line drawn after it on the same page.
      if(watermark) drawDiagonalWatermark(doc);
      drawFooter(doc, i, total, watermark, generatedStr);
    }
  }

  /* ---------------- Chart image embed ---------------- */
  // Captures a live Chart.js canvas as a PNG and places it in the PDF, preserving its aspect
  // ratio. Adds a new page first if there isn't enough room left on the current one.
  function drawChartImage(doc, startY, canvasId, label){
    const canvas = document.getElementById(canvasId);
    if(!canvas || !canvas.width || !canvas.height) return startY;

    let dataUrl;
    try{ dataUrl = canvas.toDataURL('image/png', 1.0); }
    catch(e){ return startY; } // canvas tainted or unsupported — skip silently rather than break the PDF

    const maxW = PAGE_W - 2*MARGIN;
    const aspect = canvas.height / canvas.width;
    const imgW = maxW;
    const imgH = imgW * aspect;
    const labelH = 22;
    const pageH = doc.internal.pageSize.getHeight();

    let y = startY + 24;
    if(y + labelH + imgH > pageH - 60){
      doc.addPage();
      y = MARGIN;
    }

    doc.setFont('helvetica','bold');
    doc.setFontSize(11);
    doc.setTextColor(28,42,63);
    doc.text(label, MARGIN, y + 12);
    y += labelH;

    try{ doc.addImage(dataUrl, 'PNG', MARGIN, y, imgW, imgH); }catch(e){ return y; }
    return y + imgH;
  }

  /* ---------------- Signature / sign-off block ---------------- */
  // Draws a sign-off row near the bottom of the report: signature (image or blank line) + printed
  // name/title on the left, stamp image on the right if provided. Adds a new page first if there
  // isn't enough room left on the current one.
  function drawSignatureBlock(doc, startY, opts){
    // opts: { signerName, signerTitle, signatureDataUrl, stampDataUrl }
    const pageH = doc.internal.pageSize.getHeight();
    const blockH = 90;
    let y = startY;

    if(y + blockH > pageH - 50){
      doc.addPage();
      y = MARGIN + 20;
    } else {
      y += 20;
    }

    const sigX = MARGIN;
    const sigLineW = 200;
    const stampX = PAGE_W - MARGIN - 80;

    // Signature image (if provided) sits above the line; otherwise just a blank line to sign by hand
    if(opts.signatureDataUrl){
      try{ doc.addImage(opts.signatureDataUrl, 'PNG', sigX, y - 32, 130, 36); }catch(e){}
    }

    doc.setDrawColor(28,42,63);
    doc.setLineWidth(0.75);
    doc.line(sigX, y, sigX + sigLineW, y);

    doc.setFont('helvetica','bold');
    doc.setFontSize(10);
    doc.setTextColor(28,42,63);
    doc.text(opts.signerName || 'Signed', sigX, y + 14);

    doc.setFont('helvetica','normal');
    doc.setFontSize(8.5);
    doc.setTextColor(82,96,122);
    doc.text(opts.signerTitle || 'Authorized signature', sigX, y + 26);

    // Stamp/seal image, placed to the right, separate from the signature line
    if(opts.stampDataUrl){
      try{ doc.addImage(opts.stampDataUrl, 'PNG', stampX, y - 60, 80, 80); }catch(e){}
    }

    return y + 40;
  }

  /* ---------------- Cut-off / scope (Pass/Fail) helper ----------------
     Shared between buildExamPdf and the live on-screen preview so the filtering rule
     (score >= cutoff = Pass) only ever lives in one place.
  */
  function getCutoffScope(){
    const cutoffEl = document.getElementById('examCutoff');
    const cutoffRaw = cutoffEl ? cutoffEl.value.trim() : '';
    const hasCutoff = cutoffRaw !== '' && !isNaN(parseFloat(cutoffRaw));
    const cutoff = hasCutoff ? parseFloat(cutoffRaw) : null;
    const scope = hasCutoff ? (document.getElementById('examPdfScope')?.value || 'all') : 'all';
    return { cutoff, scope, hasCutoff };
  }

  function applyScopeFilter(sortedAll, scope, cutoff){
    if(scope === 'pass') return sortedAll.filter(r => r.score >= cutoff);
    if(scope === 'fail') return sortedAll.filter(r => r.score < cutoff);
    return sortedAll;
  }

  function renderScopePreview(){
    const panel = document.getElementById('scopePreviewPanel');
    const heading = document.getElementById('scopePreviewHeading');
    const body = document.getElementById('scopePreviewBody');
    if(!panel || !heading || !body) return;

    const { cutoff, scope } = getCutoffScope();

    if(scope === 'all' || typeof lastExamRows === 'undefined' || !lastExamRows.length){
      panel.style.display = 'none';
      return;
    }

    const sortedAll = [...lastExamRows].sort((a,b)=>a.rank-b.rank);
    const filtered = applyScopeFilter(sortedAll, scope, cutoff);

    panel.style.display = 'block';
    const scopeName = scope === 'pass' ? 'Pass list' : 'Fail list';
    const rule = scope === 'pass' ? `score ≥ ${cutoff}` : `score < ${cutoff}`;
    heading.textContent = `${scopeName} preview — ${rule} — ${filtered.length} of ${sortedAll.length} student(s)`;

    body.innerHTML = filtered.map(r => `
      <tr>
        <td><span class="rank-pill">#${r.rank}</span></td>
        <td>${(r.name||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</td>
        <td class="num">${r.score}/${r.max}</td>
      </tr>`).join('') || '<tr><td colspan="3" style="text-align:center; color:var(--ink-soft);">No students in this list.</td></tr>';
  }

  /* ---------------- Grading UI ---------------- */
  function renderGradeBandsList(){
    const list = document.getElementById('gradeBandsList');
    const presetSelect = document.getElementById('gradingPreset');
    if(!list) return;
    if(presetSelect) presetSelect.value = grading.preset;

    const isCustom = grading.preset === 'custom';
    const sorted = [...grading.bands].sort((a,b)=>b.min-a.min);

    list.innerHTML = sorted.map((band, i) => `
      <div class="grade-band-row" data-band-index="${i}">
        <input type="text" class="bandLabelInput" value="${band.label.replace(/"/g,'&quot;')}" ${isCustom?'':'disabled'} placeholder="Label">
        <span class="grade-band-meta">≥</span>
        <input type="number" class="bandMinInput" value="${band.min}" min="0" max="100" ${isCustom?'':'disabled'}>
        <span class="grade-band-meta">% of max</span>
        ${isCustom ? `<button class="icon-btn" type="button" data-remove-band="${i}" title="Remove band">✕</button>` : ''}
      </div>`).join('');

    const addBtn = document.getElementById('addGradeBandBtn');
    if(addBtn) addBtn.style.display = isCustom ? 'inline-flex' : 'none';

    if(isCustom){
      list.querySelectorAll('.bandLabelInput, .bandMinInput').forEach(el => {
        el.addEventListener('change', readBandsFromUI);
      });
      list.querySelectorAll('[data-remove-band]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.removeBand, 10);
          const sortedNow = [...grading.bands].sort((a,b)=>b.min-a.min);
          sortedNow.splice(idx, 1);
          grading.bands = sortedNow;
          saveGrading(grading);
          renderGradeBandsList();
          renderGradeColumn();
        });
      });
    }
  }

  function readBandsFromUI(){
    const list = document.getElementById('gradeBandsList');
    if(!list) return;
    const rows = Array.from(list.querySelectorAll('.grade-band-row'));
    const bands = rows.map(row => {
      const label = row.querySelector('.bandLabelInput')?.value.trim() || '?';
      const min = parseFloat(row.querySelector('.bandMinInput')?.value);
      return { label, min: isNaN(min) ? 0 : min };
    });
    grading.bands = bands;
    saveGrading(grading);
    renderGradeColumn();
  }

  /* ---------------- On-screen Grade column ----------------
     Injects a Grade <td> into each row of the live exam table (not just the PDF) when grading
     is enabled, by walking the already-rendered DOM rather than re-implementing app.js's row
     template — keeps this resilient if that template changes later.
  */
  function renderGradeColumn(){
    const headerCell = document.getElementById('gradeColHeader');
    const tbody = document.getElementById('examTableBody');
    if(!headerCell || !tbody) return;

    headerCell.style.display = grading.enabled ? '' : 'none';
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.forEach(row => {
      let gradeCell = row.querySelector('.grade-cell');
      if(!grading.enabled){
        if(gradeCell) gradeCell.remove();
        return;
      }
      // Read this row's % of max from the existing rendered cell rather than re-deriving it —
      // the 3rd <td> (index 2) holds raw score, 4th (index 3) holds % of max.
      const cells = row.querySelectorAll('td');
      if(cells.length < 4) return;
      const pctOfMaxText = cells[3].textContent.replace('%','').trim();
      const pctOfMax = parseFloat(pctOfMaxText);
      const grade = isNaN(pctOfMax) ? '—' : gradeFor(pctOfMax, grading.bands);

      if(!gradeCell){
        gradeCell = document.createElement('td');
        gradeCell.className = 'num grade-cell';
        // Insert right before the last cell (the no-print remove-button cell), so Grade
        // lands immediately after Percentile, matching the PDF's column order.
        row.insertBefore(gradeCell, row.lastElementChild);
      }
      gradeCell.textContent = grade;
    });
  }

  function buildExamPdf(){
    if(typeof students === 'undefined' || !students.length){ alert('Add students first.'); return; }
    if(typeof lastExamRows === 'undefined' || !lastExamRows.length){ alert('Nothing to export yet.'); return; }

    const decimalsEl = document.getElementById('examPdfDecimals');
    const decimals = decimalsEl ? parseInt(decimalsEl.value, 10) : 1;
    const includeChartChecked = document.getElementById('examPdfIncludeChart')?.checked ?? true;

    const { cutoff, scope } = getCutoffScope();

    const doc = newDoc();
    const sortedAll = [...lastExamRows].sort((a,b)=>a.rank-b.rank);

    // Apply Pass/Fail scope filtering. Pass = score >= cutoff (per the agreed boundary rule).
    const sorted = applyScopeFilter(sortedAll, scope, cutoff);

    if(scope !== 'all' && !sorted.length){
      alert(scope === 'pass' ? 'No students meet the pass mark — nothing to print.' : 'No students are below the pass mark — nothing to print.');
      return;
    }

    // The on-screen histogram reflects the WHOLE class, not a filtered subset. Showing it
    // unmodified under a "Pass List" or "Fail List" heading would misrepresent the data, so
    // the chart is only ever included when printing the full, unscoped list.
    const includeChart = includeChartChecked && scope === 'all';

    const scores = sorted.map(r=>r.score);

    const scopeBracket = scope === 'pass' ? ' (Pass List)' : scope === 'fail' ? ' (Fail List)' : '';

    let y = drawHeader(doc, {
      orgName: branding.examOrgName || 'CentileIQ',
      detailLines: [
        branding.examClassName ? `Class: ${branding.examClassName}` : null,
        branding.examTeacherName ? `Teacher: ${branding.examTeacherName}` : null,
        branding.examAddress || null,
        [branding.examPhone ? `Tel: ${branding.examPhone}` : null, branding.examEmail ? `Email: ${branding.examEmail}` : null].filter(Boolean).join('   ·   ') || null
      ],
      title: `Examination Ranking Report${scopeBracket}`,
      logoDataUrl: branding.logoDataUrl
    });

    // Summary stat strip — same five columns (Students/Mean/Median/Std. dev./Range) regardless
    // of scope, so a Pass-list or Fail-list printout looks structurally identical to the full
    // report; only the underlying numbers differ, reflecting whichever group is being shown.
    const statLabels = ['Students','Mean','Median','Std. dev.','Range'];
    const statValues = [
      String(scores.length),
      mean(scores).toFixed(1),
      median(scores).toFixed(1),
      stddev(scores).toFixed(1),
      `${Math.min(...scores)}–${Math.max(...scores)}`
    ];
    const colW = (PAGE_W - 2*MARGIN) / statLabels.length;
    doc.setFont('helvetica','normal');
    statLabels.forEach((lbl,i)=>{
      const x = MARGIN + i*colW;
      doc.setFontSize(8);
      doc.setTextColor(82,96,122);
      doc.text(lbl.toUpperCase(), x, y);
      doc.setFont('times','bold');
      doc.setFontSize(15);
      doc.setTextColor(28,42,63);
      doc.text(statValues[i], x, y + 16);
      doc.setFont('helvetica','normal');
    });
    y += 36;

    // Column definitions: each knows its header label, how to pull its value from a row,
    // and its horizontal alignment — header and body always share the same alignment so
    // headings sit centered directly above their values.
    const ALL_EXAM_COLS = {
      rank:       { header:'Rank',      value:r=>'#'+r.rank,                         halign:'center', width:50 },
      name:       { header:'Name',      value:r=>r.name,                             halign:'left',   width:null },
      score:      { header:'Score',     value:r=>`${r.score}/${r.max}`,              halign:'center', width:75 },
      pctOfMax:   { header:'% of Max',  value:r=>r.pctOfMax.toFixed(1)+'%',          halign:'center', width:80 },
      percentile: { header:'Percentile',value:r=>r.pct.toFixed(decimals),            halign:'center', width:80 },
      grade:      { header:'Grade',     value:r=>gradeFor(r.pctOfMax, grading.bands),halign:'center', width:60 }
    };
    const checkedCols = Array.from(document.querySelectorAll('.examColCheck:checked')).map(el=>el.value);
    let colKeys = Object.keys(ALL_EXAM_COLS).filter(k => k==='rank' || k==='name' || checkedCols.includes(k));
    // Grade only ever appears when the grading feature itself is switched on, regardless of
    // the column checkbox state — it isn't a real column until grading is enabled.
    if(!grading.enabled) colKeys = colKeys.filter(k => k !== 'grade');
    else if(!colKeys.includes('grade')) colKeys.push('grade');
    const cols = colKeys.map(k => ALL_EXAM_COLS[k]);

    const columnStyles = {};
    cols.forEach((c,i) => { if(c.width) columnStyles[i] = { cellWidth:c.width, halign:c.halign }; else columnStyles[i] = { halign:c.halign }; });

    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [cols.map(c=>c.header)],
      body: sorted.map(r => cols.map(c => c.value(r))),
      styles:{ font:'helvetica', fontSize:9.5, textColor:[28,42,63], cellPadding:6, lineColor:[226,221,208], lineWidth:0.5, valign:'middle' },
      headStyles:{ fillColor:[28,42,63], textColor:[255,255,255], fontStyle:'bold', fontSize:8.5, halign:'center' },
      alternateRowStyles:{ fillColor:[251,250,247] },
      columnStyles
    });

    let afterTableY = doc.lastAutoTable.finalY;

    // Optional score-distribution chart, captured from the live on-screen canvas
    if(includeChart){
      afterTableY = drawChartImage(doc, afterTableY, 'distChart', 'Score Distribution');
    }

    drawSignatureBlock(doc, afterTableY, {
      signerName: branding.examSignerName,
      signerTitle: branding.examSignerTitle,
      signatureDataUrl: branding.signatureDataUrl,
      stampDataUrl: branding.stampDataUrl
    });

    finalizeFooters(doc, !proActive());
    const filenameSuffix = scope==='pass' ? '_pass_list' : scope==='fail' ? '_fail_list' : '';
    doc.save(`exam_ranking_report${filenameSuffix}.pdf`);
  }

  /* ---------------- Growth Screening PDF ---------------- */
  function buildGrowthPdf(){
    if(typeof growthEntries === 'undefined' || !growthEntries.length){ alert('Add a measurement first.'); return; }

    const doc = newDoc();
    let y = drawHeader(doc, {
      orgName: branding.growthOrgName || 'CentileIQ',
      detailLines: [
        branding.growthProviderName ? `Provider: ${branding.growthProviderName}` : null,
        branding.growthAddress || null,
        [branding.growthPhone ? `Tel: ${branding.growthPhone}` : null, branding.growthEmail ? `Email: ${branding.growthEmail}` : null].filter(Boolean).join('   ·   ') || null
      ],
      title: 'Growth Screening Report',
      logoDataUrl: branding.logoDataUrl
    });

    // Column definitions: header and body share the same alignment so headings sit
    // centered directly above their values, matching the exam report's pattern.
    const ALL_GROWTH_COLS = {
      name:        { header:'Name',         value:e=>e.name || '—',                                          halign:'left',   width:null },
      sex:         { header:'Sex',          value:e=>e.sex==='boy'?'Boy':'Girl',                              halign:'center', width:42 },
      age:         { header:'Age / Length', value:e=>e.months!=null ? formatAge(e.months) : `${e.lengthCm} cm`, halign:'center', width:70 },
      measurement: { header:'Measurement',  value:e=>INDICATOR_LABEL[e.indicator],                            halign:'left',   width:null },
      value:       { header:'Value',        value:e=>`${e.value} ${VALUE_UNIT[e.indicator]}`,                 halign:'center', width:64 },
      z:           { header:'Z-score',      value:e=>e.z.toFixed(2),                                          halign:'center', width:54 },
      centile:     { header:'Centile',      value:e=>centileBand(e.pct),                                      halign:'center', width:64 },
      flag:        { header:'Flag',         value:e=>e.cls.label,                                             halign:'center', width:64 }
    };
    const checkedGrowthCols = Array.from(document.querySelectorAll('.growthColCheck:checked')).map(el=>el.value);
    const growthColKeys = Object.keys(ALL_GROWTH_COLS).filter(k => k==='name' || checkedGrowthCols.includes(k));
    const growthCols = growthColKeys.map(k => ALL_GROWTH_COLS[k]);
    const flagColIndex = growthColKeys.indexOf('flag');

    const growthColumnStyles = {};
    growthCols.forEach((c,i) => { growthColumnStyles[i] = c.width ? { cellWidth:c.width, halign:c.halign } : { halign:c.halign }; });

    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [growthCols.map(c=>c.header)],
      body: growthEntries.map(e => growthCols.map(c => c.value(e))),
      styles:{ font:'helvetica', fontSize:8.5, textColor:[28,42,63], cellPadding:5.5, lineColor:[226,221,208], lineWidth:0.5, valign:'middle' },
      headStyles:{ fillColor:[28,42,63], textColor:[255,255,255], fontStyle:'bold', fontSize:7.5, halign:'center' },
      alternateRowStyles:{ fillColor:[251,250,247] },
      columnStyles: growthColumnStyles,
      didParseCell: function(data){
        if(flagColIndex>-1 && data.section === 'body' && data.column.index === flagColIndex){
          // Color by the entry's actual severity level (cls.level: 'flag'/'watch'/'normal'),
          // not by matching words in the displayed label — most labels (e.g. "Stunted",
          // "Overweight/Obese") never literally contain the words "flag" or "watch", so
          // text-matching silently failed to color anything but the green/normal case.
          const entry = growthEntries[data.row.index];
          const level = entry?.cls?.level;
          if(level === 'flag') { data.cell.styles.textColor = [181,69,61]; data.cell.styles.fontStyle='bold'; }
          else if(level === 'watch') { data.cell.styles.textColor = [207,122,49]; data.cell.styles.fontStyle='bold'; }
          else { data.cell.styles.textColor = [79,122,69]; }
        }
      }
    });

    let afterTableY = doc.lastAutoTable.finalY + 24;

    // Always-included safety disclaimer — not gated by tier
    const disclaimer = 'Screening tool, not a diagnosis. Percentiles are calculated from WHO Child Growth Standards (0-5y) and WHO Growth Reference (5-19y) median and spread values, sampled at standard checkpoint ages and interpolated between them. For clinical decisions, confirm against official WHO charts or a healthcare provider.';
    const disclaimerWidth = PAGE_W - 2*MARGIN - 20;
    doc.setFont('helvetica','bold');
    doc.setFontSize(8);
    const leadIn = 'Note: ';
    const leadInW = doc.getTextWidth(leadIn);
    doc.setFont('helvetica','normal');
    // Wrap narrow enough that, once "Note: " is prepended to line 1, it still fits the box width
    const boxLines = doc.splitTextToSize(disclaimer, disclaimerWidth - leadInW);
    const lineGap = 11.5;
    const boxH = boxLines.length * lineGap + 18;

    doc.setFillColor(251,236,219);
    doc.setDrawColor(239,211,172);
    doc.setLineWidth(0.75);
    doc.roundedRect(MARGIN, afterTableY, PAGE_W - 2*MARGIN, boxH, 4, 4, 'FD');

    doc.setTextColor(138,83,24);
    boxLines.forEach((line, i) => {
      if(i === 0){
        doc.setFont('helvetica','bold');
        doc.text(leadIn, MARGIN + 10, afterTableY + 15);
        doc.setFont('helvetica','normal');
        doc.text(line, MARGIN + 10 + leadInW, afterTableY + 15);
      } else {
        doc.text(line, MARGIN + 10, afterTableY + 15 + i*lineGap);
      }
    });

    const afterDisclaimerY = afterTableY + boxH;
    drawSignatureBlock(doc, afterDisclaimerY, {
      signerName: branding.growthSignerName,
      signerTitle: branding.growthSignerTitle,
      signatureDataUrl: branding.signatureDataUrl,
      stampDataUrl: branding.stampDataUrl
    });

    finalizeFooters(doc, !proActive());
    doc.save('growth_screening_report.pdf');
  }

  /* ---------------- Pro-tier check ----------------
     Reads the locally-stored license flag set by a successful verifyLicenseKey() call.
     Returning false keeps the free CentileIQ watermark on every PDF footer.
  */
  function proActive(){
    return loadLicenseState().active;
  }

  /* ---------------- Free-tier record cap (15 per tab) ----------------
     Free accounts are capped at 15 students (exam) and 15 entries (growth), counted
     separately per tab. Enforced at the point of entry (button clicks) rather than by
     truncating app.js's own render/state logic, so app.js itself stays untouched.
  */
  const FREE_RECORD_CAP = 15;

  function showUpgradePrompt(message){
    alert(message + '\n\nUpgrade to CentileIQ Pro ($14.99, one-time) for unlimited records.');
    openLicenseModal();
  }

  // Blocks a single-add action outright once the cap is reached. Returns true if the
  // action should be blocked (caller should stop), false if it's safe to proceed.
  function blockIfAtCap(currentCount, label){
    if(proActive()) return false;
    if(currentCount >= FREE_RECORD_CAP){
      showUpgradePrompt(`The free version of CentileIQ is limited to ${FREE_RECORD_CAP} ${label}. You're already at the limit.`);
      return true;
    }
    return false;
  }

  // For bulk-style additions (paste, file import) where many rows arrive at once: returns
  // how many of the incoming rows can actually be accepted without exceeding the cap.
  // Pro accounts get Infinity (no truncation).
  function allowedAdditions(currentCount, incomingCount, label){
    if(proActive()) return incomingCount;
    const room = Math.max(0, FREE_RECORD_CAP - currentCount);
    if(incomingCount > room){
      showUpgradePrompt(`The free version of CentileIQ is limited to ${FREE_RECORD_CAP} ${label}. Only the first ${room} of ${incomingCount} new row(s) were added.`);
    }
    return room;
  }

  /* ---------------- Branding modal ---------------- */
  function openBrandingModal(kind){
    if(!proActive()){
      showUpgradePrompt('Custom report headers (logo, signature, stamp, institution details) are a Pro feature.');
      return;
    }
    const modal = document.getElementById('brandingModal');
    const isExam = kind === 'exam';
    document.getElementById('brandingModalTitle').textContent = isExam ? 'Report header — Exam' : 'Report header — Growth';
    document.getElementById('brandOrgLabel').textContent = isExam ? 'School / Institution name' : 'Clinic / Institution name';
    document.getElementById('brandOrgInput').value = isExam ? branding.examOrgName : branding.growthOrgName;
    document.getElementById('brandPersonLabel').textContent = isExam ? 'Teacher name (optional)' : 'Provider name (optional)';
    document.getElementById('brandPersonInput').value = isExam ? branding.examTeacherName : branding.growthProviderName;
    document.getElementById('brandClassWrap').style.display = isExam ? 'block' : 'none';
    document.getElementById('brandClassInput').value = branding.examClassName || '';
    document.getElementById('brandAddressInput').value = isExam ? (branding.examAddress || '') : (branding.growthAddress || '');
    document.getElementById('brandPhoneInput').value = isExam ? (branding.examPhone || '') : (branding.growthPhone || '');
    document.getElementById('brandEmailInput').value = isExam ? (branding.examEmail || '') : (branding.growthEmail || '');
    document.getElementById('brandSignerNameLabel').textContent = isExam ? 'Approved by — name (optional)' : 'Signed by — name (optional)';
    document.getElementById('brandSignerNameInput').value = isExam ? (branding.examSignerName || '') : (branding.growthSignerName || '');
    document.getElementById('brandSignerTitleInput').value = isExam ? (branding.examSignerTitle || '') : (branding.growthSignerTitle || '');
    modal.dataset.kind = kind;
    modal.style.display = 'flex';
  }

  function closeBrandingModal(){
    document.getElementById('brandingModal').style.display = 'none';
  }

  function saveBrandingFromModal(){
    const modal = document.getElementById('brandingModal');
    const kind = modal.dataset.kind;
    const org = document.getElementById('brandOrgInput').value.trim();
    const person = document.getElementById('brandPersonInput').value.trim();
    const address = document.getElementById('brandAddressInput').value.trim();
    const phone = document.getElementById('brandPhoneInput').value.trim();
    const email = document.getElementById('brandEmailInput').value.trim();
    const signerName = document.getElementById('brandSignerNameInput').value.trim();
    const signerTitle = document.getElementById('brandSignerTitleInput').value.trim();
    if(kind === 'exam'){
      branding.examOrgName = org;
      branding.examTeacherName = person;
      branding.examClassName = document.getElementById('brandClassInput').value.trim();
      branding.examAddress = address;
      branding.examPhone = phone;
      branding.examEmail = email;
      branding.examSignerName = signerName;
      branding.examSignerTitle = signerTitle;
    } else {
      branding.growthOrgName = org;
      branding.growthProviderName = person;
      branding.growthAddress = address;
      branding.growthPhone = phone;
      branding.growthEmail = email;
      branding.growthSignerName = signerName;
      branding.growthSignerTitle = signerTitle;
    }
    saveBranding(branding);
    closeBrandingModal();
  }

  function handleImageUpload(file, brandingKey, previewElId){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      branding[brandingKey] = e.target.result;
      saveBranding(branding);
      const preview = document.getElementById(previewElId);
      if(preview){ preview.src = e.target.result; preview.style.display = 'inline-block'; }
    };
    reader.readAsDataURL(file);
  }

  /* ---------------- Wire up buttons once DOM is ready ---------------- */
  /* ---------------- Pro license modal UI ---------------- */
  function refreshProBadge(){
    const btn = document.getElementById('proStatusBtn');
    const pill = document.getElementById('proPillBtn');
    const active = proActive();
    // Drives the print-only watermark CSS rule (body:not(.pro-active) .print-watermark),
    // kept in sync here alongside the badge since both reflect the same license state.
    document.body.classList.toggle('pro-active', active);

    // Active: show the small "PRO" pill attached to the app name, hide the unlock button.
    // Inactive: show the "Unlock Pro" call-to-action, hide the pill entirely.
    if(btn) btn.style.display = active ? 'none' : 'inline-flex';
    if(pill) pill.style.display = active ? 'inline-flex' : 'none';
  }

  function openLicenseModal(){
    const modal = document.getElementById('licenseModal');
    if(!modal) return;
    const state = loadLicenseState();
    const activeView = document.getElementById('licenseActiveView');
    const entryView = document.getElementById('licenseEntryView');
    const emailLine = document.getElementById('licenseEmailLine');
    const statusMsg = document.getElementById('licenseStatusMsg');

    if(state.active){
      activeView.style.display = 'block';
      entryView.style.display = 'none';
      emailLine.textContent = state.email ? ` (${state.email})` : '';
    } else {
      activeView.style.display = 'none';
      entryView.style.display = 'block';
      if(statusMsg) statusMsg.textContent = '';
      const keyInput = document.getElementById('licenseKeyInput');
      if(keyInput) keyInput.value = '';
    }
    modal.style.display = 'flex';
  }

  function closeLicenseModal(){
    const modal = document.getElementById('licenseModal');
    if(modal) modal.style.display = 'none';
  }

  async function handleVerifyClick(){
    const keyInput = document.getElementById('licenseKeyInput');
    const statusMsg = document.getElementById('licenseStatusMsg');
    const verifyBtn = document.getElementById('licenseVerifyBtn');
    const key = keyInput?.value.trim();

    if(!key){
      if(statusMsg){ statusMsg.textContent = 'Enter your license key first.'; statusMsg.style.color = 'var(--rose)'; }
      return;
    }

    if(verifyBtn){ verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying…'; }
    if(statusMsg){ statusMsg.textContent = ''; }

    const result = await verifyLicenseKey(key);

    if(verifyBtn){ verifyBtn.disabled = false; verifyBtn.textContent = 'Verify & Unlock'; }

    if(result.valid){
      setLicenseActive(key, result.customer_email);
      refreshProBadge();
      // Refresh anything on screen that depends on Pro status (PDF watermark only takes
      // effect at the next export, so no immediate re-render is needed beyond the badge).
      openLicenseModal(); // re-opens into the "active" view now that state has changed
    } else {
      if(statusMsg){
        statusMsg.textContent = result.error || 'That license key could not be verified.';
        statusMsg.style.color = 'var(--rose)';
      }
    }
  }

  function handleDeactivateClick(){
    if(!confirm('Remove the Pro license from this browser? You can re-enter your key anytime to unlock it again.')) return;
    clearLicense();
    refreshProBadge();
    openLicenseModal(); // re-opens into the "entry" view now that state has changed
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pdfExamBtn')?.addEventListener('click', buildExamPdf);
    document.getElementById('pdfGrowthBtn')?.addEventListener('click', buildGrowthPdf);
    document.getElementById('brandExamBtn')?.addEventListener('click', ()=>openBrandingModal('exam'));
    document.getElementById('brandGrowthBtn')?.addEventListener('click', ()=>openBrandingModal('growth'));
    document.getElementById('brandingSaveBtn')?.addEventListener('click', saveBrandingFromModal);
    document.getElementById('brandingCancelBtn')?.addEventListener('click', closeBrandingModal);
    document.getElementById('brandLogoInput')?.addEventListener('change', e => handleImageUpload(e.target.files[0], 'logoDataUrl', 'brandLogoPreview'));
    document.getElementById('brandSignatureInput')?.addEventListener('change', e => handleImageUpload(e.target.files[0], 'signatureDataUrl', 'brandSignaturePreview'));
    document.getElementById('brandStampInput')?.addEventListener('change', e => handleImageUpload(e.target.files[0], 'stampDataUrl', 'brandStampPreview'));

    const cutoffInput = document.getElementById('examCutoff');
    const scopeSelect = document.getElementById('examPdfScope');
    const cutoffHint = document.getElementById('cutoffHint');
    function syncCutoffState(){
      if(!cutoffInput || !scopeSelect || !cutoffHint) return;
      const has = cutoffInput.value.trim() !== '' && !isNaN(parseFloat(cutoffInput.value));
      scopeSelect.disabled = !has;
      if(!has){
        scopeSelect.value = 'all';
        cutoffHint.textContent = 'Set a cut-off to enable Pass/Fail list scopes.';
      } else {
        cutoffHint.textContent = `Pass = score ≥ ${parseFloat(cutoffInput.value)}.`;
      }
      renderScopePreview();
    }
    cutoffInput?.addEventListener('input', syncCutoffState);
    scopeSelect?.addEventListener('change', renderScopePreview);
    syncCutoffState();

    // Keep the Pass/Fail preview and the on-screen Grade column in sync whenever the roster
    // itself changes (add/remove/import), not just when their own controls change. renderExam
    // is defined in app.js, loaded before this file, and is a plain top-level function — safe
    // to wrap without editing app.js.
    if(typeof renderExam === 'function'){
      const originalRenderExam = renderExam;
      renderExam = function(){
        originalRenderExam.apply(this, arguments);
        renderScopePreview();
        renderGradeColumn();
      };
    }

    document.getElementById('examColsToggleBtn')?.addEventListener('click', () => {
      const panel = document.getElementById('examColsPanel');
      if(panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('growthColsToggleBtn')?.addEventListener('click', () => {
      const panel = document.getElementById('growthColsPanel');
      if(panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    [['logoDataUrl','brandLogoPreview'], ['signatureDataUrl','brandSignaturePreview'], ['stampDataUrl','brandStampPreview']].forEach(([key, elId])=>{
      if(branding[key]){
        const preview = document.getElementById(elId);
        if(preview){ preview.src = branding[key]; preview.style.display = 'inline-block'; }
      }
    });

    const gradingEnabledEl = document.getElementById('examGradingEnabled');
    const gradingPanel = document.getElementById('gradingPanel');
    const gradingPresetEl = document.getElementById('gradingPreset');
    const editGradingBtn = document.getElementById('editGradingBtn');

    // Single source of truth for whether the grading editor panel is visibly expanded.
    // The "Edit grading" link only ever shows when grading is ON but the panel is collapsed —
    // there's no reason to show it while the panel is already open, or while grading is off.
    function setGradingPanelOpen(open){
      if(!gradingPanel) return;
      gradingPanel.style.display = open ? 'block' : 'none';
      if(editGradingBtn) editGradingBtn.style.display = (grading.enabled && !open) ? 'inline-flex' : 'none';
    }

    if(gradingEnabledEl){
      gradingEnabledEl.checked = grading.enabled;
      setGradingPanelOpen(grading.enabled);
      gradingEnabledEl.addEventListener('change', () => {
        grading.enabled = gradingEnabledEl.checked;
        saveGrading(grading);
        // Turning grading on opens the editor so the user can pick/confirm a scheme;
        // turning it off hides the editor entirely (nothing left to collapse).
        setGradingPanelOpen(grading.enabled);
        renderGradeColumn();
      });
    }

    document.getElementById('doneGradingBtn')?.addEventListener('click', () => {
      setGradingPanelOpen(false);
    });
    editGradingBtn?.addEventListener('click', () => {
      setGradingPanelOpen(true);
    });

    document.getElementById('resetGradingBtn')?.addEventListener('click', () => {
      if(!confirm('Reset grading to the default WASSCE scheme and turn grading off? Any custom bands you\'ve set up will be lost.')) return;
      grading = { enabled:false, preset:'wassce', bands: GRADE_PRESETS.wassce.map(b=>({...b})) };
      saveGrading(grading);
      if(gradingEnabledEl) gradingEnabledEl.checked = false;
      renderGradeBandsList();
      renderGradeColumn();
      setGradingPanelOpen(false);
    });

    gradingPresetEl?.addEventListener('change', () => {
      grading.preset = gradingPresetEl.value;
      // Switching to a built-in preset resets bands to that preset's defaults. Switching to
      // Custom starts from whatever the currently-active preset's bands were, as a sane
      // starting point the user can then edit rather than starting from a blank list.
      grading.bands = (grading.preset === 'custom')
        ? grading.bands.map(b=>({...b}))
        : GRADE_PRESETS[grading.preset].map(b=>({...b}));
      saveGrading(grading);
      renderGradeBandsList();
      renderGradeColumn();
    });

    document.getElementById('addGradeBandBtn')?.addEventListener('click', () => {
      grading.bands.push({ label:'New', min:0 });
      saveGrading(grading);
      renderGradeBandsList();
      renderGradeColumn();
    });

    renderGradeBandsList();
    renderGradeColumn();

    document.getElementById('proStatusBtn')?.addEventListener('click', openLicenseModal);
    document.getElementById('proPillBtn')?.addEventListener('click', openLicenseModal);
    document.getElementById('licenseCancelBtn')?.addEventListener('click', closeLicenseModal);
    document.getElementById('licenseCloseBtn')?.addEventListener('click', closeLicenseModal);
    document.getElementById('licenseVerifyBtn')?.addEventListener('click', handleVerifyClick);
    document.getElementById('licenseDeactivateBtn')?.addEventListener('click', handleDeactivateClick);
    document.getElementById('licenseKeyInput')?.addEventListener('keydown', e => {
      if(e.key === 'Enter') handleVerifyClick();
    });
    refreshProBadge();

    // ---- Free-tier record cap enforcement ----
    // These listeners run in the CAPTURING phase, i.e. before app.js's own (bubbling-phase)
    // click handlers fire, so a blocked action never reaches app.js's logic at all. For
    // single-record adds, the click is stopped outright once at the cap. For bulk-style
    // additions (paste, file import), the incoming data is pre-truncated so app.js only
    // ever sees the rows that are actually allowed through.

    document.getElementById('addStudentBtn')?.addEventListener('click', function(e){
      if(typeof students !== 'undefined' && blockIfAtCap(students.length, 'students')){
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }, true);

    document.getElementById('addGrowthBtn')?.addEventListener('click', function(e){
      if(typeof growthEntries !== 'undefined' && blockIfAtCap(growthEntries.length, 'growth entries')){
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }, true);

    document.getElementById('bulkAddBtn')?.addEventListener('click', function(e){
      if(typeof students === 'undefined') return;
      const textarea = document.getElementById('bulkPasteArea');
      if(!textarea) return;
      const lines = textarea.value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      const allowed = allowedAdditions(students.length, lines.length, 'students');
      if(allowed < lines.length){
        // Truncate the textarea content to only the rows that fit, so app.js's own
        // bulkAddBtn handler (which reads this same textarea) only processes those.
        textarea.value = lines.slice(0, allowed).join('\n');
        if(allowed === 0){
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      }
    }, true);

    document.getElementById('importBtn')?.addEventListener('click', function(e){
      if(typeof students === 'undefined' || typeof parsedRows === 'undefined' || !parsedRows) return;
      // File import REPLACES the roster in app.js (students = fresh), rather than appending,
      // so the cap applies to the size of the imported file itself, not existing + incoming.
      const allowed = allowedAdditions(0, parsedRows.length, 'students');
      if(allowed < parsedRows.length){
        parsedRows = parsedRows.slice(0, allowed);
        if(allowed === 0){
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      }
    }, true);
  });

})();
