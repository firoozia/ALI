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
let r=post({token:'tok',action:'sync',since:0,shipments:[{id:'s1',name:'CN-1',source:'f.xlsx',createdAt:1,updatedAt:1}],expected:[{id:'e1',shipmentId:'s1',pallet:'1',lineNo:1,category:'PVC',code:'101',size:'0.30*1400',qty:120,unit:'m',netKg:64,grossKg:67,itemId:'ZX-251009-A0001',labelId:'ZX-261017-KO0001',updatedAt:1000}],items:[item, {...item,id:'ZX-251009-A0002'}],movements:[{id:'m1',itemId:item.id,type:'IN',qty:120,reference:'Pallet 1',at:1000,device:'A',code:'101',size:'x',unit:'m'}]});
assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.items.length,2); assert.equal(r.items[0].netKg,64); assert.equal(r.items[0].grossKg,null); assert.equal(r.items[0].shipmentId,'s1'); assert.equal(r.shipments[0].name,'CN-1');
assert.equal(sheets.Expected.cells[1][14],'ZX-261017-KO0001'); assert.equal(r.expected[0].labelId,'ZX-261017-KO0001');
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
let cuts=sheets.Cuts.cells; assert.equal(cuts[0][2],'Customer / reason'); assert.equal(cuts.length,3);
assert.equal(cuts[1][1],'Waste'); assert.equal(cuts[2][1],'Cut'); assert.equal(cuts[2][2],'Bahar'); assert.equal(cuts[2][3],'F-12'); assert.equal(cuts[2][6],12.5); assert.equal(cuts[2][9],'Sara');
// the mock dates every row the same day, so the cut joins the 90 m ship-out of 101
assert.ok(sheets['Out by day'].cells.some(r=>r[5]===102.5 && String(r[6]).includes('Bahar · F-12')));
assert.equal(sheets.Movements.cells[0][12],'Customer'); assert.ok(sheets.Movements.cells.some(r=>r[0]==='c1' && r[12]==='Bahar' && r[13]==='F-12'));
r=post({token:'tok',action:'sync',since:Date.now()+1000,movementsSince:0});
assert.ok(r.movements.some(m=>m.id==='c1' && m.customer==='Bahar' && m.invoice==='F-12'));
post({token:'tok',action:'sync',since:0,movements:[{id:'u2',itemId:'ZX-251009-A0001',type:'UNDO',qty:1.5,unit:'m',code:'101',size:'0.30*1400',reference:'w1',at:Date.UTC(2026,9,11,11),device:'A',user:'Sara'}]});
assert.equal(sheets.Cuts.cells.length,2); assert.equal(sheets.Cuts.cells[1][1],'Cut');
// damage: a DAMAGE row shows in Cuts with its reason, and an UNDO removes it again
post({token:'tok',action:'sync',since:0,movements:[{id:'d1',itemId:'ZX-251009-A0001',type:'DAMAGE',qty:3.5,unit:'m',code:'101',size:'0.30*1400',reference:'Torn · edge',at:Date.UTC(2026,9,11,12),device:'A',user:'Sara'}]});
assert.equal(sheets.Cuts.cells.length,3); assert.equal(sheets.Cuts.cells[1][1],'Damage'); assert.equal(sheets.Cuts.cells[1][2],'Torn · edge'); assert.equal(sheets.Cuts.cells[1][6],3.5);
post({token:'tok',action:'sync',since:0,movements:[{id:'u3',itemId:'ZX-251009-A0001',type:'UNDO',qty:3.5,unit:'m',code:'101',size:'0.30*1400',reference:'d1',at:Date.UTC(2026,9,11,13),device:'A',user:'Sara'}]});
assert.equal(sheets.Cuts.cells.length,2);
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
r=post({token:'tok',action:'sync',since:Math.min(cs.cells[1][6],cs.cells[3][6])-1});
assert.ok(r.customers.some(c=>c.id==='k1' && c.name==='Bahar Design' && c.hidden===true));
assert.ok(r.customers.some(c=>c.id==='k3' && c.name==='Mehdi Trading' && c.hidden===false && c.createdBy==='SHEET'));
// bulk paste: 194 names pasted in one go all get their own ID, and a phone pulls every one of them
const custBefore=cs.cells.length; let custSeq=0; ctx.Utilities.getUuid=()=>'bulk-'+(++custSeq);
for(let i=0;i<194;i++) cs.cells[custBefore+i]=['','CUSTOMER '+i,'','','','',''];
ctx.onEdit({range:{getSheet:()=>cs,getRow:()=>custBefore+1,getLastRow:()=>custBefore+194,getNumColumns:()=>1,getColumn:()=>2}});
assert.equal(new Set(cs.cells.slice(custBefore).map(r=>r[0])).size,194); assert.ok(cs.cells.slice(custBefore).every(r=>r[3]==='SHEET' && r[4]===false && r[5]>0));
r=post({token:'tok',action:'sync',since:0}); assert.ok(r.customers.filter(c=>c.name.startsWith('CUSTOMER ')).length===194);
// deleting a row in the sheet is not sent to phones: they simply stop hearing about it
cs.cells.splice(custBefore+190,4); r=post({token:'tok',action:'sync',since:0});
assert.equal(r.customers.filter(c=>c.name.startsWith('CUSTOMER ')).length,190);
// fallback: names pasted without the trigger running are stamped by hand
cs.cells.push(['','LATE NAME','','','','','']); ctx.Utilities.getUuid=()=>'late-1'; ctx.stampCustomers();
assert.equal(cs.cells[cs.cells.length-1][0],'late-1');
// admin code and quick poll
assert.equal(post({token:'tok',action:'verifyAdmin',code:'x'}).ok,false);
ctx.Utilities.getUuid=()=>'abcd1234-ffff';
const code = ctx.adminCode_(); assert.equal(code,'ABCD1234');
assert.equal(post({token:'tok',action:'verifyAdmin',code:' abcd1234 '}).ok,true);
assert.equal(post({token:'tok',action:'verifyAdmin',code:'nope'}).error,'Wrong admin code');
const rev0 = post({token:'tok',action:'poll'}).rev; assert.ok(rev0);
assert.equal(post({token:'bad',action:'poll'}).ok,false);
// users: pushed from a phone, returned to others; hand edit of Role in the sheet
r=post({token:'tok',action:'sync',since:0,users:[{id:'u1',name:'Ali',role:'ADMIN',canReceive:true,active:true,pinHash:'h1',salt:'s1',updatedAt:1000},
  {id:'u2',name:'Reza',role:'USER',canReceive:false,active:true,pinHash:'h2',salt:'s2',updatedAt:1000}]});
