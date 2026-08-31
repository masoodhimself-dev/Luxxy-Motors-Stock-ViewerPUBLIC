import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import enquiriesRouter from "./enquiries";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stockRouter);
router.use(enquiriesRouter);

export default router;
