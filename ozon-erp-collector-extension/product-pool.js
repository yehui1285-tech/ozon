const core = globalThis.OzonProductPoolCore;
const $ = id => document.getElementById(id);
let pool = core.emptyPool();
let offset = 0;
const pageSize = 50;

async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "操作失败");
  return result;
}
function feedback(text, error = false) {
  $("message").textContent = text;
  $("message").style.color = error ? "#a52e1b" : "#226247";
}
function cell(row, text) {
  const td = row.insertCell();
  td.textContent = text || "—";
  return td;
}
function option(select, value, text) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = text;
  select.append(item);
}
for (const [value, text] of Object.entries(core.statuses)) option($("filter"), value, text);
function render() {
  const all = Object.values(pool.products);
  $("total").textContent = all.length;
  $("newCount").textContent = all.filter(p => p.status === "new" && !p.blocked).length;
  $("historyCount").textContent = Object.keys(pool.history).length;
  const query = $("query").value.trim().toLowerCase();
  const filtered = all.filter(p => (!$("filter").value || p.status === $("filter").value)
    && [p.sku,p.title,p.category,p.storeName].some(s => String(s || "").toLowerCase().includes(query)))
    .sort((a,b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  offset = Math.min(offset, Math.max(0, Math.floor((filtered.length - 1) / pageSize) * pageSize));
  $("rows").replaceChildren();
  for (const p of filtered.slice(offset, offset + pageSize)) {
    const row = $("rows").insertRow();
    const name = cell(row, p.sku);
    name.append(document.createElement("br"));
    const link = document.createElement("a");
    link.textContent = p.title || "商品";
    if (/^https:\/\/www\.ozon\.ru\/product\//i.test(p.link)) {link.href = p.link; link.target = "_blank"; link.rel = "noopener noreferrer";}
    name.append(link);
    cell(row,p.category); cell(row,p.price);
    const risk = cell(row,p.shippingRisk);
    if (p.blocked) risk.className = "blocked";
    cell(row, `${p.storeName} · ${String(p.lastSeenAt || "").slice(0,10)}`);
    const select = document.createElement("select");
    for (const [value,text] of Object.entries(core.statuses)) option(select,value,text);
    select.value = p.status;
    row.insertCell().append(select);
    const notes = document.createElement("textarea"); notes.rows = 2; notes.value = p.notes;
    notes.setAttribute("aria-label", `${p.sku} 备注`);
    row.insertCell().append(notes);
    const save = document.createElement("button"); save.textContent = "保存";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {pool = (await send({ type:"updateProductPoolItem",sku:p.sku,patch:{status:select.value,notes:notes.value} })).state;feedback("已保存");render();}
      catch(e) {feedback(e.message,true);save.disabled=false;}
    });
    row.insertCell().append(save);
  }
  if (!filtered.length) {const c = $("rows").insertRow().insertCell();c.colSpan=8;c.textContent="暂无符合条件的商品。请先在批量扫描页加入本批商品。";}
  $("page").textContent = filtered.length ? `${offset+1}–${Math.min(offset+pageSize,filtered.length)} / ${filtered.length}` : "0 件";
  $("previous").disabled = offset === 0;
  $("next").disabled = offset + pageSize >= filtered.length;
}
async function refresh() {try {pool=(await send({type:"getProductPool"})).pool;render();}catch(e){feedback(e.message,true);}}
function download(name,text,type) {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const a = document.createElement("a"); a.href=url; a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$("query").addEventListener("input",()=>{offset=0;render();});
$("filter").addEventListener("change",()=>{offset=0;render();});
$("previous").addEventListener("click",()=>{offset-=pageSize;render();});
$("next").addEventListener("click",()=>{offset+=pageSize;render();});
$("refresh").addEventListener("click",refresh);
$("export").addEventListener("click",()=>download("Ozon商品池.csv","\ufeff"+core.exportPoolCsv(pool),"text/csv;charset=utf-8"));
$("backup").addEventListener("click",()=>download("Ozon商品池备份.json",JSON.stringify(pool,null,2),"application/json"));
$("exportHistory").addEventListener("click",()=>download("Ozon历史SKU.txt",Object.keys(pool.history).join("\n"),"text/plain;charset=utf-8"));
$("importHistory").addEventListener("click",async()=>{
  const button=$("importHistory"); button.disabled=true;
  try {const r=await send({type:"importProductPoolHistory",text:$("history").value});pool=r.state;$("history").value="";feedback(`新增历史 SKU ${r.added} 个，忽略无效项 ${r.invalid} 个`);render();}
  catch(e){feedback(e.message,true);}finally{button.disabled=false;}
});
refresh();
