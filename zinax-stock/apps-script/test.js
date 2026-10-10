// Runs Code.gs against a mocked spreadsheet: node apps-script/test.js apps-script/Code.gs
const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
// --- minimal SpreadsheetApp mock ---
function makeSheet(name){ return { name, getName(){ return name; }, cells: [], fmt:{}, getLastRow(){ return this.cells.length; }, getLastColumn(){ return Math.max(0,...this.cells.map(r=>r.length)); }, getMaxRows(){return 1000;},
  getRange(r,c,nr,nc){ const sh=this; nr=nr||1; nc=nc||1; return {
    setValues(v){ for(let i=0;i<nr;i++){ sh.cells[r-1+i]=sh.cells[r-1+i]||[]; for(let j=0;j<nc;j++) sh.cells[r-1+i][c-1+j]=v[i][j]; } return this; },
    getValues(){ const out=[]; for(let i=0;i<nr;i++){ const row=[]; for(let j=0;j<nc;j++){ const v=(sh.cells[r-1+i]||[])[c-1+j]; row.push(v===undefined?'':v);} out.push(row);} return out; },
    getValue(){ return ((sh.cells[r-1]||[])[c-1]) ?? ''; }, setValue(v){ sh.cells[r-1]=sh.cells[r-1]||[]; sh.cells[r-1][c-1]=v; return this; },
    setFontWeight(){return this;}, setNumberFormat(){return this;} }; },
  setFrozenRows(){}, clearContents(){ this.cells=[]; } }; }
const sheets={};
const ss={ getSheetByName:n=>sheets[n]||null, insertSheet:(n)=>sheets[n]=makeSheet(n), getUrl:()=>'https://docs.google.com/spreadsheets/d/x', getSpreadsheetTimeZone:()=>'Asia/Tehran', getId:()=>'x', getName:()=>'Zinax' };
const props={ZINAX_TOKEN:'tok'};
const ctx={ SpreadsheetApp:{getActive:()=>ss}, ScriptApp:{WeekDay:{FRIDAY:'FRIDAY'}}, PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k], setProperty:(k,v)=>props[k]=v})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}, Utilities:{formatDate:()=> '2025-10-09 17:00', getUuid:()=> 'u'},
  ContentService:{MimeType:{JSON:'json'}, createTextOutput:t=>({t, setMimeType(){return this;}})}, Logger:{log(){}}, Date, JSON, Number, String, isNaN, Object, Math };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(process.argv[2],'utf8'), ctx);
