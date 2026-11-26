(function () {
  const form = document.querySelector('[data-valuation]');
  if (!form) return;

  const registration = form.elements.registration;
  const mileage = form.elements.mileage;
  const panes = [...form.querySelectorAll('[data-pane]')];
  const steps = [...form.querySelectorAll('[data-st]')];
  let step = 1;

  function showStep(next) {
    step = next;
    panes.forEach((pane, index) => pane.hidden = next !== index + 1);
    steps.forEach((indicator, index) => {
      indicator.classList.toggle('on', index < next);
      if (index + 1 === next) indicator.setAttribute('aria-current', 'step');
      else indicator.removeAttribute('aria-current');
    });
    panes[next - 1].querySelector('h3').focus();
  }

  function advance() {
    if (step === 1) {
      const reg = registration.value.toUpperCase().replace(/\s/g, '');
      const miles = mileage.value.trim().replaceAll(',', '');
      registration.setCustomValidity(/^[A-Z0-9]{2,8}$/.test(reg) ? '' : 'Enter a valid registration.');
      mileage.setCustomValidity(/^\d{1,7}$/.test(miles) && Number(miles) <= 1000000 ? '' : 'Enter the current mileage in whole miles.');
      if (!registration.reportValidity() || !mileage.reportValidity()) return;

      form.querySelector('[data-valuation-reg]').textContent = reg;
      form.querySelector('[data-valuation-mileage]').textContent = Number(miles).toLocaleString('en-GB') + ' miles';
    }
    showStep(step + 1);
  }

  for (const input of [registration, mileage]) input.addEventListener('input', () => input.setCustomValidity(''));
  form.addEventListener('click', event => {
    if (event.target.closest('[data-next]')) advance();
    if (event.target.closest('[data-back]')) showStep(step - 1);
  });
  form.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || step !== 1 || event.isComposing || ![registration, mileage].includes(event.target)) return;
    event.preventDefault();
    advance();
  });

  const prefilledReg = new URLSearchParams(location.search).get('reg');
  if (prefilledReg) registration.value = prefilledReg.toUpperCase().replace(/\s/g, '').slice(0, 8);
})();
