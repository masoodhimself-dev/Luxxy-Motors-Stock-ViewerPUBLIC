import { useId, useMemo } from 'react';
import type { MotHistory } from '@workspace/vehicle-meta';
import type { Car } from '@/lib/stock-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { withDealerAnswers } from '@/lib/dealer-answers';
import { featuredVehicleAnswers, vehicleAnswers } from '@/lib/vehicle-answers';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import './vehicle-questions.css';

/** Published car and dealership facts, with no generation or provider lookups. */
export function VehicleAnswers({ car, motHistory, onAskTeam }: {
  car: Car;
  motHistory?: MotHistory | null;
  onAskTeam: (message?: string) => void;
}) {
  const headingId = useId();
  const { settings, isLoading, isError } = useDealerSettings();
  const answers = useMemo(() => {
    const supplied = vehicleAnswers(car, motHistory);
    const all = isLoading || isError ? supplied : withDealerAnswers(supplied, car, settings);
    // A configured inclusion already answers the warranty question. Keep the
    // first view distinct instead of repeating it in another accordion row.
    const includesWarranty = all.some(answer => answer.id === 'included' && /\bwarrant(?:y|ies)\b/i.test(answer.answer));
    return featuredVehicleAnswers(all.filter(answer => !includesWarranty || answer.id !== 'warranty'));
  }, [car, motHistory, settings, isLoading, isError]);
  if (!answers.length) return null;
  return <section id="vehicle-questions" className="vehicle-questions" aria-labelledby={headingId}>
    <h2 id={headingId} className="section-heading">Questions about this car</h2>
    <Accordion key={car.id} type="single" collapsible className="vehicle-questions-list">
      {answers.map(answer => <AccordionItem key={answer.id} value={answer.id}>
        <AccordionTrigger>{answer.question}</AccordionTrigger>
        <AccordionContent>
          <p className="vehicle-question-answer">{answer.answer}</p>
          {answer.href && <a className="vehicle-question-link" href={answer.href}>{answer.linkLabel}</a>}
        </AccordionContent>
      </AccordionItem>)}
    </Accordion>
    <p className="vehicle-questions-contact">Need to check something else? <button type="button" onClick={() => onAskTeam()}>Message the showroom</button></p>
  </section>;
}
