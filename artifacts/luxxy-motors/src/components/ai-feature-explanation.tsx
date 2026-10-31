import { useEffect, useState } from "react";
import { useAiAssistance } from "@/lib/ai-assistance";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";
export function AiFeatureExplanation({
  vehicleId,
  features,
}: {
  vehicleId: string;
  features: string[];
}) {
  const ai = useAiAssistance();
  const [feature, setFeature] = useState(features[0] ?? ""),
    [answer, setAnswer] = useState("");
  useEffect(() => {
    setFeature(features[0] ?? "");
    setAnswer("");
  }, [vehicleId, features.join("\n")]);
  if (!ai.enabled || !features.length) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-11 mt-3">
          Explain a feature
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg p-5">
        <DialogHeader>
          <DialogTitle>Understand this car’s equipment</DialogTitle>
          <DialogDescription>
            Choose a listed feature for a plain-English explanation.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm">
          Feature
          <NativeSelect
            value={feature}
            onChange={(e) => {
              setFeature(e.target.value);
              setAnswer("");
            }}
          >
            {features.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          disabled={ai.busy || !ai.remaining}
          onClick={async () => {
            const reply = await ai.run("explain", { vehicleId, text: feature });
            if (reply) setAnswer(reply.answer);
          }}
        >
          {ai.busy ? "Explaining…" : "Explain this feature"}
        </Button>
        {(answer || ai.error) && (
          <p role="status" className="text-sm leading-6">
            {ai.error || answer}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {ai.remaining} of 10 AI requests left. Confirm important details with
          the dealership.
        </p>
      </DialogContent>
    </Dialog>
  );
}
