/**
 * Zinax Stock: Google Sheets backend.
 *
 * Install (once):
 * 1. Create a Google Sheet named "Zinax Stock Data".
 * 2. Extensions > Apps Script, paste this file, save.
 * 3. Run `setup` and allow access. The log prints the token for the app.
 * 4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *    Copy the URL ending in /exec into the app's Settings with the token.
 *
 * `setup` also installs the weekly backup (see BACKUP_* below).
 */

const BACKUP_DAY = ScriptApp.WeekDay.FRIDAY;
const BACKUP_HOUR = 2;
const BACKUP_KEEP = 12;
const BACKUP_FOLDER = 'Zinax Stock Backups';

// Column order of each sheet. The first column is the row ID; ServerAt is set by this script.
const SHEETS = {
  Items: ['ID', 'Category', 'Code', 'Size', 'Qty', 'Remaining', 'Unit', 'Status', 'Shipment', 'Pallet', 'NetKg', 'GrossKg',
          'ReceivedAt', 'Location', 'Device', 'UpdatedAt', 'ServerAt', 'ShipmentId'],
  Movements: ['ID', 'ItemID', 'Type', 'Qty', 'Unit', 'Code', 'Size', 'Reference', 'At', 'Device', 'ServerAt', 'User',
              'Customer', 'Invoice'],
  Shipments: ['ID', 'Name', 'Source', 'CreatedAt', 'UpdatedAt', 'ServerAt'],
  Expected: ['ID', 'ShipmentID', 'Pallet', 'Line', 'Category', 'Code', 'Size', 'Qty', 'Unit', 'NetKg', 'GrossKg', 'ItemID',
             'UpdatedAt', 'ServerAt'],
  // Customer library shared by the phones. Add a name on a new row, fix a name, or put TRUE in Hidden to stop suggesting it.
  Customers: ['ID', 'Name', 'CreatedAt', 'By', 'Hidden', 'UpdatedAt', 'ServerAt'],
};

// Columns kept as plain text so codes like "0101" or sizes like "0.30*1400" are not turned into numbers.
const TEXT_COLUMNS = {
  Items: ['Code', 'Size', 'Pallet'],
  Movements: ['Code', 'Size', 'Invoice'],
  Expected: ['Pallet', 'Code', 'Size'],
  Shipments: [],
  Customers: ['Name'],
};

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) { sheet_(name); });
  stockSheet_();
  outSheet_();
  cutsSheet_();
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('ZINAX_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    props.setProperty('ZINAX_TOKEN', token);
  }
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'weeklyBackup'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(BACKUP_DAY).atHour(BACKUP_HOUR).create();
  Logger.log('Token for the app: ' + token);
  Logger.log('Sheet: ' + ss.getUrl());
}

