/* ======================================================================
   PERSISTENCE & STATE
====================================================================== */
let students = [];      // {name, score, max}
let growthEntries = []; // {name, sex, indicator, months, lengthCm, value, z, pct, cls}

function saveData() {
  localStorage.setItem('centileiq_students', JSON.stringify(students));
  localStorage.setItem('centileiq_growth', JSON.stringify(growthEntries));
}

function loadData() {
  const savedStudents = localStorage.getItem('centileiq_students');
  const savedGrowth = localStorage.getItem('centileiq_growth');
  if (savedStudents) students = JSON.parse(savedStudents);
  if (savedGrowth) growthEntries = JSON.parse(savedGrowth);
}

/* ======================================================================
   PAGE LOADER
====================================================================== */
(function(){
  const fill = document.getElementById('loaderFill');
  const statusEl = document.getElementById('loaderStatus');
  const overlay = document.getElementById('pageLoader');
  let pct = 4, finished = false;
  const tick = setInterval(()=>{
    pct = Math.min(92, pct + Math.random()*18);
    if(fill) fill.style.width = pct + '%';
  }, 160);
  function finish(){
    if(finished) return;
    finished = true;
    clearInterval(tick);
    if(fill) fill.style.width = '100%';
    if(statusEl) statusEl.textContent = 'Ready';
    setTimeout(()=> overlay.classList.add('hidden'), 300);
  }
  if(document.readyState === 'complete'){ finish(); }
  else { window.addEventListener('load', finish); }
  setTimeout(finish, 4000); // safety fallback
})();

/* ======================================================================
   TAB SWITCHING
====================================================================== */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
  });
});

/* ======================================================================
   SHARED HELPERS
====================================================================== */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function csvEscape(val){
  val = String(val ?? '');
  if(/[",\n]/.test(val)) return '"' + val.replace(/"/g,'""') + '"';
  return val;
}
function downloadCSV(filename, rows, headers){
  if(!rows.length) return;
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => csvEscape(r[h])).join(',')));
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function mean(arr){return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;}
function stddev(arr){
  if (!arr.length) return 0;
  const m=mean(arr);
  return Math.sqrt(mean(arr.map(x=>(x-m)**2)));
}
function median(arr){
  if (!arr.length) return 0;
  const s=[...arr].sort((a,b)=>a-b);
  const n=s.length;
  return n%2? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2;
}

/* ======================================================================
   EXAM RANKINGS
====================================================================== */
let parsedRows = null;
let chartInstance = null;
let lastExamRows = [];
let examSort = {key:'rank', dir:'asc'};
let examSearchTerm = '';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

