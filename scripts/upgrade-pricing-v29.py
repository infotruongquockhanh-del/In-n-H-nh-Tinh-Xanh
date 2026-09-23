import json,sys
from pathlib import Path
if int(json.loads(Path('package.json').read_text())['version'].split('.')[0])>=30: # skip-v30
    print('V30: historical V29 migration skipped');sys.exit(0)
"""Reproducible, idempotent UI upgrade. Does not touch authentication or business data."""
from pathlib import Path
import re, json
p = Path('public/app.html')
s = p.read_text()
if '<!-- HTX QUOTE V29 -->' not in s:
    def once(old, new):
        global s
        if s.count(old) != 1:
            raise RuntimeError(f'Expected exactly one anchor: {old[:100]!r} ({s.count(old)})')
        s = s.replace(old,new,1)
    def cut(start, end):
        global s
        a=s.index(start); b=s.index(end,a); s=s[:a]+s[b:]
    cut('        <div class="sheets-sync-card" id="googleSheetsSyncCard"', '        <div class="account-grid">')
    cut('        <div class="panel cashflow-panel">', '        <div class="panel action-orders-panel">')
    cut('        <div class="top-date" id="topDate">', '        <div class="user-chip" id="userChip">')
    cut('  $("cashflowMonthCaption").textContent=', '  const actionRows=list')
    once('  $("globalWorkMonth").value=getWorkMonth();\n','')
    once('  $("globalWorkMonth").addEventListener("change",e=>setWorkMonth(e.target.value));\n','')
    once('  $("topDate").textContent=now.toLocaleDateString("vi-VN",{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"});','')
    once('    if(currentUser?.role==="director")refreshGoogleSheetsStatus();','')
    once('    details:r.details,\n    note:', '    details:r.details,\n    printSides:r.printSides||"",\n    pricingInput:r.pricingInput||null,\n    note:')
    once('init();\n</script>','</script>\n<!-- HTX QUOTE V29 -->\n<script src="/quote-math.js?v=29.0.0"></script>\n<script src="/quote-v29.js?v=29.0.0"></script>\n<script>init();</script>')
    s=s.replace('${fmt(x.qty)}','${formatQuantityV29(x.qty)}').replace('${fmt(item.qty)}','${formatQuantityV29(item.qty)}')
    s=s.replace('${money(x.unitPrice)}','${formatUnitPriceV29(x.unitPrice)}').replace('${money(item.unitPrice)}','${formatUnitPriceV29(item.unitPrice)}')
    once('cell(`F${r}`,Math.round(item.unitPrice),10,"n")','cell(`F${r}`,item.unitPrice,15,"n")')
    once('<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>', '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.######"/></numFmts>')
    once('<cellXfs count="15">','<cellXfs count="16">')
    once('</cellXfs>', '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>\n</cellXfs>')
    s=s.replace('V28.0','V29.0').replace('["menu2","In menu 2 mặt"]','["menu2","In menu tờ / tấm"]')
    p.write_text(s)
pkgpath=Path('package.json'); pkg=json.loads(pkgpath.read_text()); pkg['version']='29.0.0'
pkg['scripts']['test:pricing']='node --test tests/pricing.test.mjs'
pkgpath.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')
server=Path('server.js'); server.write_text(server.read_text().replace("version:'28.0.0'","version:'29.0.0'"))
print('V29 UI ready. Existing business data and authentication source unchanged.')
