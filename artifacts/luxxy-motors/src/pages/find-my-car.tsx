import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { CarCard } from '@/components/car-card';
import { Button } from '@/components/ui/button';
import { useStock, type Car } from '@/lib/stock-context';
import { cn } from '@/lib/utils';
import { usePageMeta } from '@/hooks/use-page-meta';

type AnswerKey = 'budget' | 'bodyType' | 'fuel' | 'transmission' | 'use';
type AnswerValue = string;
type Answers = Partial<Record<AnswerKey, AnswerValue>>;
type MatchKind = 'exact' | 'flexible';

type RecommendationMatch = {
  key: AnswerKey;
  answer: string;
  explanation: string;
  kind: MatchKind;
  points: number;
};

type RecommendationMiss = {
  key: AnswerKey;
  answer: string;
  explanation: string;
};
type QuestionOption = {
  value: AnswerValue;
  label: string;
  detail: string;
};

type Question = {
  key: AnswerKey;
  eyebrow: string;
  title: string;
  description: string;
  options: QuestionOption[];
};

const questions: Question[] = [
  {
    key: 'budget',
    eyebrow: '01 / five',
    title: 'What would feel comfortable?',
    description: 'A guide price is enough. We will keep a little flexibility for the right car.',
    options: [
      { value: 'under-10000', label: 'Up to £10,000', detail: 'Thoughtful, well-priced used cars' },
      { value: '10000-15000', label: '£10,000 – £15,000', detail: 'A broad choice of everyday cars' },
      { value: '15000-22000', label: '£15,000 – £22,000', detail: 'More recent cars and extra comfort' },
      { value: 'over-22000', label: '£22,000 or more', detail: 'The newest and most specified stock' },
    ],
  },
  {
    key: 'bodyType',
    eyebrow: '02 / five',
    title: 'What shape suits your life?',
    description: 'Think about parking, passengers and the sort of roads you use most.',
    options: [
      { value: 'hatchback', label: 'Hatchback', detail: 'Easy around town, versatile every day' },
      { value: 'suv', label: 'SUV or crossover', detail: 'A higher view with useful space' },
      { value: 'saloon', label: 'Saloon or estate', detail: 'Comfortable, composed longer journeys' },
      { value: 'coupe', label: 'Coupe or convertible', detail: 'Something with a little more occasion' },
    ],
  },
  {
    key: 'fuel',
    eyebrow: '03 / five',
    title: 'How do you want to power it?',
    description: 'Not sure? Choose “Open to options” and we will keep the door open.',
    options: [
      { value: 'petrol', label: 'Petrol', detail: 'Familiar, flexible and easy to live with' },
      { value: 'diesel', label: 'Diesel', detail: 'A sensible choice for higher mileage' },
      { value: 'hybrid', label: 'Hybrid or electric', detail: 'Quieter running and modern efficiency' },
      { value: 'any', label: 'Open to options', detail: 'Show me the strongest all-round fits' },
    ],
  },
  {
    key: 'transmission',
    eyebrow: '04 / five',
    title: 'Which gearbox feels right?',
    description: 'Choose the one you enjoy, rather than the one you think you should choose.',
    options: [
      { value: 'automatic', label: 'Automatic', detail: 'Relaxed in traffic and simple to use' },
      { value: 'manual', label: 'Manual', detail: 'Connected and familiar on every road' },
      { value: 'any', label: 'No strong preference', detail: 'Let the car be the deciding factor' },
    ],
  },
  {
    key: 'use',
    eyebrow: '05 / five',
    title: 'What will it mostly do?',
    description: 'This helps us weigh the details that matter when two cars look alike on paper.',
    options: [
      { value: 'city', label: 'City and short trips', detail: 'Compact, easy and economical to run' },
      { value: 'family', label: 'Family life', detail: 'Space for people, bags and busy days' },
      { value: 'commute', label: 'Regular commuting', detail: 'Comfortable and settled on longer drives' },
      { value: 'leisure', label: 'Weekends and getting away', detail: 'A little more character for the open road' },
    ],
  },
];

const normalise = (value: string | null | undefined) => (value || '').trim().toLowerCase();

