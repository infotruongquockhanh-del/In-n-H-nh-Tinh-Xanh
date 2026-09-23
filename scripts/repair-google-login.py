#!/usr/bin/env python3
"""HTX V30.1: Google-side diagnosis and narrowly-scoped Firestore IAM repair.
Run inside Google Cloud Shell with the application owner's existing Google login.
No key export, account reset, DB creation, data modification or deployment.
By default read-only; --apply-iam permits ONE conditional datastore.user binding
only after the checks below. Uses only the Python standard library and gcloud.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SOURCE_COMMIT = '88d060e5f6a70f487c51ef1a7c0988df8178baca'
KNOWN_PROJECT = 'careful-run-vmn89'
KNOWN_DATABASE = 'ai-studio-innhnhtinhxanh-7678140b-9310-430e-aca2-4ac9c52f1af2'
SERVICE = 'in-hanh-tinh-xanh'
REGION = 'asia-southeast1'
SITE = 'https://in-hanh-tinh-xanh.ai.studio'
ROLE = 'roles/datastore.user'
SECRET_NAMES = {
    'FIREBASE_SERVICE_ACCOUNT_JSON','FIREBASE_ADMIN_CREDENTIALS','FIREBASE_ADMIN_JSON',
    'GOOGLE_SERVICE_ACCOUNT_JSON','FIREBASE_SERVICE_ACCOUNT_BASE64','FIREBASE_PRIVATE_KEY',
    'FIREBASE_ADMIN_PRIVATE_KEY','GOOGLE_APPLICATION_CREDENTIALS'
}
REPORT = {'tool_version':'30.1.0','source_reference':SOURCE_COMMIT,'changes':[]}

class Stop(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message

def classify(message):
    text = str(message)
    if re.search(r'SERVICE_DISABLED|API has not been used|accessNotConfigured',text,re.I): return 'DB_API_DISABLED'
    if re.search(r'UNAUTHENTICATED|default credentials|invalid_grant|DB_CREDENTIALS_UNAVAILABLE',text,re.I): return 'DB_CREDENTIALS_UNAVAILABLE'
    if re.search(r'PERMISSION_DENIED|permission[^\n]*denied|insufficient permissions',text,re.I): return 'DB_PERMISSION_DENIED'
    if re.search(r'NOT_FOUND|database[^\n]*does not exist',text,re.I): return 'DB_NOT_FOUND'
    if re.search(r'RESOURCE_EXHAUSTED|QUOTA',text,re.I): return 'DB_QUOTA_EXCEEDED'
    if re.search(r'DEADLINE_EXCEEDED|UNAVAILABLE|ECONNRESET',text,re.I): return 'DB_UNAVAILABLE'
    return 'GOOGLE_CHECK_FAILED'

def gcloud(*args, json_output=True):
    command = ['gcloud',*args,'--quiet']
    if json_output: command.append('--format=json')
    result = subprocess.run(command,capture_output=True,text=True,timeout=60,check=False)
    if result.returncode:
        # Do not echo raw stderr: gcloud may include env/secret values.
        code = classify(result.stderr)
        raise Stop(code, 'Google không cho phép hoàn tất bước: '+ ' '.join(args[:3])+'. Không tự nâng quyền chủ tài khoản hoặc bật thanh toán.')
    try: return json.loads(result.stdout) if json_output else result.stdout.strip()
    except ValueError: raise Stop('INVALID_GOOGLE_RESPONSE','Google trả về kết quả không đúng định dạng.')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

def get_json(url, token=None):
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https': raise Stop('UNSAFE_URL','Từ chối URL không dùng HTTPS.')
    if token and parsed.netloc != 'firestore.googleapis.com': raise Stop('UNSAFE_URL','Không gửi xác thực đến máy chủ ngoài Firestore.')
    headers={'Accept':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    request=urllib.request.Request(url,headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect).open(request,timeout=20) as response:
            return response.status,json.load(response)
    except urllib.error.HTTPError as error:
        try: data=json.loads(error.read(1024*1024))
        except (ValueError,UnicodeError): data={}
        return error.code,data
    except (urllib.error.URLError,TimeoutError,OSError): return 0,{}
    except (ValueError,UnicodeError): return 0,{}

def health():
    status,body=get_json(SITE+'/api/health')
    return {'http_status':status,**{k:v for k,v in body.items() if k in ('ok','version','code','authentication')}} if isinstance(body,dict) else {'http_status':status}

def env_values(revision):
    containers=revision.get('spec',{}).get('containers',[])
    if len(containers)!=1: raise Stop('AMBIGUOUS_CONTAINER','Dịch vụ có nhiều container; không tự chọn tài khoản/kết nối.')
    return {item['name']:item for item in containers[0].get('env',[]) if 'name' in item}

def target(values):
    for name in SECRET_NAMES:
        if name in values and (values[name].get('value') or values[name].get('valueFrom')):
            raise Stop('EXPLICIT_CREDENTIALS','Ứng dụng đang dùng thông tin xác thực riêng. Không đọc khóa bí mật hoặc tự cấp quyền cho sai service account.')
    def value(name):
        item=values.get(name,{})
        if item.get('valueFrom'): raise Stop('TARGET_IN_SECRET','Tên database/project dùng tham chiếu Secret; cần đối chiếu tại Google, không đọc Secret tự động.')
        return str(item.get('value','')).strip()
    injected={}
    if value('FIREBASE_CONFIG'):
        try: injected=json.loads(value('FIREBASE_CONFIG'))
        except ValueError: raise Stop('DB_CONFIG_INVALID','FIREBASE_CONFIG cần được kiểm tra; công cụ không đọc đường dẫn bên trong container.')
        if not isinstance(injected,dict): raise Stop('DB_CONFIG_INVALID','FIREBASE_CONFIG không phải đối tượng JSON.')
    project=value('FIREBASE_PROJECT_ID') or KNOWN_PROJECT
    database=value('FIRESTORE_DATABASE_ID') or KNOWN_DATABASE
    if injected.get('projectId') and injected['projectId']!=project:
        raise Stop('DB_TARGET_MISMATCH','FIREBASE_CONFIG và cấu hình mã nguồn/biến môi trường đang trỏ khác project. Không tự chuyển dữ liệu.')
    if injected.get('firestoreDatabaseId') and injected['firestoreDatabaseId']!=database:
        raise Stop('DB_TARGET_MISMATCH','Các cấu hình đang trỏ khác database. Không tự đổi sang database trống.')
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]',project): raise Stop('DB_CONFIG_INVALID','Project ID không hợp lệ.')
    if database!='(default)' and not re.fullmatch(r'[a-z][a-z0-9-]{2,61}[a-z0-9]',database): raise Stop('DB_CONFIG_INVALID','Database ID không hợp lệ.')
    return project,database

def has_director(project,database,token):
    root='https://firestore.googleapis.com/v1/projects/'+urllib.parse.quote(project,safe='')+'/databases/'+urllib.parse.quote(database,safe='')
    status,info=get_json(root,token)
    if status!=200:
        raise Stop(classify(info.get('error',{}).get('status','')+' '+info.get('error',{}).get('message','')), 'Không xác nhận được database cũ tồn tại và có thể đọc bằng tài khoản Google hiện tại. Dừng, không tạo database thay thế.')
    if info.get('type') not in ('FIRESTORE_NATIVE',): raise Stop('DATABASE_MODE','Database không phải Firestore Native; không tự chuyển kiểu dữ liệu.')
    page_token=''; found=False
    for _ in range(50):
        query=[('pageSize','100'),('mask.fieldPaths','role'),('mask.fieldPaths','active')]
        if page_token: query.append(('pageToken',page_token))
        status,page=get_json(root+'/documents/users?'+urllib.parse.urlencode(query),token)
        if status!=200: raise Stop('USERS_CHECK_FAILED','Không xác nhận được tài khoản Giám đốc cũ. Không tạo hoặc đặt lại mật khẩu.')
        for document in page.get('documents',[]):
            fields=document.get('fields',{})
            if fields.get('role',{}).get('stringValue')=='director' and fields.get('active',{}).get('booleanValue',True): found=True
        page_token=page.get('nextPageToken','')
        if not page_token: return found
    raise Stop('USERS_CHECK_LIMIT','Danh sách tài khoản quá lớn; không sửa IAM khi đối chiếu chưa hoàn tất.')

def condition_for(project,database):
    return {'title':'HTX-database-access-'+hashlib.sha256(database.encode()).hexdigest()[:10],
            'description':'HTX login repair; access to this existing Firestore database only',
            'expression':f'resource.name=="projects/{project}/databases/{database}"'}

def private_json(path,content):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf8') as stream: json.dump(content,stream,ensure_ascii=False,indent=2)

def main(args):
    if not shutil.which('gcloud'): raise Stop('GCLOUD_REQUIRED','Hãy chạy file này trong Google Cloud Shell. Công cụ không yêu cầu bạn gửi mật khẩu hoặc khóa Google.')
    accounts=gcloud('auth','list','--filter=status:ACTIVE')
    if len(accounts)!=1: raise Stop('GOOGLE_LOGIN_REQUIRED','Cloud Shell cần đúng một tài khoản Google đang xác thực.')
    project=args.project or gcloud('config','get-value','project',json_output=False)
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]',project or ''): raise Stop('PROJECT_REQUIRED','Chọn project đang chạy website ở Google Cloud, hoặc truyền --project=PROJECT_ID.')
    service=gcloud('run','services','describe',SERVICE,'--region='+REGION,'--project='+project)
    if service.get('metadata',{}).get('name')!=SERVICE: raise Stop('SERVICE_MISMATCH','Không đúng dịch vụ Hành Tinh Xanh.')
    traffic=[t for t in service.get('status',{}).get('traffic',[]) if int(t.get('percent',0))>0]
    revisions={t.get('revisionName') or service.get('status',{}).get('latestReadyRevisionName') for t in traffic}
    if len(revisions)!=1 or not next(iter(revisions),None): raise Stop('SPLIT_TRAFFIC','Không xác định được duy nhất revision đang phục vụ. Không sửa khi có nhiều phiên bản chạy song song.')
    revision_name=next(iter(revisions))
    if not re.fullmatch(r'[a-z0-9-]+',revision_name): raise Stop('REVISION_INVALID','Tên revision không hợp lệ.')
    revision=gcloud('run','revisions','describe',revision_name,'--region='+REGION,'--project='+project)
    sa=revision.get('spec',{}).get('serviceAccountName','')
    if not re.fullmatch(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.gserviceaccount\.com',sa): raise Stop('SERVICE_ACCOUNT_UNKNOWN','Không đọc được service account thực tế của revision; không tự đoán.')
    values=env_values(revision)
    db_project,db_id=target(values)
    REPORT.update({'runtime_project':project,'service':SERVICE,'revision':revision_name,'runtime_service_account':sa,'database_project':db_project,'database_id':db_id})
    current=health();REPORT['health_before']=current
    print('Dịch vụ:',SERVICE,'| Project chạy:',project)
    print('Database đang đối chiếu:',db_project,'/',db_id)
    print('Service account:',sa)
    if current.get('ok') is True:
        REPORT['result']='DATABASE_HEALTHY';print('Kiểm tra database đã thành công. Không sửa IAM hoặc đặt lại mật khẩu.');return
    if current.get('version') not in ('30.0.0','30.1.0'):
        raise Stop('VERSION_UNVERIFIED','Không đọc được đúng phiên bản website. Chỉ lưu báo cáo, không thay đổi quyền.')
    query=f'resource.type="cloud_run_revision" AND resource.labels.service_name="{SERVICE}" AND resource.labels.revision_name="{revision_name}"'
    entries=gcloud('logging','read',query,'--freshness=24h','--limit=150','--project='+project)
    # Raw logs are neither printed nor saved; keep only known error categories.
    codes=set()
    for entry in entries:
        text=str(entry.get('textPayload',''))+' '+json.dumps(entry.get('jsonPayload',{}),ensure_ascii=False)
        code=classify(text)
        if code!='GOOGLE_CHECK_FAILED': codes.add(code)
    REPORT['log_error_categories']=sorted(codes)
    permission_evidence=current.get('code')=='DB_PERMISSION_DENIED' or 'DB_PERMISSION_DENIED' in codes
    if not permission_evidence: raise Stop('NO_IAM_EVIDENCE','Chưa có bằng chứng lỗi quyền Firestore. Không tự cấp quyền theo phỏng đoán. Báo cáo đã ghi nhóm lỗi tìm được.')
    if codes & {'DB_API_DISABLED','DB_CREDENTIALS_UNAVAILABLE','DB_NOT_FOUND'}:
        raise Stop('MULTIPLE_CONFIG_ERRORS','Nhật ký còn lỗi cấu hình/xác thực khác; công cụ dừng thay vì cấp quyền không đúng nguyên nhân.')
    token=gcloud('auth','print-access-token',json_output=False)
    if not has_director(db_project,db_id,token):
        raise Stop('EXISTING_DIRECTOR_NOT_FOUND','Database chưa có tài khoản Giám đốc cũ đang hoạt động. Không tạo tài khoản mặc định hoặc ghi đè dữ liệu; cần đối chiếu bản sao dữ liệu.')
    del token
    REPORT['existing_director_verified']=True
    policy=gcloud('projects','get-iam-policy',db_project)
    condition=condition_for(db_project,db_id)
    member='serviceAccount:'+sa
    existing=any(b.get('role')==ROLE and member in b.get('members',[]) and (not b.get('condition') or b['condition'].get('expression')==condition['expression']) for b in policy.get('bindings',[]))
    if existing: raise Stop('IAM_ALREADY_PRESENT','Binding đọc/ghi tương ứng đã tồn tại. Chờ IAM có hiệu lực hoặc kiểm tra chính sách từ chối; không cấp Owner/Editor để thử.')
    REPORT['proposed_binding']={'role':ROLE,'member':member,'condition':condition}
    if not args.apply_iam:
        REPORT['result']='READY_FOR_LIMITED_IAM_REPAIR';print('Đã xác định thiếu binding phù hợp. Chế độ kiểm tra: chưa thay đổi gì. Thêm --apply-iam để cho phép cấp quyền đúng database.');return
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    directory=Path.home()/('htx-iam-backup-'+stamp);directory.mkdir(mode=0o700)
    private_json(directory/'policy-before.json',policy)
    private_json(directory/'condition.json',condition)
    # This is the only mutating Google command in this tool. No policy replacement.
    gcloud('projects','add-iam-policy-binding',db_project,'--member='+member,'--role='+ROLE,'--condition-from-file='+str(directory/'condition.json'))
    REPORT['changes'].append({'action':'add_conditional_binding','project':db_project,'role':ROLE,'member':member,'database':db_id,'policy_backup':str(directory)})
    REPORT['result']='IAM_UPDATED_HEALTH_PENDING'
    print('Đã bổ sung quyền đúng database. Không khởi động lại, Publish hoặc sửa dữ liệu. Đang kiểm tra lại…')
    for _ in range(12):
        time.sleep(10);after=health();REPORT['health_after']=after
        if after.get('ok') is True:
            REPORT['result']='DATABASE_HEALTHY_AFTER_IAM';print('Website đã trả ok:true. Bạn thử đăng nhập bằng mật khẩu đang dùng. Công cụ chưa thử mật khẩu của bạn.');return
    print('IAM đã cập nhật; chưa xác nhận database khỏe. Google có thể cần đến 5 phút để quyền có hiệu lực. Không tự tăng quyền thêm.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project',help='Project Cloud Run đang chạy website; mặc định lấy project đã chọn trong gcloud.')
    parser.add_argument('--apply-iam',action='store_true',help='Cho phép duy nhất binding có điều kiện cho DB cũ đã được xác minh.')
    args=parser.parse_args()
    exit_code=0
    try: main(args)
    except Stop as error:
        REPORT['result']=error.code;REPORT['message']=error.message;print(error.message);exit_code=2
    except (subprocess.TimeoutExpired,KeyboardInterrupt):
        REPORT['result']='INTERRUPTED';print('Đã dừng/chờ quá lâu. Kiểm tra báo cáo trước khi chạy lại.');exit_code=2
    except Exception:
        REPORT['result']='TOOL_ERROR';print('Công cụ chưa hoàn tất. Không in dữ liệu bí mật. Kiểm tra báo cáo.');exit_code=2
    output=Path.cwd()/('HTX-KET-QUA-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
    private_json(output,REPORT)
    print('Báo cáo (không có mật khẩu/token):',output)
    sys.exit(exit_code)
