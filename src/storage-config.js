/* Fail closed on hosted environments. A deployment must not silently switch DB. */
export function storagePlan(env=process.env){
  const test=env.NODE_ENV==='test';
  const serverless=!test&&Boolean(env.K_SERVICE||env.VERCEL||env.CLOUD_RUN_JOB);
  const hosted=!test&&(serverless||env.NODE_ENV==='production');
  const explicit=env.DATA_BACKEND;
  if(explicit&&!['firestore','local'].includes(explicit))throw new Error('DATA_BACKEND phải là firestore hoặc local.');
  const backend=explicit||(hosted?'firestore':'local');
  if(backend==='local'&&hosted){
    if(serverless)throw new Error('Không cho phép lưu local database trên Cloud Run/Vercel: dữ liệu sẽ mất khi cập nhật. Sao lưu bản cũ và chuyển sang Firestore trước khi triển khai.');
    if(!env.HTX_LOCAL_DB_PATH||env.HTX_LOCAL_DURABLE!=='true')throw new Error('Local production yêu cầu HTX_LOCAL_DB_PATH trên ổ bền vững và HTX_LOCAL_DURABLE=true.');
  }
  return {backend,hosted,serverless,test};
}