const bodyTypeMatches = (car: Car, answer: string) => {
  const body = normalise(car.bodyType);
  if (answer === 'suv') return body.includes('suv') || body.includes('crossover') || body.includes('4x4');
  if (answer === 'saloon') return body.includes('saloon') || body.includes('estate');
  if (answer === 'coupe') return body.includes('coupe') || body.includes('convertible') || body.includes('roadster');
  return body.includes('hatch') || body.includes('small car') || body.includes('city');
};

const fuelMatches = (car: Car, answer: string) => {
  const fuel = normalise(car.fuel);
  if (answer === 'hybrid') return fuel.includes('hybrid') || fuel.includes('electric') || fuel.includes('plug');
  return fuel.includes(answer);
};

const transmissionMatches = (car: Car, answer: string) => {
  const transmission = normalise(car.transmission);
  if (answer === 'automatic') return transmission.includes('auto') || transmission.includes('cvt');
  return transmission.includes('manual');
};

const carPrice = (car: Car) => (typeof car.price === 'number' ? car.price : null);
const formatPrice = (price: number) => `£${price.toLocaleString('en-GB')}`;

const answerLabel = (key: AnswerKey, value: string) =>
  questions.find((question) => question.key === key)?.options.find((option) => option.value === value)?.label ?? value;

const useCaseMatches = (car: Car, answer: string) => {
  const body = normalise(car.bodyType);
  const fuel = normalise(car.fuel);
  const mileage = typeof car.mileage === 'number' ? car.mileage : null;

  return (
    (answer === 'city' && (body.includes('hatch') || body.includes('city') || (mileage !== null && mileage < 45000))) ||
    (answer === 'family' && ((car.seats || 0) >= 5 || body.includes('suv') || body.includes('estate'))) ||
    (answer === 'commute' && (body.includes('saloon') || body.includes('estate') || fuel.includes('diesel') || fuel.includes('hybrid'))) ||
    (answer === 'leisure' && (body.includes('coupe') || body.includes('convertible') || body.includes('suv')))
  );
};

const formatMileage = (mileage: number) => `${mileage.toLocaleString('en-GB')} miles`;

function useCaseEvidence(car: Car, use: string) {
  const body = normalise(car.bodyType);
  const fuel = normalise(car.fuel);
  const mileage = typeof car.mileage === 'number' ? car.mileage : null;
  const evidence: string[] = [];

  if (use === 'city') {
    if (body.includes('hatch') || body.includes('city')) evidence.push(`${car.bodyType} body shape`);
    if (mileage !== null && mileage < 45000) evidence.push(formatMileage(mileage));
  }

  if (use === 'family') {
    if ((car.seats || 0) >= 5) evidence.push(`${car.seats} seats`);
    if (body.includes('suv') || body.includes('estate')) evidence.push(`${car.bodyType} body shape`);
  }

  if (use === 'commute') {
    if (body.includes('saloon') || body.includes('estate')) evidence.push(`${car.bodyType} body shape`);
    if (fuel.includes('diesel') || fuel.includes('hybrid')) evidence.push(`${car.fuel} fuel`);
  }

  if (use === 'leisure' && (body.includes('coupe') || body.includes('convertible') || body.includes('suv'))) {
    evidence.push(`${car.bodyType} body shape`);
  }

  return evidence;
}

