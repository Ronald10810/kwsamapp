import { Router } from 'express';
const router = Router();
router.get('/', (_req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});
export default router;
//# sourceMappingURL=health.js.map