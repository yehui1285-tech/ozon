(function(scope){
  'use strict';
  const MAX=20, STORE='ozonCategoryFavoritesV1';
  const names=n=>n.nameZh||n.nameRu||n.id;
  function index(nodes){const map=new Map(nodes.map(n=>[String(n.id),{...n,id:String(n.id),parentId:n.parentId==null?null:String(n.parentId),children:[]} ]));for(const n of map.values()){const p=map.get(n.parentId);if(p)p.children.push(n)}return [...map.values()].filter(n=>!map.has(n.parentId));}
  function descendants(node,out=[]){out.push(node);for(const child of node.children||[])descendants(child,out);return out}
  function makeSelection(nodes){const roots=index(nodes), byId=new Map();for(const root of roots)for(const n of descendants(root))byId.set(n.id,n);const selected=new Map();
    function addMany(items){const unique=items.filter(n=>!selected.has(n.id));if(selected.size+unique.length>MAX)throw Error('本批最多选择 20 个类目；请缩小范围，分批扫描。');for(const n of unique)selected.set(n.id,n)}
    return {roots,byId,selected,add(node){addMany([node])},addLeaves(node){addMany(descendants(node).filter(n=>!n.children.length))},remove(node){selected.delete(node.id)},toggle(node,checked){if(checked)this.add(node);else this.remove(node)},clear(){selected.clear()},urls(){return [...selected.values()].map(n=>n.url)}};
  }
  async function readFavorites(){try{const data=await chrome.storage.local.get(STORE);return Array.isArray(data[STORE])?data[STORE]:[]}catch{return []}}
  async function writeFavorites(items){await chrome.storage.local.set({[STORE]:items})}
  scope.OzonCategoryCatalog=Object.freeze({MAX,names,index,makeSelection,readFavorites,writeFavorites});
})(globalThis);
