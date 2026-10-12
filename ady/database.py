"""SQL Server via the installed ODBC sqlcmd; Windows Authentication only."""
import csv
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from .common import ROOT, date, number, stamp, read_json, write_csv

def literal(value):
    return "N'" + str(value).replace("'", "''") + "'"

def prepare(rows):
    unique = {}
    for row in rows:
        price = number(row.get('actual_price'))
        if not row.get('name') or not row.get('supermarket') or price is None or price <= 0:
            continue
        try:
            time = stamp(date(row.get('collected_at')))
        except (ValueError, TypeError):
            continue
        identity = str(row.get('product_id') or row.get('product_url') or row.get('match_key') or row['name'])
        # Same JSON encoding and milliseconds as the original writer: retain existing keys.
        key = json.dumps([time, row['supermarket'], identity], ensure_ascii=False, separators=(',', ':'))
        identifier = hashlib.sha256(key.encode('utf-8')).hexdigest()
        unique[identifier] = dict(id=identifier, collected_at=time, supermarket=row['supermarket'],
            product_identity=identity, match_key=row.get('match_key') or row['name'], category=row.get('category') or '',
            actual_price=price, name=row['name'], size=row.get('size') or '', product_url=row.get('product_url') or '',
            payload=json.dumps({**row, 'collected_at': time}, ensure_ascii=False, separators=(',', ':')))
    return list(unique.values())

class Database:
    def __init__(self):
        self.config = read_json(ROOT / 'config/sqlserver.json')
        self.name = os.environ.get('SQL_DATABASE') or self.config['database']
        if not re.fullmatch(r'[a-zA-Z0-9_]+', self.name):
            raise ValueError('Invalid SQL database name')
        self.initialized = False

    def execute(self, sql, database=None):
        with tempfile.TemporaryDirectory(prefix='ady-sqlserver-') as directory:
            path = Path(directory) / 'query.sql'
            path.write_text('SET NOCOUNT ON; SET XACT_ABORT ON;\n' + sql, encoding='utf-8')
            args = [self.config['sqlcmd'], '-S', os.environ.get('SQL_SERVER') or self.config['server'],
                '-E', '-C', '-d', database or self.name, '-b', '-x', '-l', '10', '-t', '120',
                '-f', '65001', '-y', '0', '-w', '65535', '-i', str(path)]
            result = subprocess.run(args, capture_output=True, encoding='utf-8', check=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        return '\n'.join(line for line in result.stdout.splitlines() if line.strip() and
                         not re.fullmatch(r'[- ]+', line) and line.strip() != 'payload')

    def initialize(self):
        if self.initialized:
            return
        self.execute(f'IF DB_ID({literal(self.name)}) IS NULL EXEC({literal("CREATE DATABASE [" + self.name + "]")});', 'master')
        self.execute((ROOT / 'sql/schema.sql').read_text(encoding='utf-8'))
        self.initialized = True

    def save(self, rows):
        self.initialize()
        rows = prepare(rows)
        if not rows:
            return 0
        statements = ['BEGIN TRANSACTION; DECLARE @inserted int = 0;']
        for start in range(0, len(rows), 200):
            data = literal(json.dumps(rows[start:start+200], ensure_ascii=False, separators=(',', ':')))
            statements.append(f'''INSERT INTO dbo.PriceObservations
                SELECT j.* FROM OPENJSON({data}) WITH (
                id varchar(64), collected_at datetime2(3), supermarket nvarchar(50), product_identity nvarchar(2000),
                match_key nvarchar(2000), category nvarchar(500), actual_price decimal(18,2), name nvarchar(2000),
                size nvarchar(500), product_url nvarchar(2000), payload nvarchar(max)) j
                WHERE NOT EXISTS (SELECT 1 FROM dbo.PriceObservations p WITH (UPDLOCK,HOLDLOCK) WHERE p.id=j.id);
                SET @inserted += @@ROWCOUNT;''')
        statements.append('COMMIT; SELECT @inserted;')
        return int(self.execute('\n'.join(statements)).strip())

    def history(self):
        self.initialize()
        if self.execute("SELECT COUNT(*) FROM dbo.ImportMetadata WHERE [key]='csv_imported';").strip() == '0':
            source = ROOT / 'data/processed/price_history.csv'
            if source.exists():
                with source.open(encoding='utf-8-sig', newline='') as handle:
                    self.save(list(csv.DictReader(handle)))
            self.execute("IF NOT EXISTS(SELECT 1 FROM dbo.ImportMetadata WHERE [key]='csv_imported') INSERT INTO dbo.ImportMetadata VALUES ('csv_imported',CONVERT(nvarchar(30),SYSUTCDATETIME(),126));")
        return [json.loads(line.strip()) for line in self.execute('SELECT payload FROM dbo.PriceObservations ORDER BY collected_at,id;').splitlines() if line.strip()]

    def export(self):
        write_csv(ROOT / 'data/processed/price_history.csv', self.history())
