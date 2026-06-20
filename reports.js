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
        examOrgName: '',
        examTeacherName: '',
        examClassName: '',
        growthOrgName: '',
        growthProviderName: '',
        logoDataUrl: null
      };
    }catch(e){
      return { examOrgName:'', examTeacherName:'', examClassName:'', growthOrgName:'', growthProviderName:'', logoDataUrl:null };
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
    // opts: { orgName, subLine1, subLine2, title, logoDataUrl }
    let y = MARGIN;
    if(opts.logoDataUrl){
      try{ doc.addImage(opts.logoDataUrl, 'PNG', MARGIN, y - 6, 36, 36); }catch(e){}
    }
    const textX = opts.logoDataUrl ? MARGIN + 46 : MARGIN;

    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.setTextColor(28,42,63);
    doc.text(opts.orgName || 'CentileIQ', textX, y + 8);

    doc.setFont('helvetica','normal');
    doc.setFontSize(9);
    doc.setTextColor(82,96,122);
    if(opts.subLine1) doc.text(opts.subLine1, textX, y + 21);
    if(opts.subLine2) doc.text(opts.subLine2, textX, y + 33);

    // Right-aligned date
    doc.setFontSize(9);
    doc.setTextColor(82,96,122);
    const dateStr = 'Generated ' + new Date().toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
    doc.text(dateStr, PAGE_W - MARGIN, y + 8, { align:'right' });

    y += 44;
    doc.setDrawColor(226,221,208);
    doc.setLineWidth(1);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 22;

    doc.setFont('times','bold');
    doc.setFontSize(16);
    doc.setTextColor(28,42,63);
    doc.text(opts.title, MARGIN, y);
    y += 10;

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

  /* ---------------- Exam Rankings PDF ---------------- */
  function buildExamPdf(){
    if(!window.students || !students.length){ alert('Add students first.'); return; }
    if(!window.lastExamRows || !lastExamRows.length){ alert('Nothing to export yet.'); return; }

    const doc = newDoc();
    const scores = students.map(s=>s.score);
    const sorted = [...lastExamRows].sort((a,b)=>a.rank-b.rank);

    let y = drawHeader(doc, {
      orgName: branding.examOrgName || 'CentileIQ',
      subLine1: branding.examClassName ? `Class: ${branding.examClassName}` : null,
      subLine2: branding.examTeacherName ? `Teacher: ${branding.examTeacherName}` : null,
      title: 'Examination Ranking Report',
      logoDataUrl: branding.logoDataUrl
    });

    // Summary stat strip
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

    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Rank','Name','Score','% of Max','Percentile']],
      body: sorted.map(r=>[
        '#'+r.rank, r.name, `${r.score}/${r.max}`, r.pctOfMax.toFixed(1)+'%', r.pct.toFixed(1)
      ]),
      styles:{ font:'helvetica', fontSize:9.5, textColor:[28,42,63], cellPadding:6, lineColor:[226,221,208], lineWidth:0.5 },
      headStyles:{ fillColor:[28,42,63], textColor:[255,255,255], fontStyle:'bold', fontSize:8.5 },
      alternateRowStyles:{ fillColor:[251,250,247] },
      columnStyles:{
        0:{ cellWidth:50 }, 2:{ halign:'right', cellWidth:70 },
        3:{ halign:'right', cellWidth:80 }, 4:{ halign:'right', cellWidth:80 }
      }
    });

    finalizeFooters(doc, !proActive());
    doc.save('exam_ranking_report.pdf');
  }

  /* ---------------- Growth Screening PDF ---------------- */
  function buildGrowthPdf(){
    if(!window.growthEntries || !growthEntries.length){ alert('Add a measurement first.'); return; }

    const doc = newDoc();
    let y = drawHeader(doc, {
      orgName: branding.growthOrgName || 'CentileIQ',
      subLine1: branding.growthProviderName ? `Provider: ${branding.growthProviderName}` : null,
      subLine2: null,
      title: 'Growth Screening Report',
      logoDataUrl: branding.logoDataUrl
    });

    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Name','Sex','Age / Length','Measurement','Value','Z-score','Centile','Flag']],
      body: growthEntries.map(e=>{
        const ageOrLength = e.months!=null ? formatAge(e.months) : `${e.lengthCm} cm`;
        return [
          e.name || '—',
          e.sex==='boy'?'Boy':'Girl',
          ageOrLength,
          INDICATOR_LABEL[e.indicator],
          `${e.value} ${VALUE_UNIT[e.indicator]}`,
          e.z.toFixed(2),
          centileBand(e.pct),
          e.cls.label
        ];
      }),
      styles:{ font:'helvetica', fontSize:8.5, textColor:[28,42,63], cellPadding:5.5, lineColor:[226,221,208], lineWidth:0.5 },
      headStyles:{ fillColor:[28,42,63], textColor:[255,255,255], fontStyle:'bold', fontSize:7.5 },
      alternateRowStyles:{ fillColor:[251,250,247] },
      didParseCell: function(data){
        if(data.section === 'body' && data.column.index === 7){
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
    const boxLines = doc.splitTextToSize(disclaimer, PAGE_W - 2*MARGIN - 20);
    const boxH = boxLines.length * 11 + 16;
    doc.roundedRect(MARGIN, afterTableY, PAGE_W - 2*MARGIN, boxH, 4, 4, 'F');
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.setTextColor(138,83,24);
    doc.text(boxLines, MARGIN + 10, afterTableY + 14);

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
    if(kind === 'exam'){
      branding.examOrgName = org;
      branding.examTeacherName = person;
      branding.examClassName = document.getElementById('brandClassInput').value.trim();
    } else {
      branding.growthOrgName = org;
      branding.growthProviderName = person;
    }
    saveBranding(branding);
    closeBrandingModal();
  }

  function handleLogoUpload(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      branding.logoDataUrl = e.target.result;
      saveBranding(branding);
      const preview = document.getElementById('brandLogoPreview');
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
    document.getElementById('brandLogoInput')?.addEventListener('change', e => handleLogoUpload(e.target.files[0]));

    if(branding.logoDataUrl){
      const preview = document.getElementById('brandLogoPreview');
      if(preview){ preview.src = branding.logoDataUrl; preview.style.display = 'inline-block'; }
    }
  });

})();
