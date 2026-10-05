import retiredSalesRouter from "./retired-sales";
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import recentHandoversRouter from "./recent-handovers";
import enquiriesRouter from "./enquiries";
import enquiryMergesRouter from './enquiry-merges';
import dealerSettingsRouter from "./dealer-settings";
import leadsRouter from "./leads";
import viewingsRouter from "./viewings";
import contactIntentsRouter from "./contact-intents";
import vehicleBrochureRouter from "./vehicle-brochure";
import reservationsRouter from "./reservations";
import saleWorkspaceRouter from "./sale-workspace";
import dealerIntegrationsRouter from './dealer-integrations';
import dealerOperationsRouter from './dealer-operations';
import stripeReservationsRouter from './stripe-reservations';
import dealerRelationshipsRouter from './dealer-relationships';
import dealerChatRouter from './dealer-chat';
import { requireStaffOperationAccess } from '../middlewares/staff-auth';

const router: IRouter = Router();
router.use(requireStaffOperationAccess);
router.use(dealerIntegrationsRouter);
router.use(dealerOperationsRouter);
router.use(stripeReservationsRouter);
router.use(dealerRelationshipsRouter);
router.use(dealerChatRouter);

router.use(retiredSalesRouter);
router.use(saleWorkspaceRouter);
router.use(healthRouter);
router.use(stockRouter);
router.use(vehicleBrochureRouter);
router.use(reservationsRouter);
router.use(recentHandoversRouter);
router.use(enquiriesRouter);
router.use(enquiryMergesRouter);
router.use(viewingsRouter);
router.use(contactIntentsRouter);

router.use(dealerSettingsRouter);

router.use(leadsRouter);

export default router;
