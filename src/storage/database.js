import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/sqlserver.json'), 'utf8'));
export const DATABASE_NAME = process.env.SQL_DATABASE || config.database;
if (!/^[a-zA-Z0-9_]+$/.test(DATABASE_NAME)) throw new Error('Invalid SQL database name');
const literal = value => "N'" + String(value).replaceAll("'", "''") + "'";
export function executeSql(sql, db = DATABASE_NAME) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ady-sqlserver-'));
  try {
    const input = path.join(directory, 'query.sql');
    writeFileSync(input, 'SET NOCOUNT ON; SET XACT_ABORT ON;\n' + sql, 'utf8');
    return execFileSync(config.sqlcmd, ['-S', process.env.SQL_SERVER || config.server, '-E', '-C', '-d', db, '-b', '-x', '-l', '10', '-t', '120', '-f', '65001', '-y', '0', '-w', '65535', '-i', input], {encoding:'utf8', maxBuffer:128*1024*1024, windowsHide:true}).split(/\r?\n/).filter(line => line.trim() && !/^[- ]+$/.test(line) && line.trim() !== 'payload').join('\n');
  } finally { rmSync(directory, {recursive:true}); }
}
let initialized = false;
export function database() {
  if (initialized) return;
  executeSql('IF DB_ID(' + literal(DATABASE_NAME) + ') IS NULL EXEC(' + literal('CREATE DATABASE [' + DATABASE_NAME + ']') + ');', 'master');
  executeSql(`IF OBJECT_ID('dbo.PriceObservations', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PriceObservations (
      id varchar(64) NOT NULL PRIMARY KEY,
      collected_at datetime2(3) NOT NULL,
      supermarket nvarchar(50) NOT NULL,
      product_identity nvarchar(2000) NOT NULL,
      match_key nvarchar(2000) NOT NULL,
      category nvarchar(500) NOT NULL,
      actual_price decimal(18,2) NOT NULL CHECK(actual_price > 0),
      name nvarchar(2000) NOT NULL,
      size nvarchar(500) NOT NULL,
      product_url nvarchar(2000) NOT NULL,
      payload nvarchar(max) NOT NULL CHECK(ISJSON(payload)=1));
    CREATE INDEX IX_Prices_StoreTime ON dbo.PriceObservations(supermarket, collected_at);
    CREATE INDEX IX_Prices_CategoryTime ON dbo.PriceObservations(category, collected_at);
  END;
  IF OBJECT_ID('dbo.ImportMetadata', 'U') IS NULL CREATE TABLE dbo.ImportMetadata ([key] nvarchar(100) PRIMARY KEY, value nvarchar(2000));`);
  initialized = true;
}
export function prepareObservations(rows) {
  const unique = new Map();
  for (const row of rows) {
    const price = Number(row.actual_price);
    if (!row.name || !row.supermarket || !Number.isFinite(price) || price <= 0 || !Number.isFinite(Date.parse(row.collected_at))) continue;
    const time = new Date(row.collected_at).toISOString();
    const identity = String(row.product_id || row.product_url || row.match_key || row.name);
    const id = createHash('sha256').update(JSON.stringify([time, row.supermarket, identity])).digest('hex');
    unique.set(id, {id, collected_at:time, supermarket:row.supermarket, product_identity:identity, match_key:row.match_key || row.name, category:row.category || '', actual_price:price, name:row.name, size:row.size || '', product_url:row.product_url || '', payload:JSON.stringify({...row,collected_at:time})});
  }
  return [...unique.values()];
}
export function saveObservations(rows) {
  database();
  const prepared = prepareObservations(rows);
  if (!prepared.length) return 0;
  let sql = 'BEGIN TRANSACTION; DECLARE @inserted int = 0;\n';
  for (let i=0; i<prepared.length; i+=200) {
    sql += `INSERT INTO dbo.PriceObservations
      SELECT j.* FROM OPENJSON(${literal(JSON.stringify(prepared.slice(i,i+200)))}) WITH (
      id varchar(64), collected_at datetime2(3), supermarket nvarchar(50), product_identity nvarchar(2000),
      match_key nvarchar(2000), category nvarchar(500), actual_price decimal(18,2), name nvarchar(2000), size nvarchar(500), product_url nvarchar(2000), payload nvarchar(max)) j
      WHERE NOT EXISTS (SELECT 1 FROM dbo.PriceObservations p WITH (UPDLOCK, HOLDLOCK) WHERE p.id=j.id);
      SET @inserted += @@ROWCOUNT;\n`;
  }
  sql += 'COMMIT; SELECT @inserted;';
  return Number(executeSql(sql).trim());
}
export function sqlHistory() {
  database();
  // One JSON object per line, unlimited nvarchar output; JSON escapes embedded line breaks.
  return executeSql('SELECT payload FROM dbo.PriceObservations ORDER BY collected_at, id;').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(s=>JSON.parse(s));
}
export function hasImported() {
  database();
  return executeSql("SELECT COUNT(*) FROM dbo.ImportMetadata WHERE [key]='csv_imported';").trim() === '1';
}
export function markImported() {
  executeSql("IF NOT EXISTS(SELECT 1 FROM dbo.ImportMetadata WHERE [key]='csv_imported') INSERT INTO dbo.ImportMetadata VALUES ('csv_imported', CONVERT(nvarchar(30),SYSUTCDATETIME(),126));");
}