function doGet() {
  return json_({ ok: true, app: 'Zinax Stock', hint: 'POST from the app to sync.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const req = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('ZINAX_TOKEN');
    if (!token || req.token !== token) return json_({ ok: false, error: 'Wrong token. Copy it again from the Apps Script log.' });
    if (req.action === 'ping') return json_({ ok: true, now: Date.now() });
    if (req.action === 'sync') return json_(sync_(req));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function sync_(req) {
  const now = Date.now();
  const since = Number(req.since) || 0;
  const shipmentNames = {};

  upsert_('Shipments', req.shipments || [], function (s) {
    return [s.id, s.name, s.source, date_(s.createdAt), s.updatedAt, now];
  }, 4);
  readAll_('Shipments').forEach(function (r) { shipmentNames[r[0]] = r[1]; });

  upsert_('Expected', req.expected || [], function (u) {
    return [u.id, u.shipmentId, u.pallet, u.lineNo, u.category, u.code, u.size, u.qty, u.unit,
            blank_(u.netKg), blank_(u.grossKg), u.itemId || '', u.updatedAt, now];
  }, 12);

  upsert_('Items', req.items || [], function (i) {
    return [i.id, i.category, i.code, i.size, i.qty, i.remaining, i.unit, i.status, shipmentNames[i.shipmentId] || '',
            i.pallet || '', blank_(i.netKg), blank_(i.grossKg), date_(i.receivedAt), i.location || '', i.device,
            i.updatedAt, now, i.shipmentId || ''];
  }, 15);

  appendNew_('Movements', req.movements || [], function (m) {
    return [m.id, m.itemId, m.type, m.qty, m.unit, m.code, m.size, m.reference || '', date_(m.at), m.device, now, m.user || '',
            m.customer || '', m.invoice || ''];
  });

  upsert_('Customers', req.customers || [], function (c) {
    return [c.id, c.name, date_(c.createdAt), c.createdBy || '', c.hidden ? true : false, c.updatedAt, now];
  }, 5);

  if ((req.items || []).length) stockSheet_();
  if ((req.movements || []).length) { outSheet_(); cutsSheet_(); }
  const movementsSince = req.movementsSince === undefined ? since : Number(req.movementsSince) || 0;

  return {
    ok: true,
    now: now,
    sheetUrl: SpreadsheetApp.getActive().getUrl(),
    shipments: changed_('Shipments', since).map(function (r) {
      return { id: r[0], name: r[1], source: r[2], createdAt: ms_(r[3]), updatedAt: Number(r[4]) };
    }),
    expected: changed_('Expected', since).map(function (r) {
      return { id: r[0], shipmentId: r[1], pallet: String(r[2]), lineNo: Number(r[3]), category: r[4], code: String(r[5]),
               size: String(r[6]), qty: Number(r[7]), unit: r[8], netKg: num_(r[9]), grossKg: num_(r[10]),
               itemId: r[11], updatedAt: Number(r[12]) };
    }),
    items: changed_('Items', since).map(function (r) {
      return { id: r[0], category: r[1], code: String(r[2]), size: String(r[3]), qty: Number(r[4]), remaining: Number(r[5]),
               unit: r[6], status: r[7], pallet: String(r[9]), netKg: num_(r[10]), grossKg: num_(r[11]),
               receivedAt: ms_(r[12]), location: String(r[13]), device: r[14], updatedAt: Number(r[15]), shipmentId: r[17] };
    }),
    movements: changed_('Movements', movementsSince).map(function (r) {
      return { id: r[0], itemId: r[1], type: r[2], qty: Number(r[3]), unit: r[4], code: String(r[5]), size: String(r[6]),
               reference: String(r[7]), at: ms_(r[8]), device: String(r[9]), user: String(r[11] || ''),
               customer: String(r[12] || ''), invoice: String(r[13] || '') };
    }),
    customers: changed_('Customers', since).filter(function (r) { return String(r[1]).trim(); }).map(function (r) {
      return { id: String(r[0]), name: String(r[1]).trim(), createdAt: ms_(r[2]), createdBy: String(r[3] || ''),
               hidden: yes_(r[4]), updatedAt: Number(r[5]) || 0 };
    }),
  };
}

// ---------- hand edits in the sheet ----------

/**
 * Runs when someone edits the sheet by hand. Edits in the Items tab are stamped so the phones
 * pick them up on their next sync. Remaining 0 marks a package shipped; above 0 puts it back in stock.
 * A change to Remaining is logged in Movements as ADJUST.
 */
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() === 'Customers') return customersEdited_(e);
  if (sh.getName() !== 'Items') return;
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last < first) return;
  const cols = SHEETS.Items;
  const C = function (name) { return cols.indexOf(name); };
  const rows = sh.getRange(first, 1, last - first + 1, cols.length).getValues();
  const now = Date.now();
  rows.forEach(function (r) {
    if (!r[0]) return;
    if (r[C('Remaining')] !== '' && !isNaN(Number(r[C('Remaining')]))) {
      const left = Number(r[C('Remaining')]);
      if (left <= 0 && r[C('Status')] === 'IN_STOCK') r[C('Status')] = 'SHIPPED';
      else if (left > 0 && r[C('Status')] === 'SHIPPED') r[C('Status')] = 'IN_STOCK';
    }
    // Never older than what a phone last wrote, even if its clock runs ahead.
    r[C('UpdatedAt')] = Math.max(now, (Number(r[C('UpdatedAt')]) || 0) + 1);
    r[C('ServerAt')] = now;
  });
  sh.getRange(first, 1, rows.length, cols.length).setValues(rows);

  const remainingCol = C('Remaining') + 1;
  if (rows.length === 1 && e.range.getNumColumns() === 1 && e.range.getColumn() === remainingCol && rows[0][0]) {
    const r = rows[0];
    const delta = (Number(e.value) || 0) - (Number(e.oldValue) || 0);
    if (delta !== 0) {
      const mv = sheet_('Movements');
      mv.getRange(mv.getLastRow() + 1, 1, 1, SHEETS.Movements.length).setValues([[
        Utilities.getUuid(), r[0], 'ADJUST', delta, r[C('Unit')], r[C('Code')], r[C('Size')],
        'Edited in sheet', new Date(now), 'SHEET', now, '', '', '',
      ]]);
    }
  }
  stockSheet_();
}

