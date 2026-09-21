/**
 * HÀNH TINH XANH - GOOGLE SHEET SYNC V23
 *
 * Firestore là database chính.
 * Google Sheet là lớp đồng bộ / báo cáo / backup.
 * Không đồng bộ passwordHash tài khoản sang Sheet.
 */

const HTX_SYNC_VERSION = 23;

const HTX_KEYS = {
  ORDERS: "htx_auto_quotes_v5",
  CUSTOMERS: "htx_customer_profiles_v10",
  INVENTORY: "htx_inventory_v7",
  CUSTOM_PRODUCTS: "htx_custom_products_v7",
  PAYROLL: "htx_payroll_v17",
  WORK_MONTH: "htx_work_month_v7",
  PRICE_ADJUST: "htx_price_adjustments_v6",
  CATALOG_OVERRIDES: "htx_catalog_overrides_v7"
};

const SHEETS = {
  ORDERS: "DON_HANG",
  CUSTOMERS: "KHACH_HANG",
  INVENTORY: "TON_KHO",
  CUSTOM_PRODUCTS: "SAN_PHAM_TUY_CHINH",
  PAYROLL: "LUONG_CHAM_CONG",
  WORK_MONTH: "THANG_LAM_VIEC",
  PRICE_ADJUST: "DIEU_CHINH_GIA",
  CATALOG_OVERRIDES: "GIA_CHI_TIET",
  LOG: "NHAT_KY_DONG_BO"
};

const HEADERS = {
  DON_HANG: [
    "ID","MA_DON","NGAY_TAO","CAP_NHAT","KHACH_HANG","CONG_TY","SDT",
    "TRANG_THAI","DON_GAP","GIAO_DU_KIEN","NV_THIET_KE",
    "TIEN_HANG","PHI_THIET_KE","PHI_SHIP","VAT","TONG_DON",
    "DAT_COC","CON_LAI","DA_THU","CACH_THU","SO_HANG_MUC","JSON_DATA"
  ],
  KHACH_HANG: [
    "ID","MA_KH","TEN_KHACH_HANG","CONG_TY","SDT","EMAIL","DIA_CHI","MST","CCCD",
    "NHOM_KH","PHU_TRACH","GHI_CHU","JSON_DATA"
  ],
  TON_KHO: [
    "ID","TEN_VAT_TU","DON_VI","KICH_THUOC","TON_KHO","TON_TOI_THIEU",
    "NHA_CUNG_CAP","SDT","LIEN_HE","GHI_CHU","JSON_DATA"
  ],
  SAN_PHAM_TUY_CHINH: [
    "ID","KEY","TEN_SAN_PHAM","NHOM","SO_QUY_CACH","GHI_CHU","JSON_DATA"
  ],
  LUONG_CHAM_CONG: [
    "THANG","ID","NHAN_VIEN","TAI_KHOAN","VAI_TRO","LUONG_CO_BAN","NGAY_CONG",
    "NGAY_CONG_CHUAN","GIO_TANG_CA","KPI","BHXH","LUONG_DONG_BHXH","JSON_DATA"
  ],
  THANG_LAM_VIEC: ["KEY","GIA_TRI","JSON_DATA"],
  DIEU_CHINH_GIA: ["KEY","GIA_TRI_JSON","JSON_DATA"],
  GIA_CHI_TIET: ["KEY","GIA_TRI_JSON","JSON_DATA"],
  NHAT_KY_DONG_BO: ["THOI_GIAN","HANH_DONG","KEY","NGUON","CHI_TIET"]
};

