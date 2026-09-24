import { Router } from 'express';
const router = Router();
// Preserve stored records, but never execute the former sales workflow.
router.use(['/sales', '/signing', '/customer-intake-sessions'], (_req, res) => {
  res.status(410).json({ error: 'The previous sales process has been removed.' });
});
export default router;
