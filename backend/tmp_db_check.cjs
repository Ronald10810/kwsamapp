const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await client.query("select count(*)::int as count from staging.associates_raw");
  console.log(JSON.stringify(result.rows[0]));
  await client.end();
}

main().catch(async (error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