function scoreCar(car: Car, answers: Answers) {
  let score = 0;
  const matches: RecommendationMatch[] = [];
  const misses: RecommendationMiss[] = [];
  const price = carPrice(car);

  if (answers.budget && price !== null) {
    const inBudget =
      (answers.budget === 'under-10000' && price <= 10000) ||
      (answers.budget === '10000-15000' && price >= 10000 && price <= 15000) ||
      (answers.budget === '15000-22000' && price >= 15000 && price <= 22000) ||
      (answers.budget === 'over-22000' && price >= 22000);
    if (inBudget) {
      score += 4;
      matches.push({
        key: 'budget',
        answer: answerLabel('budget', answers.budget),
        explanation: 'Within your guide price',
        kind: 'exact',
        points: 4,
      });
    } else if (
      (answers.budget === 'under-10000' && price <= 11500) ||
      (answers.budget === '10000-15000' && price >= 8500 && price <= 16500) ||
      (answers.budget === '15000-22000' && price >= 13500 && price <= 24000) ||
      (answers.budget === 'over-22000' && price >= 20000)
    ) {
      score += 2;
      matches.push({
        key: 'budget',
        answer: answerLabel('budget', answers.budget),
        explanation: 'Close to your guide price',
        kind: 'flexible',
        points: 2,
      });
    } else {
      misses.push({
        key: 'budget',
        answer: answerLabel('budget', answers.budget),
        explanation: `This car is listed at ${formatPrice(price)}, outside the flexible guide range`,
      });
    }
  }

  if (answers.bodyType) {
    if (bodyTypeMatches(car, answers.bodyType)) {
      score += 3;
      matches.push({
        key: 'bodyType',
        answer: answerLabel('bodyType', answers.bodyType),
        explanation: 'The shape you described',
        kind: 'exact',
        points: 3,
      });
    } else {
      misses.push({
        key: 'bodyType',
        answer: answerLabel('bodyType', answers.bodyType),
        explanation: car.bodyType ? `This car is listed as ${car.bodyType}` : 'Its listed body shape does not match',
      });
    }
  }

  if (answers.fuel && answers.fuel !== 'any') {
    if (fuelMatches(car, answers.fuel)) {
      score += 2;
      matches.push({
        key: 'fuel',
        answer: answerLabel('fuel', answers.fuel),
        explanation: `${answers.fuel === 'hybrid' ? 'Hybrid or electric' : answers.fuel} running`,
        kind: 'exact',
        points: 2,
      });
    } else {
      misses.push({
        key: 'fuel',
        answer: answerLabel('fuel', answers.fuel),
        explanation: car.fuel ? `This car uses ${car.fuel}` : 'Its listed fuel type does not match',
      });
    }
  }

  if (answers.transmission && answers.transmission !== 'any') {
    if (transmissionMatches(car, answers.transmission)) {
      score += 2;
      matches.push({
        key: 'transmission',
        answer: answerLabel('transmission', answers.transmission),
        explanation: `An ${answers.transmission} gearbox`,
        kind: 'exact',
        points: 2,
      });
    } else {
      misses.push({
        key: 'transmission',
        answer: answerLabel('transmission', answers.transmission),
        explanation: car.transmission ? `This car has a ${car.transmission} gearbox` : 'Its listed gearbox does not match',
      });
    }
  }

  if (answers.use) {
    const evidence = useCaseEvidence(car, answers.use);
    if (evidence.length > 0) {
      score += 2;
      matches.push({
        key: 'use',
        answer: answerLabel('use', answers.use),
        explanation: `Supported by ${evidence.join(' and ')}`,
        kind: 'exact',
        points: 2,
      });
    } else {
      misses.push({
        key: 'use',
        answer: answerLabel('use', answers.use),
        explanation: 'Its current details do not support this intended use as strongly',
      });
    }
  }

  return { score, matches, misses };
}

function matchSummary(matches: RecommendationMatch[]) {
  if (matches.length === 0) return 'A sensible starting point from the cars currently on the forecourt.';
  const explanations = matches.map((match) => match.explanation.toLowerCase());
  if (matches.length === 1) return `A sensible fit for you, especially for ${explanations[0]}.`;
  if (matches.length === 2) return `A strong fit for ${explanations[0]} and ${explanations[1]}.`;
  return `A strong all-round fit: ${explanations.slice(0, 3).join(', ')}.`;
}

