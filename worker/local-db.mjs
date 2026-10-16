import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function openDB(path){
  const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA journal_mode=WAL');
  sqlite.exec('CREATE TABLE IF NOT EXISTS qadam_local_migrations(name TEXT PRIMARY KEY)');
  for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
    if(sqlite.prepare('SELECT name FROM qadam_local_migrations WHERE name=?').get(name))continue;
    sqlite.exec('BEGIN');try{
      const exists=name==='0000_orders.sql'&&sqlite.prepare("SELECT name FROM sqlite_master WHERE name='qadam_orders'").get();
      if(!exists)sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
      sqlite.prepare('INSERT INTO qadam_local_migrations(name) VALUES(?)').run(name);sqlite.exec('COMMIT');
    }catch(e){sqlite.exec('ROLLBACK');throw e;}
  }
  const prepare=sql=>{let values=[];const statement=sqlite.prepare(sql);return {bind(...v){values=v;return this;},run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes)}};},async first(){return statement.get(...values)??null;},async all(){return {results:statement.all(...values)}}};};
  return {prepare,async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const result=[];for(const s of statements)result.push(s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close(){sqlite.close();}};
}
