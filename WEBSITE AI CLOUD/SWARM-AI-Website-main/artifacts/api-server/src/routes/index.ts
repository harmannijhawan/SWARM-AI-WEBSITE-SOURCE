import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { requireAuth } from "../middlewares/requireAuth";
import conversationsRouter from "./conversations";
import providersRouter from "./providers";
import modelsRouter from "./models";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(conversationsRouter);
router.use(providersRouter);
router.use(modelsRouter);

export default router;
