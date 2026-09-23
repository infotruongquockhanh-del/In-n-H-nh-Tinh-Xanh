import fs from 'node:fs';
import { db } from './firebase-admin.js';
import { hashPassword, normalizeUsername, fail } from './access-policy.js';

const snapshot=JSON.parse(fs.readFileSync(new URL('../data/local-database.json',import.meta.url),'utf8'));
const legacyUsers=Object.values(snapshot.users||{});

export async function ensureDirectorBootstrap(){
  return db.runTransaction(async tx=>{
    const snap=await tx.get(db.collection('users'));
    const directors=snap.docs.filter(d=>d.data().role==='director');
    if(directors.length)return{created:false};

    const legacy=legacyUsers.find(u=>u.role==='director'&&u.active!==false&&u.username&&u.passwordHash);
    if(legacy){
      const id=String(legacy.id||202609190001);
      if(snap.docs.some(d=>d.id===id))throw fail('Mã tài khoản Giám đốc khởi tạo đã tồn tại. Không ghi đè dữ liệu.',503);
      tx.set(db.collection('users').doc(id),{
        ...legacy,id:Number(legacy.id||202609190001),username:normalizeUsername(legacy.username||'giamdoc'),
        role:'director',active:true,accessApproved:true,authVersion:Number(legacy.authVersion||0),
        mustChangePassword:false,provisionedByDirectorId:'v27-migration',
        provisionedAt:new Date().toISOString(),migratedFrom:'data/local-database.json'
      });
      return{created:true,source:'v27'};
    }

    const password=process.env.BOOTSTRAP_DIRECTOR_PASSWORD;
    if(!password)throw fail('Chưa có tài khoản Giám đốc và không tìm thấy dữ liệu V27 để khôi phục.',503);
    const username=normalizeUsername(process.env.BOOTSTRAP_DIRECTOR_USERNAME||'giamdoc');
    const id=202609190001;
    tx.set(db.collection('users').doc(String(id)),{
      id,username,name:'Giám đốc',role:'director',active:true,passwordHash:hashPassword(password),authVersion:0,
      accessApproved:true,provisionedByDirectorId:'server-bootstrap',mustChangePassword:false,createdAt:new Date().toISOString()
    });
    return{created:true,source:'env'};
  });
}
