import retiredSalesRouter from "./retired-sales";
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import recentHandoversRouter from "./recent-handovers";
import enquiriesRouter from "./enquiries";
import dealerSettingsRouter from "./dealer-settings";
import leadsRouter from "./leads";
import viewingsRouter from "./viewings";
import contactIntentsRouter from "./contact-intents";
import vehicleBrochureRouter from "./vehicle-brochure";
import reservationsRouter from "./reservations";

const router: IRouter = Router();

router.use(retiredSalesRouter);
router.use(healthRouter);
router.use(stockRouter);
router.use(vehicleBrochureRouter);
router.use(reservationsRouter);
router.use(recentHandoversRouter);
router.use(enquiriesRouter);
router.use(viewingsRouter);
router.use(contactIntentsRouter);

router.use(dealerSettingsRouter);

router.use(leadsRouter);

export default router;