/**
 * Edits in the Customers tab: a name typed on a new row gets an ID; every edited row is stamped
 * so the phones take the change on their next sync.
 */
function customersEdited_(e) {
  const sh = e.range.getSheet();
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last < first) return;
  const width = SHEETS.Customers.length;
  const rows = sh.getRange(first, 1, last - first + 1, width).getValues();
  const now = Date.now();
  rows.forEach(function (r) {
    if (!String(r[1]).trim()) return;
    if (!r[0]) {
      r[0] = Utilities.getUuid();
      r[2] = new Date(now);
      r[3] = r[3] || 'SHEET';
    }
    r[4] = yes_(r[4]);
    r[5] = Math.max(now, (Number(r[5]) || 0) + 1);
    r[6] = now;
  });
  sh.getRange(first, 1, rows.length, width).setValues(rows);
}

// ---------- sheet helpers ----------

function sheet_(name) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  const headers = SHEETS[name];
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 || sh.getRange(1, 1).getValue() !== headers[0]) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    TEXT_COLUMNS[name].forEach(function (col) {
      const c = headers.indexOf(col) + 1;
      sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  } else if (sh.getLastColumn() < headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sh;
}

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEETS[name].length).getValues();
}

/** Insert or replace rows by ID. A row is replaced only when the incoming UpdatedAt is not older. */
function upsert_(name, objects, toRow, updatedIdx) {
  if (!objects.length) return;
  const sh = sheet_(name);
  const width = SHEETS[name].length;
  const data = readAll_(name);
  const index = {};
  data.forEach(function (r, i) { index[String(r[0])] = i; });
  let changed = false;
  objects.forEach(function (o) {
    const row = toRow(o);
    const i = index[String(row[0])];
    if (i === undefined) {
      index[String(row[0])] = data.length;
      data.push(row);
      changed = true;
    } else if (Number(data[i][updatedIdx]) <= Number(row[updatedIdx])) {
      data[i] = row;
      changed = true;
    }
  });
  if (changed) sh.getRange(2, 1, data.length, width).setValues(data);
}

function appendNew_(name, objects, toRow) {
  if (!objects.length) return;
  const sh = sheet_(name);
  const seen = {};
  readAll_(name).forEach(function (r) { seen[String(r[0])] = true; });
  const rows = objects.filter(function (o) { return !seen[String(o.id)]; }).map(toRow);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, SHEETS[name].length).setValues(rows);
}

function changed_(name, since) {
  const at = SHEETS[name].indexOf('ServerAt');
  return readAll_(name).filter(function (r) { return Number(r[at]) > since; });
}

/** Code sort: by category, then numeric codes as numbers, then text. */
function byCode_(a, b, catIdx, codeIdx) {
  if (a[catIdx] !== b[catIdx]) return a[catIdx] < b[catIdx] ? -1 : 1;
  const na = Number(a[codeIdx]), nb = Number(b[codeIdx]);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a[codeIdx]) < String(b[codeIdx]) ? -1 : String(a[codeIdx]) > String(b[codeIdx]) ? 1 : 0;
}

/**
 * Rebuilds the two summary tabs from Items:
 * Stock, one row per code with where it is kept, and By location, one row per location and code.
 */
function stockSheet_() {
  const ss = SpreadsheetApp.getActive();
  const NONE = 'No location';
  const groups = {};
  const places = {};
  readAll_('Items').forEach(function (r) {
    if (r[7] !== 'IN_STOCK') return;
    const key = [r[1], r[2], r[3], r[6]].join('|');
    if (!groups[key]) groups[key] = { row: [r[1], r[2], r[3], r[6], 0, 0], where: {} };
    const g = groups[key];
    const loc = String(r[13] || '').trim() || NONE;
    g.row[4] += 1;
    g.row[5] += Number(r[5]) || 0;
    g.where[loc] = (g.where[loc] || 0) + 1;
    const pkey = [loc, key].join('|');
    if (!places[pkey]) places[pkey] = [loc, r[1], r[2], r[3], r[6], 0, 0];
    places[pkey][5] += 1;
    places[pkey][6] += Number(r[5]) || 0;
  });
  const updated = 'Updated ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');

  const stockRows = Object.keys(groups).map(function (k) {
    const g = groups[k];
    const where = Object.keys(g.where)
      .sort(function (a, b) { return g.where[b] - g.where[a]; })
      .map(function (loc) { return loc + ': ' + g.where[loc]; })
      .join(', ');
    return g.row.concat([where]);
  }).sort(function (a, b) { return byCode_(a, b, 0, 1); });
  writeSummary_(ss, 'Stock', 0, ['Category', 'Code', 'Size', 'Unit', 'Packages', 'Total', 'Locations'], stockRows, updated);

  const placeRows = Object.keys(places).map(function (k) { return places[k]; }).sort(function (a, b) {
    if (a[0] !== b[0]) {
      if (a[0] === NONE) return 1;
      if (b[0] === NONE) return -1;
      return a[0] < b[0] ? -1 : 1;
    }
    return byCode_(a, b, 1, 2);
  });
  writeSummary_(ss, 'By location', 1, ['Location', 'Category', 'Code', 'Size', 'Unit', 'Packages', 'Total'], placeRows, updated);
}

