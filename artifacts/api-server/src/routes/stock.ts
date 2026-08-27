import { promises as fs } from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { ReplaceStockBody } from "@workspace/api-zod";

const router: IRouter = Router();
const stockPath = path.resolve(import.meta.dirname, "../../../data/stock.json");

function hasValidPortalPassword(value: string | undefined): boolean {
  return value === (process.env.PORTAL_PASSWORD ?? "luxxy");
}

async function readStock(): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(stockPath, "utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

router.get("/stock", async (req, res): Promise<void> => {
  const stock = await readStock();
  if (!stock) {
    res.sendStatus(204);
    return;
  }

  res.json(stock);
});

router.post("/stock/auth", (req, res): void => {
  if (!hasValidPortalPassword(req.get("x-portal-password"))) {
    req.log.warn("Rejected invalid portal login");
    res.status(401).json({ error: "Incorrect portal password" });
    return;
  }

  res.sendStatus(204);
});

router.post("/stock", async (req, res): Promise<void> => {
  const suppliedPassword = req.get("x-portal-password");

  if (!hasValidPortalPassword(suppliedPassword)) {
    req.log.warn("Rejected unauthorized stock upload");
    res.status(401).json({ error: "Incorrect portal password" });
    return;
  }

  const parsed = ReplaceStockBody.safeParse(req.body);
  if (!parsed.success || !Array.isArray(parsed.data.cars) || parsed.data.cars.length === 0) {
    res.status(400).json({
      error: 'Expected a wrapped stock object with a non-empty "cars" array',
    });
    return;
  }

  const stock = {
    ...parsed.data,
    count: parsed.data.cars.length,
  };

  await fs.mkdir(path.dirname(stockPath), { recursive: true });
  const temporaryPath = `${stockPath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(stock, null, 2), "utf8");
  await fs.rename(temporaryPath, stockPath);

  req.log.info({ vehicleCount: stock.cars.length }, "Shared stock replaced");
  res.json(stock);
});

export default router;