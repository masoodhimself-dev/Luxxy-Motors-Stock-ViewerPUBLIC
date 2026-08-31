import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import enquiriesRouter from "./enquiries";
import salesRouter from "./sales";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stockRouter);
router.use(enquiriesRouter);
router.use(salesRouter);

export default router;
