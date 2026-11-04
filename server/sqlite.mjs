import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,chmodSync} from 'node:fs';
export function openDatabase(path,migrations){
  const raw=new DatabaseSync(path);chmodSync(path,0o600);
  raw.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  if(migrations){raw.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');for(const file of readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort())if(!raw.prepare('SELECT name FROM local_migrations WHERE name=?').get(file)){
    raw.exec('BEGIN IMMEDIATE');try{raw.exec(readFileSync(migrations+'/'+file,'utf8'));raw.prepare('INSERT INTO local_migrations VALUES(?)').run(file);raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');raw.close();throw e;}
  }}
  function prepare(query,params=[]){return {bind(...values){return prepare(query,values);},first(){return raw.prepare(query).get(...params)||null;},all(){return {results:raw.prepare(query).all(...params)};},run(){return {meta:{changes:Number(raw.prepare(query).run(...params).changes)}};}};}
  return {raw,prepare,batch(statements){raw.exec('BEGIN IMMEDIATE');try{// No awaits: a transaction cannot interleave with another request.
    const results=statements.map(s=>s.run());raw.exec('COMMIT');return results;
  }catch(e){raw.exec('ROLLBACK');throw e;}},snapshot(destination){raw.prepare('VACUUM INTO ?').run(destination);chmodSync(destination,0o600);},integrity(){return raw.prepare('PRAGMA integrity_check').get().integrity_check;},close(){raw.close();}};
}
