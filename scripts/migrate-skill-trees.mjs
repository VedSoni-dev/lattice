import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from '@neondatabase/serverless';
const source=await readFile('db/002_skill_trees.sql','utf8');
const checksum=createHash('sha256').update(source).digest('hex');
const db=new Client(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
await db.connect();
try{
 await db.query('begin');
 await db.query("select pg_advisory_xact_lock(hashtext('lattice_skill_tree_migration'))");
 await db.query('create table if not exists lattice_private.schema_migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now())');
 await db.query('revoke all on lattice_private.schema_migrations from public,anon,authenticated');
 const existing=await db.query('select checksum from lattice_private.schema_migrations where name=$1',['002_skill_trees']);
 if(existing.rows.length){if(existing.rows[0].checksum!==checksum)throw Error('Applied migration differs from local source; use a new migration.');console.log('Skill tree migration already applied.');}
 else{
  await db.query(source);
  await db.query('insert into lattice_private.schema_migrations(name,checksum) values($1,$2)',['002_skill_trees',checksum]);
  console.log('Skill tree migration applied. Existing data preserved.');
 }
 await db.query('commit');
}catch(error){await db.query('rollback');throw error;}finally{await db.end();}
