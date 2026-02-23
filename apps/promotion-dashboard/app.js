const KEY = 'promotion_dashboard_v2';
let state = [];
let filter = 'ALL';

async function bootstrap(){
  const seeded = localStorage.getItem(KEY);
  if (seeded) {
    state = JSON.parse(seeded);
    render();
    return;
  }
  try {
    const res = await fetch('./data.json');
    const j = await res.json();
    state = j.queue || [];
  } catch {
    state = [];
  }
  save();
  render();
}

function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }

function render(){
  const tbody = document.querySelector('#queue-table tbody');
  tbody.innerHTML = '';
  const rows = state.filter(r => filter==='ALL' ? true : r.status===filter);
  rows.forEach((r,idx)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.proposal_id||''}</td>
      <td>${r.target_path||''}</td>
      <td>${r.summary||''}</td>
      <td>${r.risk_level||'L1'}</td>
      <td><span class="badge status-${r.status||'DRAFT'}">${r.status||'DRAFT'}</span></td>
      <td>${r.created_at||''}</td>
      <td>
        <select data-id="${r.proposal_id||idx}" class="status-change">
          ${['DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','APPLIED'].map(s=>`<option ${s===(r.status||'DRAFT')?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>`;
    tr.addEventListener('click', ()=>showDetails(r));
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.status-change').forEach(el=>{
    el.addEventListener('click',e=>e.stopPropagation());
    el.addEventListener('change', e=>{
      const id = e.target.dataset.id;
      const i = state.findIndex(x=>(x.proposal_id||String(state.indexOf(x)))===id);
      if(i>=0){ state[i].status = e.target.value; save(); render(); }
    });
  });
}

function showDetails(r){
  document.getElementById('details').innerHTML = `
    <p><b>ID:</b> ${r.proposal_id||'-'}</p>
    <p><b>Target:</b> ${r.target_path||'-'}</p>
    <p><b>Summary:</b> ${r.summary||'-'}</p>
    <p><b>Risk:</b> ${r.risk_level||'-'}</p>
    <p><b>Status:</b> ${r.status||'-'}</p>
    <p><b>Created:</b> ${r.created_at||'-'}</p>
    <p><b>Reason:</b> ${r.reason || '-'}</p>`;
}

document.getElementById('proposal-form').addEventListener('submit', e=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const item = Object.fromEntries(fd.entries());
  item.created_at = new Date().toISOString();
  item.reason = '';
  state.unshift(item);
  save();
  e.target.reset();
  render();
});

document.querySelectorAll('[data-filter]').forEach(btn=>{
  btn.addEventListener('click', ()=>{ filter = btn.dataset.filter; render(); });
});

document.getElementById('reset').addEventListener('click', ()=>{
  localStorage.removeItem(KEY);
  location.reload();
});

document.getElementById('export-md').addEventListener('click', ()=>{
  const header = '| proposal_id | target | summary | risk | status | created_at |\n|---|---|---|---|---|---|\n';
  const body = state.map(r=>`| ${r.proposal_id||'-'} | ${r.target_path||'-'} | ${r.summary||'-'} | ${r.risk_level||'L1'} | ${r.status||'DRAFT'} | ${r.created_at||'-'} |`).join('\n');
  const content = `# PROMOTION_DASHBOARD\n\n## Queue\n${header}${body}\n\n## Recent Approvals\n| proposal_id | approved_by | approved_at | commit_ref |\n|---|---|---|---|\n| - | - | - | - |\n\n## Recent Rejects\n| proposal_id | reason | reviewer | at |\n|---|---|---|---|\n| - | - | - | - |\n`;
  const blob = new Blob([content], {type:'text/markdown'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'PROMOTION_DASHBOARD.md';
  a.click();
});

bootstrap();