const post=b=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(b)}}).t);
assert.equal(post({token:'bad',action:'sync'}).ok,false);
const item={id:'ZX-251009-A0001',category:'PVC',code:'101',size:'0.30*1400',unit:'m',qty:120,remaining:120,status:'IN_STOCK',shipmentId:'s1',pallet:'1',netKg:64,grossKg:null,receivedAt:1000,location:'',device:'A',updatedAt:1000};
let r=post({token:'tok',action:'sync',since:0,shipments:[{id:'s1',name:'CN-1',source:'f.xlsx',createdAt:1,updatedAt:1}],expected:[{id:'e1',shipmentId:'s1',pallet:'1',lineNo:1,category:'PVC',code:'101',size:'0.30*1400',qty:120,unit:'m',netKg:64,grossKg:67,itemId:'ZX-251009-A0001',updatedAt:1000}],items:[item, {...item,id:'ZX-251009-A0002'}],movements:[{id:'m1',itemId:item.id,type:'IN',qty:120,reference:'Pallet 1',at:1000,device:'A',code:'101',size:'x',unit:'m'}]});
assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.items.length,2); assert.equal(r.items[0].netKg,64); assert.equal(r.items[0].grossKg,null); assert.equal(r.items[0].shipmentId,'s1'); assert.equal(r.shipments[0].name,'CN-1');
assert.equal(sheets.Items.cells[1][8],'CN-1');
// stale update ignored, newer applied; movement dedupe
r=post({token:'tok',action:'sync',since:r.now,items:[{...item,remaining:50,updatedAt:500},{...item,id:'ZX-251009-A0002',remaining:0,status:'SHIPPED',updatedAt:2000}],movements:[{id:'m1',itemId:item.id,type:'IN',qty:120,at:1000,device:'A',code:'101',size:'x',unit:'m'}]});
assert.equal(sheets.Items.cells[1][5],120); assert.equal(sheets.Items.cells[2][7],'SHIPPED'); assert.equal(sheets.Movements.cells.length,2);
assert.deepEqual(sheets.Stock.cells[1].slice(0,7),['PVC','101','0.30*1400','m',1,120,'No location: 1']);
assert.deepEqual(sheets['By location'].cells[1].slice(0,7),['No location','PVC','101','0.30*1400','m',1,120]);
// locations: put the remaining item in Warehouse 1 from the phone
r=post({token:'tok',action:'sync',since:0,items:[{...item,id:'ZX-251009-A0001',location:'Warehouse 1',updatedAt:3000}]});
assert.equal(sheets.Stock.cells[1][6],'Warehouse 1: 1'); assert.equal(sheets['By location'].cells[1][0],'Warehouse 1');
// hand edit: set Remaining of A0001 (row 2) from 120 to 0
const items=sheets.Items; const before=items.cells[1][15];
items.cells[1][5]=0;
const range={getSheet:()=>items,getRow:()=>2,getLastRow:()=>2,getNumColumns:()=>1,getColumn:()=>6};
ctx.Utilities.getUuid=()=>'adj1';
ctx.onEdit({range, value:'0', oldValue:'120'});
assert.equal(items.cells[1][7],'SHIPPED'); assert.ok(items.cells[1][15]>before); assert.ok(items.cells[1][16]>0);
assert.equal(sheets.Movements.cells[2][2],'ADJUST'); assert.equal(sheets.Movements.cells[2][3],-120);
assert.equal(sheets.Stock.cells.length,1); // nothing left in stock
r=post({token:'tok',action:'sync',since:items.cells[1][16]-1});
assert.equal(r.items.length,1); assert.equal(r.items[0].status,'SHIPPED'); assert.equal(r.items[0].remaining,0);
// edits on other tabs are ignored
ctx.onEdit({range:{getSheet:()=>sheets.Stock,getRow:()=>2,getLastRow:()=>2,getNumColumns:()=>1,getColumn:()=>1}});
// ship-outs: an OUT from phone B shows in Out by day and is returned to phone A on a full pull
r=post({token:'tok',action:'sync',since:0,movements:[{id:'o1',itemId:'ZX-251009-A0002',type:'OUT',qty:30,unit:'m',code:'101',size:'0.30*1400',reference:'INV-7',at:Date.UTC(2026,9,10,9),device:'B',user:'Reza'},{id:'o2',itemId:'ZX-251009-A0002',type:'OUT',qty:90,unit:'m',code:'101',size:'0.30*1400',reference:'',at:Date.UTC(2026,9,10,11),device:'B'}]});
const out=sheets['Out by day'].cells; assert.equal(out[1][4],1); assert.equal(out[1][5],120); assert.equal(out[1][6],'INV-7'); assert.equal(out[1][7],'Reza, phone B');
r=post({token:'tok',action:'sync',since:Date.now()+1000,movementsSince:0});
assert.ok(r.movements.some(m=>m.id==='o1' && m.qty===30 && m.at===Date.UTC(2026,9,10,9) && m.device==='B' && m.user==='Reza'));
assert.equal(sheets.Movements.cells[0][11],'User');
assert.equal(post({token:'tok',action:'sync',since:Date.now()+1000}).movements.length,0);
// undo the 30 m ship-out: Out by day drops it, the log keeps both rows
post({token:'tok',action:'sync',since:0,movements:[{id:'u1',itemId:'ZX-251009-A0002',type:'UNDO',qty:30,unit:'m',code:'101',size:'0.30*1400',reference:'o1',at:Date.UTC(2026,9,10,12),device:'A',user:'Ali'}]});
assert.equal(sheets['Out by day'].cells[1][5],90); assert.equal(sheets['Out by day'].cells[1][6],'');
assert.ok(sheets.Movements.cells.some(r=>r[0]==='o1') && sheets.Movements.cells.some(r=>r[0]==='u1' && r[11]==='Ali'));
// cuts: a CUT with customer and invoice, a WASTE, then undo the WASTE
post({token:'tok',action:'sync',since:0,movements:[
  {id:'c1',itemId:'ZX-251009-A0001',type:'CUT',qty:12.5,unit:'m',code:'101',size:'0.30*1400',reference:'Bahar · F-12',at:Date.UTC(2026,9,11,9),device:'A',user:'Sara',customer:'Bahar',invoice:'F-12'},
  {id:'w1',itemId:'ZX-251009-A0001',type:'WASTE',qty:1.5,unit:'m',code:'101',size:'0.30*1400',reference:'Short end',at:Date.UTC(2026,9,11,10),device:'A',user:'Sara'}]});
