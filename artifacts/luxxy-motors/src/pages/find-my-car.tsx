import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, RotateCcw } from 'lucide-react';
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

const stepLabels = ['Budget', 'Body style', 'Fuel', 'Gearbox', 'Everyday use'];

const questions: Question[] = [
  {
    key: 'budget',
    eyebrow: '01 / five',
    title: 'What would feel comfortable?',
    description: 'A guide price is enough. We will keep a little flexibility for the right car.',
    options: [
      { value: 'under-10000', label: 'Up to £10,000', detail: 'Browse within a £10,000 guide price' },
      { value: '10000-15000', label: '£10,000 – £15,000', detail: 'Browse within this guide price' },
      { value: '15000-22000', label: '£15,000 – £22,000', detail: 'Browse within this guide price' },
      { value: 'over-22000', label: '£22,000 or more', detail: 'Start your search from £22,000' },
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
      { value: 'diesel', label: 'Diesel', detail: 'Include diesel vehicles' },
      { value: 'hybrid', label: 'Hybrid or electric', detail: 'Include hybrid and electric vehicles' },
      { value: 'any', label: 'Open to options', detail: 'Include all fuel types' },
    ],
  },
  {
    key: 'transmission',
    eyebrow: '04 / five',
    title: 'Which gearbox feels right?',
    description: 'Choose your preferred transmission.',
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
      { value: 'city', label: 'City and short trips', detail: 'Mostly local journeys and shorter drives' },
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
        'group flex min-h-[5rem] w-full items-center justify-between gap-5 rounded-sm border bg-card px-5 py-4 text-left transition-[border-color,background-color,transform] duration-200  hover:border-primary/50  focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected ? 'border-accent bg-accent/10 shadow-none' : 'border-border/80',
      )}
    >
      <span className="min-w-0">
        <span className="block font-display text-base sm:text-lg font-semibold leading-tight text-primary">{option.label}</span>
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasNavigated = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [recommendationView, setRecommendationView] = useState<'cards' | 'compact' | 'shortlist'>('cards');

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
    if (hasNavigated.current) headingRef.current?.focus();
    hasNavigated.current = true;
  }, [step, showResults]);

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
      <div className="luxxy-shell min-h-[70dvh]">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:px-12">
          <div className="animate-pulse space-y-8" aria-label="Loading Find My Car" data-testid="state-loading">
            <div className="h-3 w-32 bg-muted" />
            <div className="h-16 max-w-2xl bg-muted" />
            <div className="grid gap-4 md:grid-cols-3">
              {[1, 2, 3].map((item) => <div key={item} className="h-64 border border-border/60 bg-card" />)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="luxxy-shell min-h-[70dvh]">
        <div className="mx-auto flex min-h-[70dvh] max-w-xl flex-col items-start justify-center px-5 py-16 sm:px-8">
          <p className="luxxy-kicker">Find My Car</p>
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight text-primary">Stock could not be loaded</h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">We could not load the live stock just now. Please try again and we will get you back to the right cars.</p>
          <Button type="button" onClick={() => window.location.reload()} data-testid="button-retry-stock" className="mt-8">
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const stockCount = stock?.cars?.length ?? 0;

  if (stockCount === 0) {
    return (
      <div className="luxxy-shell min-h-[70dvh]">
        <div className="mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center px-5 py-16 sm:px-8 lg:px-12">
          <p className="luxxy-kicker">Find My Car</p>
          <h1 className="mt-5 max-w-2xl font-display text-2xl font-semibold leading-tight text-primary sm:text-3xl">No vehicles available to match</h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground">There are no cars available to match at this moment. Our stock changes regularly, so please check back soon or speak with the team about what is arriving.</p>
          <a href="/enquire?type=general" className="mt-6 inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-4">Tell us what you are looking for</a>
          <Button type="button" onClick={() => window.location.reload()} data-testid="button-refresh-empty-stock" className="mt-9 w-fit">
            Check live stock again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="luxxy-shell min-h-[70dvh] overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14 lg:px-12">
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-7">
          <div>
            <p className="luxxy-kicker">Find my car</p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-primary sm:text-4xl">A little guidance. A shorter shortlist.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Five questions to help you explore our {stockCount} available {stockCount === 1 ? 'car' : 'cars'}. No contact details needed.</p>
          </div>
          <a href="/#stock" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline underline-offset-4">Browse all stock <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
        </header>

        {!showResults ? (
          <div className="grid gap-10 pt-7 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-16 lg:pt-10">
          <section className="min-w-0" aria-labelledby="question-title">
            <nav aria-label="Your car preferences" className="mb-8 grid grid-cols-5 gap-2">
              {questions.map((item, index) => (
                <button key={item.key} type="button" disabled={!answers[item.key] && index !== step} onClick={() => setStep(index)} aria-current={index === step ? 'step' : undefined} aria-label={`${stepLabels[index]}${answers[item.key] ? ': ' + answerLabel(item.key, answers[item.key]!) : ''}`} className={cn('min-h-11 border-t-2 pt-2 text-left text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50', index === step ? 'border-accent text-primary' : answers[item.key] ? 'border-primary text-primary' : 'border-border text-muted-foreground')}>
                  <span className="block">0{index + 1}</span><span className="mt-1 hidden sm:block">{stepLabels[index]}</span>
                </button>
              ))}
            </nav>
            <p className="luxxy-kicker text-accent">Question {step + 1} of 5 · {stepLabels[step]}</p>
            <h2 ref={headingRef} tabIndex={-1} id="question-title" className="mt-3 font-display text-2xl font-semibold leading-tight text-primary outline-none sm:text-3xl">{question.title}</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{question.description}</p>
            <fieldset className="mt-6 grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{question.title}</legend>
              {question.options.map((option) => <OptionButton key={option.value} option={option} selected={answers[question.key] === option.value} onSelect={() => choose(option.value)} />)}
            </fieldset>
            <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
              {hasStarted ? <button type="button" onClick={back} data-testid="button-back-question" className="inline-flex min-h-11 items-center gap-2 px-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-accent"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</button> : <span className="text-xs text-muted-foreground">Choose one option</span>}
              <Button type="button" onClick={next} disabled={!answers[question.key]} data-testid={step === questions.length - 1 ? 'button-see-matches' : 'button-next-question'}>
                {step === questions.length - 1 ? 'See my matches' : 'Continue'}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </section>
          <aside className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0" aria-label="Your preferences">
            <div className="flex items-baseline justify-between gap-2"><h2 className="font-display text-xl font-semibold">Your brief</h2><span className="text-xs text-muted-foreground" aria-live="polite">{answeredCount} of 5 answered</span></div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Your answers guide the shortlist. Edit any selection as you go.</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-5 lg:block">
              {questions.map((item, index) => <div key={item.key} className="border-b border-border py-3"><dt className="text-xs text-muted-foreground">{stepLabels[index]}</dt><dd className="mt-1 text-sm font-medium">{answers[item.key] ? <button type="button" onClick={() => setStep(index)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent" aria-label={`Edit ${stepLabels[index]}: ${answerLabel(item.key, answers[item.key]!)}`}>{answerLabel(item.key, answers[item.key]!)}<span className="text-xs text-accent">Edit</span></button> : <span className="text-muted-foreground">Not selected</span>}</dd></div>)}
            </dl>
            <button type="button" onClick={restart} data-testid="button-restart-quiz" className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Start over</button>
            {answeredCount === questions.length && <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => setShowResults(true)}>Update my matches</Button>}
            <div className="mt-5 border-t border-border pt-5"><p className="text-sm leading-6 text-muted-foreground">Prefer to talk it through?</p><a href="/enquire?type=general" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline underline-offset-4">Ask the team</a></div>
          </aside>
          </div>
        ) : (
          <section className="mt-6" aria-labelledby="results-title">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <h2 ref={headingRef} tabIndex={-1} id="results-title" className="font-display text-2xl font-semibold tracking-tight">Your matches</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground" aria-live="polite" data-testid="text-results-announcement">
                  {hasStrongMatch ? 'The closest matches for your answers, with any differences explained below.' : 'No close match in current stock. These are the nearest alternatives.'}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">{questions.filter(item => answers[item.key]).map(item => answerLabel(item.key, answers[item.key] as string)).join(' · ')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => { setShowResults(false); setStep(0); setHasStarted(true); }} data-testid="button-change-answers">Change answers</Button>
                <Button type="button" variant="ghost" onClick={restart} data-testid="button-restart-results">Start again</Button>
              </div>
            </div>
            <div className="mt-5 inline-flex border border-border" aria-label="View your matches">
              {(['cards', 'compact', 'shortlist'] as const).map(view => <button key={view} type="button" aria-pressed={recommendationView === view} onClick={() => setRecommendationView(view)} data-testid={`button-recommendation-view-${view}`} className={cn('min-h-11 px-4 text-sm capitalize', recommendationView === view ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground')}>{view}</button>)}
            </div>

            {!hasStrongMatch && (
              <div className="mt-7 flex gap-4 border border-accent/40 bg-accent/10 p-5 sm:p-6" data-testid="state-no-perfect-match">
                <div>
                  <h3 className="font-display text-xl font-semibold text-primary">Some preferences may need a compromise</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Try changing an answer, or contact the team about upcoming stock.</p>
                </div>
              </div>
            )}

            <div
              className={cn(
                'mt-8 grid items-start gap-6',
                recommendationView === 'cards' ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
              )}
              data-testid="list-recommendations"
              data-recommendation-view={recommendationView}
            >
              {recommendations.map(({ car, matches, misses, score }, index) => (
                <div
                  key={car.id}
                  className={cn(
                    'flex min-w-0 flex-col gap-3',
                    recommendationView === 'shortlist' && index === 0 && 'lg:col-span-2',
                  )}
                  data-testid={`recommendation-${car.id}`}
                  data-match-score={score}
                >
                  <CarCard
                    car={car}
                    stretchedLink
                    layout={recommendationView === 'compact' || (recommendationView === 'shortlist' && index > 0) ? 'compact' : 'card'}

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
                              'shrink-0 text-[10px] font-medium',
                              match.kind === 'flexible' ? 'text-accent' : 'text-muted-foreground',
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
                              <span className="shrink-0 text-[10px] font-medium tracking-normal text-muted-foreground">
                                Missed preference
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                </div>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-between gap-5 border-y border-border py-7">
              <div><h3 className="font-display text-xl font-semibold">Still looking for the right car?</h3><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">These suggestions use the stock details available. Check each vehicle and speak to us about anything important to you.</p></div>
              <a href="/enquire?type=general" className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent underline underline-offset-4">Talk to the team<ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
