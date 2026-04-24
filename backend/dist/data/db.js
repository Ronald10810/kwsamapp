import 'dotenv/config';
import { getRequiredPgPool } from '../config/db.js';
const pool = getRequiredPgPool();
export async function withClient(work) {
    const client = await pool.connect();
    try {
        return await work(client);
    }
    finally {
        client.release();
    }
}
export async function closePool() {
    await pool.end();
}
export async function runInTransaction(work) {
    return withClient(async (client) => {
        await client.query('BEGIN');
        try {
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    });
}
//# sourceMappingURL=db.js.map