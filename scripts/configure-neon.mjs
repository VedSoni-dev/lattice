import {neon} from '@neondatabase/serverless';
const sql=neon(process.env.DATABASE_URL),appOrigin=new URL(process.env.APP_ORIGIN).origin;
const endpointId=process.env.NEON_AUTH_ENDPOINT_ID;
if(!endpointId)throw new Error('Set NEON_AUTH_ENDPOINT_ID to the Neon endpoint that hosts your auth configuration.');
const rows=await sql`update neon_auth.project_config set trusted_origins=case when trusted_origins @> ${JSON.stringify([appOrigin])}::jsonb then trusted_origins else coalesce(trusted_origins,'[]'::jsonb)||${JSON.stringify([appOrigin])}::jsonb end,name='Lattice',allow_localhost=false,updated_at=now() where endpoint_id=${endpointId} returning name,trusted_origins,allow_localhost`;
if(rows.length!==1)throw new Error('Expected exactly one Lattice auth configuration.');
console.log(rows);
