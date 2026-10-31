import { useState } from "react";
import { Link } from "wouter";
import { useAiAssistance } from "@/lib/ai-assistance";
import type { Car } from "@/lib/stock-context";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CarCard } from "./car-card";
import "./ai-assistance.css";
export function AiCarFinder({ cars }: { cars: Car[] }) {
  const ai = useAiAssistance();
  const [text, setText] = useState(""),
    [answer, setAnswer] = useState(""),
    [ids, setIds] = useState<string[]>([]);
  return (
    <section className="ai-car-finder" aria-labelledby="ai-car-finder-heading">
      <div>
        <p className="luxxy-kicker">Find your next car</p>
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
          if (!ai.enabled) {
            setAnswer(
              "Smart search is unavailable at the moment. You can use our stock filters to find your next car.",
            );
            return;
          }
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
          disabled={
            !text.trim() || ai.busy || (ai.enabled && ai.remaining === 0)
          }
        >
          {ai.busy ? "Finding cars…" : "Find me a car"}
        </Button>
      </form>
      <div className="ai-allowance">
        <span>
          {ai.enabled
            ? `${ai.remaining} of 10 AI requests left for this browser session.`
            : "You can always browse with our usual filters."}
        </span>
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
}
