import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import enquiriesRouter from "./enquiries";
import salesRouter from "./sales";
import dealerSettingsRouter from "./dealer-settings";
import customerIntakeRouter from "./customer-intake";
import leadsRouter from "./leads";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stockRouter);
router.use(enquiriesRouter);
router.use(salesRouter);
router.use(dealerSettingsRouter);
router.use(customerIntakeRouter);
router.use(leadsRouter);

export default router;
