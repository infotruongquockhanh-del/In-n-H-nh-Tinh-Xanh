/** Convert a saved GET /api/state response. Offline only; never connects to a live DB. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node scripts/convert-legacy-state.mjs state-from-old-site.json business-backup.json');
if(fs.existsSync(output))throw new Error('Output already exists. Refusing to overwrite.');
const raw=JSON.parse(fs.readFileSync(input,'utf8')),state=raw.state;
if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('Input must be a saved successful /api/state response with a state object.');
const mapping={htx_auto_quotes_v5:'orders',htx_customer_profiles_v10:'customers',htx_inventory_v7:'inventory',htx_custom_products_v7:'customProducts'};
const collections={orders:{},customers:{},inventory:{},customProducts:{},settings:{}};
for(const [key,col]of Object.entries(mapping)){
 const rows=state[key]??[];if(!Array.isArray(rows))throw new Error('Invalid collection '+key);
 for(const row of rows){const id=String(row.id??row.key??'');if(!id||id.includes('/')||Object.hasOwn(collections[col],id)||['__proto__','constructor','prototype'].includes(id))throw new Error('Missing/duplicate/invalid ID in '+key);collections[col][id]=row;}
}
for(const key of ['htx_payroll_v17','htx_work_month_v7','htx_price_adjustments_v6','htx_catalog_overrides_v7'])if(state[key]!=null)collections.settings[key]={value:state[key]};
function stable(v){return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;}
const result={format:'HTX-BUSINESS-BACKUP',schemaVersion:30,exportedAt:new Date().toISOString(),source:'Converted offline from a user-saved old /api/state response; timestamp is conversion time, not proof of live backup time',scope:'Business state only; excludes users, passwords, secrets and server history not returned by /api/state',collections,counts:Object.fromEntries(Object.entries(collections).map(([k,v])=>[k,Object.keys(v).length])),sha256:createHash('sha256').update(JSON.stringify(stable(collections))).digest('hex')};
fs.writeFileSync(output,JSON.stringify(result,null,2),{encoding:'utf8',flag:'wx',mode:0o600});console.log(result.counts);
