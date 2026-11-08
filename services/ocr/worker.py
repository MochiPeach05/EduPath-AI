"""Pull-only demo worker. No inbound port, browser secrets, or direct database access."""
import argparse
from collections import Counter
from contextlib import ExitStack
import base64
from datetime import datetime
import json
import os
from pathlib import Path
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
# The refusals the server knows (apps/api/src/student/transcript-jobs.ts); any other failure is ocr_failed.
PARSE_ERRORS={'invalid_pdf','encrypted_pdf','too_many_pages','unsupported_layout','curriculum_view'}

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
    """Fields that break the worker's contract with the server (apps/api/src/student/ocr-adapter.ts; keep both in step):
    the server answers invalid_ocr_result. Since 2026-10-23 the values of a row (codes, marks, cells that are not
    numbers) are not checked: the server keeps them as printed and marks the row for review."""
    count,values=Counter(),{}
    def bad(field,value=None):
        count[field]+=1
        if value is not None: values.setdefault(field,set()).add(value)
    integer=lambda v,low,high: isinstance(v,int) and not isinstance(v,bool) and low<=v<=high
    number=lambda v,high: isinstance(v,(int,float)) and not isinstance(v,bool) and 0<=v<=high
    text=lambda v,high=2000: isinstance(v,str) and len(v)<=high
    if d.get('schema_version')!='1.1' or d.get('adapter')!='vlu_8_columns': bad('version')
    if not integer(d.get('course_count'),0,1000): bad('course_count')
    courses,pages,summaries=d.get('courses') or [],d.get('pages') or [],d.get('summaries') or []
    if len(courses)>1000: bad('courses')
    for c in courses:
        if not integer(c.get('ordinal'),0,100000): bad('ordinal',mask(c.get('ordinal')))
        if not text(c.get('course_code'),200): bad('course_code',mask(c.get('course_code')))
        if not text(c.get('course_name')): bad('course_name')
        if c.get('credits') is not None and not number(c['credits'],1000): bad('credits',mask(c['credits']))
        for field,high in (('score_10',10),('score_4',4)):
            if c.get(field) is not None and not number(c[field],high): bad(field)
        if c.get('letter_grade') is not None and not text(c['letter_grade'],50): bad('letter_grade')
        if c.get('result') not in (None,'passed','failed'): bad('result')
        if c.get('result_raw') is not None and not text(c['result_raw'],200): bad('result_raw')
        if not integer(c.get('source_page'),1,20): bad('source_page')
        for field in ('academic_year','semester'):
            if c.get(field) is not None and not text(c[field],50): bad(field,mask(c[field]))
        if c.get('section') not in ('semester','credit_transfer','unknown'): bad('section',str(c.get('section')))
        if not isinstance(c.get('needs_review'),bool): bad('needs_review')
        if not (isinstance(c.get('issues'),list) and len(c['issues'])<=100 and all(text(i) for i in c['issues'])): bad('issues')
        cells=c.get('raw_cells')
        if cells is not None and not (isinstance(cells,list) and len(cells)<=20 and all(x is None or text(x) for x in cells)): bad('raw_cells')
    if not isinstance(d.get('needs_review'),bool): bad('needs_review')
    if not 1<=len(pages)<=20 or any(not integer(p.get('page'),1,20) or p.get('method') not in ('pdf_text','ppocr','gemma')
            or not isinstance(p.get('warnings'),list) or len(p['warnings'])>100 for p in pages): bad('pages')
    if len(summaries)>200: bad('summaries',f'{len(summaries)} rows')
    for s in summaries:
        cells=s.get('raw_cells')
        if not (isinstance(cells,list) and len(cells)<=20 and all(x is None or text(x) for x in cells))                 or any(s.get(k) is not None and not text(s.get(k)) for k in ('academic_year','semester')): bad('summaries')
    if len(d.get('semesters') or [])>100: bad('semesters')
    unparsed=d.get('unparsed_rows') or []
    if len(unparsed)>1000 or any(not isinstance(r,dict) or (r.get('source_page') is not None and not integer(r['source_page'],1,20)) for r in unparsed): bad('unparsed_rows')
    return count,values

def server_error(d):
    """The error the server answers for this result; None when it saves it (rows with issues are marked for review)."""
    if schema_problems(d)[0]: return 'invalid_ocr_result'
    courses,pages=d['courses'],d['pages']
    if d['course_count']!=len(courses) or any(p['page']!=i+1 for i,p in enumerate(pages)) or any(c['source_page']>len(pages) for c in courses): return 'invalid_ocr_result'
    if not courses: return 'unsupported_layout'
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
                review_rows=sum(1 for c in d['courses'] if c['issues']),issues=dict(Counter(i for c in d['courses'] for i in c['issues'])),
                unparsed=[[mask(cell or '') for cell in row['raw_cells']] for row in d['unparsed_rows'][:20]])
        LOG.parent.mkdir(exist_ok=True)
        with LOG.open('a',encoding='utf-8') as file: file.write(json.dumps(entry,ensure_ascii=False)+'\n')
    except Exception:
        pass

def parse_pdf(pdf_path,result_path,text_only=False,gemma=False):
    """text_only: the text layer alone, never OCR (the API's own reader on Render, apps/api/src/student/text-layer.ts,
    user 2026-11-07). A page that needs OCR answers {'needs_ocr': True} and an unexpected failure {'fallback': True}:
    the API then hands the job back to this worker's queue. Paddle is never imported.
    gemma (user 2026-11-08): the pages that need OCR are read by Gemma 4 on Cloudflare Workers AI (gemma_ocr.py) instead
    of PaddleOCR, on the API server too; Gemma failing answers {'error': 'ocr_failed', 'reason': …}."""
    import pymupdf
    from test_ocr import Options, OcrRequired, extract_transcript, DEFAULT_REC_MODEL
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
            if text_only:
                options=Options(ocr_enabled=False)
            elif gemma:
                options=Options(engine='gemma')
            else:
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
    except OcrRequired:
        result={'needs_ocr':True}
    except RuntimeError as error:
        # gemma_ocr.GemmaOcrError: Workers AI did not read a page (no answer, refused, the day's quota, not JSON).
        gemma_failed=gemma and type(error).__name__=='GemmaOcrError'
        result=({'error':'ocr_failed','reason':str(error)[:40]} if gemma_failed
            else {'fallback':True} if text_only else {'error':'ocr_failed'})
    except ValueError as error:
        code=str(error)
        result={'error':code} if code in PARSE_ERRORS else {'fallback':True} if text_only else {'error':'ocr_failed'}
    except Exception:
        result={'fallback':True} if text_only else {'error':'ocr_failed'}
    result_path.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    if not text_only: log_result(started,result)

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
    parser.add_argument('--text-only',action='store_true',help='with --parse: the text layer alone, never OCR (the API on Render)')
    parser.add_argument('--gemma',action='store_true',help='with --parse: OCR with Gemma 4 on Cloudflare Workers AI (the API on Render)')
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    if args.parse: parse_pdf(Path(args.parse[0]),Path(args.parse[1]),text_only=args.text_only,gemma=args.gemma)
    else:
        try: run(args.once)
        except KeyboardInterrupt: print('Worker stopped.')
