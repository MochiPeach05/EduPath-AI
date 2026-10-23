"""Pull-only demo worker. No inbound port, browser secrets, or direct database access."""
import argparse
from collections import Counter
from contextlib import ExitStack
import base64
from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import shutil
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

ROOT=Path(__file__).resolve().parent
LOG=ROOT/'logs'/'transcripts.jsonl'
# The server's rules for a result (apps/api/src/student/ocr-adapter.ts, mapOcrTranscript); keep both in step.
SERVER_CODE=re.compile(r'[0-9]{2}[A-Z]{2,10}[0-9]{5,8}|[A-Z]{3}[0-9]{4}')
SERVER_LETTERS={'A+','A','B+','B','C+','C','D+','D','F','MT','VT'}

def read_config():
    env=ROOT/'.env'
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key,value=line.split('=',1)
                if key.strip() in {'OCR_API_URL','OCR_WORKER_KEY','OCR_DEVICE','OCR_DET_MODEL'}:
                    os.environ.setdefault(key.strip(),value.strip().strip('"').strip("'"))
    url=os.environ.get('OCR_API_URL','http://localhost:4000').rstrip('/')
    key=os.environ.get('OCR_WORKER_KEY','')
    parsed=urlparse(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/') or not parsed.hostname:
        raise ValueError('OCR_API_URL must be an origin without credentials or a path.')
    if parsed.scheme!='https' and not (parsed.scheme=='http' and parsed.hostname in {'localhost','127.0.0.1','::1'}):
        raise ValueError('Use HTTPS, or localhost HTTP for development.')
    if len(key)<32: raise ValueError('Set OCR_WORKER_KEY (at least 32 characters).')
    return url,key

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def send(url,key,path,body):
    request=Request(url+'/api/worker/transcripts'+path,data=json.dumps(body).encode(),
        headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
    with build_opener(NoRedirect()).open(request,timeout=35) as response:
        raw=response.read(8*1024*1024+1)
        if len(raw)>8*1024*1024: raise ValueError('Response too large')
        return json.loads(raw)

def mask(value):
    """Digits become 9 and letters A/a: the form of a value without its content."""
    return ''.join('9' if c.isdigit() else ('A' if c.isupper() else 'a') if c.isalpha() else c for c in str(value))[:16]

def schema_problems(d):
    """Fields that break the server's result schema (it answers invalid_ocr_result): counts, masked values."""
    count,values=Counter(),{}
    def bad(field,value=None):
        count[field]+=1
        if value is not None: values.setdefault(field,set()).add(value)
    integer=lambda v,low,high: isinstance(v,int) and not isinstance(v,bool) and low<=v<=high
    text=lambda v,low=0: isinstance(v,str) and low<=len(v)<=2000
    if d.get('schema_version')!='1.1' or d.get('adapter')!='vlu_8_columns': bad('version')
    if not integer(d.get('course_count'),1,1000): bad('course_count')
    courses,pages,summaries=d.get('courses') or [],d.get('pages') or [],d.get('summaries') or []
    if not 1<=len(courses)<=1000: bad('courses')
    for c in courses:
        if not integer(c.get('ordinal'),1,1000): bad('ordinal',mask(c.get('ordinal')))
        if not (isinstance(c.get('course_code'),str) and SERVER_CODE.fullmatch(c['course_code'])): bad('course_code',mask(c.get('course_code')))
        if not text(c.get('course_name'),1): bad('course_name')
        if not integer(c.get('credits'),0,30): bad('credits',mask(((c.get('raw_cells') or [])+['']*4)[3] or ''))
        for field,high in (('score_10',10),('score_4',4)):
            v=c.get(field)
            if v is not None and not (isinstance(v,(int,float)) and not isinstance(v,bool) and 0<=v<=high): bad(field)
        letter=c.get('letter_grade')
        # A mark the server does not know is kept as printed when short (P, CT…); anything longer is masked.
        if letter is not None and letter not in SERVER_LETTERS: bad('letter_grade',letter if len(letter)<=4 and not re.search(r'\d',letter) else mask(letter))
        if c.get('result') not in (None,'passed','failed'): bad('result')
        if not integer(c.get('source_page'),1,20): bad('source_page')
        year=c.get('academic_year')
        if year is not None and not (isinstance(year,str) and re.fullmatch(r'[0-9]{4}-[0-9]{4}',year)): bad('academic_year',mask(year))
        if c.get('semester') not in (None,'HK01','HK02','HK03'): bad('semester',mask(c.get('semester')))
        if c.get('section') not in ('semester','credit_transfer'): bad('section',str(c.get('section')))
        if not isinstance(c.get('needs_review'),bool): bad('needs_review')
        if not (isinstance(c.get('issues'),list) and len(c['issues'])<=100 and all(text(i) for i in c['issues'])): bad('issues')
    if not isinstance(d.get('needs_review'),bool): bad('needs_review')
    if not 1<=len(pages)<=20 or any(not integer(p.get('page'),1,20) or p.get('method') not in ('pdf_text','ppocr')
            or not isinstance(p.get('warnings'),list) or len(p['warnings'])>100 for p in pages): bad('pages')
    if len(summaries)>200: bad('summaries',f'{len(summaries)} rows')
    for s in summaries:
        cells=s.get('raw_cells')
        if not (isinstance(cells,list) and len(cells)<=20 and all(x is None or text(x) for x in cells)) \
                or any(s.get(k) is not None and not text(s.get(k)) for k in ('academic_year','semester')): bad('summaries')
    if len(d.get('semesters') or [])>100: bad('semesters')
    if len(d.get('unparsed_rows') or [])>1000: bad('unparsed_rows')
    return count,values

def server_error(d):
    """The error the server answers for this result, in its order of checks; None when it imports."""
    if schema_problems(d)[0]: return 'invalid_ocr_result'
    courses,pages=d['courses'],d['pages']
    if d['unparsed_rows'] or d['course_count']!=len(courses) or any(p['page']!=i+1 for i,p in enumerate(pages)): return 'unreadable_rows'
    sections={}
    for c in courses:
        transfer,year,semester=c['section']=='credit_transfer',c['academic_year'],c['semester']
        if c['issues'] or (c['score_10'] is None)!=(c['score_4'] is None): return 'unreadable_grades'
        if c['source_page']>len(pages): return 'invalid_ocr_result'
        if (year is not None or semester is not None) if transfer else (not year or not semester or int(year[5:])!=int(year[:4])+1): return 'missing_semester'
        ordinals=sections.setdefault('transfer' if transfer else f'{year}-{semester}',set())
        if c['ordinal'] in ordinals: return 'duplicate_rows'
        ordinals.add(c['ordinal'])
    if any((f"{s['academic_year']}-{s['semester']}" if s['academic_year'] else 'transfer') not in sections for s in d['summaries']): return 'missing_semester'
    return None

def log_result(started,result):
    """Appends one line per PDF to logs/transcripts.jsonl: the server's expected answer and why, masked.
    No names, student codes, course names or scores; a failed log never fails the job."""
    try:
        entry={'at':datetime.now().astimezone().isoformat(timespec='seconds'),'seconds':round(time.perf_counter()-started,1)}
        if 'error' in result: entry['error']=result['error']
        else:
            d=result['result']; count,values=schema_problems(d)
            entry.update(server=server_error(d),courses=d['course_count'],pages=[[p['method'],p['warnings']] for p in d['pages']],
                schema={k:{'count':n,'values':sorted(values.get(k,()))[:10]} for k,n in count.items()},
                issues=dict(Counter(i for c in d['courses'] for i in c['issues'])),
                unparsed=[[mask(cell or '') for cell in row['raw_cells']] for row in d['unparsed_rows'][:20]])
        LOG.parent.mkdir(exist_ok=True)
        with LOG.open('a',encoding='utf-8') as file: file.write(json.dumps(entry,ensure_ascii=False)+'\n')
    except Exception:
        pass

def parse_pdf(pdf_path,result_path):
    import pymupdf
    from test_ocr import Options, extract_transcript, DEFAULT_REC_MODEL
    started=time.perf_counter()
    result={}
    try:
        if pdf_path.stat().st_size>5*1024*1024: raise ValueError('invalid_pdf')
        with ExitStack() as stack:
            document=stack.enter_context(pymupdf.open(pdf_path))
            if not document.is_pdf: raise ValueError('invalid_pdf')
            if document.needs_pass: raise ValueError('encrypted_pdf')
            if not 1<=len(document)<=20: raise ValueError('too_many_pages')
            # Bound raster allocation for malformed/oversized PDF canvases at 150 DPI.
            if any(p.rect.width<=0 or p.rect.height<=0 or p.rect.width*p.rect.height*(150/72)**2>10_000_000 for p in document):
                raise ValueError('unsupported_layout')
            model_dir=DEFAULT_REC_MODEL
            # Paddle's Windows native loader cannot open Unicode model paths.
            if os.name=='nt' and not str(model_dir).isascii():
                model_dir=Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='edupath-model-')))
                if not str(model_dir).isascii():
                    raise ValueError('ASCII temporary directory required for Paddle on Windows')
                for name in ('inference.json','inference.pdiparams','inference.yml'):
                    shutil.copyfile(DEFAULT_REC_MODEL/name,model_dir/name)
            options=Options(device=os.environ.get('OCR_DEVICE','auto'),det_model=os.environ.get('OCR_DET_MODEL','PP-OCRv5_mobile_det'),rec_model_dir=model_dir)
            result={'result':extract_transcript(document,'transcript.pdf',options,log=lambda _:None)}
    except ValueError as error:
        code=str(error)
        result={'error':code if code in {'invalid_pdf','encrypted_pdf','too_many_pages','unsupported_layout'} else 'ocr_failed'}
    except Exception:
        result={'error':'ocr_failed'}
    result_path.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    log_result(started,result)