let cuts=sheets.Cuts.cells; assert.equal(cuts[0][2],'Customer'); assert.equal(cuts.length,3);
assert.equal(cuts[1][1],'Waste'); assert.equal(cuts[2][1],'Cut'); assert.equal(cuts[2][2],'Bahar'); assert.equal(cuts[2][3],'F-12'); assert.equal(cuts[2][6],12.5); assert.equal(cuts[2][9],'Sara');
// the mock dates every row the same day, so the cut joins the 90 m ship-out of 101
assert.ok(sheets['Out by day'].cells.some(r=>r[5]===102.5 && String(r[6]).includes('Bahar · F-12')));
assert.equal(sheets.Movements.cells[0][12],'Customer'); assert.ok(sheets.Movements.cells.some(r=>r[0]==='c1' && r[12]==='Bahar' && r[13]==='F-12'));
r=post({token:'tok',action:'sync',since:Date.now()+1000,movementsSince:0});
assert.ok(r.movements.some(m=>m.id==='c1' && m.customer==='Bahar' && m.invoice==='F-12'));
post({token:'tok',action:'sync',since:0,movements:[{id:'u2',itemId:'ZX-251009-A0001',type:'UNDO',qty:1.5,unit:'m',code:'101',size:'0.30*1400',reference:'w1',at:Date.UTC(2026,9,11,11),device:'A',user:'Sara'}]});
assert.equal(sheets.Cuts.cells.length,2); assert.equal(sheets.Cuts.cells[1][1],'Cut');
// customers: phone pushes two, a stale rename is ignored, a newer one applies
r=post({token:'tok',action:'sync',since:0,customers:[{id:'k1',name:'Bahar',createdAt:1000,createdBy:'Sara',updatedAt:1000,hidden:false},{id:'k2',name:'Ali Rezaei',createdAt:1000,createdBy:'Sara',updatedAt:1000,hidden:false}]});
assert.equal(r.customers.length,2); assert.equal(sheets.Customers.cells[0][1],'Name');
post({token:'tok',action:'sync',since:0,customers:[{id:'k1',name:'Old',createdAt:1000,createdBy:'Sara',updatedAt:500,hidden:false}]});
assert.equal(sheets.Customers.cells[1][1],'Bahar');
post({token:'tok',action:'sync',since:0,customers:[{id:'k2',name:'Ali Rezaei',createdAt:1000,createdBy:'Sara',updatedAt:2000,hidden:true}]});
assert.equal(sheets.Customers.cells[2][4],true);
// hand edit: a new name typed on row 4 gets an ID; renaming row 2 is stamped newer
const cs=sheets.Customers; cs.cells[3]=['','Mehdi Trading','','','','',''];
ctx.Utilities.getUuid=()=>'k3';
ctx.onEdit({range:{getSheet:()=>cs,getRow:()=>4,getLastRow:()=>4,getNumColumns:()=>1,getColumn:()=>2}});
assert.equal(cs.cells[3][0],'k3'); assert.equal(cs.cells[3][3],'SHEET'); assert.equal(cs.cells[3][4],false); assert.ok(cs.cells[3][5]>0);
cs.cells[1][1]='Bahar Design'; cs.cells[1][4]='yes';
ctx.onEdit({range:{getSheet:()=>cs,getRow:()=>2,getLastRow:()=>2,getNumColumns:()=>1,getColumn:()=>2}});
assert.ok(cs.cells[1][5]>1000); assert.equal(cs.cells[1][4],true);
r=post({token:'tok',action:'sync',since:cs.cells[1][6]-1});
assert.ok(r.customers.some(c=>c.id==='k1' && c.name==='Bahar Design' && c.hidden===true));
assert.ok(r.customers.some(c=>c.id==='k3' && c.name==='Mehdi Trading' && c.hidden===false && c.createdBy==='SHEET'));
console.log('APPS_SCRIPT_TESTS_OK');
