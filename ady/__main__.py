import argparse
import asyncio
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import time
from .common import ROOT, log, stamp
from .database import Database
from .analysis import analyze, catalog

def pipeline():
    from .scraper import scrape
    (ROOT / 'data').mkdir(exist_ok=True)
    lock = ROOT / 'data/pipeline.lock'
    try:
        handle = lock.open('x',encoding='utf-8')
    except FileExistsError:
        raise RuntimeError('Chu kỳ khác đang chạy: data/pipeline.lock') from None
    try:
        with handle:
            json.dump(dict(pid=os.getpid(),started_at=stamp()),handle)
        log('Bắt đầu chu kỳ Python SQL')
        database = Database()
        asyncio.run(scrape(database,os.environ.get('SCRAPE_SCOPE')=='configured'))
        rows = database.history()
        report = analyze(rows)
        catalog(rows)
        log('Hoàn tất chu kỳ Python SQL',observations=len(rows))
        return report['summary']
    except Exception as error:
        log('Chu kỳ thất bại',error=str(error))
        raise
    finally:
        lock.unlink()

class PublicHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()

    def translate_path(self,path):
        result = super().translate_path(path)
        # Do not expose symlinks pointing outside the public directory.
        if not __import__('pathlib').Path(result).resolve().is_relative_to((ROOT/'public').resolve()):
            return str(ROOT/'public'/'__forbidden__')
        return result

def main():
    parser = argparse.ArgumentParser(description='ADY201m Python và SQL Server')
    parser.add_argument('command',choices=['pipeline','scrape','analyze','catalog','watch','serve','db-import'])
    parser.add_argument('--port',type=int,default=int(os.environ.get('PORT','4174')))
    args = parser.parse_args()
    if args.command=='serve':
        host = os.environ.get('HOST','127.0.0.1')
        server = ThreadingHTTPServer((host,args.port),partial(PublicHandler,directory=str(ROOT/'public')))
        print(f'http://{host}:{args.port}/analytics.html',flush=True)
        try: server.serve_forever()
        finally: server.server_close()
    elif args.command=='watch':
        interval = float(os.environ.get('SCRAPE_INTERVAL_MINUTES','60'))*60
        if interval<=0: parser.error('SCRAPE_INTERVAL_MINUTES must be positive')
        while True:
            start = time.monotonic()
            try: pipeline()
            except Exception as error: log('Lỗi theo dõi',error=str(error))
            time.sleep(max(1,interval-(time.monotonic()-start)))
    elif args.command=='pipeline':
        print(json.dumps(pipeline(),ensure_ascii=False,indent=2))
    else:
        database = Database()
        if args.command=='scrape':
            from .scraper import scrape
            print(asyncio.run(scrape(database,True)))
        else:
            rows = database.history()
            if args.command=='analyze': print(json.dumps(analyze(rows)['summary'],ensure_ascii=False,indent=2))
            elif args.command=='catalog': print(catalog(rows)['count'])
            else: database.export(); print(f'SQL observations: {len(rows)}')

if __name__=='__main__':
    main()