function setupGoogleSheet(syncSecret) {
  if (!syncSecret || String(syncSecret).length < 16) {
    throw new Error("SYNC SECRET nên có ít nhất 16 ký tự.");
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Hãy chạy setupGoogleSheet từ Apps Script được gắn với Google Sheet.");

  PropertiesService.getScriptProperties().setProperties({
    HTX_SPREADSHEET_ID: ss.getId(),
    HTX_SYNC_SECRET: String(syncSecret),
    HTX_SYNC_VERSION: String(HTX_SYNC_VERSION)
  }, true);

  Object.keys(SHEETS).forEach(function(k) { ensureSheet_(SHEETS[k]); });
  formatAllSheets_();
  appendLog_("SETUP", "", "Apps Script", "Khởi tạo Google Sheet Sync V" + HTX_SYNC_VERSION);
  return "Đã khởi tạo Google Sheet Sync. Spreadsheet ID: " + ss.getId();
}

function setSyncSecret(syncSecret) {
  if (!syncSecret || String(syncSecret).length < 16) {
    throw new Error("SYNC SECRET nên có ít nhất 16 ký tự.");
  }
  PropertiesService.getScriptProperties().setProperty("HTX_SYNC_SECRET", String(syncSecret));
  return "Đã cập nhật SYNC SECRET.";
}

function getSyncInfo() {
  var p = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: p.getProperty("HTX_SPREADSHEET_ID"),
    version: p.getProperty("HTX_SYNC_VERSION"),
    secretConfigured: !!p.getProperty("HTX_SYNC_SECRET")
  };
}

function doGet() {
  return json_({
    ok: true,
    service: "Hanh Tinh Xanh Google Sheet Sync",
    version: HTX_SYNC_VERSION,
    message: "Dùng POST để đồng bộ dữ liệu."
  });
}

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    authorize_(payload.secret);

    var action = String(payload.action || "");
    if (action === "ping") {
      var ss = openSpreadsheet_();
      return json_({ok:true,version:HTX_SYNC_VERSION,spreadsheetId:ss.getId(),spreadsheetName:ss.getName()});
    }
    if (action === "syncKey") {
      syncKey_(payload.key, payload.value);
      appendLog_("SYNC_KEY", payload.key, source_(payload), "Đồng bộ 1 nhóm dữ liệu");
      return json_({ok:true,key:payload.key});
    }
    if (action === "syncAll") {
      var state = payload.state || {};
      Object.keys(state).forEach(function(key) { syncKey_(key, state[key]); });
      appendLog_("SYNC_ALL", "", source_(payload), "Đồng bộ toàn bộ dữ liệu");
      return json_({ok:true,keys:Object.keys(state)});
    }
    if (action === "pullAll") {
      var pulled = pullAll_();
      appendLog_("PULL_ALL", "", source_(payload), "Backend lấy dữ liệu từ Google Sheet");
      return json_({ok:true,state:pulled});
    }
    throw new Error("Action không được hỗ trợ: " + action);
  } catch (err) {
    return json_({ok:false,error:String(err && err.message ? err.message : err)});
  }
}

function authorize_(secret) {
  var expected = PropertiesService.getScriptProperties().getProperty("HTX_SYNC_SECRET");
  if (!expected) throw new Error("Apps Script chưa được setup SYNC SECRET.");
  if (String(secret || "") !== expected) throw new Error("SYNC SECRET không hợp lệ.");
}

function source_(payload) {
  return payload && payload.meta && payload.meta.source ? String(payload.meta.source) : "backend";
}

function openSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty("HTX_SPREADSHEET_ID");
  if (!id) throw new Error("Chưa có HTX_SPREADSHEET_ID. Hãy chạy setupGoogleSheet(secret).");
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(name) {
  var ss = openSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var headers = HEADERS[name] || [];
  if (headers.length) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}

function clearAndWrite_(sheetName, rows) {
  var sh = ensureSheet_(sheetName);
  var headers = HEADERS[sheetName] || [];
  sh.clearContents();
  if (headers.length) sh.getRange(1,1,1,headers.length).setValues([headers]);
  if (rows && rows.length) sh.getRange(2,1,rows.length,headers.length).setValues(rows);
  formatSheet_(sh, headers.length);
}

function formatSheet_(sh, columnCount) {
  if (!columnCount) return;
  sh.setFrozenRows(1);
  sh.getRange(1,1,1,columnCount).setFontWeight("bold").setBackground("#07562f").setFontColor("#ffffff");
  sh.getDataRange().setVerticalAlignment("top");
  try { sh.autoResizeColumns(1, Math.min(columnCount, 12)); } catch (e) {}
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2,1,last-1,columnCount).setWrap(true);
}

