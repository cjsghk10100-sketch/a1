const KEY = 'promotion_dashboard_v3';
let state = [];
let selectedId = null;

const sample = [
  { proposal_id:'PR-001', target_path:'memory/ops/COMMON_CONSTITUTION_V1.md', summary:'메타 루프 조항 추가', risk_level:'L1', status:'APPLIED', created_at:new Date().toISOString(), evidence:'1212 문서 기반 상위루프 정합성', reason:'반영 완료', decided_at:new Date().toISOString() },
  { proposal_id:'PR-002', target_path:'MIN_ORG/03_PLAYBOOKS/00_MISSION_CONTROL_MVP.md', summary:'markdown.new 수집 경로 추가', risk_level:'L1', status:'PENDING_APPROVAL', created_at:new Date().toISOString(), evidence:'토큰 절감/수집 안정성 개선', reason:'', decided_at:'' }
];

async function loadTmpFiles(){
  const tbody = document.querySelector('#tmp-table tbody');
  tbody.innerHTML = '';
  try {
    const res = await fetch('./tmp_files.json?v=' + Date.now());
    const j = await res.json();
    const files = j.files || [];
    if (!files.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4">tmp 폴더 파일이 없습니다.</td>';
      tbody.appendChild(tr);
      return;
    }
    files.slice(0,200).forEach(f => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${f.path}</td><td>${f.zone}</td><td>${f.size}</td><td>${f.modified_at}</td>`;
      tbody.appendChild(tr);
    });
  } catch {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4">tmp_files.json을 읽지 못했습니다.</td>';
    tbody.appendChild(tr);
  }
}

async function bootstrap(){
  const seeded = localStorage.getItem(KEY);
  if (seeded) {
    try {
      const parsed = JSON.parse(seeded);
      state = (Array.isArray(parsed) && parsed.length) ? parsed : structuredClone(sample);
    } catch {
      state = structuredClone(sample);
    }
  } else {
    try {
      const res = await fetch('./data.json');
      const j = await res.json();
      state = (j.queue && j.queue.length) ? j.queue.map(x=>({ ...x, evidence:x.evidence||'', reason:x.reason||'', decided_at:x.decided_at||'' })) : structuredClone(sample);
    } catch {
      state = structuredClone(sample);
    }
  }
  save();
  renderAll();
  await loadTmpFiles();
}

function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }

function renderTable(selector, rows, rowBuilder){
  const tbody = document.querySelector(selector+' tbody');
  tbody.innerHTML='';
  if(!rows.length){
    const tr=document.createElement('tr');
    tr.innerHTML='<td colspan="6">항목 없음</td>';
    tbody.appendChild(tr);
    return;
  }
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = rowBuilder(r);
    tr.addEventListener('click', ()=>selectProposal(r.proposal_id));
    tbody.appendChild(tr);
  });
}

function renderAll(){
  const pending = state.filter(x=>x.status==='PENDING_APPROVAL');
  const approved = state.filter(x=>x.status==='APPROVED');
  const rejected = state.filter(x=>x.status==='REJECTED');
  const applied = state.filter(x=>x.status==='APPLIED');

  renderTable('#pending-table', pending, r=>`
    <td>${r.proposal_id}</td><td>${r.target_path}</td><td>${r.summary}</td><td>${r.evidence||'-'}</td><td>${r.risk_level||'L1'}</td>
    <td><span class="badge status-${r.status}">${r.status}</span></td>`);

  renderTable('#approved-table', approved, r=>`
    <td>${r.proposal_id}</td><td>${r.summary}</td><td>${r.evidence||'-'}</td><td>${r.reason||'-'}</td><td>${fmt(r.decided_at)}</td>`);

  renderTable('#rejected-table', rejected, r=>`
    <td>${r.proposal_id}</td><td>${r.summary}</td><td>${r.evidence||'-'}</td><td>${r.reason||'-'}</td><td>${fmt(r.decided_at)}</td>`);

  renderTable('#applied-table', applied, r=>`
    <td>${r.proposal_id}</td><td>${r.summary}</td><td>${r.evidence||'-'}</td><td>${r.reason||'-'}</td><td>${fmt(r.decided_at)}</td>`);
}

function fmt(s){ if(!s) return '-'; try{return new Date(s).toLocaleString();}catch{return s;} }

function selectProposal(id){
  selectedId = id;
  const r = state.find(x=>x.proposal_id===id);
  if(!r) return;
  document.getElementById('details').innerHTML = `
    <p><b>ID:</b> ${r.proposal_id}</p>
    <p><b>Target:</b> ${r.target_path}</p>
    <p><b>Summary:</b> ${r.summary}</p>
    <p><b>근거:</b> ${r.evidence||'-'}</p>
    <p><b>Risk:</b> ${r.risk_level||'-'}</p>
    <p><b>Status:</b> <span class="badge status-${r.status}">${r.status}</span></p>
    <p><b>Created:</b> ${fmt(r.created_at)}</p>
    <p><b>Reason:</b> ${r.reason || '-'}</p>`;
  document.getElementById('decision-reason').value = r.reason || '';
}

function decide(status){
  if(!selectedId){ alert('먼저 승격 대기 행을 선택해줘.'); return; }
  const r = state.find(x=>x.proposal_id===selectedId);
  if(!r){ return; }
  const reason = document.getElementById('decision-reason').value.trim();
  r.status = status;
  r.reason = reason;
  r.decided_at = new Date().toISOString();
  save();
  renderAll();
  selectProposal(selectedId);
  if (status === 'APPLIED') {
    exportMarkdown();
    alert('반영 완료 처리됨: PROMOTION_DASHBOARD.md 파일이 다운로드됩니다. 내려받은 파일을 memory/reference/PROMOTION_DASHBOARD.md에 덮어쓰면 실제 반영 완료.');
  }
}

document.getElementById('proposal-form').addEventListener('submit', e=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const item = Object.fromEntries(fd.entries());
  item.created_at = new Date().toISOString();
  item.status = 'PENDING_APPROVAL';
  item.reason = '';
  item.decided_at = '';
  state.unshift(item);
  save();
  e.target.reset();
  renderAll();
});

document.getElementById('approve-btn').addEventListener('click', ()=>decide('APPROVED'));
document.getElementById('reject-btn').addEventListener('click', ()=>decide('REJECTED'));
document.getElementById('apply-btn').addEventListener('click', ()=>decide('APPLIED'));
document.getElementById('refresh-tmp').addEventListener('click', loadTmpFiles);
document.getElementById('reset').addEventListener('click', ()=>{ localStorage.removeItem(KEY); location.reload(); });

function exportMarkdown(){
  const header = '| proposal_id | target | summary | risk | status | created_at |\n|---|---|---|---|---|---|\n';
  const body = state.map(r=>`| ${r.proposal_id||'-'} | ${r.target_path||'-'} | ${r.summary||'-'} | ${r.risk_level||'L1'} | ${r.status||'DRAFT'} | ${r.created_at||'-'} |`).join('\n');
  const content = `# PROMOTION_DASHBOARD\n\n## Queue\n${header}${body}\n\n## Recent Approvals\n| proposal_id | approved_by | approved_at | commit_ref |\n|---|---|---|---|\n${state.filter(x=>x.status==='APPROVED').map(r=>`| ${r.proposal_id} | me | ${fmt(r.decided_at)} | - |`).join('\n') || '| - | - | - | - |'}\n\n## Recent Rejects\n| proposal_id | reason | reviewer | at |\n|---|---|---|---|\n${state.filter(x=>x.status==='REJECTED').map(r=>`| ${r.proposal_id} | ${r.reason||'-'} | me | ${fmt(r.decided_at)} |`).join('\n') || '| - | - | - | - |'}\n`;
  const blob = new Blob([content], {type:'text/markdown'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'PROMOTION_DASHBOARD.md';
  a.click();
}

document.getElementById('export-md').addEventListener('click', exportMarkdown);

bootstrap();