function OptionButton({
  option,
  selected,
  onSelect,
}: {
  option: QuestionOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`option-${option.value}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'group flex min-h-[5.35rem] w-full items-center justify-between gap-5 border bg-card px-5 py-4 text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected ? 'border-accent bg-accent/10' : 'border-border/80',
      )}
    >
      <span className="min-w-0">
        <span className="block font-display text-[1.18rem] font-semibold leading-tight text-primary">{option.label}</span>
        <span className="mt-1 block text-sm leading-5 text-muted-foreground">{option.detail}</span>
      </span>
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center border transition-colors',
          selected ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-background text-transparent group-hover:border-primary/50',
        )}
        aria-hidden="true"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    </button>
  );
}

export default function FindMyCar() {
  const { stock, isLoading, error } = useStock();
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [showResults, setShowResults] = useState(false);

  usePageMeta({
    title: 'Find My Car | Luxxy Motors',
    description: 'Answer five quick questions and discover the strongest matches from Luxxy Motors live used-car stock.',
  });

  const question = questions[step];
  const recommendations = useMemo(() => {
    if (!stock?.cars) return [];
    return stock.cars
      .map((car) => ({ car, ...scoreCar(car, answers) }))
      .sort((a, b) => b.score - a.score || (carPrice(a.car) ?? Number.MAX_SAFE_INTEGER) - (carPrice(b.car) ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 3);
  }, [answers, stock?.cars]);

  const answeredCount = Object.keys(answers).length;
  const topScore = recommendations[0]?.score ?? 0;
  const hasStrongMatch = topScore >= 7;

  useEffect(() => {
    if (showResults) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [showResults]);

  const choose = (value: string) => {
    setHasStarted(true);
    setAnswers((current) => ({ ...current, [question.key]: value }));
  };

  const next = () => {
    if (!answers[question.key]) return;
    if (step === questions.length - 1) {
      setShowResults(true);
      return;
    }
    setStep((current) => current + 1);
  };

  const restart = () => {
    setAnswers({});
    setStep(0);
    setHasStarted(false);
    setShowResults(false);
  };

  const back = () => {
    if (step === 0) {
      setHasStarted(false);
      return;
    }
    setStep((current) => current - 1);
  };

  if (isLoading) {
    return (
      <main className="luxxy-shell min-h-[100dvh]">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:px-12">
          <div className="animate-pulse space-y-8" aria-label="Loading Find My Car" data-testid="state-loading">
            <div className="h-3 w-32 bg-muted" />
            <div className="h-16 max-w-2xl bg-muted" />
            <div className="grid gap-4 md:grid-cols-3">
              {[1, 2, 3].map((item) => <div key={item} className="h-64 border border-border/60 bg-card" />)}
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="luxxy-shell min-h-[100dvh]">
        <div className="mx-auto flex min-h-[70dvh] max-w-xl flex-col items-start justify-center px-5 py-16 sm:px-8">
          <p className="luxxy-kicker">Find My Car</p>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-primary sm:text-5xl">The forecourt is taking a moment.</h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">We could not load the live stock just now. Please try again and we will get you back to the right cars.</p>
          <Button type="button" onClick={() => window.location.reload()} data-testid="button-retry-stock" className="mt-8">
            Try again
          </Button>
        </div>
      </main>
    );
  }

  const stockCount = stock?.cars?.length ?? 0;

  if (stockCount === 0) {
    return (
      <main className="luxxy-shell min-h-[100dvh]">
        <div className="mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center px-5 py-16 sm:px-8 lg:px-12">
          <p className="luxxy-kicker">Find My Car</p>
          <h1 className="mt-5 max-w-2xl font-display text-5xl font-semibold leading-[0.98] tracking-tight text-primary sm:text-7xl">A thoughtful match starts with the right stock.</h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground">There are no cars available to match at this moment. Our stock changes regularly, so please check back soon or speak with the Harrow team about what is arriving.</p>
          <div className="mt-9 border-l-2 border-accent pl-5 text-sm font-semibold leading-6 text-primary">No guesswork. No placeholder cars. Just the vehicles we can actually help you with.</div>
          <Button type="button" onClick={() => window.location.reload()} data-testid="button-refresh-empty-stock" className="mt-9 w-fit">
            Check live stock again
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="luxxy-shell min-h-[100dvh] overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14 lg:px-12">
        <header className="luxxy-reveal grid overflow-hidden border border-border bg-primary text-primary-foreground lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="relative px-6 py-9 sm:px-10 sm:py-12 lg:px-14 lg:py-14">
            <div className="absolute left-0 top-0 h-full w-1 bg-accent" aria-hidden="true" />
            <p className="luxxy-kicker text-accent">A little help choosing well</p>
            <h1 className="luxxy-reveal luxxy-reveal-1 mt-5 max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-7xl">
              Find the car that fits.
            </h1>
            <p className="luxxy-reveal luxxy-reveal-2 mt-6 max-w-2xl text-base leading-7 text-primary-foreground/70 sm:text-lg">
              Five quick choices, then a short list from our live Harrow stock. Nothing is made up, and you can change your mind at any point.
            </p>
          </div>
          <div className="flex items-end justify-between gap-6 border-t border-primary-foreground/15 bg-primary/60 px-6 py-6 sm:px-10 lg:flex-col lg:items-start lg:justify-end lg:border-l lg:border-t-0 lg:px-8 lg:py-10">
            <div>
              <span className="luxxy-label text-primary-foreground/60">Live forecourt</span>
              <span className="mt-2 block font-display text-4xl font-semibold">{stockCount}</span>
              <span className="text-sm text-primary-foreground/65">cars currently available</span>
            </div>
            <div className="hidden max-w-[12rem] text-sm leading-6 text-primary-foreground/60 sm:block lg:block">
              We keep the matching honest, even when the perfect answer is not on site today.
            </div>
          </div>
        </header>

        {!showResults ? (
          <section className="luxxy-reveal luxxy-reveal-3 mt-10 max-w-5xl" aria-labelledby="question-title">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {hasStarted && (
                  <button type="button" onClick={back} data-testid="button-back-question" className="inline-flex h-9 items-center gap-2 px-2 text-sm font-semibold text-primary transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                )}
                <span className="luxxy-label text-muted-foreground">Question {step + 1} of {questions.length}</span>
              </div>
              <button type="button" onClick={restart} data-testid="button-restart-quiz" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <RotateCcw className="h-3.5 w-3.5" />
                Start over
              </button>
            </div>
            <div className="mb-8" aria-label={`Step ${step + 1} of ${questions.length}`} role="progressbar" aria-valuemin={1} aria-valuemax={questions.length} aria-valuenow={step + 1}>
              <div className="grid grid-cols-5 gap-1.5">
                {questions.map((item, index) => (
                  <div key={item.key} className="min-w-0">
                    <div className={cn('h-1.5 transition-colors', index <= step ? 'bg-accent' : 'bg-border')} />
                    <span className={cn('mt-2 hidden truncate text-[10px] font-bold uppercase tracking-[.1em] sm:block', index === step ? 'text-primary' : 'text-muted-foreground')}>
                      {item.key === 'bodyType' ? 'Shape' : item.key === 'transmission' ? 'Gearbox' : item.key === 'use' ? 'Use' : item.key}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-hidden border border-border/80 bg-card">
              <div className="border-b border-border/70 bg-secondary/35 px-5 py-6 sm:px-9 sm:py-8">
                <p className="luxxy-label text-accent">{question.eyebrow}</p>
                <h2 id="question-title" className="mt-3 max-w-2xl font-display text-3xl font-semibold leading-tight text-primary sm:text-4xl">{question.title}</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{question.description}</p>
              </div>
              <div className="p-5 sm:p-9">
                <fieldset className="grid gap-3 sm:grid-cols-2">
                  <legend className="sr-only">{question.title}</legend>
                  {question.options.map((option) => (
                    <OptionButton key={option.value} option={option} selected={answers[question.key] === option.value} onSelect={() => choose(option.value)} />
                  ))}
                </fieldset>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-6">
                  <p className="text-xs leading-5 text-muted-foreground">Not sure? Pick the closest answer. We keep the matching forgiving.</p>
                  <Button type="button" onClick={next} disabled={!answers[question.key]} data-testid={step === questions.length - 1 ? 'button-see-matches' : 'button-next-question'}>
                    {step === questions.length - 1 ? 'See my matches' : 'Next question'}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="mt-12" aria-labelledby="results-title">
            <div className="grid overflow-hidden border border-border bg-primary text-primary-foreground lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="px-6 py-8 sm:px-10 sm:py-10">
                <p className="luxxy-kicker text-accent">Your shortlist</p>
                <h2 id="results-title" className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">A considered place to start.</h2>
                <p className="mt-3 max-w-2xl text-base leading-7 text-primary-foreground/70" aria-live="polite" data-testid="text-results-announcement">
                  {hasStrongMatch ? 'These are the strongest matches for the answers you gave us.' : 'There is not a perfect match in today’s stock, but these are the closest cars to your brief.'}
                </p>
              </div>
              <div className="border-t border-primary-foreground/15 bg-primary/60 px-6 py-6 sm:px-10 lg:border-l lg:border-t-0 lg:px-8 lg:py-8">
                <p className="luxxy-label text-primary-foreground/60">Your brief</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {questions.map((item) => answers[item.key] && (
                    <span key={item.key} className="border border-primary-foreground/20 px-2.5 py-1.5 text-xs font-semibold text-primary-foreground/85">
                      {answerLabel(item.key, answers[item.key] as string)}
                    </span>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => { setShowResults(false); setStep(0); setHasStarted(true); }} data-testid="button-change-answers" className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                    <SlidersHorizontal className="h-4 w-4" />
                    Change answers
                  </Button>
                  <Button type="button" variant="ghost" onClick={restart} data-testid="button-restart-results" className="text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground">
                    <RotateCcw className="h-4 w-4" />
                    Start again
                  </Button>
                </div>
              </div>
            </div>

            {!hasStrongMatch && (
              <div className="mt-7 flex gap-4 border border-accent/40 bg-accent/10 p-5 sm:p-6" data-testid="state-no-perfect-match">
                <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <h3 className="font-display text-xl font-semibold text-primary">No exact match today — and that is useful to know.</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">We would rather show you the nearest honest options than force a car into the wrong box. Try changing one answer, or call the team and tell us what you are looking for.</p>
                </div>
              </div>
            )}

            <div className="mt-8 grid gap-6 lg:grid-cols-3" data-testid="list-recommendations">
              {recommendations.map(({ car, matches, misses, score }, index) => (
                <div key={car.id} className="flex min-w-0 flex-col gap-3" data-testid={`recommendation-${car.id}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="luxxy-label text-accent">{index === 0 ? 'Best fit' : `Match ${index + 1}`}</span>
                    <span className="text-xs font-semibold text-muted-foreground">{score > 0 ? `${score} points from your brief` : 'Worth a closer look'}</span>
                  </div>
                  <CarCard
                    car={car}
                    stretchedLink
                    badges={[
                      index === 0 ? 'Best match' : `Match ${index + 1}`,
                      ...matches.slice(0, 2).map((match) => match.explanation),
                    ]}
                  />
                  <div className="border-t border-border/70 px-1 pt-4" data-testid={`recommendation-explanation-${car.id}`}>
                    <p className="luxxy-label text-accent">{matches.length > 0 ? 'Why it fits' : 'Why it is here'}</p>
                    {matches.length > 0 ? (
                      <ul className="mt-3 space-y-3" aria-label={`Matching answers for ${car.title || 'this car'}`}>
                        {matches.map((match) => (
                          <li key={match.key} className="flex items-start justify-between gap-3 text-sm" data-testid={`recommendation-match-${car.id}-${match.key}`}>
                            <span className="min-w-0">
                              <span className="block font-semibold leading-5 text-primary">{match.answer}</span>
                              <span className="block text-xs leading-5 text-muted-foreground">{match.explanation}</span>
                            </span>
                            <span className={cn(
                              'shrink-0 border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em]',
                              match.kind === 'flexible' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-secondary text-muted-foreground',
                            )}>
                              {match.kind === 'flexible' ? 'Flexible fallback' : match.key === 'use' ? 'Good fit' : 'Exact preference'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-muted-foreground" data-testid={`recommendation-no-direct-match-${car.id}`}>
                        None of your answers match this car directly; it is one of the closest live options.
                      </p>
                    )}
                    {misses.length > 0 && (
                      <div className="mt-5 border-t border-border/70 pt-4" data-testid={`recommendation-misses-${car.id}`}>
                        <p className="luxxy-label text-muted-foreground">Where it differs</p>
                        <ul className="mt-3 space-y-3" aria-label={`Missed preferences for ${car.title || 'this car'}`}>
                          {misses.map((miss) => (
                            <li key={miss.key} className="flex items-start justify-between gap-3 text-sm" data-testid={`recommendation-miss-${car.id}-${miss.key}`}>
                              <span className="min-w-0">
                                <span className="block font-semibold leading-5 text-primary">{miss.answer}</span>
                                <span className="block text-xs leading-5 text-muted-foreground">{miss.explanation}</span>
                              </span>
                              <span className="shrink-0 border border-border bg-background px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                                Missed preference
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <p className="px-1 text-sm leading-6 text-muted-foreground">{matchSummary(matches)}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