def process_job(job):
    started=time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='edupath-ocr-') as directory:
        pdf=Path(directory)/'input.pdf'; result=Path(directory)/'result.json'
        payload=base64.b64decode(job['pdf'],validate=True)
        if not 8<=len(payload)<=5*1024*1024: return {'error':'invalid_pdf'}
        pdf.write_bytes(payload)
        # Each task has its own process: a hard timeout frees Paddle memory, including after failures.
        child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--parse',str(pdf),str(result)],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
            env={**os.environ,'PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK':'True'})
        try:
            child.wait(timeout=300)
        except subprocess.TimeoutExpired:
            if os.name=='nt':
                subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            child.kill(); child.wait()
            return {'error':'parse_timeout'}
        except BaseException:
            if os.name=='nt':
                subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            child.kill(); child.wait()
            raise
        if child.returncode or not result.exists() or result.stat().st_size>1_900_000:
            return {'error':'ocr_failed'}
        parsed=json.loads(result.read_text(encoding='utf-8'))
        if 'result' in parsed:
            pages=parsed['result'].get('pages',[])
            ocr_pages=sum(page['method']!='pdf_text' for page in pages)
            device=(parsed['result'].get('ocr_settings') or {}).get('device','cpu (PDF text)')
            print(f'Parsed in {time.perf_counter()-started:.1f}s; pages={len(pages)}, OCR pages={ocr_pages}, device={device}.',flush=True)
        return parsed

