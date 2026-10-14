import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function openDB(path){
  const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA journal_mode=WAL');
  const exists=sqlite.prepare("SELECT name FROM sqlite_master WHERE name='qadam_orders'").get();
  if(!exists)sqlite.exec(readFileSync(new URL('../drizzle/0000_orders.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  return {prepare(sql){let values=[];const statement=sqlite.prepare(sql);return {bind(...v){values=v;return this;},async run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes)}};},async first(){return statement.get(...values)??null;},async all(){return {results:statement.all(...values)}}};},close(){sqlite.close();}};
}