function formatAllSheets_() {
  Object.keys(SHEETS).forEach(function(k) {
    var name=SHEETS[k];
    var sh=ensureSheet_(name);
    formatSheet_(sh,(HEADERS[name]||[]).length);
  });
}

function syncKey_(key, value) {
  if (key === HTX_KEYS.ORDERS) return writeOrders_(value || []);
  if (key === HTX_KEYS.CUSTOMERS) return writeCustomers_(value || []);
  if (key === HTX_KEYS.INVENTORY) return writeInventory_(value || []);
  if (key === HTX_KEYS.CUSTOM_PRODUCTS) return writeCustomProducts_(value || []);
  if (key === HTX_KEYS.PAYROLL) return writePayroll_(value || {});
  if (key === HTX_KEYS.WORK_MONTH) return writeSingleValue_(SHEETS.WORK_MONTH, key, value);
  if (key === HTX_KEYS.PRICE_ADJUST) return writeSingleValue_(SHEETS.PRICE_ADJUST, key, value);
  if (key === HTX_KEYS.CATALOG_OVERRIDES) return writeSingleValue_(SHEETS.CATALOG_OVERRIDES, key, value);
  throw new Error("Không hỗ trợ sync key: " + key);
}

function pullAll_() {
  var state = {};
  state[HTX_KEYS.ORDERS] = readJsonRows_(SHEETS.ORDERS);
  state[HTX_KEYS.CUSTOMERS] = readJsonRows_(SHEETS.CUSTOMERS);
  state[HTX_KEYS.INVENTORY] = readJsonRows_(SHEETS.INVENTORY);
  state[HTX_KEYS.CUSTOM_PRODUCTS] = readJsonRows_(SHEETS.CUSTOM_PRODUCTS);
  state[HTX_KEYS.PAYROLL] = readPayroll_();
  state[HTX_KEYS.WORK_MONTH] = readSingleValue_(SHEETS.WORK_MONTH);
  state[HTX_KEYS.PRICE_ADJUST] = readSingleValue_(SHEETS.PRICE_ADJUST);
  state[HTX_KEYS.CATALOG_OVERRIDES] = readSingleValue_(SHEETS.CATALOG_OVERRIDES);
  return state;
}

function writeOrders_(list) {
  var rows = (Array.isArray(list) ? list : []).map(function(o) {
    var ci = o.customerInfo || {};
    var t = o.totals || {};
    var dep = o.deposit || {};
    var subtotal = number_(t.subtotal, sumItems_(o.items));
    var grand = number_(o.total, t.grand, subtotal + number_(t.designFee,o.designFee) + number_(t.shipFee,o.shipFee) + number_(t.vat));
    var deposit = number_(dep.amount);
    var remaining = dep.remaining !== undefined ? number_(dep.remaining) : Math.max(0, grand - deposit);
    return [
      safe_(o.id),safe_(o.orderCode),safe_(o.createdAt),safe_(o.updatedAt),
      safe_(o.customer || ci.name),safe_(ci.company),safe_(ci.phone),
      safe_(o.status),o.urgent ? "GẤP" : "",safe_(o.expectedDelivery),safe_(o.designerName),
      subtotal,number_(t.designFee,o.designFee),number_(t.shipFee,o.shipFee),number_(t.vat),
      grand,deposit,remaining,o.paid ? "ĐÃ THU" : "CHƯA THU",safe_(o.paymentMethod),
      Array.isArray(o.items) ? o.items.length : number_(o.count),JSON.stringify(o)
    ];
  });
  clearAndWrite_(SHEETS.ORDERS, rows);
}

function writeCustomers_(list) {
  var rows=(Array.isArray(list)?list:[]).map(function(c){
    return [
      safe_(c.id),safe_(c.code),safe_(c.name),safe_(c.company),safe_(c.phone),
      safe_(c.email),safe_(c.address),safe_(c.taxCode),safe_(c.cccd),
      safe_(c.tier),safe_(c.owner),safe_(c.note),JSON.stringify(c)
    ];
  });
  clearAndWrite_(SHEETS.CUSTOMERS,rows);
}

