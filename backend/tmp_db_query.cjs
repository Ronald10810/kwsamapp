const { Client } = require('pg');

async function main() {
  const sql = process.argv[2];
  if (!sql) {
    throw new Error('SQL argument required');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await client.query(sql);
  console.log(JSON.stringify(result.rows));
  await client.end();
}

main().catch(async (error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
