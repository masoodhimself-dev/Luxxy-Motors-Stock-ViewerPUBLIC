import { useState } from "react";
import { Link } from "wouter";
import { useAiAssistance } from "@/lib/ai-assistance";
import type { Car } from "@/lib/stock-context";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CarCard } from "./car-card";
import "./ai-assistance.css";
export function AiCarFinder({ cars, collapsible = false }: { cars: Car[]; collapsible?: boolean }) {
  const ai = useAiAssistance();
  const [text, setText] = useState(""),
    [answer, setAnswer] = useState(""),
    [ids, setIds] = useState<string[]>([]);
  if (!ai.enabled) return null;

  const finder = (
    <section className="ai-car-finder" aria-labelledby="ai-car-finder-heading">
      <div>
        <h2 id="ai-car-finder-heading" className="section-heading">
          Tell us what you’re looking for
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          Try “an automatic under £8,000 with parking sensors”.
        </p>
      </div>
      <form
        className="ai-question-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setIds([]);
          setAnswer("");
          const reply = await ai.run("finder", { text });
          if (reply) {
            setAnswer(reply.answer);
            setIds(reply.vehicleIds);
          }
        }}
      >
        <label className="sr-only" htmlFor="ai-car-search">
          Describe the car you want
        </label>
        <Input
          id="ai-car-search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={600}
          placeholder="Budget, gearbox and features"
          disabled={ai.busy}
        />
        <Button
          type="submit"
          disabled={!text.trim() || ai.busy || ai.remaining === 0}
        >
          {ai.busy ? "Finding cars…" : "Find me a car"}
        </Button>
      </form>
      <div className="ai-allowance">
        {ai.remaining === 0 && <span>Car finder is unavailable for now.</span>}
        <Link href="/stock" className="text-link min-h-11">
          Browse all cars
        </Link>
      </div>
      {(answer || ai.error) && (
        <p className="text-sm leading-6" role="status">
          {ai.error || answer}
        </p>
      )}
      {!!ids.length && (
        <div className="ai-matched-cars">
          {ids
            .map((id) => cars.find((car) => car.id === id))
            .filter((car): car is Car =>
              Boolean(car && car.inventoryStatus === "available"),
            )
            .slice(0, 4)
            .map((car) => (
              <CarCard key={car.id} car={car} />
            ))}
        </div>
      )}
    </section>
  );
  return collapsible
    ? <details className="mh-ai-search"><summary>Search by describing a car</summary>{finder}</details>
    : finder;
}