function writeInventory_(list) {
  var rows=(Array.isArray(list)?list:[]).map(function(x){
    return [
      safe_(x.id),safe_(x.name),safe_(x.unit),safe_(x.size),number_(x.stock),number_(x.min),
      safe_(x.supplier),safe_(x.phone),safe_(x.contact),safe_(x.note),JSON.stringify(x)
    ];
  });
  clearAndWrite_(SHEETS.INVENTORY,rows);
}

function writeCustomProducts_(list) {
  var rows=(Array.isArray(list)?list:[]).map(function(x){
    return [
      safe_(x.id),safe_(x.key),safe_(x.name),safe_(x.group || x.category),
      Array.isArray(x.variants)?x.variants.length:0,safe_(x.note),JSON.stringify(x)
    ];
  });
  clearAndWrite_(SHEETS.CUSTOM_PRODUCTS,rows);
}

function writePayroll_(obj) {
  var rows=[];
  var payroll=obj && typeof obj==="object" ? obj : {};
  Object.keys(payroll).sort().forEach(function(month){
    var list=Array.isArray(payroll[month]) ? payroll[month] : [];
    list.forEach(function(r){
      rows.push([
        month,safe_(r.id),safe_(r.employeeName),safe_(r.username),safe_(r.role),
        number_(r.baseSalary),number_(r.workedDays),number_(r.standardDays,26),
        number_(r.overtimeHours),number_(r.kpiPercent),
        r.insuranceEnabled===false?"KHÔNG":"CÓ",number_(r.insuranceBase),JSON.stringify(r)
      ]);
    });
  });
  clearAndWrite_(SHEETS.PAYROLL,rows);
}

function writeSingleValue_(sheetName,key,value) {
  clearAndWrite_(sheetName,[[key,typeof value==="string"?value:JSON.stringify(value),JSON.stringify(value)]]);
}

function readJsonRows_(sheetName) {
  var sh=ensureSheet_(sheetName);
  var last=sh.getLastRow();
  if(last<2)return [];
  var headers=HEADERS[sheetName];
  var jsonCol=headers.indexOf("JSON_DATA")+1;
  var values=sh.getRange(2,jsonCol,last-1,1).getValues();
  var result=[];
  values.forEach(function(row){
    var raw=row[0];
    if(raw===null || raw==="")return;
    try{result.push(JSON.parse(String(raw)));}catch(e){}
  });
  return result;
}

function readPayroll_() {
  var sh=ensureSheet_(SHEETS.PAYROLL);
  var last=sh.getLastRow();
  var result={};
  if(last<2)return result;
  var headers=HEADERS[SHEETS.PAYROLL];
  var monthCol=headers.indexOf("THANG");
  var jsonCol=headers.indexOf("JSON_DATA");
  var values=sh.getRange(2,1,last-1,headers.length).getValues();
  values.forEach(function(row){
    var month=String(row[monthCol]||"").trim();
    var raw=row[jsonCol];
    if(!month || !raw)return;
    try{
      var rec=JSON.parse(String(raw));
      if(!result[month])result[month]=[];
      result[month].push(rec);
    }catch(e){}
  });
  return result;
}

function readSingleValue_(sheetName) {
  var sh=ensureSheet_(sheetName);
  if(sh.getLastRow()<2)return null;
  var raw=sh.getRange(2,3).getValue();
  if(raw===null || raw==="")return null;
  try{return JSON.parse(String(raw));}catch(e){return raw;}
}

function appendLog_(action,key,source,detail) {
  var sh=ensureSheet_(SHEETS.LOG);
  var next=Math.max(2,sh.getLastRow()+1);
  sh.getRange(next,1,1,5).setValues([[
    Utilities.formatDate(new Date(),Session.getScriptTimeZone()||"Asia/Ho_Chi_Minh","yyyy-MM-dd HH:mm:ss"),
    action||"",key||"",source||"",detail||""
  ]]);
  if(next>2002) sh.deleteRows(2,next-2001);
}

function sumItems_(items) {
  if(!Array.isArray(items))return 0;
  return items.reduce(function(sum,x){return sum+number_(x.total);},0);
}

function number_() {
  for(var i=0;i<arguments.length;i++){
    var n=Number(arguments[i]);
    if(isFinite(n))return n;
  }
  return 0;
}
function safe_(v) { return v===null || v===undefined ? "" : String(v); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
