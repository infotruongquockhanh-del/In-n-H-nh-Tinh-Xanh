import { createHmac } from 'node:crypto';
import express from 'express';
import { requireDirector } from './auth.js';
import { backupBusiness, restoreMissing, customerDuplicates, mergeCustomers } from './data-safety.js';
import { completeDesign, designSummary, savePayroll, deletePayroll, setKpiPolicy } from './design-payroll.js';
import { migrateBrowserState } from './browser-migration.js';
const router=express.Router();
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.get('/api/auth/draft-key',asyncRoute(async(req,res)=>{
 const secret=process.env.DRAFT_KEY_SECRET||process.env.SESSION_SECRET;
 if(!secret||secret.length<32)return res.status(503).json({error:'Cần cấu hình SESSION_SECRET/DRAFT_KEY_SECRET ổn định (ít nhất 32 ký tự) để lưu bản nháp an toàn.'});
 res.json({key:createHmac('sha256',secret).update('htx-v30-draft|'+String(req.user.id)).digest('base64')});
}));
router.get('/api/admin/backup' ,requireDirector,asyncRoute(async(req,res)=>{
 const backup=await backupBusiness(req.user);res.setHeader('Content-Disposition',`attachment; filename="HTX-business-${Date.now()}.json"`);res.json(backup);
}));
router.post('/api/admin/backup/preview',requireDirector,asyncRoute(async(req,res)=>res.json(await restoreMissing(req.body.backup,req.user,false))));
router.post('/api/admin/backup/restore-missing',requireDirector,asyncRoute(async(req,res)=>{
 if(req.body.confirm!=='RESTORE_MISSING_ONLY')return res.status(400).json({error:'Cần xác nhận khôi phục bản ghi thiếu; không ghi đè dữ liệu đang có.'});
 res.json(await restoreMissing(req.body.backup,req.user,true));
}));
router.get('/api/admin/customers/duplicates',requireDirector,asyncRoute(async(req,res)=>res.json({groups:await customerDuplicates()})));
router.post('/api/admin/customers/merge',requireDirector,asyncRoute(async(req,res)=>{
 if(req.body.confirm!==true)return res.status(400).json({error:'Cần xem trước và xác nhận gộp.'});
 res.json(await mergeCustomers(req.body.ids,req.body.targetId,req.user));
}));
router.post('/api/orders/:id/design-complete',asyncRoute(async(req,res)=>res.json(await completeDesign(req.params.id,req.body,req.user))));
router.get('/api/payroll/design-summary',asyncRoute(async(req,res)=>res.json(await designSummary(req.query.month,req.query.employeeId,req.user))));
router.put('/api/payroll/:month/:employeeId',asyncRoute(async(req,res)=>res.json({ok:true,record:await savePayroll(req.params.month,req.params.employeeId,req.body,req.user)})));
router.delete('/api/payroll/:month/:employeeId',asyncRoute(async(req,res)=>res.json(await deletePayroll(req.params.month,req.params.employeeId,req.body.expectedVersion,req.user))));
router.put('/api/admin/design-kpi-policy',requireDirector,asyncRoute(async(req,res)=>res.json(await setKpiPolicy(req.body.rule,req.user))));
router.post('/api/admin/migrate-browser-state',requireDirector,asyncRoute(async(req,res)=>res.json({ok:true,summary:await migrateBrowserState(req.body?.state,req.user)})));
export default router;