def run(once=False):
    url,key=read_config()
    stop=threading.Event()
    def heartbeat():
        while not stop.wait(20):
            try: send(url,key,'/heartbeat',{})
            except (OSError,ValueError): pass
    threading.Thread(target=heartbeat,daemon=True).start()
    print('Worker ready. Keep this process running to receive transcript jobs.',flush=True)
    try:
        while True:
            try:
                job=send(url,key,'/claim',{}).get('job')
                if job:
                    print('Processing PDF: text layer first, OCR when needed.',flush=True)
                    result=process_job(job)
                    for attempt in range(3):
                        try:
                            send(url,key,'/'+job['id']+'/complete',{'leaseToken':job['leaseToken'],**result})
                            print('Result delivered.' if 'result' in result else 'Processing failed; status delivered.',flush=True)
                            break
                        except HTTPError as error:
                            if error.code==409:
                                print('Task cancelled or lease expired; result discarded.',flush=True);break
                            if attempt==2: raise
                            time.sleep(3)
                        except (URLError,TimeoutError):
                            if attempt==2: raise
                            time.sleep(3)
                if once: break
                if not job: time.sleep(2)
            except (OSError,ValueError,KeyError) as error:
                print('Backend unavailable or configuration invalid; retry in 15 seconds. '+
                    (f'HTTP {error.code}.' if isinstance(error,HTTPError) else type(error).__name__),flush=True)
                if once: raise SystemExit(1)
                time.sleep(15)
    finally: stop.set()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--parse',nargs=2,metavar=('PDF','RESULT'))
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    if args.parse: parse_pdf(Path(args.parse[0]),Path(args.parse[1]))
    else:
        try: run(args.once)
        except KeyboardInterrupt: print('Worker stopped.')