assert.equal(r.users.length,2); assert.equal(sheets.Users.cells[0][5],'PinHash');
assert.ok(r.users.some(u=>u.id==='u2' && u.role==='USER' && u.pinHash==='h2' && u.active===true && u.canReceive===false));
const us=sheets.Users; us.cells[2][2]='admin'; us.cells[2][3]='yes';
ctx.onEdit({range:{getSheet:()=>us,getRow:()=>3,getLastRow:()=>3,getNumColumns:()=>1,getColumn:()=>3}});
assert.equal(us.cells[2][2],'ADMIN'); assert.equal(us.cells[2][3],true); assert.ok(us.cells[2][7]>1000);
r=post({token:'tok',action:'sync',since:us.cells[2][8]-1});
assert.ok(r.users.some(u=>u.id==='u2' && u.role==='ADMIN' && u.canReceive===true));
// requests: user asks, first decision wins, a late different decision is ignored
const rq={id:'q1',kind:'UNDO',target:'c1',summary:'Undo cut 12.5 m of 101',reason:'wrong length',requestedBy:'Reza',device:'B',requestedAt:5000,status:'PENDING',decidedBy:'',decidedAt:0,note:'',updatedAt:5000};
r=post({token:'tok',action:'sync',since:0,requests:[rq]});
assert.ok(r.requests.some(q=>q.id==='q1' && q.status==='PENDING' && q.target==='c1' && q.reason==='wrong length'));
assert.notEqual(r.rev, rev0);
post({token:'tok',action:'sync',since:0,requests:[{...rq,status:'APPROVED',decidedBy:'Ali',decidedAt:6000,updatedAt:6000}]});
post({token:'tok',action:'sync',since:0,requests:[{...rq,status:'REJECTED',decidedBy:'Sara',decidedAt:7000,updatedAt:7000}]});
post({token:'tok',action:'sync',since:0,requests:[{...rq,updatedAt:8000}]});
const q=sheets.Requests.cells[1]; assert.equal(q[8],'APPROVED'); assert.equal(q[9],'Ali');
r=post({token:'tok',action:'sync',since:0}); assert.ok(r.requests.some(x=>x.id==='q1' && x.status==='APPROVED' && x.decidedAt===6000));
// an edit request keeps its new values
r=post({token:'tok',action:'sync',since:0,requests:[{...rq,id:'q2',kind:'EDIT',target:'ZX-251009-A0002',payload:'{"category":"EDGE_BANDING"}',updatedAt:9000}]});
assert.equal(sheets.Requests.cells[0][14],'Payload');
assert.ok(r.requests.some(x=>x.id==='q2' && x.kind==='EDIT' && x.payload==='{"category":"EDGE_BANDING"}'));
// an EDIT movement is logged but does not count as out
post({token:'tok',action:'sync',since:0,movements:[{id:'e1',itemId:'ZX-251009-A0002',type:'EDIT',qty:90,unit:'m',code:'101',size:'0.30*1400',reference:'Category PVC film → Edge banding',at:Date.UTC(2026,9,12,9),device:'A',user:'Ali'}]});
assert.ok(sheets.Movements.cells.some(r=>r[0]==='e1' && r[2]==='EDIT'));
assert.ok(!sheets['Out by day'].cells.some(r=>r[5]===90 && r[0]!=='Date' && String(r[7]).includes('Ali') && r[6]==='Category PVC film → Edge banding'));
// groups and products: pushed from a phone, Stock shows group names, rows typed in the sheet get IDs
r=post({token:'tok',action:'sync',since:0,groups:[{id:'PVC',name:'PVC film',unit:'m',pack:'roll',order:0,hidden:false,updatedAt:1},{id:'G_MDF',name:'MDF board',unit:'pcs',pack:'sheet',order:7,hidden:false,updatedAt:5000}],
  products:[{id:'P1',groupId:'PVC',code:'101',size:'0.30*1400',unit:'m',packQty:120,note:'White gloss',hidden:false,updatedAt:5000}],
  items:[{...item,id:'ZX-251009-A0009',category:'G_MDF',code:'M-18',size:'18mm',unit:'pcs',qty:10,remaining:10,location:'',updatedAt:9000}]});
