import { getRequiredPgPool } from '../config/db.js';
import { logger } from '../config/logger.js';

async function main(): Promise<void> {
  const pool = getRequiredPgPool();
  
  try {
    logger.info('Querying CMA and Marketing Plan documents for 2026-07-06...');
    
    // Query CMAs
    const cmaResult = await pool.query(
      "SELECT COUNT(*) as count, STRING_AGG(DISTINCT associate_email, ', ') as users FROM public.cma_documents WHERE DATE(created_at) = '2026-07-06'"
    );

    // Query Marketing Plans  
    const mpResult = await pool.query(
      "SELECT COUNT(*) as count, STRING_AGG(DISTINCT associate_email, ', ') as users FROM public.marketing_plan_documents WHERE DATE(created_at) = '2026-07-06'"
    );

    console.log('\n=== CMAs Generated on 2026-07-06 ===');
    console.log('Count:', cmaResult.rows[0].count);
    console.log('Users:', cmaResult.rows[0].users || 'None');

    console.log('\n=== Marketing Plans Generated on 2026-07-06 ===');
    console.log('Count:', mpResult.rows[0].count);
    console.log('Users:', mpResult.rows[0].users || 'None');
    
    await pool.end();
  } catch (err) {
    logger.error({ err }, 'Failed to query database');
    process.exit(1);
  }
}

main();
