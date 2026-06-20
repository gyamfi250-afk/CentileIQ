/* ======================================================================
   CENTILEIQ — PDF REPORTS
   Builds two distinct, designed report layouts using jsPDF + autoTable:
     1) Exam Rankings  -> institutional / letterhead style
     2) Growth Screen   -> clinical report style
   Both pull live data from the existing app.js state (students / growthEntries)
   so they always reflect exactly what's on screen.
====================================================================== */

(function(){

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

  /* ---------------- Shared PDF helpers ---------------- */
  const PAGE_W = 595.28; // A4 pt, portrait
  const MARGIN = 40;

  function newDoc(){
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit:'pt', format:'a4' });
  }

  function drawHeader(doc, opts){
    // opts: { orgName, detailLines: string[], title, logoDataUrl }
    const lines = (opts.detailLines || []).filter(Boolean);
    const lineCount = Math.max(lines.length, 1); // at least 1 line of vertical space reserved
    const blockTop = MARGIN;
    const nameBaselineY = blockTop + 14;
    const firstDetailY = nameBaselineY + 15;
    const blockBottom = lines.length ? (firstDetailY + (lines.length-1)*12) : nameBaselineY;

    // Logo vertically centered against the full name+details text block
    if(opts.logoDataUrl){
      const logoSize = 36;
      const blockCenterY = (nameBaselineY - 9 + blockBottom + 3) / 2;
      try{ doc.addImage(opts.logoDataUrl, 'PNG', MARGIN, blockCenterY - logoSize/2, logoSize, logoSize); }catch(e){}
    }
    const textX = opts.logoDataUrl ? MARGIN + 46 : MARGIN;

    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.setTextColor(28,42,63);
    doc.text(opts.orgName || 'CentileIQ', textX, nameBaselineY);

    doc.setFont('helvetica','normal');
    doc.setFontSize(9);
    doc.setTextColor(82,96,122);
    lines.forEach((line, i) => {
      doc.text(line, textX, firstDetailY + i*12);
    });

    // Date sits at the same baseline as the org name, right-aligned — stays anchored to the
    // top of the block regardless of how many detail lines follow, rather than floating
    doc.setFontSize(8.5);
    doc.setTextColor(82,96,122);
    const dateStr = 'Generated ' + new Date().toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
    doc.text(dateStr, PAGE_W - MARGIN, nameBaselineY, { align:'right' });

    let y = Math.max(blockBottom + 16, blockTop + 44);
    doc.setDrawColor(226,221,208);
    doc.setLineWidth(1);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 24;

    doc.setFont('times','bold');
    doc.setFontSize(16);
    doc.setTextColor(28,42,63);
    doc.text(opts.title, PAGE_W / 2, y, { align:'center' });
    y += 10;

    if(opts.subtitle){
      y += 14;
      doc.setFont('helvetica','bold');
      doc.setFontSize(10);
      doc.setTextColor(28,125,118); // teal accent — distinguishes the scope label from the main title
      doc.text(opts.subtitle, PAGE_W / 2, y, { align:'center' });
    }

    return y + 14;
  }

  function drawFooter(doc, pageNum, totalPages, watermark){
    const h = doc.internal.pageSize.getHeight();
    doc.setDrawColor(226,221,208);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, h - 40, PAGE_W - MARGIN, h - 40);
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.setTextColor(154,163,181);
    if(watermark){
      doc.text('Generated with CentileIQ — centileiq app', MARGIN, h - 26);
    }
    doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, h - 26, { align:'right' });
  }

  function finalizeFooters(doc, watermark){
    const total = doc.internal.getNumberOfPages();
    for(let i=1;i<=total;i++){
      doc.setPage(i);
      drawFooter(doc, i, total, watermark);
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

  /* ---------------- Exam Rankings PDF ---------------- */
  function buildExamPdf(){
    if(typeof students === 'undefined' || !students.length){ alert('Add students first.'); return; }
    if(typeof lastExamRows === 'undefined' || !lastExamRows.length){ alert('Nothing to export yet.'); return; }

    const decimalsEl = document.getElementById('examPdfDecimals');
    const decimals = decimalsEl ? parseInt(decimalsEl.value, 10) : 1;
    const includeChartChecked = document.getElementById('examPdfIncludeChart')?.checked ?? true;

    const cutoffEl = document.getElementById('examCutoff');
    const cutoffRaw = cutoffEl ? cutoffEl.value.trim() : '';
    const hasCutoff = cutoffRaw !== '' && !isNaN(parseFloat(cutoffRaw));
    const cutoff = hasCutoff ? parseFloat(cutoffRaw) : null;
    const scope = hasCutoff ? (document.getElementById('examPdfScope')?.value || 'all') : 'all';

    const doc = newDoc();
    const sortedAll = [...lastExamRows].sort((a,b)=>a.rank-b.rank);

    // Apply Pass/Fail scope filtering. Pass = score >= cutoff (per the agreed boundary rule).
    let sorted = sortedAll;
    let scopeLabel = null;
    if(scope === 'pass'){
      sorted = sortedAll.filter(r => r.score >= cutoff);
      scopeLabel = `Pass List — score ≥ ${cutoff}`;
    } else if(scope === 'fail'){
      sorted = sortedAll.filter(r => r.score < cutoff);
      scopeLabel = `Fail List — score < ${cutoff}`;
    }

    if(scope !== 'all' && !sorted.length){
      alert(scope === 'pass' ? 'No students meet the pass mark — nothing to print.' : 'No students are below the pass mark — nothing to print.');
      return;
    }

    // The on-screen histogram reflects the WHOLE class, not a filtered subset. Showing it
    // unmodified under a "Pass List" or "Fail List" heading would misrepresent the data, so
    // the chart is only ever included when printing the full, unscoped list.
    const includeChart = includeChartChecked && scope === 'all';

    const scores = sorted.map(r=>r.score);

    let y = drawHeader(doc, {
      orgName: branding.examOrgName || 'CentileIQ',
      detailLines: [
        branding.examClassName ? `Class: ${branding.examClassName}` : null,
        branding.examTeacherName ? `Teacher: ${branding.examTeacherName}` : null,
        branding.examAddress || null,
        [branding.examPhone, branding.examEmail].filter(Boolean).join('  ·  ') || null
      ],
      title: 'Examination Ranking Report',
      subtitle: scopeLabel,
      logoDataUrl: branding.logoDataUrl
    });

    // Summary stat strip — describes whichever set (all/pass/fail) is actually being printed
    const statLabels = scope==='all' ? ['Students','Mean','Median','Std. dev.','Range'] : ['Students','Mean','Median','Std. dev.','Cut-off'];
    const statValues = [
      String(scores.length),
      mean(scores).toFixed(1),
      median(scores).toFixed(1),
      stddev(scores).toFixed(1),
      scope==='all' ? `${Math.min(...scores)}–${Math.max(...scores)}` : String(cutoff)
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
      percentile: { header:'Percentile',value:r=>r.pct.toFixed(decimals),            halign:'center', width:80 }
    };
    const checkedCols = Array.from(document.querySelectorAll('.examColCheck:checked')).map(el=>el.value);
    const colKeys = Object.keys(ALL_EXAM_COLS).filter(k => k==='rank' || k==='name' || checkedCols.includes(k));
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
        [branding.growthPhone, branding.growthEmail].filter(Boolean).join('  ·  ') || null
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
          const flag = data.cell.raw;
          if(/flag/i.test(flag)) { data.cell.styles.textColor = [181,69,61]; data.cell.styles.fontStyle='bold'; }
          else if(/watch/i.test(flag)) { data.cell.styles.textColor = [207,122,49]; data.cell.styles.fontStyle='bold'; }
          else { data.cell.styles.textColor = [79,122,69]; }
        }
      }
    });

    let afterTableY = doc.lastAutoTable.finalY + 24;

    // Always-included safety disclaimer — not gated by tier
    const disclaimer = 'Screening tool, not a diagnosis. Percentiles are calculated from WHO Child Growth Standards (0-5y) and WHO Growth Reference (5-19y) median and spread values, sampled at standard checkpoint ages and interpolated between them. For clinical decisions, confirm against official WHO charts or a healthcare provider.';
    doc.setFillColor(251,236,219);
    const disclaimerWidth = PAGE_W - 2*MARGIN - 20;
    const boxLines = doc.splitTextToSize(disclaimer, disclaimerWidth);
    const boxH = boxLines.length * 11 + 16;
    doc.roundedRect(MARGIN, afterTableY, PAGE_W - 2*MARGIN, boxH, 4, 4, 'F');
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.setTextColor(138,83,24);
    doc.text(boxLines, MARGIN + 10, afterTableY + 14, { align:'justify', maxWidth: disclaimerWidth });

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

  /* ---------------- Pro-tier stub ----------------
     Wire this up to your license-check logic later (Gumroad/LemonSqueezy key validation).
     Returning false keeps the free CentileIQ watermark on every PDF footer.
  */
  function proActive(){
    return localStorage.getItem('centileiq_pro') === 'true';
  }

  /* ---------------- Branding modal ---------------- */
  function openBrandingModal(kind){
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
    }
    cutoffInput?.addEventListener('input', syncCutoffState);
    syncCutoffState();

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
  });

})();