assert.equal(r.groups.length,2); assert.ok(r.products.some(p=>p.id==='P1' && p.note==='White gloss' && p.packQty===120));
assert.ok(sheets.Stock.cells.some(r=>r[0]==='MDF board' && r[1]==='M-18'));
const gs=sheets.Groups; gs.cells.push(['','Handle','','','','','','']);
ctx.onEdit({range:{getSheet:()=>gs,getRow:()=>gs.cells.length,getLastRow:()=>gs.cells.length,getNumColumns:()=>1,getColumn:()=>2}});
const g=gs.cells[gs.cells.length-1]; assert.equal(g[0],'G_HANDLE'); assert.equal(g[2],'pcs'); assert.equal(g[3],'pack'); assert.equal(g[5],false);
const ps=sheets.Products; ctx.Utilities.getUuid=()=>'abcdef12-3456-7890-abcd-ef1234567890'; ps.cells.push(['','G_HANDLE','H-1','128mm','pcs',50,'Black','','','']);
ctx.onEdit({range:{getSheet:()=>ps,getRow:()=>ps.cells.length,getLastRow:()=>ps.cells.length,getNumColumns:()=>1,getColumn:()=>3}});
const pr=ps.cells[ps.cells.length-1]; assert.ok(String(pr[0]).startsWith('P_')); assert.ok(pr[8]>0);
r=post({token:'tok',action:'sync',since:Math.min(pr[9],g[7])-1});
assert.ok(r.products.some(p=>p.code==='H-1' && p.groupId==='G_HANDLE' && p.note==='Black'));
assert.ok(r.groups.some(x=>x.id==='G_HANDLE' && x.name==='Handle'));
// devices, counts, reservations and returns
r=post({token:'tok',action:'sync',since:0,device:'B',user:'Sara',appVersion:'2.15.0',
  counts:[{id:'c1',place:'Warehouse 1',at:5000,user:'Sara',device:'B',expected:3,found:2,missing:1,extra:1,missingIds:['ZX-1'],extraIds:['ZX-9']}],
  items:[{...item,id:'ZX-251009-A0077',reservedFor:'Bahar Design',updatedAt:99999}],
  movements:[{id:'ret1',itemId:'ZX-251009-A0077',type:'RETURN',qty:12,reference:'Bahar Design',at:6000,device:'B',code:'101',size:'x',unit:'m',user:'Sara',customer:'Bahar Design',invoice:'INV-9'}]});