if (dropzone) {
  dropzone.addEventListener('click', ()=>fileInput.click());
  ['dragover','dragenter'].forEach(ev=>dropzone.addEventListener(ev, e=>{e.preventDefault(); dropzone.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>dropzone.addEventListener(ev, e=>{e.preventDefault(); dropzone.classList.remove('drag');}));
  dropzone.addEventListener('drop', e=>{
    if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
}

if (fileInput) {
  fileInput.addEventListener('change', e=>{
    if(e.target.files.length) handleFile(e.target.files[0]);
  });
}

function handleFile(file){
  const name = file.name.toLowerCase();
  if(name.endsWith('.csv')){
    Papa.parse(file, {
      header:true, skipEmptyLines:true,
      complete: res => onParsed(res.data, res.meta.fields)
    });
  } else if(name.endsWith('.xlsx') || name.endsWith('.xls')){
    const reader = new FileReader();
    reader.onload = e=>{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, {defval:''});
      const fields = json.length ? Object.keys(json[0]) : [];
      onParsed(json, fields);
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert('Please upload a CSV or Excel (.xlsx/.xls) file.');
  }
  if (fileInput) fileInput.value = '';
}

function onParsed(rows, fields){
  if(!rows || !rows.length || !fields || !fields.length){
    alert('Could not find any rows/columns in that file. Please check the format.');
    return;
  }
  parsedRows = rows;
  const colName = document.getElementById('colName');
  const colScore = document.getElementById('colScore');
  colName.innerHTML = ''; colScore.innerHTML = '';
  fields.forEach(f=>{
    colName.innerHTML += `<option value="${f}">${f}</option>`;
    colScore.innerHTML += `<option value="${f}">${f}</option>`;
  });
  const guessName = fields.find(f=>/name|student|pupil/i.test(f)) || fields[0];
  const guessScore = fields.find(f=>/score|mark|grade|result|percent/i.test(f)) || fields[fields.length-1];
  colName.value = guessName;
  colScore.value = guessScore;
  document.getElementById('uploadConfig').style.display = 'block';
}

document.getElementById('importBtn')?.addEventListener('click', ()=>{
  if(!parsedRows) return;
  const nameCol = document.getElementById('colName').value;
  const scoreCol = document.getElementById('colScore').value;
  const maxScore = parseFloat(document.getElementById('maxScore').value) || 100;
  const hadExisting = students.length > 0;
  const fresh = [];
  parsedRows.forEach(r=>{
    const nm = (r[nameCol] ?? '').toString().trim();
    const sc = parseFloat(r[scoreCol]);
    if(nm && !isNaN(sc)) fresh.push({name:nm, score:sc, max:maxScore});
  });
  if(fresh.length === 0){
    alert('No valid rows were imported — check that the score column contains numbers. Your existing roster is unchanged.');
    return;
  }
  students = fresh;
  saveData();
  parsedRows = null;
  document.getElementById('uploadConfig').style.display = 'none';
  renderExam();
  if(hadExisting) alert(`Loaded ${fresh.length} student(s) from the new file — the previous roster was cleared.`);
});

document.getElementById('addStudentBtn')?.addEventListener('click', ()=>{
  const nameEl = document.getElementById('manualName');
  const scoreEl = document.getElementById('manualScore');
  const nm = nameEl.value.trim();
  const sc = parseFloat(scoreEl.value);
  if(!nm){ nameEl.focus(); return; }
  if(isNaN(sc)){ scoreEl.focus(); return; }
  students.push({name:nm, score:sc, max:100});
  saveData();
  nameEl.value=''; scoreEl.value='';
  nameEl.focus();
  renderExam();
});

document.getElementById('bulkToggleBtn')?.addEventListener('click', ()=>{
  const wrap = document.getElementById('bulkPasteWrap');
  const btn = document.getElementById('bulkToggleBtn');
  const showing = wrap.style.display !== 'none';
  wrap.style.display = showing ? 'none' : 'block';
  btn.textContent = showing ? '+ Paste multiple students at once' : '− Hide paste box';
});

function parseBulkPasteLine(line){
  let parts;
  if(line.includes('\t')) parts = line.split('\t');
  else if(line.includes(',')) parts = line.split(',');
  else parts = line.split(/\s{2,}/);
  if(parts.length < 2) return null;
  const name = parts[0].trim();
  const score = parseFloat(parts[parts.length-1]);
  if(!name || isNaN(score)) return null;
  return {name, score};
}

document.getElementById('bulkAddBtn')?.addEventListener('click', ()=>{
  const text = document.getElementById('bulkPasteArea').value;
  const maxScore = parseFloat(document.getElementById('bulkMaxScore').value) || 100;
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let added = 0, skipped = 0;
  lines.forEach(line=>{
    const row = parseBulkPasteLine(line);
    if(row){ students.push({name:row.name, score:row.score, max:maxScore}); added++; }
    else skipped++;
  });
  saveData();
  document.getElementById('bulkPasteArea').value = '';
  renderExam();
  if(added===0) alert('No valid "name, score" rows found — separate each with a comma, tab, or a couple of spaces, one student per line.');
  else if(skipped>0) alert(`Added ${added} student(s). Skipped ${skipped} line(s) that didn't look like "name, score".`);
});

function percentileRank(scores, score){
  const below = scores.filter(s=>s<score).length;
  const equal = scores.filter(s=>s===score).length;
  return ((below + 0.5*equal) / scores.length) * 100;
}

function competitionRanks(scores){
  const sorted = [...scores].sort((a,b)=>b-a);
  return scores.map(s=> sorted.indexOf(s) + 1);
}

const SORT_LABELS = {rank:'Rank', name:'Name', score:'Score', pctOfMax:'% of max', pct:'Percentile'};
function updateSortHeaders(){
  document.querySelectorAll('#examTable thead th.sortable').forEach(th=>{
    const key = th.dataset.sort;
    let label = SORT_LABELS[key];
    if(examSort.key===key) label += examSort.dir==='asc' ? ' ▲' : ' ▼';
    th.textContent = label;
  });
}
document.querySelectorAll('#examTable thead th.sortable').forEach(th=>{
  th.addEventListener('click', ()=>{
    const key = th.dataset.sort;
    if(examSort.key === key){ examSort.dir = examSort.dir==='asc' ? 'desc' : 'asc'; }
    else { examSort = {key, dir: key==='name' ? 'asc' : 'asc'}; }
    renderExam();
  });
});
document.getElementById('examSearch')?.addEventListener('input', e=>{
  examSearchTerm = e.target.value;
  renderExam();
});

function renderExam(){
  const has = students.length>0;
  const emptyEl = document.getElementById('examEmpty');
  const resultsEl = document.getElementById('examResultsCard');
  const chartEl = document.getElementById('examChartCard');

  if (emptyEl) emptyEl.style.display = has? 'none':'block';
  if (resultsEl) resultsEl.style.display = has? 'block':'none';
  if (chartEl) chartEl.style.display = has? 'block':'none';
  if(!has){ lastExamRows = []; return; }

  const scores = students.map(s=>s.score);
  const ranks = competitionRanks(scores);
  const rows = students.map((s,i)=>({
    ...s,
    pct: percentileRank(scores, s.score),
    pctOfMax: (s.score / s.max) * 100,
    rank: ranks[i]
  }));
  lastExamRows = rows;

  const statsEl = document.getElementById('examStats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat"><div class="k">Students</div><div class="v">${scores.length}</div></div>
      <div class="stat"><div class="k">Mean</div><div class="v">${mean(scores).toFixed(1)}</div></div>
      <div class="stat"><div class="k">Median</div><div class="v">${median(scores).toFixed(1)}</div></div>
      <div class="stat"><div class="k">Std. dev.</div><div class="v">${stddev(scores).toFixed(1)}</div></div>
      <div class="stat"><div class="k">Range</div><div class="v">${Math.min(...scores)}–${Math.max(...scores)}</div></div>
    `;
  }

  const top = rows.find(r=>r.rank===1);
  const med = median(scores);
  const atOrAboveMedian = scores.filter(s=>s>=med).length;
  const insightEl = document.getElementById('examInsight');
  if (insightEl && top) {
    insightEl.textContent =
      `${top.name} leads with ${top.score}/${top.max} (${top.pctOfMax.toFixed(0)}% of max). ${atOrAboveMedian} of ${scores.length} student(s) are at or above the class median.`;
  }

  let displayRows = rows.filter(r => r.name.toLowerCase().includes(examSearchTerm.toLowerCase()));
  displayRows.sort((a,b)=>{
    let av=a[examSort.key], bv=b[examSort.key];
    if(typeof av === 'string'){ av=av.toLowerCase(); bv=bv.toLowerCase(); }
    if(av<bv) return examSort.dir==='asc' ? -1 : 1;
    if(av>bv) return examSort.dir==='asc' ? 1 : -1;
    return 0;
  });
  updateSortHeaders();
  const countEl = document.getElementById('examCount');
  if (countEl) countEl.textContent = `Showing ${displayRows.length} of ${rows.length}`;

  const body = document.getElementById('examTableBody');
  if (body) {
    body.innerHTML = displayRows.map(r=>`
      <tr>
        <td><span class="rank-pill">#${r.rank}</span></td>
        <td>${escapeHtml(r.name)}</td>
        <td class="num">${r.score}</td>
        <td class="num">${r.pctOfMax.toFixed(1)}%</td>
        <td class="num">
          <div class="ruler-wrap align-end">
            <div class="ruler"><div class="marker" style="left:${r.pct}%;"></div></div>
            <span class="ruler-val">${r.pct.toFixed(1)}</span>
          </div>
        </td>
        <td class="no-print"><button class="icon-btn" data-remove-name="${escapeHtml(r.name)}" data-remove-score="${r.score}" title="Remove">✕</button></td>
      </tr>`).join('');

    body.querySelectorAll('[data-remove-name]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const nm = btn.dataset.removeName, sc = parseFloat(btn.dataset.removeScore);
        const idx = students.findIndex(s=>s.name===nm && s.score===sc);
        if(idx>-1) {
          students.splice(idx,1);
          saveData();
        }
        renderExam();
      });
    });
  }

  renderChart(students.map(s=>(s.score/s.max)*100));
}

document.getElementById('exportExamBtn')?.addEventListener('click', ()=>{
  if(!lastExamRows.length) return;
  const sorted = [...lastExamRows].sort((a,b)=>a.rank-b.rank);
  const rows = sorted.map(r=>({
    Rank:r.rank, Name:r.name, Score:r.score, MaxScore:r.max,
    PercentOfMax:r.pctOfMax.toFixed(1), Percentile:r.pct.toFixed(1)
  }));
  downloadCSV('centileiq_exam_rankings.csv', rows, ['Rank','Name','Score','MaxScore','PercentOfMax','Percentile']);
});

document.getElementById('printExamBtn')?.addEventListener('click', ()=>{
  window.print();
});

document.getElementById('clearExamBtn')?.addEventListener('click', ()=>{
  if(!students.length) return;
  if(!confirm(`Delete all ${students.length} student(s) from the roster? This can't be undone.`)) return;
  students = [];
  saveData();
  examSearchTerm = '';
  const searchEl = document.getElementById('examSearch');
  if (searchEl) searchEl.value = '';
  renderExam();
});

function renderChart(pctScores){
  const box = document.querySelector('#examChartCard .canvas-box');
  if(typeof Chart === 'undefined'){
    if (box) box.innerHTML = '<p class="sub">Chart library failed to load — check your internet connection and reload the page.</p>';
    return;
  }
  const bins = [0,10,20,30,40,50,60,70,80,90,100];
  const counts = new Array(bins.length-1).fill(0);
  pctScores.forEach(p=>{
    let idx = Math.floor(p/10);
    if(idx>9) idx=9;
    if(idx<0) idx=0;
    counts[idx]++;
  });
  const labels = bins.slice(0,-1).map((b,i)=>`${b}-${bins[i+1]}%`);

  const canvas = document.getElementById('distChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if(chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type:'bar',
    data:{
      labels,
      datasets:[{
        label:'Students',
        data:counts,
        backgroundColor:'#1c7d76',
        borderRadius:5,
        maxBarThickness:46
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{
        x:{ grid:{display:false}, ticks:{font:{family:'IBM Plex Mono', size:10}} },
        y:{ beginAtZero:true, ticks:{precision:0, font:{family:'IBM Plex Mono', size:10}}, grid:{color:'#ece8dd'} }
      }
    }
  });
}

/* ======================================================================
   GROWTH PERCENTILES
====================================================================== */
const REF = {
  weight: {
    L: 0, xKind:'age', min:0, max: 120,
    boy: {
      x:[0,1,2,3,4,5,6,9,12,15,18,21,24,30,36,42,48,54,60,72,84,96,108,120],
      M:[3.3,4.5,5.6,6.4,7.0,7.5,7.9,8.9,9.6,10.3,10.9,11.5,12.2,13.3,14.3,15.3,16.3,17.3,18.3,20.5,22.9,25.4,28.1,31.2],
      S:[0.146,0.146,0.144,0.142,0.140,0.139,0.138,0.136,0.135,0.134,0.133,0.132,0.132,0.131,0.130,0.130,0.130,0.130,0.130,0.135,0.140,0.145,0.150,0.160]
    },
    girl: {
      x:[0,1,2,3,4,5,6,9,12,15,18,21,24,30,36,42,48,54,60,72,84,96,108,120],
      M:[3.2,4.2,5.1,5.8,6.4,6.9,7.3,8.2,8.9,9.6,10.2,10.9,11.5,12.7,13.9,14.8,15.9,16.8,17.9,19.9,22.4,25.0,28.2,31.9],
      S:[0.146,0.146,0.146,0.145,0.144,0.143,0.142,0.140,0.138,0.137,0.136,0.135,0.135,0.134,0.134,0.134,0.134,0.134,0.134,0.135,0.140,0.150,0.155,0.165]
    }
  },
  height: {
    L: 1, xKind:'age', min:0, max: 228,
    boy: {
      x:[0,1,2,3,4,5,6,9,12,15,18,21,24,30,36,42,48,54,60,72,84,96,108,120,132,144,156,168,180,192,204,216,228],
      M:[49.9,54.7,58.4,61.4,63.9,65.9,67.6,72.0,75.7,78.6,81.2,83.6,87.1,91.0,96.1,99.9,103.3,106.7,110.0,116.0,121.7,127.3,132.6,137.8,143.2,149.1,156.0,163.1,169.0,172.9,175.2,176.1,176.5],
      S:[0.038,0.037,0.037,0.037,0.037,0.037,0.037,0.037,0.038,0.038,0.038,0.038,0.039,0.039,0.040,0.040,0.040,0.041,0.041,0.041,0.041,0.041,0.042,0.043,0.045,0.047,0.048,0.047,0.044,0.041,0.039,0.038,0.038]
    },
    girl: {
      x:[0,1,2,3,4,5,6,9,12,15,18,21,24,30,36,42,48,54,60,72,84,96,108,120,132,144,156,168,180,192,204,216,228],
      M:[49.1,53.7,57.1,59.8,62.1,64.0,65.7,70.1,74.0,76.8,79.7,82.5,85.7,90.0,95.1,99.0,102.7,106.2,109.4,115.5,121.1,126.6,132.5,138.6,144.8,151.2,156.7,159.8,161.7,162.5,163.0,163.2,163.3],
      S:[0.039,0.038,0.038,0.038,0.038,0.038,0.038,0.038,0.039,0.039,0.039,0.039,0.040,0.040,0.041,0.041,0.041,0.041,0.041,0.041,0.041,0.042,0.043,0.045,0.047,0.046,0.043,0.040,0.038,0.037,0.037,0.037,0.037]
    }
  },
  weightheight: {
    L: 0, xKind:'length', min:45, max:120,
    boy: {
      x:[45,50,55,60,65,70,75,80,85,90,95,100,105,110,115,120],
      M:[2.5,3.3,4.3,5.4,6.8,8.4,9.6,10.6,11.8,12.6,14.0,15.5,17.0,18.6,20.3,22.2],
      S:[0.120,0.118,0.116,0.114,0.112,0.111,0.110,0.110,0.110,0.111,0.112,0.113,0.115,0.117,0.119,0.120]
    },
    girl: {
      x:[45,50,55,60,65,70,75,80,85,90,95,100,105,110,115,120],
      M:[2.4,3.2,4.1,5.1,6.4,7.9,9.2,10.3,11.5,12.6,13.9,15.4,17.0,18.2,19.8,21.7],
      S:[0.122,0.120,0.118,0.116,0.114,0.113,0.112,0.112,0.112,0.113,0.114,0.115,0.117,0.119,0.121,0.122]
    }
  },
  bmi: {
    L: -0.5, xKind:'age', min:0, max: 228,
    boy: {
      x:[0,1,2,3,4,5,6,9,12,15,18,21,24,30,36,42,48,54,60,72,84,96,108,120,132,144,156,168,180,192,204,216,228],
      M:[13.4,14.9,15.8,16.2,16.5,16.8,17.0,16.9,17.0,16.8,16.6,16.4,16.3,16.0,15.8,15.6,15.5,15.4,15.3,15.3,15.4,15.6,15.9,16.4,17.0,17.7,18.5,19.3,19.9,20.4,20.7,21.0,21.2],
      S:[0.090,0.090,0.092,0.092,0.092,0.093,0.093,0.094,0.095,0.096,0.097,0.098,0.099,0.099,0.100,0.100,0.100,0.100,0.100,0.100,0.103,0.105,0.108,0.112,0.118,0.125,0.132,0.138,0.142,0.145,0.148,0.150,0.150]
    },
    girl: {
      x:[0,1,2,3,4,5,6,9,12,15,18,21,24,30,36,42,48,54,60,72,84,96,108,120,132,144,156,168,180,192,204,216,228],
      M:[13.3,14.5,15.4,15.8,16.1,16.3,16.5,16.5,16.5,16.4,16.2,16.0,15.9,15.6,15.4,15.3,15.2,15.2,15.3,15.3,15.4,15.6,15.9,16.5,17.2,18.0,18.8,19.5,20.0,20.4,20.7,20.9,21.0],
      S:[0.092,0.092,0.094,0.094,0.094,0.095,0.095,0.096,0.097,0.098,0.099,0.100,0.100,0.100,0.100,0.100,0.100,0.100,0.100,0.102,0.105,0.108,0.112,0.118,0.125,0.132,0.138,0.142,0.145,0.146,0.147,0.148,0.148]
    }
  },
  headcirc: {
    L: 1, xKind:'age', min:0, max: 60,
    boy: {
      x:[0,1,2,3,4,5,6,9,12,15,18,21,24,30,36,42,48,54,60],
      M:[34.5,37.3,39.1,40.5,41.6,42.6,43.3,45.0,46.1,46.9,47.4,47.8,48.3,48.9,49.7,50.2,50.5,50.8,51.1],
      S:[0.031,0.031,0.031,0.031,0.030,0.030,0.030,0.030,0.030,0.030,0.030,0.030,0.029,0.029,0.029,0.029,0.029,0.029,0.029]
    },
    girl: {
      x:[0,1,2,3,4,5,6,9,12,15,18,21,24,30,36,42,48,54,60],
      M:[33.9,36.5,38.3,39.5,40.6,41.5,42.2,43.8,44.9,45.7,46.2,46.7,47.2,47.9,48.6,49.1,49.5,49.8,50.2],
      S:[0.032,0.032,0.032,0.032,0.031,0.031,0.031,0.031,0.031,0.031,0.031,0.031,0.031,0.030,0.030,0.030,0.030,0.030,0.030]
    }
  }
};

const INDICATOR_LABEL = {
  weight:'Weight-for-age', height:'Height-for-age', weightheight:'Weight-for-Height/Length',
  bmi:'BMI-for-age', headcirc:'Head circ.-for-age'
};
const VALUE_UNIT = {weight:'kg', height:'cm', weightheight:'kg', bmi:'kg/m²', headcirc:'cm'};

function interp(table, x){
  const {x: xs, M, S} = table;
  if(x<=xs[0]) return {M:M[0], S:S[0]};
  if(x>=xs[xs.length-1]) return {M:M[M.length-1], S:S[S.length-1]};
  for(let i=0;i<xs.length-1;i++){
    if(x>=xs[i] && x<=xs[i+1]){
      const t = (x-xs[i])/(xs[i+1]-xs[i]);
      return { M: M[i] + t*(M[i+1]-M[i]), S: S[i] + t*(S[i+1]-S[i]) };
    }
  }
}

function zFromValue(value, L, M, S){
  if(Math.abs(L) < 1e-6) return Math.log(value/M)/S;
  return (Math.pow(value/M, L) - 1) / (L*S);
}
function xFromZ(z, L, M, S){
  if(Math.abs(L) < 1e-6) return M * Math.exp(S*z);
  return M * Math.pow(1 + L*S*z, 1/L);
}

function erf(x){
  const sign = x<0 ? -1 : 1; x = Math.abs(x);
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const t = 1/(1+p*x);
  const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}
function normalCDF(z){ return 0.5*(1+erf(z/Math.SQRT2)); }

function classify(indicator, z){
  if(indicator==='bmi'){
    if(z < -3) return {label:'Severe thinness', level:'flag'};
    if(z < -2) return {label:'Thinness', level:'watch'};
    if(z <= 1) return {label:'Normal', level:'normal'};
    if(z <= 2) return {label:'Risk of overweight', level:'watch'};
    return {label:'Overweight/Obese', level:'flag'};
  }
  if(indicator==='weightheight'){
    if(z < -3) return {label:'Severely wasted', level:'flag'};
    if(z < -2) return {label:'Wasted', level:'watch'};
    if(z <= 1) return {label:'Normal', level:'normal'};
    if(z <= 2) return {label:'Possible overweight', level:'watch'};
    return {label:'Overweight/Obese', level:'flag'};
  }
  if(indicator==='height'){
    if(z < -3) return {label:'Severely stunted', level:'flag'};
    if(z < -2) return {label:'Stunted', level:'watch'};
    if(z <= 2) return {label:'Normal', level:'normal'};
    return {label:'Tall (not a concern)', level:'normal'};
  }
  if(indicator==='headcirc'){
    if(z < -2) return {label:'Microcephaly range', level:'flag'};
    if(z > 2) return {label:'Macrocephaly range', level:'flag'};
    return {label:'Normal', level:'normal'};
  }
  if(z < -3) return {label:'Severely underweight', level:'flag'};
  if(z < -2) return {label:'Underweight', level:'watch'};
  if(z <= 2) return {label:'Normal', level:'normal'};
  return {label:'Above typical range', level:'normal'};
}

function centileBand(pct){
  const cuts = [3,15,50,85,97];
  const labels = ['<3rd','3rd–15th','15th–50th','50th–85th','85th–97th','>97th'];
  for(let i=0;i<cuts.length;i++){ if(pct<cuts[i]) return labels[i]; }
  return labels[labels.length-1];
}

const gIndicator = document.getElementById('gIndicator');
const gValueLabel = document.getElementById('gValueLabel');
const bmiHelperWrap = document.getElementById('bmiHelperWrap');

function updateIndicatorUI(){
  if (!gIndicator) return;
  const ind = gIndicator.value;
  const ref = REF[ind];
  if (gValueLabel) gValueLabel.textContent = `${INDICATOR_LABEL[ind]} (${VALUE_UNIT[ind]})`;
  if (bmiHelperWrap) bmiHelperWrap.style.display = ind==='bmi' ? 'flex' : 'none';
  const isLength = ref.xKind === 'length';
  const ageFields = document.getElementById('ageFieldsWrap');
  const lengthFields = document.getElementById('lengthFieldWrap');
  if (ageFields) ageFields.style.display = isLength ? 'none' : 'flex';
  if (lengthFields) lengthFields.style.display = isLength ? 'flex' : 'none';
  checkRange();
}

gIndicator?.addEventListener('change', updateIndicatorUI);
['gYears','gMonths','gLengthWH'].forEach(id=>document.getElementById(id)?.addEventListener('input', checkRange));

function totalMonths(){
  const y = parseInt(document.getElementById('gYears')?.value)||0;
  const m = parseInt(document.getElementById('gMonths')?.value)||0;
  return Math.min(228, Math.max(0, y*12+m));
}

function checkRange(){
  if (!gIndicator) return true;
  const ind = gIndicator.value;
  const ref = REF[ind];
  const noteEl = document.getElementById('gRangeNote');
  if(ref.xKind === 'length'){
    const len = parseFloat(document.getElementById('gLengthWH')?.value);
    if(!isNaN(len) && (len < ref.min || len > ref.max)){
      if (noteEl) {
        noteEl.style.display='block';
        noteEl.textContent = `WHO's weight-for-height/length standard covers ${ref.min}–${ref.max} cm — outside that range, weight-for-age or BMI-for-age is a better fit.`;
      }
      return false;
    }
    if (noteEl) noteEl.style.display='none';
    return true;
  }
  const months = totalMonths();
  if(months > ref.max){
    if (noteEl) {
      noteEl.style.display='block';
      noteEl.textContent = ind==='weight'
        ? `WHO doesn't recommend weight-for-age past age 10 (puberty timing varies too much) — try BMI-for-age instead for this child.`
        : `Head circumference-for-age is only defined by WHO up to age 5 — this child is outside that range.`;
    }
    return false;
  }
  if (noteEl) noteEl.style.display='none';
  return true;
}

document.getElementById('bmiCalcBtn')?.addEventListener('click', ()=>{
  const w = parseFloat(document.getElementById('bmiW').value);
  const h = parseFloat(document.getElementById('bmiH').value);
  if(!w || !h){ return; }
  const bmi = w / Math.pow(h/100, 2);
  const valueEl = document.getElementById('gValue');
  if (valueEl) valueEl.value = bmi.toFixed(1);
});

let growthChartInstance = null;

document.getElementById('addGrowthBtn')?.addEventListener('click', ()=>{
  const ind = gIndicator.value;
  const ref = REF[ind];
  if(!checkRange()) return;
  const value = parseFloat(document.getElementById('gValue').value);
  if(isNaN(value)){ document.getElementById('gValue').focus(); return; }
  const sex = document.getElementById('gSex').value;
  const name = document.getElementById('gName').value.trim() || '—';

  let months = null, lengthCm = null, xValue;
  if(ref.xKind === 'length'){
    lengthCm = parseFloat(document.getElementById('gLengthWH').value);
    if(isNaN(lengthCm)){ document.getElementById('gLengthWH').focus(); return; }
    xValue = lengthCm;
  } else {
    months = totalMonths();
    xValue = months;
  }

  const table = ref[sex];
  const {M,S} = interp(table, xValue);
  const z = zFromValue(value, ref.L, M, S);
  const pct = normalCDF(z)*100;
  const cls = classify(ind, z);

  growthEntries.push({name, sex, indicator:ind, months, lengthCm, value, z, pct, cls});
  saveData();
  const valEl = document.getElementById('gValue');
  if (valEl) valEl.value='';
  const wEl = document.getElementById('bmiW');
  if (wEl) wEl.value='';
  const hEl = document.getElementById('bmiH');
  if (hEl) hEl.value='';
  renderGrowth();
});

function formatAge(months){
  const y = Math.floor(months/12), m = months%12;
  if(y===0) return `${m}mo`;
  if(m===0) return `${y}y`;
  return `${y}y ${m}mo`;
}

function renderGrowth(){
  const has = growthEntries.length>0;
  const emptyEl = document.getElementById('growthEmpty');
  const resultsEl = document.getElementById('growthResultsCard');
  if (emptyEl) emptyEl.style.display = has? 'none':'block';
  if (resultsEl) resultsEl.style.display = has? 'block':'none';
  if(!has) return;

  const body = document.getElementById('growthTableBody');
  if (body) {
    body.innerHTML = growthEntries.map((e,i)=>{
      const pctClamped = Math.min(99.9, Math.max(0.1, e.pct));
      const ageOrLength = e.months!=null ? formatAge(e.months) : `${e.lengthCm} cm`;
      return `
      <tr>
        <td>${escapeHtml(e.name)}</td>
        <td>${e.sex==='boy'?'Boy':'Girl'}</td>
        <td class="num">${ageOrLength}</td>
        <td>${INDICATOR_LABEL[e.indicator]}</td>
        <td class="num">${e.value} ${VALUE_UNIT[e.indicator]}</td>
        <td class="num">${e.z.toFixed(2)}</td>
        <td>
          <div class="ruler-wrap">
            <div class="ruler"><div class="marker" style="left:${pctClamped}%;"></div></div>
            <span class="ruler-val">${centileBand(e.pct)}</span>
          </div>
        </td>
        <td><span class="badge ${e.cls.level}">${e.cls.label}</span></td>
        <td class="no-print">
          <button class="icon-btn chart" data-chart-growth="${i}" title="View growth chart">📈</button>
          <button class="icon-btn" data-remove-growth="${i}" title="Remove">✕</button>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-remove-growth]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        growthEntries.splice(parseInt(btn.dataset.removeGrowth),1);
        saveData();
        renderGrowth();
      });
    });
    body.querySelectorAll('[data-chart-growth]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        renderGrowthChart(parseInt(btn.dataset.chartGrowth));
      });
    });
  }
}

document.getElementById('exportGrowthBtn')?.addEventListener('click', ()=>{
  if(!growthEntries.length) return;
  const rows = growthEntries.map(e=>({
    Name:e.name, Sex:e.sex==='boy'?'Boy':'Girl',
    AgeOrLength: e.months!=null ? formatAge(e.months) : `${e.lengthCm} cm`,
    Measurement: INDICATOR_LABEL[e.indicator], Value:e.value, Unit:VALUE_UNIT[e.indicator],
    ZScore:e.z.toFixed(2), Centile:e.pct.toFixed(1), Flag:e.cls.label
  }));
  downloadCSV('centileiq_growth_measurements.csv', rows, ['Name','Sex','AgeOrLength','Measurement','Value','Unit','ZScore','Centile','Flag']);
});

document.getElementById('printGrowthBtn')?.addEventListener('click', ()=>{
  window.print();
});

document.getElementById('clearGrowthBtn')?.addEventListener('click', ()=>{
  if(!growthEntries.length) return;
  if(!confirm(`Delete all ${growthEntries.length} measurement(s)? This can't be undone.`)) return;
  growthEntries = [];
  saveData();
  const chartCard = document.getElementById('growthChartCard');
  if (chartCard) chartCard.style.display = 'none';
  renderGrowth();
});

function computeCurveData(indicator, sex){
  const ref = REF[indicator];
  const table = ref[sex];
  const Zs = {p3:-1.881, p15:-1.036, p50:0, p85:1.036, p97:1.881};
  const curves = {};
  Object.keys(Zs).forEach(k=>{
    curves[k] = table.x.map((xv,i)=> ({x:xv, y: xFromZ(Zs[k], ref.L, table.M[i], table.S[i])}));
  });
  return curves;
}

function renderGrowthChart(idx){
  const e = growthEntries[idx];
  const ref = REF[e.indicator];
  const curves = computeCurveData(e.indicator, e.sex);
  const childX = ref.xKind === 'length' ? e.lengthCm : e.months;

  const chartCard = document.getElementById('growthChartCard');
  if (chartCard) {
    chartCard.style.display = 'block';
    const titleEl = document.getElementById('growthChartTitle');
    if (titleEl) titleEl.textContent = `${e.name} — ${INDICATOR_LABEL[e.indicator]} (${e.sex==='boy'?'boy':'girl'})`;
    chartCard.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  const box = document.querySelector('#growthChartCard .canvas-box');
  if(typeof Chart === 'undefined'){
    if (box) box.innerHTML = '<p class="sub">Chart library failed to load — check your internet connection and reload the page.</p>';
    return;
  }
  const canvas = document.getElementById('growthChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if(growthChartInstance) growthChartInstance.destroy();
  growthChartInstance = new Chart(ctx, {
    type:'line',
    data:{
      datasets:[
        {label:'3rd', data:curves.p3, borderColor:'#b5453d', borderDash:[4,3], borderWidth:1, pointRadius:0, tension:.3},
        {label:'15th', data:curves.p15, borderColor:'#cf7a31', borderWidth:1, pointRadius:0, tension:.3},
        {label:'50th (median)', data:curves.p50, borderColor:'#1c7d76', borderWidth:2.5, pointRadius:0, tension:.3},
        {label:'85th', data:curves.p85, borderColor:'#cf7a31', borderWidth:1, pointRadius:0, tension:.3},
        {label:'97th', data:curves.p97, borderColor:'#b5453d', borderDash:[4,3], borderWidth:1, pointRadius:0, tension:.3},
        {type:'scatter', label:e.name, data:[{x:childX, y:e.value}], backgroundColor:'#1c2a3f',
         borderColor:'#fff', borderWidth:2, pointRadius:7, pointHoverRadius:8}
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'nearest', intersect:false},
      scales:{
        x:{ type:'linear', title:{display:true, text: ref.xKind==='length' ? 'Length / Height (cm)' : 'Age (months)'}, grid:{color:'#ece8dd'} },
        y:{ title:{display:true, text: VALUE_UNIT[e.indicator]}, grid:{color:'#ece8dd'} }
      },
      plugins:{ legend:{display:true, position:'bottom', labels:{boxWidth:12, font:{size:10.5}}} }
    }
  });
}

/* ======================================================================
   INITIALIZATION
====================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  updateIndicatorUI();
  renderExam();
  renderGrowth();
});

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(err=>console.warn('Service worker registration failed:', err));
  });
}
