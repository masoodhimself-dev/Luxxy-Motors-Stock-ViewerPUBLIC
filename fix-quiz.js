const fs = require('fs');
const path = 'artifacts/luxxy-motors/src/pages/find-my-car.tsx';
let content = fs.readFileSync(path, 'utf8');

// Add data-testid to option buttons
content = content.replace(
  /role="radio"\n\s+aria-checked=\{answers\[currentQuestion.key\] === option.value\}/g,
  'role="radio"\n                  data-testid={`option-${option.value}`}\n                  aria-checked={answers[currentQuestion.key] === option.value}'
);

// Remove auto-advance
content = content.replace(
  /setAnswers\(\(prev\) => \(\{ \.\.\.prev, \[currentQuestion\.key\]: value \}\)\);\n\s+if \(step < questions\.length - 1\) \{\n\s+setStep\(\(prev\) => prev \+ 1\);\n\s+\} else \{\n\s+setShowResults\(true\);\n\s+window\.scrollTo\(\{ top: 0 \}\);\n\s+\}/,
  'setAnswers((prev) => ({ ...prev, [currentQuestion.key]: value }));'
);

// Add the Next and See matches buttons
const nextButtonHtml = `
              <div className="mt-12 flex justify-between">
                {step > 0 ? (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setStep(step - 1)}
                    data-testid="button-back-question"
                    className="font-display text-[13px] font-bold uppercase tracking-widest text-primary border-2 border-primary rounded-none h-14 bg-background shadow-[4px_4px_0px_#111] hover:bg-primary hover:text-primary-foreground transition-all hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#111]"
                  >
                    <ArrowLeft className="mr-3 h-5 w-5" /> Back to previous question
                  </Button>
                ) : <div />}
                <Button
                  size="lg"
                  disabled={!answers[currentQuestion.key]}
                  onClick={() => {
                    if (step < questions.length - 1) {
                      setStep((prev) => prev + 1);
                    } else {
                      setShowResults(true);
                      window.scrollTo({ top: 0 });
                    }
                  }}
                  data-testid={step < questions.length - 1 ? 'button-next-question' : 'button-see-matches'}
                  className="font-display text-[13px] font-bold uppercase tracking-widest text-primary-foreground bg-primary border-2 border-primary rounded-none h-14 shadow-[4px_4px_0px_#E51D34] hover:bg-accent hover:border-accent transition-all hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#111]"
                >
                  {step < questions.length - 1 ? (
                    <>Next question <ArrowRight className="ml-3 h-5 w-5" /></>
                  ) : (
                    <>See my matches <Sparkles className="ml-3 h-5 w-5" /></>
                  )}
                </Button>
              </div>
`;

// Replace the old Back button
content = content.replace(
  /\{step > 0 && \(\n\s+<div className="mt-12 flex justify-start">\n\s+<Button[\s\S]+?<\/Button>\n\s+<\/div>\n\s+\)\}/,
  nextButtonHtml
);

fs.writeFileSync(path, content, 'utf8');