function writeSummary_(ss, name, position, headers, rows, updated) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, position);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.getRange(1, headers.length + 2).setValue(updated);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(1);
}

/** IDs of ship-outs, cuts and write-offs cancelled in the app: each has an UNDO row whose Reference is its ID. */
function undone_(moves) {
  const undone = {};
  moves.forEach(function (r) { if (r[2] === 'UNDO') undone[String(r[7])] = true; });
  return undone;
}

/** Out by day: what left the warehouse each day (shipped and cut), per code. Newest day first. */
function outSheet_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const groups = {};
  const moves = readAll_('Movements');
  const undone = undone_(moves);
  moves.forEach(function (r) {
    if ((r[2] !== 'OUT' && r[2] !== 'CUT') || undone[String(r[0])]) return;
    const day = Utilities.formatDate(new Date(ms_(r[8])), tz, 'yyyy-MM-dd');
    const key = [day, r[5], r[6], r[4]].join('|');
    if (!groups[key]) groups[key] = { row: [day, String(r[5]), String(r[6]), r[4], 0, 0], items: {}, refs: {}, by: {} };
    const g = groups[key];
    g.items[r[1]] = true;
    g.row[5] += Number(r[3]) || 0;
    if (String(r[7]).trim()) g.refs[String(r[7]).trim()] = true;
    g.by[String(r[11] || '').trim() || ('phone ' + r[9])] = true;
  });
  const rows = Object.keys(groups).map(function (k) {
    const g = groups[k];
    g.row[4] = Object.keys(g.items).length;
    return g.row.concat([Object.keys(g.refs).join(', '), Object.keys(g.by).join(', ')]);
  }).sort(function (a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? 1 : -1;
    return byCode_(a, b, 3, 1);
  });
  writeSummary_(ss, 'Out by day', 2, ['Date', 'Code', 'Size', 'Unit', 'Packages', 'Total', 'Customer / invoice', 'By'], rows,
    'Updated ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'));
}

/** Cuts: every cut for a customer and every short end written off, newest first. */
function cutsSheet_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const moves = readAll_('Movements');
  const undone = undone_(moves);
  const rows = moves.filter(function (r) {
    return (r[2] === 'CUT' || r[2] === 'WASTE') && !undone[String(r[0])];
  }).sort(function (a, b) { return ms_(b[8]) - ms_(a[8]); }).map(function (r) {
    return [Utilities.formatDate(new Date(ms_(r[8])), tz, 'yyyy-MM-dd HH:mm'), r[2] === 'CUT' ? 'Cut' : 'Waste',
            String(r[12] || ''), String(r[13] || ''), String(r[5]), String(r[6]), Number(r[3]) || 0, r[4], r[1],
            String(r[11] || '').trim() || ('phone ' + r[9])];
  });
  writeSummary_(ss, 'Cuts', 3, ['Date', 'Type', 'Customer', 'Invoice', 'Code', 'Size', 'Length', 'Unit', 'Roll', 'By'], rows,
    'Updated ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'));
}

// ---------- weekly backup ----------

function weeklyBackup() {
  const ss = SpreadsheetApp.getActive();
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  const stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' backup ' + stamp, folder);

  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });
}

// ---------- values ----------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function date_(ms) { return ms ? new Date(Number(ms)) : ''; }
function ms_(v) { return v instanceof Date ? v.getTime() : Number(v) || 0; }
function num_(v) { return v === '' || v === null || isNaN(Number(v)) ? null : Number(v); }
function yes_(v) { return v === true || /^(true|yes|y|1|x)$/i.test(String(v).trim()); }
function blank_(v) { return v === null || v === undefined ? '' : v; }
