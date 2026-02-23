const KEY = 'promotion_dashboard_v1';
const sample = [
  { proposal_id:'PR-001', target_path:'memory/ops/COMMON_CONSTITUTION_V1.md', summary:'메타 루프 조항 추가', risk_level:'L1', status:'APPLIED', created_at:new Date().toISOString(), reason:'기본 정렬 반영' },
  { proposal_id:'PR-002', target_path:'MIN_ORG/03_PLAYBOOKS/00_MISSION_CONTROL_MVP.md', summary:'markdown.new 수집 경로 추가', risk_level:'L1', status:'PENDING_APPROVAL', created_at:new Date().toISOString(), reason:'' }
];

let state = load();
let filter = 'ALL';

function load(){
  try { return JSON.parse(localStorage.getItem(KEY)) || sample; } catch { return sample; }
}
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }

function render(){
  const tbody = document.querySelector('#queue-table tbody');
  tbody.innerHTML = '';
  const rows = state.filter(r => filter==='ALL' ? true : r.status===filter);
  rows.forEach((r,idx)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.proposal_id}</td>
      <td>${r.target_path}</td>
      <td>${r.summary}</td>
      <td>${r.risk_level}</td>
      <td><span class="badge status-${r.status}">${r.status}</span></td>
      <td>${new Date(r.created_at).toLocaleString()}</td>
      <td>
        <select data-idx="${idx}" class="status-change">
          ${['DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','APPLIED'].map(s=>`<option ${s===r.status?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>`;
    tr.addEventListener('click', ()=>showDetails(r));
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.status-change').forEach(el=>{
    el.addEventListener('click',e=>e.stopPropagation());
    el.addEventListener('change', e=>{
      const i = Number(e.target.dataset.idx);
      const record = rows[i];
      const realIdx = state.findIndex(x=>x.proposal_id===record.proposal_id);
      state[realIdx].status = e.target.value;
      save(); render();
    });
  });
}

function showDetails(r){
  const div = document.getElementById('details');
  div.innerHTML = `
    <p><b>ID:</b> ${r.proposal_id}</p>
    <p><b>Target:</b> ${r.target_path}</p>
    <p><b>Summary:</b> ${r.summary}</p>
    <p><b>Risk:</b> ${r.risk_level}</p>
    <p><b>Status:</b> ${r.status}</p>
    <p><b>Created:</b> ${new Date(r.created_at).toLocaleString()}</p>
    <p><b>Reason:</b> ${r.reason || '-'}</p>
  `;
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
  state = structuredClone(sample);
  save();
  render();
});

render();