assert.ok(r.devices.some(d=>d.device==='B' && d.user==='Sara' && d.appVersion==='2.15.0' && d.at>0));
assert.deepEqual(sheets.Counts.cells[1].slice(5,11),[3,2,1,1,'ZX-1','ZX-9']);
assert.ok(r.items.some(i=>i.id==='ZX-251009-A0077' && i.reservedFor==='Bahar Design'));
assert.ok(sheets.Cuts.cells.some(x=>x[1]==='Return' && x[2]==='Bahar Design' && x[6]===12));
post({token:'tok',action:'sync',since:0,device:'B',user:'Ali',appVersion:'2.15.0',counts:[{id:'c1',place:'Warehouse 1'}]});
assert.equal(sheets.Devices.cells.filter(x=>x[0]==='B').length,1); assert.equal(sheets.Counts.cells.length,2);
// minimum stock: pushed from a phone, read back, and listed in the Low stock tab
r=post({token:'tok',action:'sync',since:0,products:[{id:'P_MDF',groupId:'G_MDF',code:'M-18',size:'18mm',unit:'pcs',packQty:0,note:'',hidden:false,updatedAt:9500,minQty:20},
  {id:'P_OK',groupId:'PVC',code:'101',size:'0.30*1400',unit:'m',packQty:120,note:'',hidden:false,updatedAt:9500,minQty:1}]});
assert.ok(r.products.some(p=>p.id==='P_MDF' && p.minQty===20));
const lowRows=sheets['Low stock'].cells.slice(1).filter(x=>x[1]);
assert.deepEqual(lowRows.find(x=>x[1]==='M-18').slice(0,9),['MDF board','M-18','18mm','pcs',1,10,20,10,'LOW']);
assert.ok(lowRows.every(x=>x[5]<=x[6]));
// nightly backup retention: last 30 days all, then the first of each month for 12 months
{
  const fmt=ctx.Utilities.formatDate; ctx.Utilities.formatDate=(d,tz,f)=>f==='yyyy-MM'?d.toISOString().slice(0,7):fmt(d,tz,f);
  const day=86400000, now=Date.UTC(2026,9,18);
  const backups=[]; for(let i=0;i<500;i++) backups.push({id:i, at:now-i*day});
  const del=new Set(ctx.backupsToDelete_(backups,now,'UTC').map(b=>b.id));
  for(let i=0;i<=30;i++) assert.ok(!del.has(i),'recent '+i);
  const kept=backups.filter(b=>!del.has(b.id)&&b.id>30);
  assert.ok(kept.length>=11 && kept.length<=13, 'monthly kept '+kept.length);
  assert.equal(new Set(kept.map(b=>new Date(b.at).toISOString().slice(0,7))).size, kept.length, 'one per month');
  assert.ok(kept.filter(b=>b.id<400).every(b=>new Date(b.at).getUTCDate()===1), 'first of month');
  assert.ok(del.has(499));
  ctx.Utilities.formatDate=fmt;
}
props.ZINAX_LAST_BACKUP='1234';
assert.equal(post({token:'tok',action:'sync',since:0}).lastBackup,1234);
console.log('APPS_SCRIPT_TESTS_OK');
