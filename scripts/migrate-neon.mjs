import {readFile} from 'node:fs/promises';
import {Client} from '@neondatabase/serverless';
import {neonMigration} from '../lib/neon-migration.mjs';
const db=new Client(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
await db.connect();
try{
  const existing=await db.query("select to_regclass('lattice_private.profiles') as existing");
  if(existing.rows[0].existing)throw new Error('Lattice schema already exists; refusing to reapply initial migration.');
  await db.query('begin');
  await db.query(neonMigration(await readFile('db/001_lattice.sql','utf8')));
  await db.query('commit');console.log('Lattice schema initialized on Neon.');
}catch(error){await db.query('rollback');throw error;}finally{await db.end();}
